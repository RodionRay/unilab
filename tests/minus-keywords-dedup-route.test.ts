import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,SETTINGS_ID,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const SETTINGS={
  name:'Проект',
  keywords:'остатки, синхронизация, МойСклад',
  minusKeywords:'шабашка, вакансия',
  avoidTopics:'',
  leadCriteria:'Ищет сервис для синхронизации остатков',
  hotSignals:'ищу сервис',
  product:'Платформа для селлеров',
};

function storedMinus():string[]{
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='settings'").get(SETTINGS_ID) as {data:string};
  return String(JSON.parse(row.data).minusKeywords).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
}

/** Saves the settings exactly as the client form does: the stored list goes back unchanged. */
async function saveSettings(minusKeywords:string){
  const res=await POST(postRequest({action:'save',kind:'settings',data:{...SETTINGS,minusKeywords}}));
  expect(res.status).toBe(200);
}

const lowerKeys=(terms:string[])=>terms.map(t=>t.toLowerCase().replace(/ё/g,'е'));

describe('workspace API: minusKeywords never accumulate duplicates',()=>{
  beforeEach(()=>{
    vi.stubEnv('AI_API_KEY','');
    resetWorkspace();
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(SETTINGS),SETTINGS_ID);
    login(OWNER);
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('two consecutive saves of the stored list do not grow it',async()=>{
    await saveSettings(SETTINGS.minusKeywords);
    const first=storedMinus();

    await saveSettings(first.join(', '));

    expect(storedMinus()).toEqual(first);
    expect(new Set(lowerKeys(first)).size).toBe(first.length);
    expect(first.slice(0,2)).toEqual(['шабашка','вакансия']);
    expect(first).toContain('писать @');
  });

  it('generate profile then save does not grow the list',async()=>{
    vi.stubEnv('AI_API_KEY','sk-test-not-real');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...SETTINGS,minusKeywords:'вакансия, накрутка, вакансия'})}}]}),{status:200,headers:{'Content-Type':'application/json'}})));
    expect((await POST(postRequest({action:'rebuild_product'}))).status).toBe(200);
    vi.unstubAllGlobals();
    await saveSettings(storedMinus().join(', '));
    const afterFirstSave=storedMinus();

    await saveSettings(afterFirstSave.join(', '));

    expect(storedMinus()).toEqual(afterFirstSave);
    expect(new Set(lowerKeys(afterFirstSave)).size).toBe(afterFirstSave.length);
  });

  it('a save heals an already duplicated list, first spelling and order win, ё = е',async()=>{
    await saveSettings('Шабашка, вакансия, шабашка, ВАКАНСИЯ, твёрдый, твердый, вакансия, резюме, вакансия');

    const terms=storedMinus();

    expect(terms.slice(0,4)).toEqual(['Шабашка','вакансия','твёрдый','резюме']);
    expect(new Set(lowerKeys(terms)).size).toBe(terms.length);
  });
});
