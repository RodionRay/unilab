import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,PROXY_ID,addRecord,resetWorkspace,testDb} from './helpers/workspace-harness';
import {TOKENS,vkCallResponse,vkWorker} from './helpers/vk-worker';
import {seal} from '@/lib/server-store';
import {moscowDayKey} from '@/lib/telegram-accounts';
import {fetchVkSearch,VK_SEARCH_PAGES_PER_RUN} from '@/lib/vk/fetch';
import {VK_SEARCH_METHOD} from '@/lib/vk/pool';
import {openVkSession} from '@/lib/vk/session';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);

const NOW=Date.parse('2026-10-01T10:00:00Z');
const ACC_A='b0000000-0000-4000-8000-00000000000a';
const ACC_B='b0000000-0000-4000-8000-00000000000b';
const CAP=500;
const KEYWORDS=['k1','k2','k3','k4','k5','k6','k7','k8'];

/** `calls` (all methods today) decides the pick order: least used first. */
async function addAccount(id:string,token:string,searchCalls:number,calls=searchCalls){
  addRecord(id,'vk_account',{vkUserId:id.endsWith('a')?700101:700102,name:id,proxyId:PROXY_ID,status:'active',error:'',
    counters:{day:moscowDayKey(new Date(NOW)),calls,searchCalls}},await seal(token,OWNER));
}

function counters(id:string):{searchCalls:number}{
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data).counters;
}

const searchesBy=(token:string)=>vkWorker.batches.filter(b=>b.token===token).flatMap(b=>b.methods).filter(m=>m===VK_SEARCH_METHOD).length;

/** Every keyword always has a next page, so the run wants 8 keywords × 3 pages = 24 search calls. */
async function searchRun(){
  const session=await openVkSession({
    db:testDb().db,owner:OWNER,caps:{search:CAP,calls:0},deadlineAt:NOW+45_000,now:()=>NOW,
    post:async(_path,body)=>(await vkCallResponse(body as Parameters<typeof vkCallResponse>[0])).json(),
  });
  try{
    const outcome=await fetchVkSearch(session.run,{keywords:KEYWORDS,cursor:{},depthCutoffSec:0,nowSec:Math.floor(NOW/1000)});
    return {outcome,stats:session.stats};
  }finally{
    await session.close();
  }
}

describe('openVkSession REQ-10 daily newsfeed.search cap within one run',()=>{
  beforeEach(()=>{
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(NOW);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    resetWorkspace();
    testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.status','active') WHERE id=?").run(PROXY_ID);
    vkWorker.reset();
    vkWorker.override=(m,p)=>m!==VK_SEARCH_METHOD?undefined
      :{ok:true,response:{items:[{id:1,owner_id:700400,from_id:700400,date:NOW/1000,text:'x'}],next_from:`${String(p.q)}-${String(p.start_from??'p1')}+`,profiles:[],groups:[]}};
  });
  afterEach(()=>{
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('an account one call below the cap sends one search call, then the run stops and keeps the cursor',async()=>{
    await addAccount(ACC_A,TOKENS.a,CAP-1);

    const {outcome,stats}=await searchRun();

    expect(searchesBy(TOKENS.a)).toBe(1);
    expect(counters(ACC_A).searchCalls).toBe(CAP);
    expect(stats.noAccount).toBe(true);
    expect(outcome.incomplete).toBe(true);
    expect(outcome.cursor.searchStartTime).toBeUndefined();
    expect(Object.keys(outcome.cursor.searchPaging?.next??{}).sort()).toEqual(KEYWORDS);
  });

  it('an account one call below the cap hands the remaining search calls to another account',async()=>{
    await addAccount(ACC_A,TOKENS.a,CAP-1);
    await addAccount(ACC_B,TOKENS.b,0,CAP*2);

    const {outcome,stats}=await searchRun();

    const wanted=KEYWORDS.length*VK_SEARCH_PAGES_PER_RUN;
    expect(searchesBy(TOKENS.a)).toBe(1);
    expect(searchesBy(TOKENS.b)).toBe(wanted-1);
    expect(counters(ACC_A).searchCalls).toBe(CAP);
    expect(counters(ACC_B).searchCalls).toBe(wanted-1);
    expect(stats).toMatchObject({accountsUsed:[ACC_A,ACC_B],failovers:1,noAccount:false});
    expect(outcome.incomplete).toBe(false);
  });
});
