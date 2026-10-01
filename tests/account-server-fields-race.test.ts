import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LEAD_ID,OWNER,addRecord,cfModule,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const LIVE_ID='66666666-6666-4666-8666-666666666666';
const GROUP_ID='88888888-8888-4888-8888-888888888888';
const REPLY={text:'Да, интересно',mode:'dm',at:'2026-10-01T10:00:00.000Z',ok:true};
const APPLIED={hidden:true,applied:true,at:'2026-10-01T10:00:00.000Z',error:''};

function data(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}

/** What apply_account_last_seen commits: desired flag + applied state, by point json_set. */
function applyCommits(id:string){
  testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.hideLastSeen',json('true'),'$.lastSeenPrivacy',json(?)) WHERE id=?")
    .run(JSON.stringify(APPLIED),id);
}

function patchRow(id:string,patch:Record<string,unknown>){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...data(id),...patch}),id);
}

/** Runs `concurrent` once, right before the action's first whole-record write to `id`. */
function raceFirstWrite(id:string,concurrent:()=>void){
  let fired=false;
  const realDb=cfModule.env.DB as {prepare:(q:string)=>{bind:(...v:unknown[])=>Record<string,(...a:unknown[])=>unknown>}};
  cfModule.env.DB={
    prepare(q:string){
      const stmt=realDb.prepare(q);
      return {bind(...values:unknown[]){
        const bound=stmt.bind(...values);
        return {...bound,run:async()=>{
          if(!fired&&/^UPDATE records SET data=\?/.test(q)&&values.includes(id)){fired=true;concurrent()}
          return bound.run!();
        }};
      }};
    },
  };
  return ()=>{cfModule.env.DB=realDb};
}

/** Worker answers /check-account after apply_account_last_seen committed in the meantime. */
function workerAnswersAfterApply(id:string,answer:Record<string,unknown>|Error){
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(String(url).endsWith('/check-account'))applyCommits(id);
    if(answer instanceof Error)throw answer;
    return Response.json(answer);
  }));
}

async function addLiveAccount(extra:Record<string,unknown>={}){
  const secret=await seal(JSON.stringify({kind:'session',zipBase64:'UEsDBA==',apiId:1,apiHash:'h'}),OWNER);
  addRecord(LIVE_ID,'account',{name:'Live',phone:'+79990002233',status:'active',proxyId:'',joinsToday:3,...extra},secret);
}

describe('whole-record writers keep fields written concurrently by others',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
  });
  afterEach(()=>{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('check_account (успех) не затирает применённое во время проверки «был в сети»',async()=>{
    await addLiveAccount();
    workerAnswersAfterApply(LIVE_ID,{ok:true,status:'active',profile:{firstName:'Ivan'}});

    const res=await POST(postRequest({action:'check_account',id:LIVE_ID}));

    expect(res.status).toBe(200);
    const d=data(LIVE_ID);
    expect(d.lastSeenPrivacy).toEqual(APPLIED);
    expect(d.hideLastSeen).toBe(true);
    expect(d).toMatchObject({status:'active',firstName:'Ivan',checkingAt:''});
  });

  it('check_account (сбой коннекта) не затирает применённое и счётчики, записанные во время проверки',async()=>{
    await addLiveAccount();
    vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(String(url).endsWith('/check-account')){applyCommits(LIVE_ID);patchRow(LIVE_ID,{joinsToday:4})}
      throw new Error('fetch failed');
    }));

    await POST(postRequest({action:'check_account',id:LIVE_ID,rotateProxy:false}));

    const d=data(LIVE_ID);
    expect(d.lastSeenPrivacy).toEqual(APPLIED);
    expect(d.hideLastSeen).toBe(true);
    expect(d.joinsToday).toBe(4);
    expect(d.status).toBe('disconnected');
  });

  it('save со старой копией не затирает состояние, записанное apply между чтением и записью',async()=>{
    await addLiveAccount({hideLastSeen:true});
    const restore=raceFirstWrite(LIVE_ID,()=>applyCommits(LIVE_ID));
    try{
      const res=await POST(postRequest({action:'save',kind:'account',id:LIVE_ID,data:{name:'Live 2',phone:'+79990002233',status:'active',hideLastSeen:true}}));
      expect(res.status).toBe(200);
    }finally{restore()}

    const d=data(LIVE_ID);
    expect(d.lastSeenPrivacy).toEqual(APPLIED);
    expect(d.name).toBe('Live 2');
  });

  it('save с новой сессией всё равно сбрасывает состояние, даже записанное между чтением и записью',async()=>{
    await addLiveAccount({hideLastSeen:true});
    const restore=raceFirstWrite(LIVE_ID,()=>applyCommits(LIVE_ID));
    try{
      const res=await POST(postRequest({action:'save',kind:'account',id:LIVE_ID,data:{name:'Live',phone:'+79990002233',hideLastSeen:true},secret:JSON.stringify({kind:'session',zipBase64:'UEsDBA=='})}));
      expect(res.status).toBe(200);
    }finally{restore()}

    expect(data(LIVE_ID).lastSeenPrivacy).toBeUndefined();
  });

  it('save лида не затирает ответы, пришедшие между чтением и записью (REQ-L10)',async()=>{
    const restore=raceFirstWrite(LEAD_ID,()=>patchRow(LEAD_ID,{replies:[REPLY]}));
    try{
      const res=await POST(postRequest({action:'save',kind:'lead',id:LEAD_ID,data:{name:'Lead',message:'Ищу сервис для остатков',status:'working'}}));
      expect(res.status).toBe(200);
    }finally{restore()}

    expect(data(LEAD_ID)).toMatchObject({status:'working',replies:[REPLY]});
  });

  it('save группы не затирает курсор скана, записанный между чтением и записью (REQ-L7)',async()=>{
    addRecord(GROUP_ID,'group',{name:'G',url:'https://t.me/sellers_chat',scanCursor:10});
    const restore=raceFirstWrite(GROUP_ID,()=>patchRow(GROUP_ID,{scanCursor:42}));
    try{
      const res=await POST(postRequest({action:'save',kind:'group',id:GROUP_ID,data:{name:'G 2',url:'https://t.me/sellers_chat'}}));
      expect(res.status).toBe(200);
    }finally{restore()}

    expect(data(GROUP_ID)).toMatchObject({name:'G 2',scanCursor:42});
  });
});
