import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,SETTINGS_ID,addRecord,login,OWNER,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';
import {GROUP_CATALOG,isCatalogPlaceholderUrl} from '@/lib/group-catalog';
import {joinGateFor} from '@/lib/join-relevance';
import {telegramEntityKey} from '@/lib/record-identity';
import {seal} from '@/lib/server-store';
import {ROLE_PRESETS,ensureStaffTables} from '@/lib/staff';

const G_DEAD='b0000000-0000-4000-8000-000000000001';
const G_LIVE='b0000000-0000-4000-8000-000000000002';
const LEAD_IN_DEAD='b0000000-0000-4000-8000-000000000003';

const MISSING_PAGE='<html><head><meta property="og:title" content="Telegram: Contact @x"></head><body><div class="tgme_page"><div class="tgme_page_action"><a class="tgme_action_button_new" href="tg://resolve?domain=x">Send Message</a></div></div></body></html>';
const LIVE_PAGE='<html><head><meta property="og:title" content="Chat"></head><body><div class="tgme_page"><div class="tgme_page_title"><span dir="auto">Chat</span></div><div class="tgme_page_extra">1 200 members, 30 online</div></div></body></html>';

type GroupData=Record<string,unknown>;
type Answer={tme:'dead'|'live'|'offline';join?:Record<string,unknown>};

function groupRow(id:string):GroupData|null{
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='group'").get(id) as {data:string}|undefined;
  return row?JSON.parse(row.data) as GroupData:null;
}
function tombstones():GroupData[]{
  const rows=testDb().sqlite.prepare("SELECT data FROM records WHERE owner=? AND kind='dead_group'").all(OWNER) as {data:string}[];
  return rows.map(r=>JSON.parse(r.data) as GroupData);
}
function groupsWithKey(key:string):number{
  const rows=testDb().sqlite.prepare("SELECT data FROM records WHERE owner=? AND kind='group'").all(OWNER) as {data:string}[];
  return rows.filter(r=>telegramEntityKey(String((JSON.parse(r.data) as GroupData).url||''))===key).length;
}
function addTombstone(key:string){
  addRecord(crypto.randomUUID(),'dead_group',{key,url:`https://${key}`,name:'x',at:'2026-10-01T00:00:00Z'});
}
function unjoined(name:string,url:string,extra:GroupData={}):GroupData{
  return {name,url,accountId:ACCOUNT_ID,status:'setup',membership:'none',joinedAt:'',joinState:'queued',joinStateAt:'2026-09-30T10:00:00Z',joinStateError:'',joinDecision:'approved',joinWanted:true,...extra};
}

function tmeUsernames(calls:string[]):string[]{return calls.map(c=>c.replace('https://t.me/',''))}

/** t.me answers per `answer.tme`; /join-group answers `answer.join`; everything else is an offline worker. */
function stubNet(answer:Answer){
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const u=String(url);
    calls.push(u);
    if(u.startsWith('https://t.me/')){
      if(answer.tme==='offline')throw new Error('ENOTFOUND t.me');
      return new Response(answer.tme==='dead'?MISSING_PAGE:LIVE_PAGE);
    }
    if(u.endsWith('/join-group')&&answer.join)return Response.json(answer.join);
    throw new Error('offline');
  }));
  return {
    tme:()=>calls.filter(c=>c.startsWith('https://t.me/')),
    joins:()=>calls.filter(c=>c.endsWith('/join-group')),
  };
}

async function json(res:Response):Promise<Record<string,unknown>>{return await res.json() as Record<string,unknown>}

