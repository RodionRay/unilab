import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {classifyCollectFailure,insertAudienceUsers} from '@/lib/processes/audience-tick';
import {telegramEntityKey} from '@/lib/record-identity';

const ACC='c3333333-3333-4333-8333-333333333333';
const ACC2='c5555555-5555-4555-8555-555555555555';
const PROXY='c6666666-6666-4666-8666-666666666666';
const AUD='c2222222-2222-4222-8222-222222222222';
const OTHER_AUD='c4444444-4444-4444-8444-444444444444';

type WorkerHandler=(path:string,body:Record<string,unknown>)=>unknown;
const calls:{path:string;body:Record<string,unknown>}[]=[];

function stubWorker(handler:WorkerHandler){
  calls.length=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:{body:string})=>{
    const path=new URL(String(url)).pathname;
    const body=JSON.parse(init.body) as Record<string,unknown>;
    calls.push({path,body});
    const out=await handler(path,body);
    return out instanceof Response?out:Response.json(out);
  }));
}

type Row=Record<string,unknown>&{status?:string;nextAt?:string;error?:string;log:{level:string;text:string}[]};
function row(id:string):Row{
  const r=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(r.data);
}
function audienceRows(taskId:string){
  return (testDb().sqlite.prepare("SELECT data FROM records WHERE kind='audience_user'").all() as {data:string}[])
    .map(r=>JSON.parse(r.data) as {taskId:string;userId:string})
    .filter(u=>u.taskId===taskId);
}

async function tick(){
  const res=await POST(postRequest({action:'tick_audience',id:AUD}));
  return {status:res.status,body:await res.json() as Record<string,unknown>};
}

async function seedAccount(id:string,extra:Record<string,unknown>={}){
  addRecord(id,'account',{name:`Acc ${id.slice(0,2)}`,phone:`+7999${id.slice(0,7)}`,status:'active',...extra},
    await seal(JSON.stringify({kind:'tdata',zipBase64:'eA=='}),OWNER));
}

function seedTask(extra:Record<string,unknown>={}){
  addRecord(AUD,'audience_task',{
    name:'Src',url:'https://t.me/src_chat',status:'running',accountIds:[ACC],collected:0,hasMore:true,
    collectMode:'discussions',rangeMode:'count',messageLimit:5000,cursor:'',log:[],...extra,
  });
}

/** SQL the route sends while `fn` runs. */
async function sqlDuring(fn:()=>Promise<unknown>){
  const db=testDb().db;
  const orig=db.prepare.bind(db);
  const sqls:string[]=[];
  const spy=vi.spyOn(db,'prepare').mockImplementation((sql:string)=>{sqls.push(sql);return orig(sql)});
  try{await fn()}finally{spy.mockRestore()}
  return sqls;
}
const ownerWideAudienceScan=(sql:string)=>/kind='audience_user'/.test(sql)&&!/taskId/.test(sql);

const secondsUntil=(iso:unknown)=>(Date.parse(String(iso))-Date.now())/1000;
const users=(...ids:number[])=>ids.map(i=>({userId:String(i),username:`u${i}`,name:`U${i}`,status:'recently'}));

