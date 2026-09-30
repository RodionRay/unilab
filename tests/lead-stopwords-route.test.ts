import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LEAD_ID,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {findMinusHit} from '@/lib/lead-filter';

const SETTINGS={
  name:'Проект',
  keywords:'остатки, синхронизация, МойСклад, несколько кабинетов',
  minusKeywords:'вакансия',
  avoidTopics:'',
  leadCriteria:'Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов',
  hotSignals:'ищу сервис, кто пользуется, синхронизация остатков',
  product:'Платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов',
};

/** Words of the product / marketplace context that must never land in a stop-list. */
const FORBIDDEN=/(^|, )(остатк|озон|ozon|wildberries|селлер|маркетплейс|склад|синхрониз|кабинет|подскажите|здравствуйте|нал|бот)/iu;

const TARGETS=[
  'Ищу сервис для синхронизации остатков на wildberries и ozon',
  'Подскажите сервис для синхронизации остатков между WB и Ozon, у кого что работает?',
  'Кто пользовался МойСклад с Ozon? Как настроить выгрузку остатков?',
  'Здравствуйте! Подскажите бот для склада, нужна синхронизация кабинетов',
];

/** Learned stop-lists must not reject target messages; single-word terms must not be product words. */
function expectCleanStopLists(s:{minusKeywords:string;avoidTopics:string}){
  const terms=`${s.minusKeywords}, ${s.avoidTopics}`.split(',').map((t)=>t.trim()).filter(Boolean);
  for(const t of TARGETS)expect(findMinusHit(t,terms),t).toBe('');
  expect(terms.filter((t)=>!/\s/.test(t)).join(', ')).not.toMatch(FORBIDDEN);
}

function storedSettings():{minusKeywords:string;avoidTopics:string}{
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='settings'").get(SETTINGS_ID) as {data:string};
  return JSON.parse(row.data);
}

/** Stubs the DeepSeek chat endpoint with one fixed JSON answer. */
function stubAi(content:Record<string,unknown>){
  vi.stubEnv('AI_API_KEY','sk-test-not-real');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200,headers:{'Content-Type':'application/json'}})));
}

const POLLUTED_MINUS='вакансия, казино, остатков, озон, селлер, склад, подскажите, нал, бот, синхронизации';

const NOISY='Здравствуйте! Подскажите бот склад остатков озон селлерам маркетплейсов синхронизации, казино рулетка казино рулетка';

describe('workspace API: auto-learning keeps product words out of stop-lists',()=>{
  beforeEach(()=>{
    vi.stubEnv('AI_API_KEY','');
    resetWorkspace();
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(SETTINGS),SETTINGS_ID);
    login(OWNER);
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reject_lead_stopwords adds only non-product terms',async()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'L',message:NOISY,status:'new'}),LEAD_ID);

    const res=await POST(postRequest({action:'reject_lead_stopwords',id:LEAD_ID}));

    expect(res.status).toBe(200);
    const s=storedSettings();
    expectCleanStopLists(s);
    expect(s.minusKeywords).toMatch(/казино|рулетка/);
  });

  it('train_from_ignored adds only non-product terms',async()=>{
    for(let i=0;i<4;i++){
      addRecord(`66666666-6666-4666-8666-66666666666${i}`,'lead',{name:'L',message:NOISY,status:'new',excludeFromTraining:true});
    }

    const res=await POST(postRequest({action:'train_from_ignored'}));

    expect(res.status).toBe(200);
    const s=storedSettings();
    expectCleanStopLists(s);
    expect(s.minusKeywords).toMatch(/казино|рулетка/);
  });

  it('train_from_hot keeps LLM minus words of the product out of minusKeywords',async()=>{
    addRecord('77777777-7777-4777-8777-777777777771','lead',{name:'L',message:'Ищу сервис для синхронизации остатков WB и МойСклад',status:'new',temperature:'hot'});
    stubAi({plus:['синхронизация остатков'],minus:['остатков','озон','склад','бот','казино','ставки на спорт'],examples:['ищу сервис для остатков']});

    const res=await POST(postRequest({action:'train_from_hot'}));

    expect(res.status).toBe(200);
    const s=storedSettings();
    expectCleanStopLists(s);
    expect(s.minusKeywords).toMatch(/казино/);
    expect(s.minusKeywords).toMatch(/ставки на спорт/);
  });

  it('rebuild_product sanitizes the LLM minusKeywords',async()=>{
    stubAi({product:SETTINGS.product,keywords:SETTINGS.keywords,leadCriteria:SETTINGS.leadCriteria,hotSignals:SETTINGS.hotSignals,minusKeywords:'вакансия, накрутка, остатков, озон, селлер, бот'});

    const res=await POST(postRequest({action:'rebuild_product'}));

    expect(res.status).toBe(200);
    expect(storedSettings().minusKeywords).toBe('вакансия, накрутка');
  });

  it('reject_lead_stopwords reports when every candidate overlapped the product',async()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'L',message:'Остатков синхронизации кабинетов',status:'new'}),LEAD_ID);

    const res=await POST(postRequest({action:'reject_lead_stopwords',id:LEAD_ID}));

    const body=await res.json() as {minusAdded:string[];minusSkippedAsProduct:number};
    expect(body.minusAdded).toEqual([]);
    expect(body.minusSkippedAsProduct).toBeGreaterThan(0);
  });

  it('preview_lead_core sanitizes a polluted stop-list at read time',async()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...SETTINGS,minusKeywords:POLLUTED_MINUS,avoidTopics:'озон, селлер'}),SETTINGS_ID);

    const res=await POST(postRequest({action:'preview_lead_core',message:'Ищу сервис для синхронизации остатков на wildberries и ozon'}));

    const body=await res.json() as {decision:{pass:boolean;rejectReason:string}};
    expect(body.decision.rejectReason).toBe('');
    expect(body.decision.pass).toBe(true);
  });

  it('preview_lead_core still rejects genuine spam minus',async()=>{
    const res=await POST(postRequest({action:'preview_lead_core',message:'Лучшее казино онлайн, заходи и выигрывай каждый день',minusKeywords:'казино'}));

    const body=await res.json() as {decision:{rejectReason:string}};
    expect(body.decision.rejectReason).toContain('казино');
  });

  it('preview_lead_core rejects oversized stop-list input',async()=>{
    const res=await POST(postRequest({action:'preview_lead_core',message:'тест',minusKeywords:'а'.repeat(8001)}));

    expect(res.status).toBe(400);
  });
});
