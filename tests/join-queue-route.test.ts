import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const SETTINGS={
  name:'Проект',
  product:'Облачная платформа для селлеров Wildberries, Ozon и Яндекс Маркет: остатки, заказы, цены, отзывы. Синхронизация с 1С и МойСклад.',
  keywords:'остатки, синхронизация, мойсклад, несколько кабинетов, ищу сервис',
  hotSignals:'ищу сервис, кто пользуется, синхронизация остатков',
  leadCriteria:'Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов',
  audience:'Селлеры Wildberries, Ozon и Яндекс Маркет; интеграторы 1С и МойСклад',
  minusKeywords:'вакансия',
};

const G_WB='a0000000-0000-4000-8000-000000000001';
const G_OZON='a0000000-0000-4000-8000-000000000002';
const G_SMM='a0000000-0000-4000-8000-000000000003';
const G_JOINED_SMM='a0000000-0000-4000-8000-000000000004';
const ACC2='11111111-1111-4111-8111-111111111112';

function group(id:string){
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='group'").get(id) as {data:string};
  return JSON.parse(row.data);
}
function account(id:string){
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='account'").get(id) as {data:string};
  return JSON.parse(row.data);
}
function unjoined(name:string,url:string,extra:Record<string,unknown>={}){
  return {name,url,accountId:ACCOUNT_ID,status:'setup',membership:'none',joinedAt:'',joinState:'queued',joinStateAt:'2026-09-30T10:00:00Z',joinStateError:'',...extra};
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose API JSON in assertions
async function body(res:Response){return await res.json() as any}

/** Worker stub: every /join-group answers `answer`; other calls fail like an offline worker. */
function stubWorker(answer:Record<string,unknown>){
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    calls.push(String(url));
    if(String(url).endsWith('/join-group'))return Response.json(answer);
    throw new Error('offline');
  }));
  return calls;
}

