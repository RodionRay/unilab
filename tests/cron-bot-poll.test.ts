import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/users',()=>({listUserIdsForCron:async()=>[
  {userId:'owner-1',email:'o1@example.com',name:'O1'},
  {userId:'owner-2',email:'o2@example.com',name:'O2'},
]}));

import {POST as tasksTick} from '@/app/api/cron/tasks-tick/route';
import {POST as autoRescan} from '@/app/api/cron/auto-rescan/route';
import {verifySessionToken} from '@/lib/auth';

const SECRET='k'.repeat(40);
let n=0;

function settings(owner:string,data:Record<string,unknown>){
  testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .run(`a0000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,owner,'settings',JSON.stringify(data),null,new Date().toISOString());
}

describe('cron · бот и входящие ЛС без открытого кабинета',()=>{
  const seen:{action:string;owner:string}[]=[];
  let bootSettings:Record<string,unknown>={};

  beforeEach(()=>{
    testDb().sqlite.exec('DELETE FROM records;');
    seen.length=0;
    bootSettings={};
    vi.stubEnv('CRON_SECRET',SECRET);
    vi.stubEnv('SESSION_SECRET','s'.repeat(40));
    vi.stubEnv('APP_URL','https://app.test');
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:{method?:string;body?:string;headers:Record<string,string>})=>{
      const token=String(init.headers.Cookie).split('=').slice(1).join('=');
      const owner=String((await verifySessionToken(token))?.userId);
      if(!init.body){
        seen.push({action:'GET',owner});
        return Response.json({records:[{kind:'settings',data:bootSettings}]});
      }
      const body=JSON.parse(init.body) as {action:string};
      seen.push({action:body.action,owner});
      return Response.json({ok:true,groupIds:[],rejoinItems:[]});
    }));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('REQ-4: tasks-tick опрашивает бота у владельцев с включёнными уведомлениями, даже без задач',async()=>{
    settings('owner-1',{notifyEnabled:true,notifyBotToken:'1:abc',notifyChatId:'42'});
    settings('owner-2',{notifyEnabled:false,notifyBotToken:'2:abc',notifyChatId:'43'});
    settings('stranger',{notifyEnabled:true,notifyBotToken:'3:abc',notifyChatId:'44'});

    const res=await tasksTick(new Request('https://app.test/api/cron/tasks-tick',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));

    expect(res.status).toBe(200);
    expect(seen.filter(s=>s.action==='poll_bot_updates').map(s=>s.owner)).toEqual(['owner-1']);
  });

  it('REQ-2: автообход выключен — входящие ЛС всё равно опрашиваются (иначе ответы и уведомления стоят)',async()=>{
    bootSettings={autoRescanEnabled:false};

    const res=await autoRescan(new Request('https://app.test/api/cron/auto-rescan',{method:'POST',headers:{authorization:`Bearer ${SECRET}`},body:'{}'}));

    expect(res.status).toBe(200);
    expect(seen.filter(s=>s.action==='rescan_groups')).toHaveLength(0);
    expect(seen.filter(s=>s.action==='poll_dm_replies').map(s=>s.owner).sort()).toEqual(['owner-1','owner-2']);
  });
});
