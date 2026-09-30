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

/** Words of the product / marketplace context that must never land in a stop-list. */
const FORBIDDEN=/(^|, )(остатк|озон|ozon|wildberries|селлер|маркетплейс|склад|синхрониз|кабинет|подскажите|здравствуйте|нал|бот)/iu;

function storedSettings():{minusKeywords:string;avoidTopics:string}{
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='settings'").get(SETTINGS_ID) as {data:string};
  return JSON.parse(row.data);
}

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
    expect(s.minusKeywords).not.toMatch(FORBIDDEN);
    expect(s.avoidTopics).not.toMatch(FORBIDDEN);
    expect(s.minusKeywords).toMatch(/казино|рулетка/);
  });

  it('train_from_ignored adds only non-product terms',async()=>{
    for(let i=0;i<4;i++){
      addRecord(`66666666-6666-4666-8666-66666666666${i}`,'lead',{name:'L',message:NOISY,status:'new',excludeFromTraining:true});
    }

    const res=await POST(postRequest({action:'train_from_ignored'}));

    expect(res.status).toBe(200);
    const s=storedSettings();
    expect(s.minusKeywords).not.toMatch(FORBIDDEN);
    expect(s.avoidTopics).not.toMatch(FORBIDDEN);
    expect(s.minusKeywords).toMatch(/казино|рулетка/);
  });
});