describe('workspace API: dead groups are never recommended or joined',()=>{
  beforeAll(async()=>{
    testDb();
    await ensureStaffTables();
  });
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    const db=testDb().sqlite;
    db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'Проект',product:'Сервис для селлеров Ozon',keywords:'ozon'}),SETTINGS_ID);
    db.prepare('UPDATE records SET secret=?, created=? WHERE id=?').run(await seal(JSON.stringify({session:'s'}),OWNER),'2026-01-01T00:00:00Z',ACCOUNT_ID);
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('join_group probes t.me first: a missing chat without leads is deleted and tombstoned, no account spent',async()=>{
    addRecord(G_DEAD,'group',unjoined('Ghost','https://t.me/ghost_chat_test'));
    const net=stubNet({tme:'dead',join:{ok:true,join:'joined'}});

    const res=await POST(postRequest({action:'join_group',id:G_DEAD}));
    const data=await json(res);

    expect(res.status).toBe(409);
    expect(data).toMatchObject({deadLink:true,removed:true,gate:'dead'});
    expect(data.error).toBe('Чат @ghost_chat_test не существует в Telegram');
    expect(net.joins()).toHaveLength(0);
    expect(groupRow(G_DEAD)).toBeNull();
    expect(tombstones().map(t=>t.key)).toEqual(['t.me/ghost_chat_test']);
  });

  it('a missing chat with leads is kept, marked dead with plain copy, and leaves the queue',async()=>{
    addRecord(G_DEAD,'group',unjoined('Ghost','https://t.me/ghost_chat_test',{leadsTotal:2}));
    addRecord(LEAD_IN_DEAD,'lead',{name:'L',message:'нужен сервис',status:'new',groupId:G_DEAD});
    stubNet({tme:'dead'});

    const res=await POST(postRequest({action:'join_group',id:G_DEAD}));
    const data=await json(res);

    expect(res.status).toBe(409);
    expect(data.removed).toBe(false);
    const g=groupRow(G_DEAD)!;
    expect(g).toMatchObject({joinDead:true,tmeMissing:true,joinState:'',error:'Чат @ghost_chat_test не существует в Telegram'});
    const gate=joinGateFor(g);
    expect(gate.state).toBe('dead');
    expect(gate.allow).toBe(false);
    expect(gate.reason).toBe('Чат @ghost_chat_test не существует в Telegram');
    expect(tombstones()).toHaveLength(0);
    const healed=await json(await POST(postRequest({action:'heal_dead_group_accounts'})));
    expect((healed.items as {id:string}[]).map(i=>i.id)).not.toContain(G_DEAD);
  });

  it('a probe network failure is not "dead": the join goes ahead after a single short probe',async()=>{
    addRecord(G_LIVE,'group',unjoined('Live','https://t.me/live_chat_test'));
    const net=stubNet({tme:'offline',join:{ok:true,join:'joined',title:'Live'}});

    const res=await POST(postRequest({action:'join_group',id:G_LIVE}));

    expect(res.status).toBe(200);
    expect(net.tme()).toHaveLength(1);
    expect(net.joins()).toHaveLength(1);
    expect(groupRow(G_LIVE)).toMatchObject({membership:'joined'});
    expect(groupRow(G_LIVE)!.joinDead).toBeFalsy();
  });

  it('a live probe is remembered and not repeated on the next attempt',async()=>{
    addRecord(G_LIVE,'group',unjoined('Live','https://t.me/live_chat_test'));
    const net=stubNet({tme:'live',join:{ok:false,join:'private',error:'Группа приватная'}});

    await POST(postRequest({action:'join_group',id:G_LIVE}));
    expect(groupRow(G_LIVE)!.tmeProbe).toBe('live');
    expect(String(groupRow(G_LIVE)!.tmeProbeAt||'')).not.toBe('');
    await POST(postRequest({action:'join_group',id:G_LIVE}));

    expect(net.tme()).toHaveLength(1);
  });

  it('import_catalog never re-adds a chat that was removed as dead',async()=>{
    const entry=GROUP_CATALOG.find(g=>g.verified&&g.url&&!isCatalogPlaceholderUrl(g.url))!;
    const key=telegramEntityKey(entry.url);
    addRecord(G_DEAD,'group',unjoined(entry.name,entry.url));
    stubNet({tme:'dead'});
    await POST(postRequest({action:'join_group',id:G_DEAD}));
    expect(groupsWithKey(key)).toBe(0);

    const res=await json(await POST(postRequest({action:'import_catalog'})));

    expect(res.ok).toBe(true);
    expect(groupsWithKey(key)).toBe(0);
  });

  it('existing dead groups are cleaned on the next tick, idempotently (no manual SQL)',async()=>{
    addRecord(G_DEAD,'group',unjoined('Ghost','https://t.me/ghost_chat_test',{joinDead:true,joinGaveUp:true,usernameMissing:true,joinMissingAccounts:['a1','a2','a3'],joinState:'',status:'error'}));
    addRecord(G_LIVE,'group',unjoined('Missing once','https://t.me/once_missing_test',{usernameMissing:true,joinMissingAccounts:['a1'],leadsTotal:1}));
    stubNet({tme:'dead'});

    await POST(postRequest({action:'heal_dead_group_accounts'}));
    await POST(postRequest({action:'heal_dead_group_accounts'}));

    expect(groupRow(G_DEAD)).toBeNull();
    expect(tombstones().map(t=>t.key)).toEqual(['t.me/ghost_chat_test']);
    expect(groupRow(G_LIVE)).toMatchObject({joinDead:true,tmeMissing:true,error:'Чат @once_missing_test не существует в Telegram'});
  });

  it('a witness-dead group that t.me shows alive is not deleted',async()=>{
    addRecord(G_DEAD,'group',unjoined('Farm lie','https://t.me/farm_lie_test',{joinDead:true,joinGaveUp:true,usernameMissing:true,joinState:'',status:'error'}));
    stubNet({tme:'live'});

    await POST(postRequest({action:'heal_dead_group_accounts'}));

    expect(groupRow(G_DEAD)).toMatchObject({joinDead:true});
    expect(groupRow(G_DEAD)!.tmeMissing).toBeFalsy();
    expect(tombstones()).toHaveLength(0);
  });

  it('the list (GET) never deletes or probes; confirmed dead groups go on the next tick',async()=>{
    addRecord(G_DEAD,'group',unjoined('Ghost','https://t.me/ghost_chat_test',{joinDead:true,tmeMissing:true,joinState:''}));
    addTombstone('t.me/old_ghost_test');
    const net=stubNet({tme:'dead'});

    const res=await GET();
    const data=await json(res);

    expect(res.status).toBe(200);
    expect(groupRow(G_DEAD)).not.toBeNull();
    expect(data.deadGroupKeys).toEqual(['t.me/old_ghost_test']);
    expect((data.records as {kind:string}[]).some(r=>r.kind==='dead_group')).toBe(false);
    expect(net.tme()).toHaveLength(0);

    await POST(postRequest({action:'heal_dead_group_accounts'}));
    expect(groupRow(G_DEAD)).toBeNull();
  });

  it('a viewer GET deletes nothing; staff without groups access gets no dead-chat keys',async()=>{
    addRecord(G_DEAD,'group',unjoined('Ghost','https://t.me/ghost_chat_test',{joinDead:true,tmeMissing:true,joinState:''}));
    addTombstone('t.me/old_ghost_test');
    stubNet({tme:'dead'});
    const db=testDb().sqlite;
    const member=(userId:string,role:'viewer'|'operator',groups:boolean)=>db.prepare('INSERT INTO workspace_members(id,workspace_owner_id,user_id,role,access,created) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(),OWNER,userId,role,JSON.stringify({...ROLE_PRESETS[role],groups}),new Date().toISOString());
    member('viewer-1','viewer',true);
    member('op-1','operator',false);

    login('viewer-1');
    const viewer=await json(await GET());
    login('op-1');
    const op=await json(await GET());

    expect(groupRow(G_DEAD)).not.toBeNull();
    expect(viewer.deadGroupKeys).toEqual(['t.me/old_ghost_test']);
    expect(op.deadGroupKeys).toEqual([]);
  });

  it('an unknown probe is not repeated for 30 minutes',async()=>{
    addRecord(G_LIVE,'group',unjoined('Live','https://t.me/live_chat_test'));
    const net=stubNet({tme:'offline',join:{ok:false,join:'private',error:'Группа приватная'}});

    await POST(postRequest({action:'join_group',id:G_LIVE}));
    expect(groupRow(G_LIVE)!.tmeProbe).toBe('unknown');
    await POST(postRequest({action:'join_group',id:G_LIVE}));

    expect(net.tme()).toHaveLength(1);
  });

  it('the tick probes at most 4 suspects, the least recently probed first',async()=>{
    const ids=['c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005'];
    const ages=['2026-09-01T05:00:00Z','2026-09-01T01:00:00Z','','2026-09-01T03:00:00Z','2026-09-01T02:00:00Z'];
    ids.forEach((id,i)=>addRecord(id,'group',unjoined(`S${i}`,`https://t.me/suspect_${i}_test`,{usernameMissing:true,leadsTotal:1,tmeProbe:ages[i]?'unknown':undefined,tmeProbeAt:ages[i]})));
    const net=stubNet({tme:'live'});

    await POST(postRequest({action:'heal_dead_group_accounts'}));

    expect(tmeUsernames(net.tme()).sort()).toEqual(['suspect_1_test','suspect_2_test','suspect_3_test','suspect_4_test']);
  });

  it('re-adding a removed chat by hand clears its tombstone (undo)',async()=>{
    addRecord(G_DEAD,'group',unjoined('Ghost','https://t.me/ghost_chat_test'));
    stubNet({tme:'dead'});
    await POST(postRequest({action:'join_group',id:G_DEAD}));
    await POST(postRequest({action:'join_group',id:G_DEAD}));
    expect(tombstones()).toHaveLength(1);

    const res=await POST(postRequest({action:'save',kind:'group',data:{name:'Ghost',url:'https://t.me/ghost_chat_test',accountId:ACCOUNT_ID}}));

    expect(res.status).toBe(200);
    expect(tombstones()).toHaveLength(0);
  });
});
