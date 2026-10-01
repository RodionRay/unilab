import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LEAD_ID,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const SETTINGS={
  name:'Проект',
  keywords:'остатки, синхронизация, МойСклад, несколько кабинетов',
  minusKeywords:'вакансия',
  avoidTopics:'',
  leadCriteria:'Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов',
  hotSignals:'ищу сервис, кто пользуется, синхронизация остатков',
  product:'Платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов',
};

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

describe('workspace API: no auto-learned stop-words',()=>{
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

  it.each(['reject_lead_stopwords','train_from_ignored','set_lead_training_exclude','bulk_set_lead_training_exclude'])('%s is removed and leaves the stop-list untouched',async(action)=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'L',message:NOISY,status:'new'}),LEAD_ID);

    const res=await POST(postRequest({action,id:LEAD_ID,ids:[LEAD_ID],exclude:true}));

    expect(res.status).toBe(400);
    expect(storedSettings().minusKeywords).toBe(SETTINGS.minusKeywords);
    const lead=JSON.parse((testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(LEAD_ID) as {data:string}).data);
    expect(lead.excludeFromTraining).toBeUndefined();
  });

  it('train_from_hot learns plus words only and never touches minusKeywords',async()=>{
    addRecord('77777777-7777-4777-8777-777777777771','lead',{name:'L',message:'Ищу сервис для синхронизации остатков WB и МойСклад',status:'new',temperature:'hot'});
    stubAi({plus:['синхронизация остатков'],minus:['казино','ставки на спорт'],examples:['ищу сервис для остатков']});

    const res=await POST(postRequest({action:'train_from_hot'}));

    expect(res.status).toBe(200);
    const s=storedSettings() as {minusKeywords:string;avoidTopics:string;keywords:string};
    expect(s.minusKeywords).toBe(SETTINGS.minusKeywords);
    expect(s.keywords).toMatch(/синхронизация остатков/);
  });

  it('rebuild_product sanitizes the LLM minusKeywords',async()=>{
    stubAi({product:SETTINGS.product,keywords:SETTINGS.keywords,leadCriteria:SETTINGS.leadCriteria,hotSignals:SETTINGS.hotSignals,minusKeywords:'вакансия, накрутка, остатков, озон, селлер, бот'});

    const res=await POST(postRequest({action:'rebuild_product'}));

    expect(res.status).toBe(200);
    expect(storedSettings().minusKeywords).toBe('вакансия, накрутка');
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