describe('workspace API: relevance gate before joining',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    const db=testDb().sqlite;
    db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(SETTINGS),SETTINGS_ID);
    db.prepare('UPDATE records SET secret=? WHERE id=?').run(await seal(JSON.stringify({session:'s'}),OWNER),ACCOUNT_ID);
    addRecord(G_WB,'group',unjoined('WB Official Chat','https://t.me/wb_official_chat_test'));
    addRecord(G_OZON,'group',unjoined('Ozon | Чат поставщиков','https://t.me/ozon_suppliers_test'));
    addRecord(G_SMM,'group',unjoined('DNative — блог Ткачука про SMM','https://t.me/dnative',{source:'tgstat-blogs'}));
    addRecord(G_JOINED_SMM,'group',{...unjoined('Бескромный','https://t.me/beskromny_test',{source:'tgstat-blogs'}),membership:'joined',joinedAt:'2026-09-20T10:00:00Z',joinState:'',status:'active'});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('heal queues only relevant groups, best first, and parks off-niche ones with a reason',async()=>{
    const res=await POST(postRequest({action:'heal_dead_group_accounts'}));
    const data=await body(res);

    expect(res.status).toBe(200);
    const ids=data.items.map((i:{id:string})=>i.id);
    expect(ids).not.toContain(G_SMM);
    expect(new Set(ids)).toEqual(new Set([G_WB,G_OZON]));
    const smm=group(G_SMM);
    expect(smm.joinState).toBe('');
    expect(smm.joinRelevance.band).toBe('skip');
    expect(smm.joinRelevance.reasons.length).toBeGreaterThan(0);
    // Joined groups are untouched by the gate.
    expect(group(G_JOINED_SMM).joinRelevance).toBeUndefined();
    expect(group(G_JOINED_SMM).membership).toBe('joined');
  });

  it('rescan_groups returns the join queue ordered by relevance score',async()=>{
    const res=await POST(postRequest({action:'rescan_groups'}));
    const data=await body(res);

    const scores=data.rejoinItems.map((i:{id:string})=>group(i.id).joinRelevance.score);
    expect(scores.length).toBe(2);
    expect([...scores].sort((a:number,b:number)=>b-a)).toEqual(scores);
    expect(data.joinStats).toMatchObject({auto:2,skip:1});
  });

  it('join_group refuses a parked group without calling the worker',async()=>{
    const calls=stubWorker({ok:true,join:'joined'});
    await POST(postRequest({action:'heal_dead_group_accounts'}));

    const res=await POST(postRequest({action:'join_group',id:G_SMM}));
    const data=await body(res);

    expect(res.status).toBe(409);
    expect(data.parked).toBe(true);
    expect(data.error).toMatch(/Не вступать/);
    expect(calls.filter(u=>u.endsWith('/join-group'))).toHaveLength(0);
  });

  it('manual enqueue approves the group; automatic enqueue does not',async()=>{
    await POST(postRequest({action:'heal_dead_group_accounts'}));

    const auto=await body(await POST(postRequest({action:'enqueue_joins',groupIds:[G_SMM]})));
    expect(auto.items).toHaveLength(0);
    expect(auto.parked).toBe(1);

    const manual=await body(await POST(postRequest({action:'enqueue_joins',groupIds:[G_SMM],manual:true})));
    expect(manual.items.map((i:{id:string})=>i.id)).toEqual([G_SMM]);
    expect(group(G_SMM)).toMatchObject({joinDecision:'approved',joinState:'queued'});
  });

  it('owner can approve, skip and reset a group; skip leaves the queue',async()=>{
    await POST(postRequest({action:'heal_dead_group_accounts'}));

    const skip=await body(await POST(postRequest({action:'set_group_join_decision',groupIds:[G_WB],decision:'skipped'})));
    expect(skip.ok).toBe(true);
    expect(group(G_WB)).toMatchObject({joinDecision:'skipped',joinState:''});
    const healed=await body(await POST(postRequest({action:'heal_dead_group_accounts'})));
    expect(healed.items.map((i:{id:string})=>i.id)).not.toContain(G_WB);

    const approve=await body(await POST(postRequest({action:'set_group_join_decision',groupIds:[G_SMM],decision:'approved'})));
    expect(approve.items.map((i:{id:string})=>i.id)).toEqual([G_SMM]);
    expect(group(G_SMM).joinDecision).toBe('approved');

    await POST(postRequest({action:'set_group_join_decision',groupIds:[G_WB],decision:''}));
    expect(group(G_WB).joinDecision).toBe('');
  });

  it('rescore_join_queue reports band counts and clears the queue of parked groups',async()=>{
    const res=await POST(postRequest({action:'rescore_join_queue'}));
    const data=await body(res);

    expect(res.status).toBe(200);
    expect(data.counts).toMatchObject({auto:2,skip:1,joined:1});
    expect(data.cleared).toBe(1);
    expect(group(G_SMM).joinState).toBe('');
    expect(group(G_WB).joinState).toBe('queued');
  });

  it('a form save keeps the relevance and the owner decision',async()=>{
    await POST(postRequest({action:'set_group_join_decision',groupIds:[G_SMM],decision:'skipped'}));
    const g=group(G_SMM);
    const res=await POST(postRequest({action:'save',kind:'group',id:G_SMM,data:{name:'DNative',url:g.url,accountId:ACCOUNT_ID}}));
    expect(res.status).toBe(200);
    expect(group(G_SMM).joinDecision).toBe('skipped');
  });
});

