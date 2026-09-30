import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const BUSY_PROXY_ID='77777777-7777-4777-8777-777777777777';

describe('workspace API: перегруженный воркер при проверке прокси',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:false,error:'Воркер занят, повторите позже'},{status:429,headers:{'Retry-After':'5'}})));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('429 воркера — отдельное сообщение «занят», статус прокси не меняется',async()=>{
    addRecord(BUSY_PROXY_ID,'proxy',{name:'good',host:'198.51.100.30',port:1080,protocol:'socks5',status:'active'},await seal('proxy-pass',OWNER));

    const res=await POST(postRequest({action:'check_proxy',id:BUSY_PROXY_ID}));

    const body=await res.json() as {result:{ok:boolean;error:string}};
    expect(body.result.ok).toBe(false);
    expect(body.result.error).toMatch(/занят/i);
    expect(body.result.error).not.toMatch(/недоступен/i);
    const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(BUSY_PROXY_ID) as {data:string};
    expect(JSON.parse(row.data).status).toBe('active');
  });
});
