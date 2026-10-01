import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/users',()=>({listUserIdsForCron:async()=>['o1','o2','o3','o4','o5'].map(id=>({userId:id,email:`${id}@example.com`,name:id}))}));

import {POST as autoRescan} from '@/app/api/cron/auto-rescan/route';
import {verifySessionToken} from '@/lib/auth';

const SECRET='k'.repeat(40);

describe('cron auto-rescan · входящие ЛС у всех владельцев',()=>{
  const seen:{action:string;owner:string}[]=[];
  beforeEach(()=>{
    testDb().sqlite.exec('DELETE FROM records;');
    seen.length=0;
    vi.stubEnv('CRON_SECRET',SECRET);
    vi.stubEnv('SESSION_SECRET','s'.repeat(40));
    vi.stubEnv('APP_URL','https://app.test');
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:{body?:string;headers:Record<string,string>})=>{
      const token=String(init.headers.Cookie).split('=').slice(1).join('=');
      const owner=String((await verifySessionToken(token))?.userId);
      if(!init.body)return Response.json({records:[{kind:'settings',data:{}}]});
      seen.push({action:(JSON.parse(init.body) as {action:string}).action,owner});
      return Response.json({ok:true,groupIds:[],rejoinItems:[]});
    }));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('REQ-2: владельцы после первых трёх (без сканов) всё равно получают опрос входящих ЛС',async()=>{
    const res=await autoRescan(new Request('https://app.test/api/cron/auto-rescan',{method:'POST',headers:{authorization:`Bearer ${SECRET}`},body:'{}'}));

    expect(res.status).toBe(200);
    expect(seen.filter(s=>s.action==='poll_dm_replies').map(s=>s.owner)).toEqual(['o1','o2','o3','o4','o5']);
    expect(seen.filter(s=>s.action==='rescan_groups').map(s=>s.owner)).toEqual(['o1','o2','o3']);
  });
});