describe('workspace API: join pacing',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    const db=testDb().sqlite;
    db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(SETTINGS),SETTINGS_ID);
    const sealed=await seal(JSON.stringify({session:'s'}),OWNER);
    db.prepare('UPDATE records SET secret=?, created=? WHERE id=?').run(sealed,'2026-01-01T00:00:00Z',ACCOUNT_ID);
    addRecord(G_WB,'group',unjoined('WB Official Chat','https://t.me/wb_official_chat_test'));
    await POST(postRequest({action:'heal_dead_group_accounts'}));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('FloodWait pauses the account for exactly the demanded time plus margin',async()=>{
    stubWorker({ok:false,join:'flood',error:'FloodWait 1000с',waitSec:1000});
    const before=Date.now();

    const res=await POST(postRequest({action:'join_group',id:G_WB}));

    expect(res.status).toBe(429);
    const acc=account(ACCOUNT_ID);
    const pause=(Date.parse(acc.floodUntil)-before)/1000;
    expect(pause).toBeGreaterThanOrEqual(1150-2);
    expect(pause).toBeLessThanOrEqual(1150+2);
    expect(acc.status).toBe('active');
    expect(group(G_WB).joinAttempts||0).toBe(0);
  });

  it('a successful join sets a randomized next slot minutes ahead and clears the reservation',async()=>{
    stubWorker({ok:true,join:'joined',title:'WB Official Chat'});

    const res=await POST(postRequest({action:'join_group',id:G_WB}));

    expect(res.status).toBe(200);
    const acc=account(ACCOUNT_ID);
    const gap=(Date.parse(acc.joinNextAt)-Date.now())/1000;
    expect(gap).toBeGreaterThanOrEqual(350);
    expect(gap).toBeLessThanOrEqual(900);
    expect(acc.joinReservedUntil||'').toBe('');
    expect(acc.joinsToday).toBe(1);
    expect(group(G_WB).membership).toBe('joined');
  });

  it('PEER_FLOOD puts the account into spamblock instead of burning more joins',async()=>{
    stubWorker({ok:false,join:'peer_flood',status:'spamblock',error:'PEER_FLOOD: Telegram ограничил аккаунт'});

    await POST(postRequest({action:'join_group',id:G_WB}));

    expect(account(ACCOUNT_ID).status).toBe('spamblock');
  });

  it('a busy account hands the join to another ready farm account (parallel across accounts)',async()=>{
    const sealed=await seal(JSON.stringify({session:'s2'}),OWNER);
    addRecord(ACC2,'account',{name:'Farm 2',phone:'+79990001123',status:'active',proxyId:''},sealed);
    testDb().sqlite.prepare('UPDATE records SET created=? WHERE id=?').run('2026-01-01T00:00:00Z',ACC2);
    const busy={...account(ACCOUNT_ID),joinReservedUntil:new Date(Date.now()+120_000).toISOString()};
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(busy),ACCOUNT_ID);
    stubWorker({ok:true,join:'joined'});

    const res=await POST(postRequest({action:'join_group',id:G_WB}));

    expect(res.status).toBe(200);
    expect(group(G_WB).accountId).toBe(ACC2);
    expect(account(ACC2).joinsToday).toBe(1);
  });

  it('«Слот не видит @» from 3 distinct accounts marks the link dead',async()=>{
    const ids=[ACC2,'11111111-1111-4111-8111-111111111113'];
    for(const [i,id] of ids.entries()){
      addRecord(id,'account',{name:`F${i}`,phone:`+7999000113${i}`,status:'active',proxyId:''},await seal(JSON.stringify({session:`x${i}`}),OWNER));
      testDb().sqlite.prepare('UPDATE records SET created=? WHERE id=?').run('2026-01-01T00:00:00Z',id);
    }
    stubWorker({ok:false,join:'missing',usernameMissing:true,error:'Слот не видит @wb_official_chat_test'});

    for(let i=0;i<3;i++)await POST(postRequest({action:'join_group',id:G_WB}));

    const g=group(G_WB);
    expect(new Set(g.joinMissingAccounts).size).toBe(3);
    expect(g.joinDead).toBe(true);
    const again=await POST(postRequest({action:'join_group',id:G_WB}));
    expect(again.status).toBe(409);
  });

  it('scan: «Слот не видит @» rotates only to untried accounts and stops at the cap',async()=>{
    const ids=[ACC2,'11111111-1111-4111-8111-111111111113','11111111-1111-4111-8111-111111111114'];
    for(const [i,id] of ids.entries()){
      addRecord(id,'account',{name:`S${i}`,phone:`+7999000114${i}`,status:'active',proxyId:''},await seal(JSON.stringify({session:`s${i}`}),OWNER));
    }
    const joined={...group(G_WB),membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active',joinState:''};
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(joined),G_WB);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:false,usernameMissing:true,join:'missing',error:'Слот не видит @wb_official_chat_test'})));

    const tried=new Set<string>();
    for(let i=0;i<5;i++){
      tried.add(group(G_WB).accountId);
      await POST(postRequest({action:'scan_group',id:G_WB,force:true}));
    }

    const g=group(G_WB);
    expect(g.joinDead).toBe(true);
    expect(new Set(g.joinMissingAccounts).size).toBe(3);
    expect(tried.size).toBe(3);
  });
});
