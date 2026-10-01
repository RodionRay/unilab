import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {ACCOUNT_BLIND_COOLDOWN_MS,JOIN_WORKER_ERROR_RETRY_MS,accountBlindDeferPatch} from '@/lib/processes/join-flow';

const ACC_A='a0000000-0000-4000-8000-00000000000a';
const ACC_B='b0000000-0000-4000-8000-00000000000b';
const GROUP='e0000000-0000-4000-8000-00000000000e';
const NOW=Date.parse('2026-10-01T12:00:00Z');
const BLIND_REPLY={ok:false,status:'error',join:'missing',usernameMissing:true,accountBlind:true,
  error:'Аккаунт не резолвит даже @telegram — ограничен Telegram, @live_chat тут ни при чём'};

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}
async function addAccount(id:string,data:Record<string,unknown>={}){
  addRecord(id,'account',{name:id.slice(0,1),status:'active',proxyId:'',limits:{invite:40},...data},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}

describe('accountBlindDeferPatch — пауза группы после «слепого» ответа',()=>{
  it('первый слепой свидетель — короткая пауза без ошибки',()=>{
    const patch=accountBlindDeferPatch({},ACC_A,NOW);

    expect(patch).toEqual({status:'setup',joinNextAt:new Date(NOW+JOIN_WORKER_ERROR_RETRY_MS).toISOString(),joinBlindAccounts:[ACC_A]});
  });

  it('второй слепой аккаунт на той же группе — пауза на отлёжку',()=>{
    const patch=accountBlindDeferPatch({joinBlindAccounts:[ACC_A]},ACC_B,NOW);

    expect(Date.parse(patch.joinNextAt)).toBe(NOW+ACCOUNT_BLIND_COOLDOWN_MS);
    expect(patch.joinBlindAccounts).toEqual([ACC_A,ACC_B]);
  });
});

describe('join_group: «слепой» ответ откладывает группу, автопочинка её не крутит',()=>{
  let joinCalls=0;
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    joinCalls=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(String(url).endsWith('/join-group')){joinCalls++;return Response.json(BLIND_REPLY)}
      return Response.json({ok:false,error:'not stubbed'},{status:500});
    }));
    await addAccount(ACC_A);
    addRecord(GROUP,'group',{name:'Целевая',url:'https://t.me/live_chat',membership:'none',status:'error',error:'прошлая попытка',joinedAt:'',joinWanted:true,accountId:ACC_A});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('отвечает 409 deferred, снимает статус error и ставит joinNextAt',async()=>{
    const res=await POST(postRequest({action:'join_group',id:GROUP}));
    const body=await res.json() as {deferred?:boolean;accountBlind?:boolean};

    expect(res.status).toBe(409);
    expect(body).toMatchObject({deferred:true,accountBlind:true});
    expect(rec(GROUP).status).toBe('setup');
    expect(Date.parse(rec(GROUP).joinNextAt)).toBeGreaterThan(Date.now()+10*60_000);
    expect(rec(GROUP).joinAttempts||0).toBe(0);
  },15_000);

  it('следующая автопочинка не ставит отложенную группу снова в очередь',async()=>{
    await POST(postRequest({action:'join_group',id:GROUP}));

    const heal=await (await POST(postRequest({action:'heal_dead_group_accounts'}))).json() as {items?:{id:string}[]};

    expect((heal.items||[]).map(i=>i.id)).not.toContain(GROUP);
    expect(joinCalls).toBe(1);
  },15_000);
});
