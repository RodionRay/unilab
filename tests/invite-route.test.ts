import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,cfModule,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));
vi.mock('@/lib/processes/invite-tick',async(importOriginal)=>{
  const real=await importOriginal<typeof import('@/lib/processes/invite-tick')>();
  return {
    ...real,
    interpretInviteWorkerResult:vi.fn(real.interpretInviteWorkerResult),
    inviteAccountStillLive:vi.fn(real.inviteAccountStillLive),
  };
});

import {POST} from '@/app/api/workspace/route';
import {interpretInviteWorkerResult} from '@/lib/processes/invite-tick';
import {seal} from '@/lib/server-store';
import {moscowDayKey,moscowNextMidnightIso} from '@/lib/telegram-accounts';

const ACC='c3333333-3333-4333-8333-333333333333';
const AUD='c2222222-2222-4222-8222-222222222222';
const OTHER_AUD='c5555555-5555-4555-8555-555555555555';
const INV='c1111111-1111-4111-8111-111111111111';
const userId=(n:number)=>`d000000${n}-0000-4000-8000-000000000000`;

type WorkerHandler=(path:string,body:Record<string,unknown>)=>unknown;
const calls:{path:string;body:Record<string,unknown>}[]=[];
function stubWorker(handler:WorkerHandler){
  calls.length=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:{body:string})=>{
    const path=new URL(String(url)).pathname;
    const body=JSON.parse(init.body) as Record<string,unknown>;
    calls.push({path,body});
    return Response.json(await handler(path,body));
  }));
}
const inviteWith=(result:unknown):WorkerHandler=>path=>{
  if(path==='/join-group')return {ok:true,join:'already'};
  if(path==='/invite-users')return result;
  return {ok:false,error:`unexpected ${path}`};
};
const invitedUsernames=()=>calls.filter(c=>c.path==='/invite-users')
  .flatMap(c=>(c.body.users as {username:string}[]).map(u=>u.username));

type Data=Record<string,unknown>&{log?:{text:string}[]};
function row(id:string):Data{
  const r=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(r.data);
}
async function tick(){
  const res=await POST(postRequest({action:'tick_invite',id:INV}));
  return {status:res.status,body:await res.json() as Record<string,unknown>};
}

async function seedFarm(account:Record<string,unknown>={}){
  addRecord(ACC,'account',{name:'Acc',phone:'+79990000001',status:'active',...account},await seal(JSON.stringify({kind:'tdata',zipBase64:'eA=='}),OWNER));
  addRecord(AUD,'audience_task',{name:'Src',url:'https://t.me/src_chat',sourceKind:'chat',status:'completed',accountIds:[ACC],log:[]});
  for(const n of [1,2,3])addRecord(userId(n),'audience_user',{taskId:AUD,userId:`200${n}`,username:`user${n}`,invited:false});
}
function seedInvite(extra:Record<string,unknown>={}){
  addRecord(INV,'invite_task',{
    name:'Inv',targetUrl:'https://t.me/target_chat',audienceTaskId:AUD,accountIds:[ACC],batchSize:3,
    status:'running',done:0,invitedToday:0,pauseFromSec:15,pauseToSec:15,stopDisconnectedPct:30,log:[],...extra,
  });
}

