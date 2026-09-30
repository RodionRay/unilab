import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace} from './helpers/workspace-harness';
import {resolveConfig,timeoutForAction} from '../telegram-worker/src/worker-app.mjs';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {
  PROXY_CHECK_MARGIN_MS,
  WORKER_CHECK_PROXY_TIMEOUT_MS,
  WORKER_DEFAULT_SLOTS,
  proxyCheckTimeoutMs,
} from '@/lib/worker-timeouts';

describe('proxyCheckTimeoutMs',()=>{
  it('mirrors the worker per-check timeout and default slot count',()=>{
    expect(WORKER_CHECK_PROXY_TIMEOUT_MS).toBe(timeoutForAction('check_proxy'));
    expect(WORKER_DEFAULT_SLOTS).toBe(resolveConfig({TG_WORKER_TOKEN:'t'.repeat(32)}).maxConcurrency);
  });

  it('covers one worker round per started group of slots, plus a margin',()=>{
    const per=WORKER_CHECK_PROXY_TIMEOUT_MS;
    expect(proxyCheckTimeoutMs(1,4)).toBe(per+PROXY_CHECK_MARGIN_MS);
    expect(proxyCheckTimeoutMs(4,4)).toBe(per+PROXY_CHECK_MARGIN_MS);
    expect(proxyCheckTimeoutMs(8,4)).toBe(2*per+PROXY_CHECK_MARGIN_MS);
    expect(proxyCheckTimeoutMs(10,4)).toBe(3*per+PROXY_CHECK_MARGIN_MS);
  });
});

describe('workspace API: bulk proxy check waits for the worker queue',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,latencyMs:5,telegramOk:true})));
  });
  afterEach(()=>{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gives each check of an 8-proxy batch time for two worker rounds',async()=>{
    for(let i=0;i<8;i++){
      addRecord(`88888888-8888-4888-8888-00000000000${i}`,'proxy',{name:`p${i}`,host:'198.51.100.40',port:1080+i,protocol:'socks5'},await seal('pw',OWNER));
    }
    const timeouts:number[]=[];
    const real=AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal,'timeout').mockImplementation((ms:number)=>{timeouts.push(ms);return real(ms)});

    const res=await POST(postRequest({action:'check_proxies',mode:'all',concurrency:8}));

    expect(res.status).toBe(200);
    expect(timeouts).toHaveLength(8);
    expect(new Set(timeouts)).toEqual(new Set([proxyCheckTimeoutMs(8,WORKER_DEFAULT_SLOTS)]));
  });
});
