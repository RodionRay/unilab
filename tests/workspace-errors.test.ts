import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,LEAD_ID,OWNER,login,postRequest,resetWorkspace} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const LEAKY=/10\.0\.0\.5|stack|ECONNREFUSED|JSON|Unexpected token|Unexpected end/;

describe('workspace API: ошибки воркера и AI не уходят клиенту',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('upload_account_photos отдаёт общее сообщение, деталь — в серверный лог',async()=>{
    const res=await POST(postRequest({action:'upload_account_photos',ids:[ACCOUNT_ID],photoBase64:'a'.repeat(200)}));

    const body=await res.json() as {results:{ok:boolean;error:string}[]};
    expect(body.results[0]).toMatchObject({ok:false,error:'Не удалось загрузить фото'});
    expect(JSON.stringify(body)).not.toMatch(LEAKY);
    expect(errSpy).toHaveBeenCalled();
  },10_000);

  it('draft: сбой AI-провайдера отдаёт общее сообщение',async()=>{
    vi.stubEnv('AI_API_KEY','sk-test-not-real');

    const res=await POST(postRequest({action:'draft',id:LEAD_ID}));

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(LEAKY);
    expect(errSpy).toHaveBeenCalled();
  });
});
