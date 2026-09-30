import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {clearStaleJoinState,JOIN_STATE_STALE_MS} from '@/lib/processes/join-flow';
import {moscowDayKey} from '@/lib/telegram-accounts';

const ACC_A='a0000000-0000-4000-8000-00000000000a';
const ACC_B='b0000000-0000-4000-8000-00000000000b';
const GROUP='e0000000-0000-4000-8000-00000000000e';
const GROUP_2='e0000000-0000-4000-8000-0000000000e2';

let joinCalls=0;
let workerReply:Record<string,unknown>={ok:true,join:'joined',status:'active'};
/** Ответ воркера вместо workerReply: бросить (сеть/таймаут) или вернуть свой Response. */
let workerFailure:(()=>Response)|null=null;

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}
async function addAccount(id:string,data:Record<string,unknown>){
  addRecord(id,'account',{name:id.slice(0,1),status:'active',proxyId:'',limits:{invite:40},...data},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}
function addGroup(id:string,data:Record<string,unknown>){
  addRecord(id,'group',{name:'Целевая',url:`https://t.me/chat_${id.slice(0,4)}`,membership:'none',status:'setup',joinedAt:'',accountId:ACC_A,...data});
}
const join=(id:string)=>POST(postRequest({action:'join_group',id}));
const ago=(ms:number)=>new Date(Date.now()-ms).toISOString();

describe('ручное вступление: хвосты очереди и гонки',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    joinCalls=0;
    workerReply={ok:true,join:'joined',status:'active'};
    workerFailure=null;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(String(url).endsWith('/join-group')){
        joinCalls++;
        // Воркер отвечает не сразу: параллельный запрос успевает дойти до своей проверки темпа
        await new Promise(r=>setTimeout(r,20));
        if(workerFailure)return workerFailure();
        return Response.json(workerReply);
      }
      return Response.json({ok:false,error:'not stubbed'},{status:500});
    }));
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('залипший joinState',()=>{
    it('queued/waiting без производителя сбрасываются, joining/scanning — только по таймауту',()=>{
      const now=Date.now();
      expect(clearStaleJoinState({joinState:'queued',joinStateAt:ago(1000)},now)).toMatchObject({joinState:'',joinStateAt:''});
      expect(clearStaleJoinState({joinState:'waiting',joinStateAt:ago(1000)},now)).toMatchObject({joinState:''});
      expect(clearStaleJoinState({joinState:'joining',joinStateAt:ago(60_000)},now)).toBeNull();
      expect(clearStaleJoinState({joinState:'scanning',joinStateAt:ago(JOIN_STATE_STALE_MS+1000)},now)).toMatchObject({joinState:''});
      expect(clearStaleJoinState({joinState:'joining',joinStateAt:''},now)).toMatchObject({joinState:''});
      expect(clearStaleJoinState({joinState:''},now)).toBeNull();
    });

    it('GET отдаёт группу из старой очереди как невступившую, и join_group вступает',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{joinState:'queued',joinStateAt:ago(60_000)});

      const res=await GET();
      const body=await res.json() as {records:{id:string;data:{joinState:string}}[]};

      expect(body.records.find(r=>r.id===GROUP)?.data.joinState).toBe('');
      expect(rec(GROUP).joinState).toBe('');
      const joined=await join(GROUP);
      expect(joined.status).toBe(200);
      expect(joinCalls).toBe(1);
      expect(rec(GROUP).membership).toBe('joined');
    });

    it('heal_group_join_state снимает joining старше таймаута и не трогает свежий',async()=>{
      const FRESH='f0000000-0000-4000-8000-00000000000f';
      addGroup(GROUP,{joinState:'joining',joinStateAt:ago(JOIN_STATE_STALE_MS+60_000)});
      addGroup(FRESH,{joinState:'scanning',joinStateAt:ago(30_000)});

      const res=await POST(postRequest({action:'heal_group_join_state'}));

      expect(res.status).toBe(200);
      expect(rec(GROUP).joinState).toBe('');
      expect(rec(FRESH).joinState).toBe('scanning');
    });

    it('set_group_join_state больше не принимает queued/waiting',async()=>{
      addGroup(GROUP,{});

      const res=await POST(postRequest({action:'set_group_join_state',id:GROUP,joinState:'queued'}));

      expect(res.status).toBe(400);
      expect(rec(GROUP).joinState||'').toBe('');
    });
  });

  describe('темп и дневная квота аккаунта',()=>{
    it('два параллельных join_group одним аккаунтом: до воркера доходит один, второй — 429 темп',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{});
      addGroup(GROUP_2,{});

      const [a,b]=await Promise.all([join(GROUP),join(GROUP_2)]);
      const statuses=[a.status,b.status].sort();
      const loser=a.status===429?a:b;

      expect(statuses).toEqual([200,429]);
      expect(await loser.json()).toMatchObject({pace:true});
      expect(joinCalls).toBe(1);
      expect(rec(ACC_A).joinsToday).toBe(1);
    });

    it('неудача, которая не тратит вступление, возвращает счётчик и паузу',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{});
      workerReply={ok:false,status:'disconnected',error:'Таймаут воркера'};

      await join(GROUP);

      expect(joinCalls).toBe(1);
      expect(rec(ACC_A).joinsToday||0).toBe(0);
      expect(rec(ACC_A).lastJoinAt||'').toBe('');
    });

    it('таймаут воркера после резерва: вступление могло пройти — слот и счётчик остаются',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{});
      workerFailure=()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError')};

      const res=await join(GROUP);

      expect(res.status).toBe(503);
      expect(rec(ACC_A).joinsToday).toBe(1);
      expect(rec(ACC_A).lastJoinAt).toBeTruthy();
    });

    it('сетевой сбой после резерва тоже не возвращает слот',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{});
      workerFailure=()=>{throw new TypeError('fetch failed')};

      await join(GROUP);

      expect(rec(ACC_A).joinsToday).toBe(1);
      expect(rec(ACC_A).lastJoinAt).toBeTruthy();
    });

    it('воркер отказал до Telegram (429 занят) — слот и счётчик возвращаются',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{});
      workerFailure=()=>Response.json({error:'Воркер занят'},{status:429});

      await join(GROUP);

      expect(joinCalls).toBe(1);
      expect(rec(ACC_A).joinsToday||0).toBe(0);
      expect(rec(ACC_A).lastJoinAt||'').toBe('');
    });

    it('исчерпан дневной лимит — 429 limitReached, второй живой аккаунт не подставляется',async()=>{
      await addAccount(ACC_A,{limits:{invite:3},joinsToday:3,joinsDay:moscowDayKey()});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{});

      const res=await join(GROUP);

      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({limitReached:true});
      expect(joinCalls).toBe(0);
      expect(rec(GROUP).accountId).toBe(ACC_A);
    });
  });
});
