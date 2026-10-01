import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,SETTINGS_ID,addRecord,login,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/assistant/route';
import {defaultProjectId} from '@/lib/leads';

/** REQ-4: the assistant's product context is the default project card, never the legacy settings.product. */

const systemPrompts:string[]=[];
const ask=()=>POST(new Request('http://crm.test/api/assistant',{
  method:'POST',
  headers:{'Content-Type':'application/json',origin:'http://crm.test'},
  body:JSON.stringify({message:'Что вы продаёте?',history:[],surface:'admin'}),
}));
const setSettings=(data:Record<string,unknown>)=>testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),SETTINGS_ID);

describe('assistant · product context from the default project',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    for(const k of ['DEEPSEEK_API_KEY','OPENAI_API_KEY','ASSISTANT_OPENAI_KEY','AI_API_BASE','OPENAI_API_BASE'])vi.stubEnv(k,'');
    vi.stubEnv('AI_API_KEY','sk-test-not-real');
    systemPrompts.length=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body||'{}'));
      systemPrompts.push(String(body.messages?.[0]?.content||''));
      return Response.json({choices:[{message:{content:'Ответ'}}]});
    }));
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});

  it('uses the default project product, not settings.product',async()=>{
    setSettings({product:'Устаревший продукт из настроек'});
    addRecord(defaultProjectId(OWNER),'project',{name:'Основной',product:'Сервис синхронизации остатков для селлеров'});

    const r=await ask();

    expect(r.status).toBe(200);
    expect(systemPrompts.at(-1)).toContain('Сервис синхронизации остатков для селлеров');
    expect(systemPrompts.at(-1)).not.toContain('Устаревший продукт из настроек');
  });

  it('without a project row the default project is built from the legacy settings',async()=>{
    setSettings({product:'Продукт из старых настроек'});

    await ask();

    expect(systemPrompts.at(-1)).toContain('Продукт из старых настроек');
  });
});
