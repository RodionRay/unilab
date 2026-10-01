import {beforeEach,describe,expect,it} from 'vitest';
import {createTestD1,type TestD1} from './helpers/d1-sqlite';
import {
  TICK_LOCK_TTL_MS,
  acquireTickLock,
  mergeTickResult,
  renewTickLock,
  tickCommitFromSnapshot,
  updateTaskData,
} from '@/lib/processes/tick-lock';
import {TickLockLostError,WorkerBusyError,isRetryableTickError,tickRetryPatch} from '@/lib/processes/tick-retry';
import {WORKER_LONGEST_APP_TIMEOUT_MS} from '@/lib/worker-timeouts';

const ID='c1111111-1111-4111-8111-111111111111';
let d1:TestD1;

function seed(data:Record<string,unknown>){
  d1.sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .run(ID,'o','invite_task',JSON.stringify(data),null,'2026-09-30T00:00:00.000Z');
}
const row=()=>JSON.parse((d1.sqlite.prepare('SELECT data FROM records WHERE id=?').get(ID) as {data:string}).data);

describe('tick lock primitives',()=>{
  beforeEach(()=>{d1=createTestD1()});

  it('TTL outlives the longest single worker call',()=>{
    expect(TICK_LOCK_TTL_MS).toBeGreaterThan(WORKER_LONGEST_APP_TIMEOUT_MS);
  });

  it('only one of two acquires wins; the loser sees the winner token',async()=>{
    seed({status:'running'});
    const [a,b]=await Promise.all([
      acquireTickLock(d1.db,'o',ID,'invite_task',{token:'a'}),
      acquireTickLock(d1.db,'o',ID,'invite_task',{token:'b'}),
    ]);
    expect([a,b].filter(Boolean)).toHaveLength(1);
    expect(row().tickLockId).toBe((a??b)!.token);
  });

  it('an expired lock is taken, a live one is not',async()=>{
    const now=Date.parse('2026-09-30T12:00:00.000Z');
    seed({status:'running',tickLockUntil:'2026-09-30T11:59:59.000Z',tickLockId:'old'});
    expect(await acquireTickLock(d1.db,'o',ID,'invite_task',{now,token:'new'})).not.toBeNull();
    expect(await acquireTickLock(d1.db,'o',ID,'invite_task',{now,token:'third'})).toBeNull();
    expect(row().tickLockId).toBe('new');
  });

  it('renew extends only our own lock',async()=>{
    seed({status:'running'});
    const lock=(await acquireTickLock(d1.db,'o',ID,'invite_task',{token:'mine'}))!;
    expect(await renewTickLock(d1.db,lock,{now:Date.now()+10_000})).toBe(true);
    expect(await renewTickLock(d1.db,{...lock,token:'someone'})).toBe(false);
  });

  it('updateTaskData retries when the row changed under it',async()=>{
    seed({status:'running',done:1});
    let first=true;
    const stored=await updateTaskData(d1.db,'o',ID,'invite_task',fresh=>{
      if(first){
        first=false;
        d1.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...fresh,status:'paused'}),ID);
      }
      return {...fresh,done:Number(fresh.done)+1};
    });
    expect(stored).toMatchObject({status:'paused',done:2});
    expect(row()).toMatchObject({status:'paused',done:2});
  });
});

describe('mergeTickResult',()=>{
  const patch={status:'running',nextAt:'2026-09-30T12:01:00.000Z',done:5,error:'',tickLockUntil:'x'};

  it('running + our lock: full patch, lock released',()=>{
    const out=mergeTickResult({status:'running',tickLockId:'t',tickLockUntil:'z',done:4},'invite_task','t',{patch});
    expect(out).toMatchObject({status:'running',nextAt:patch.nextAt,done:5,tickLockUntil:'',tickLockId:''});
  });

  it('paused by the user: progress only, status and schedule stay',()=>{
    const out=mergeTickResult({status:'paused',nextAt:'',tickLockId:'t',done:4,log:[]},'invite_task','t',{patch,entries:[{level:'ok',text:'+1'}]});
    expect(out).toMatchObject({status:'paused',nextAt:'',done:5,tickLockUntil:''});
    expect(out.log).toHaveLength(1);
  });

  it('lock taken by another tick: progress only, their lock stays',()=>{
    const out=mergeTickResult({status:'running',tickLockId:'other',tickLockUntil:'z',nextAt:''},'invite_task','t',{patch});
    expect(out).toMatchObject({status:'running',nextAt:'',done:5,tickLockId:'other',tickLockUntil:'z'});
  });
});

describe('tickCommitFromSnapshot',()=>{
  it('patch = changed keys, entries = appended log lines',()=>{
    const base={status:'running',done:1,name:'a',log:[{at:'1',level:'info' as const,text:'old'}]};
    const next={...base,done:2,log:[...base.log,{at:'2',level:'ok' as const,text:'new'}]};
    expect(tickCommitFromSnapshot(base,next)).toEqual({patch:{done:2},entries:[{at:'2',level:'ok',text:'new'}]});
  });
});

describe('tick retry',()=>{
  it('busy, lock lost and abort timeouts are retryable; other errors are not',()=>{
    expect(isRetryableTickError(new WorkerBusyError('busy'))).toBe(true);
    expect(isRetryableTickError(new TickLockLostError('lost'))).toBe(true);
    expect(isRetryableTickError(Object.assign(new Error('t'),{name:'TimeoutError'}))).toBe(true);
    expect(isRetryableTickError(new Error('FLOOD_WAIT'))).toBe(false);
  });

  it('retry lands 30–60 s ahead and keeps the task running',()=>{
    const now=Date.parse('2026-09-30T12:00:00.000Z');
    expect(tickRetryPatch(new WorkerBusyError('x'),now,()=>0).patch).toEqual({status:'running',error:'',nextAt:'2026-09-30T12:00:30.000Z'});
    expect(tickRetryPatch(new WorkerBusyError('x'),now,()=>0.9999).patch.nextAt).toBe('2026-09-30T12:01:00.000Z');
  });
});