describe('tick_invite · результат воркера',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    await seedFarm();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('REQ-V2: need_admin — задача в ошибке с понятным текстом, пользователи не отмечены',async()=>{
    seedInvite();
    stubWorker(inviteWith({ok:true,results:[
      {userId:'2001',username:'user1',ok:false,error:'need_admin'},
      {userId:'2002',username:'user2',ok:false,error:'need_admin'},
    ]}));
    const r=await tick();
    const task=row(INV);
    expect(r.body.ok).toBe(false);
    expect(task.status).toBe('error');
    expect(String(task.error)).toMatch(/администратор/);
    expect(row(userId(1)).invited).toBe(false);
    expect(row(userId(2)).invited).toBe(false);
  });

  it('REQ-V2: канал / нерезолвимая цель без results — ошибка, а не вечный цикл',async()=>{
    seedInvite();
    stubWorker(inviteWith({ok:false,status:'target_error',targetError:'broadcast',error:'Цель — канал, не группа.',results:[]}));
    await tick();
    const task=row(INV);
    expect(task.status).toBe('error');
    expect(task.error).toBe('Цель — канал, не группа.');
    expect(task.nextAt).toBe('');
  });

  it('REQ-V2: цель не видит ни один слот при вступлении — ошибка, а не вечная ротация',async()=>{
    seedInvite();
    stubWorker(path=>path==='/join-group'
      ?{ok:false,status:'error',join:'missing',usernameMissing:true,error:'Слот не видит @target_chat'}
      :{ok:false,error:`unexpected ${path}`});
    await tick();
    const task=row(INV);
    expect(task.status).toBe('error');
    expect(String(task.error)).toMatch(/недоступна ни одному аккаунту/);
    expect(calls.map(c=>c.path)).not.toContain('/invite-users');
  });

  it('REQ-V2: после ошибки «канал» тот же адрес больше не сохраняется как цель',async()=>{
    seedInvite();
    stubWorker(inviteWith({ok:false,status:'target_error',targetError:'broadcast',error:'Цель — канал, не группа.',results:[]}));
    await tick();
    const res=await POST(postRequest({action:'save',kind:'invite_task',data:{
      name:'Inv 2',targetUrl:'https://t.me/target_chat',audienceTaskId:AUD,accountIds:[ACC],
    }}));
    expect(res.status).toBe(400);
  });

  it('REQ-V3: дневной лимит задачи → scheduled до полуночи МСК',async()=>{
    seedInvite({dailyLimitEnabled:true,dailyLimit:2,invitedToday:2,inviteDay:moscowDayKey()});
    stubWorker(inviteWith({ok:true,results:[]}));
    await tick();
    const task=row(INV);
    expect(task.status).toBe('scheduled');
    // moscowNextMidnightIso считается от Date.now() — сравниваем с точностью до секунды
    expect(Math.abs(Date.parse(String(task.nextAt))-Date.parse(moscowNextMidnightIso()))).toBeLessThan(1000);
    expect(calls.map(c=>c.path)).not.toContain('/invite-users');
  });

  it('REQ-V3: батч режется остатком дневного лимита',async()=>{
    seedInvite({dailyLimitEnabled:true,dailyLimit:3,invitedToday:2,inviteDay:moscowDayKey()});
    stubWorker(inviteWith({ok:true,results:[{userId:'2001',username:'user1',ok:true}]}));
    await tick();
    expect(invitedUsernames()).toHaveLength(1);
  });

  it('REQ-V4: already — отдельный счётчик без квоты; privacy — пропуск навсегда',async()=>{
    seedInvite();
    stubWorker(inviteWith({ok:true,results:[
      {userId:'2001',username:'user1',ok:true,error:'already'},
      {userId:'2002',username:'user2',ok:false,error:'privacy'},
      {userId:'2003',username:'user3',ok:true},
    ]}));
    await tick();
    const task=row(INV);
    expect(task.done).toBe(1);
    expect(task.invitedToday).toBe(1);
    expect(task.alreadyMembers).toBe(1);
    expect(task.skipped).toBe(1);
    expect(row(ACC).memberInvitesToday).toBe(1);
    expect(row(userId(1))).toMatchObject({invited:true,skipReason:'already'});
    expect(row(userId(2))).toMatchObject({invited:true,skipReason:'privacy'});
  });

  it('REQ-V5: FloodWait после инвайтов — квота аккаунта учтена',async()=>{
    seedInvite();
    stubWorker(inviteWith({ok:false,status:'floodwait',floodWait:600,results:[{userId:'2001',username:'user1',ok:true}]}));
    await tick();
    expect(row(ACC)).toMatchObject({memberInviteDay:moscowDayKey(),memberInvitesToday:1});
    expect(row(INV).done).toBe(1);
  });

  it('REQ-V6: кандидаты — только этой аудитории, не отмеченные, SQL-фильтр с LIMIT',async()=>{
    addRecord(userId(7),'audience_user',{taskId:OTHER_AUD,userId:'2007',username:'stranger',invited:false});
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({taskId:AUD,userId:'2002',username:'user2',invited:true}),userId(2));
    seedInvite({batchSize:20});
    const sql:string[]=[];
    const realDb=cfModule.env.DB as {prepare:(q:string)=>unknown};
    cfModule.env.DB=new Proxy(realDb,{get(target,key){
      if(key==='prepare')return (q:string)=>{sql.push(q);return target.prepare(q)};
      const v=Reflect.get(target,key);
      return typeof v==='function'?v.bind(target):v;
    }});
    try{
      stubWorker(inviteWith({ok:true,results:[]}));
      await tick();
    }finally{cfModule.env.DB=realDb}
    expect(invitedUsernames().sort()).toEqual(['user1','user3']);
    const audienceReads=sql.filter(q=>/audience_user/.test(q)&&/^\s*SELECT/i.test(q));
    expect(audienceReads.length).toBeGreaterThan(0);
    for(const q of audienceReads)expect(q).toMatch(/json_extract[\s\S]*LIMIT/i);
  });

  it('REQ-V7: тик использует interpretInviteWorkerResult из lib/processes/invite-tick',async()=>{
    seedInvite();
    stubWorker(inviteWith({ok:true,results:[{userId:'2001',username:'user1',ok:true}]}));
    vi.mocked(interpretInviteWorkerResult).mockClear();
    await tick();
    expect(interpretInviteWorkerResult).toHaveBeenCalledTimes(1);
  });
});

describe('save invite_task · тип цели',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    await seedFarm();
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});

  const save=(targetUrl:string,audienceTaskId=AUD)=>POST(postRequest({action:'save',kind:'invite_task',data:{
    name:'Inv',targetUrl,audienceTaskId,accountIds:[ACC],
  }}));

  it('REQ-V2: канал (известный как канал-источник) как цель инвайта отклоняется',async()=>{
    addRecord(OTHER_AUD,'audience_task',{name:'Chan',url:'https://t.me/news_channel',sourceKind:'channel',status:'completed',accountIds:[ACC],log:[]});
    const res=await save('https://t.me/news_channel');
    expect(res.status).toBe(400);
    expect(String((await res.json() as {error:string}).error)).toMatch(/канал/i);
  });

  it('обычная группа сохраняется',async()=>{
    const res=await save('https://t.me/target_chat');
    expect(res.status).toBe(200);
  });
});