describe('tick_audience (REQ-A1..A9)',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    addRecord(PROXY,'proxy',{name:'P',host:'proxy.example.com',port:1080,protocol:'socks5',status:'active'});
    await seedAccount(ACC,{proxyId:PROXY});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('REQ-A1 collect RPC errors are classified',()=>{
    it('FloodWait waits it out on the task; the account stays active',async()=>{
      seedTask();
      stubWorker(()=>({ok:false,status:'flood',waitSec:900,error:'FloodWait 900с'}));

      await tick();

      const t=row(AUD);
      expect(t.status).toBe('running');
      expect(secondsUntil(t.nextAt)).toBeGreaterThan(850);
      expect(row(ACC).status).toBe('active');
    });

    it('a generic worker failure (status disconnected) does not mark the slot unauthorized',async()=>{
      seedTask();
      stubWorker(()=>({ok:false,status:'disconnected',error:'RPCError 400: SOMETHING_ODD'}));

      await tick();

      expect(row(ACC).status).toBe('active');
      expect(row(AUD).status).toBe('running');
    });

    it('private source is a task error, not an account fault',async()=>{
      seedTask();
      stubWorker(()=>({ok:false,status:'source_error',join:'private',error:'Источник закрыт для аккаунта'}));

      await tick();

      expect(row(AUD)).toMatchObject({status:'error',error:'Источник закрыт для аккаунта'});
      expect(row(ACC).status).toBe('active');
    });

    it('a dead auth key still marks the slot unauthorized',async()=>{
      seedTask();
      stubWorker(()=>({ok:false,status:'unauthorized',error:'AuthKeyUnregisteredError: auth key'}));

      await tick();

      expect(row(ACC).status).toBe('unauthorized');
    });

    it('classifies worker answers',()=>{
      expect(classifyCollectFailure({status:'flood',waitSec:5})).toEqual({kind:'flood',waitSec:60});
      expect(classifyCollectFailure({status:'transient',error:'RpcCallFailError'})).toEqual({kind:'transient'});
      expect(classifyCollectFailure({status:'source_error',join:'banned'})).toEqual({kind:'slot_blind'});
      expect(classifyCollectFailure({status:'frozen'})).toEqual({kind:'frozen'});
    });
  });

  describe('REQ-A2 a timeout in the worker answer is not a proxy fault',()=>{
    for(const error of ['Таймаут воркера','Операция прервана (таймаут/отмена)','The operation was aborted due to timeout']){
      it(`"${error}" → retry tick, proxy and account untouched`,async()=>{
        seedTask();
        stubWorker(()=>({ok:false,status:'disconnected',error}));

        await tick();

        const t=row(AUD);
        expect(t.status).toBe('running');
        expect(secondsUntil(t.nextAt)).toBeGreaterThan(20);
        expect(row(ACC).status).toBe('active');
        expect(row(PROXY).telegramOk).toBeUndefined();
      });
    }

    it('a real proxy failure still quarantines the proxy and parks the slot',async()=>{
      seedTask();
      stubWorker(()=>({ok:false,status:'proxy_error',error:'Не удалось подключиться к Telegram через прокси'}));

      await tick();

      expect(row(PROXY).telegramOk).toBe(false);
      expect(row(ACC).status).toBe('proxy_error');
    });

    it('a thrown worker transport error does not mark the proxy either',async()=>{
      seedTask();
      stubWorker(()=>{throw new Error('ECONNREFUSED 10.0.0.5:8790')});

      await tick();

      expect(row(PROXY).telegramOk).toBeUndefined();
      expect(row(ACC).status).toBe('active');
      expect(row(AUD).status).toBe('running');
    });
  });

  describe('REQ-A3/A4/A7 joining the source',()=>{
    const needJoin={ok:false,join:'need_join',error:'Аккаунт не в группе'};

    it('join request pending → task paused «ждём одобрения заявки», no join loop',async()=>{
      seedTask();
      stubWorker(path=>path==='/collect-audience'?needJoin:{ok:true,status:'pending',join:'requested',error:'Заявка на вступление отправлена'});

      await tick();
      await tick();

      const t=row(AUD);
      expect(t.status).toBe('paused');
      expect(String(t.error)).toContain('ждём одобрения заявки');
      expect(calls.filter(c=>c.path==='/join-group')).toHaveLength(1);
    });

    it('join pace gate: a slot that joined a minute ago does not join again now',async()=>{
      await seedAccount(ACC2,{});
      testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACC);
      await seedAccount(ACC,{lastJoinAt:new Date(Date.now()-60_000).toISOString()});
      seedTask();
      stubWorker(path=>path==='/collect-audience'?needJoin:{ok:true,join:'joined'});

      await tick();

      expect(calls.filter(c=>c.path==='/join-group')).toHaveLength(0);
      const t=row(AUD);
      expect(t.status).toBe('running');
      expect(secondsUntil(t.nextAt)).toBeGreaterThan(30);
    });

    it('successful join bumps join counters and saves the source peer for the next tick',async()=>{
      seedTask();
      stubWorker(path=>path==='/collect-audience'?needJoin:{ok:true,join:'joined',channelId:'777',accessHash:'42',title:'Src'});

      await tick();

      expect(row(ACC)).toMatchObject({joinsToday:1});
      expect(row(ACC).lastJoinAt).toBeTruthy();
      expect(row(AUD)).toMatchObject({sourceChannelId:'777',sourceAccessHash:'42',sourceAccountId:ACC,status:'running'});

      stubWorker(()=>({ok:true,users:[],hasMore:true,cursor:'0'}));
      await tick();
      expect(calls[0]!.body.peerHint).toEqual({channelId:'777',accessHash:'42'});
    });

    it('FloodWait on join paces the account and waits on the task',async()=>{
      seedTask();
      stubWorker(path=>path==='/collect-audience'?needJoin:{ok:false,join:'flood',error:'FloodWait 600с',waitSec:600});

      await tick();

      expect(row(ACC).lastJoinAt).toBeTruthy();
      expect(row(ACC).status).toBe('active');
      expect(secondsUntil(row(AUD).nextAt)).toBeGreaterThan(550);
    });
  });

  describe('REQ-A6 audience rows',()=>{
    it('sends the latest ids of this task only and never stores a (task,user) twice',async()=>{
      seedTask();
      const insert=testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)');
      const old=new Date(Date.now()-3_600_000).toISOString();
      insert.run('d0000000-0000-4000-8000-000000000000',OWNER,'audience_user',JSON.stringify({taskId:AUD,userId:'1'}),null,old);
      testDb().sqlite.transaction(()=>{
        for(let i=2;i<=5001;i++){
          insert.run(`e${String(i).padStart(7,'0')}-0000-4000-8000-000000000000`,OWNER,'audience_user',JSON.stringify({taskId:AUD,userId:String(i)}),null,new Date().toISOString());
        }
      })();
      insert.run('f0000000-0000-4000-8000-000000000000',OWNER,'audience_user',JSON.stringify({taskId:OTHER_AUD,userId:'9999'}),null,new Date().toISOString());
      stubWorker(()=>({ok:true,users:users(1,6000,6000,6001),hasMore:true,cursor:'80'}));

      const sqls=await sqlDuring(tick);

      expect(sqls.filter(ownerWideAudienceScan)).toEqual([]);
      const seen=calls[0]!.body.seenIds as string[];
      expect(seen).toHaveLength(5000);
      expect(seen).toContain('5001');
      expect(seen).not.toContain('1');
      expect(seen).not.toContain('9999');
      const rows=audienceRows(AUD);
      expect(rows.filter(u=>u.userId==='1')).toHaveLength(1);
      expect(rows.filter(u=>u.userId==='6000')).toHaveLength(1);
      expect(rows).toHaveLength(5003);
      expect(row(AUD).collected).toBe(2);
    });

    it('a re-inserted (task,user) is ignored at the database level',async()=>{
      const db=testDb().db;
      expect(await insertAudienceUsers(db,OWNER,AUD,[{userId:'42'},{userId:'43'}])).toBe(2);
      expect(await insertAudienceUsers(db,OWNER,AUD,[{userId:'42'}])).toBe(0);
      expect(audienceRows(AUD).map(u=>u.userId).sort()).toEqual(['42','43']);
    });

    it('export returns only this task, in collection order',async()=>{
      seedTask();
      stubWorker(()=>({ok:true,users:users(10,11,12),hasMore:true,cursor:'3'}));
      await tick();
      addRecord('f1000000-0000-4000-8000-000000000000','audience_user',{taskId:OTHER_AUD,userId:'77'});

      let res=new Response();
      const sqls=await sqlDuring(async()=>{res=await POST(postRequest({action:'export_audience',id:AUD,format:'json'}))});
      const body=await res.json() as {users:{userId:string}[]};

      expect(sqls.filter(ownerWideAudienceScan)).toEqual([]);
      expect(body.users.map(u=>u.userId)).toEqual(['10','11','12']);
    });
  });

  describe('REQ-A5/A8 cursor, truncation, message budget',()=>{
    it('passes scannedMessages and accumulates messagesScanned across ticks',async()=>{
      seedTask({collectMode:'comments',messageLimit:100});
      stubWorker(()=>({ok:true,users:users(1),hasMore:true,cursor:'900',messagesScanned:60}));

      await tick();
      await tick();

      expect(calls[0]!.body.scannedMessages).toBe(0);
      expect(calls[1]!.body.scannedMessages).toBe(60);
      expect(row(AUD).scannedMessages).toBe(120);
    });

    it('Telegram participants cap is logged as a warning',async()=>{
      seedTask();
      stubWorker(()=>({ok:true,users:users(1),hasMore:false,cursor:'10000',truncated:true,warning:'Telegram отдал 10000 из 25000 участников'}));

      await tick();

      const t=row(AUD);
      expect(t.status).toBe('completed');
      expect(t.log.some(e=>e.level==='warn'&&e.text.includes('10000 из 25000'))).toBe(true);
    });
  });

  describe('REQ-A9 source links',()=>{
    it('t.me/s/<name> is the same source as t.me/<name>, not a shared "t.me/s" key',()=>{
      expect(telegramEntityKey('https://t.me/s/Durov_Chat')).toBe('t.me/durov_chat');
      expect(telegramEntityKey('https://t.me/s/other_chat')).not.toBe(telegramEntityKey('https://t.me/s/durov_chat'));
      expect(telegramEntityKey('https://t.me/c/1234567890/55')).toBe('t.me/c/1234567890');
    });
  });
});
