import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,workerCalls} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const INTERNAL_PROXY_ID='66666666-6666-4666-8666-666666666666';

describe('workspace API: SSRF через адрес прокси',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([['127.0.0.1'],['169.254.169.254'],['10.0.0.1'],['0x7f000001'],['localhost'],['redis'],['metadata.google.internal']])(
    'сохранение прокси %s → 400',async(host)=>{
      const res=await POST(postRequest({action:'save',kind:'proxy',data:{name:'x',host,port:1080,protocol:'socks5'},secret:'p'}));

      expect(res.status).toBe(400);
    },
  );

  it('публичный прокси сохраняется',async()=>{
    const res=await POST(postRequest({action:'save',kind:'proxy',data:{name:'ok',host:'198.51.100.20',port:5545,protocol:'socks5'},secret:'p'}));

    expect(res.status).toBe(200);
  });

  it('проверка сохранённого ранее внутреннего прокси не уходит в воркер',async()=>{
    addRecord(INTERNAL_PROXY_ID,'proxy',{name:'old',host:'192.168.0.10',port:1080,protocol:'socks5'},await seal('proxy-pass',OWNER));

    const res=await POST(postRequest({action:'check_proxy',id:INTERNAL_PROXY_ID}));

    const body=await res.json() as {result:{ok:boolean;error:string}};
    expect(body.result.ok).toBe(false);
    expect(body.result.error).toMatch(/внутренней сети/);
    expect(workerCalls.filter(u=>u.includes('/check-proxy'))).toHaveLength(0);
  });
});
