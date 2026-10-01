import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,LEAD_ID,MAILING_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const ACC_A='a0000000-0000-4000-8000-00000000000a';
const ACC_B='b0000000-0000-4000-8000-00000000000b';
const DEAD_PROXY='d0000000-0000-4000-8000-00000000000d';
const GROUP='e0000000-0000-4000-8000-00000000000e';
const GROUP_2='f0000000-0000-4000-8000-00000000000f';
const AUDIENCE_ID='99999999-9999-4999-8999-999999999999';

type WorkerReply=Record<string,unknown>;
const calls:{path:string;session:string}[]=[];
let replies:Record<string,WorkerReply>={};

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}
function rowCount(kind:string){
  return (testDb().sqlite.prepare('SELECT COUNT(*) AS n FROM records WHERE kind=?').get(kind) as {n:number}).n;
}
async function addAccount(id:string,data:Record<string,unknown>){
  addRecord(id,'account',{name:id.slice(0,1),phone:'+79990000000',status:'active',proxyId:'',limits:{invite:40,message:40,chat:40},...data},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}
function addGroup(id:string,data:Record<string,unknown>){
  addRecord(id,'group',{name:'Целевая',url:'https://t.me/wanted_chat',membership:'none',status:'setup',joinedAt:'',accountId:ACC_A,...data});
}
const post=(body:Record<string,unknown>)=>POST(postRequest(body));
const workerPaths=()=>calls.map(c=>c.path);

describe('рискованные функции Telegram удалены',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    calls.length=0;
    replies={};
    vi.stubGlobal('fetch',vi.fn(async(url:string,init?:{body?:string})=>{
      const path=new URL(String(url)).pathname;
      calls.push({path,session:String(JSON.parse(String(init?.body||'{}')).zipBase64||'')});
      const r=replies[path];
      return r?Response.json(r):Response.json({ok:false,error:'not stubbed'},{status:500});
    }));
    addRecord(DEAD_PROXY,'proxy',{name:'dead',host:'198.51.100.40',port:1080,protocol:'socks5',status:'inactive'});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('REQ-1 удалённые действия → 400',()=>{
    it.each([
     'start_audience','pause_audience','tick_audience','export_audience',
     'start_invite','pause_invite','tick_invite',
     'start_mailing','pause_mailing','tick_mailing','refill_mailing_ai_pool',
     'enqueue_joins','heal_dead_group_accounts',
    ])('%s',async(action)=>{
      const res=await post({action,id:MAILING_ID,groupIds:[GROUP]});

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({error:'Неизвестное действие'});
      expect(calls).toHaveLength(0);
    });
  });

  describe('REQ-2 записи удалённых видов',()=>{
    it.each([
     ['audience_task',{url:'https://t.me/src_chat',accountIds:[ACC_A]}],
     ['audience_user',{taskId:AUDIENCE_ID,userId:'42'}],
     ['invite_task',{targetUrl:'https://t.me/dst_chat',audienceTaskId:AUDIENCE_ID,accountIds:[ACC_A]}],
     ['mailing_task',{accountIds:[ACC_A]}],
    ])('сохранение %s отклоняется',async(kind,data)=>{
      await addAccount(ACC_A,{});
      const before=rowCount(kind);

      const res=await post({action:'save',kind,data});

      expect(res.status).toBe(400);
      expect(rowCount(kind)).toBe(before);
    });

    it('GET не отдаёт задачи рассылки, инвайта и сбора, строки в БД остаются',async()=>{
      addRecord(AUDIENCE_ID,'audience_task',{name:'A',url:'https://t.me/src_chat',accountIds:[]});
      addRecord('12121212-1212-4212-8212-121212121212','invite_task',{name:'I'});

      const res=await GET();
      const kinds=new Set((await res.json() as {records:{kind:string}[]}).records.map(r=>r.kind));

      expect(kinds).toEqual(new Set(['proxy','lead','settings','project']));
      expect(rowCount('mailing_task')).toBe(1);
      expect(rowCount('audience_task')).toBe(1);
    });
  });

  describe('REQ-3 назначение аккаунта без смеси',()=>{
    beforeEach(async()=>{
      await addAccount(ACC_A,{});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{accountId:''});
      addGroup(GROUP_2,{accountId:'',url:'https://t.me/second_chat'});
    });

    it('mode:mix отклоняется и группы не меняются',async()=>{
      const res=await post({action:'assign_group_accounts',mode:'mix',groupIds:[GROUP,GROUP_2],accountIds:[ACC_A,ACC_B]});

      expect(res.status).toBe(400);
      expect(rec(GROUP).accountId).toBe('');
      expect(rec(GROUP_2).accountId).toBe('');
    });

    it('несколько аккаунтов отклоняются',async()=>{
      const res=await post({action:'assign_group_accounts',groupIds:[GROUP,GROUP_2],accountIds:[ACC_A,ACC_B]});

      expect(res.status).toBe(400);
      expect(rec(GROUP).accountId).toBe('');
    });

    it('один аккаунт назначается всем выбранным группам',async()=>{
      const res=await post({action:'assign_group_accounts',groupIds:[GROUP,GROUP_2],accountId:ACC_B});

      expect(res.status).toBe(200);
      expect(rec(GROUP).accountId).toBe(ACC_B);
      expect(rec(GROUP_2).accountId).toBe(ACC_B);
    });
  });

  describe('REQ-4 недоступный аккаунт группы → ошибка без подмены',()=>{
    it('join_group: мёртвый прокси у аккаунта группы — ошибка, живой аккаунт не подставляется',async()=>{
      await addAccount(ACC_A,{proxyId:DEAD_PROXY});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{joinWanted:true});

      const res=await post({action:'join_group',id:GROUP});

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(workerPaths()).not.toContain('/join-group');
      expect(rec(GROUP).accountId).toBe(ACC_A);
    });

    it('join_group: заморозка при вступлении помечает аккаунт, группа остаётся на нём',async()=>{
      await addAccount(ACC_A,{});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{});
      replies['/join-group']={ok:false,status:'frozen',join:'frozen',error:'FROZEN_METHOD_INVALID'};

      const res=await post({action:'join_group',id:GROUP});
      const body=await res.json() as Record<string,unknown>;

      expect(rec(ACC_A).status).toBe('frozen');
      expect(rec(GROUP).accountId).toBe(ACC_A);
      expect(body.reassigned).toBeUndefined();
      expect(body.error).toBeTruthy();
    });

    it('join_group: ручное вступление в одну группу не требует очереди и держит паузу темпа',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{});
      addGroup(GROUP_2,{url:'https://t.me/second_chat'});
      replies['/join-group']={ok:true,join:'joined',status:'active'};

      const first=await post({action:'join_group',id:GROUP});
      const second=await post({action:'join_group',id:GROUP_2});

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(await second.json()).toMatchObject({pace:true});
      expect(workerPaths().filter(p=>p==='/join-group')).toHaveLength(1);
    });

    it('scan_group: отключённый аккаунт — ошибка, группа не переназначается',async()=>{
      await addAccount(ACC_A,{status:'unauthorized'});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{});

      const res=await post({action:'scan_group',id:GROUP,force:true});
      const body=await res.json() as Record<string,unknown>;

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(body.reassigned).toBeUndefined();
      expect(body.rejoinItem).toBeUndefined();
      expect(workerPaths()).not.toContain('/scan-group');
      expect(rec(GROUP).accountId).toBe(ACC_A);
    });

    it('scan_group: воркер сообщил заморозку — аккаунт помечен, группа не переназначена',async()=>{
      await addAccount(ACC_A,{});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{});
      replies['/scan-group']={ok:false,status:'frozen',error:'FROZEN_METHOD_INVALID'};

      const res=await post({action:'scan_group',id:GROUP,force:true});
      const body=await res.json() as Record<string,unknown>;

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(body.reassigned).toBeUndefined();
      expect(rec(ACC_A).status).toBe('frozen');
      expect(rec(GROUP).accountId).toBe(ACC_A);
    });

    it('scan_group: слот не видит @username — другой аккаунт не подставляется',async()=>{
      await addAccount(ACC_A,{});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{});
      replies['/scan-group']={ok:false,usernameMissing:true,error:'Аккаунт не видит @wanted_chat'};

      const res=await post({action:'scan_group',id:GROUP,force:true});
      const body=await res.json() as Record<string,unknown>;

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(body.reassigned).toBeUndefined();
      expect(rec(GROUP).accountId).toBe(ACC_A);
    });

    it('scan_group: нужно вступить — без очереди вступления и rejoinItem',async()=>{
      await addAccount(ACC_A,{});
      addGroup(GROUP,{membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active'});
      replies['/scan-group']={ok:false,join:'need_join',error:'Сначала вступите в группу'};

      const res=await post({action:'scan_group',id:GROUP,force:true});
      const body=await res.json() as Record<string,unknown>;

      expect(res.status).toBe(409);
      expect(body).toMatchObject({needJoin:true});
      expect(body.rejoinItem).toBeUndefined();
      expect(rec(GROUP).joinState).toBe('');
    });

    it('rescan_groups: группы на недоступном аккаунте пропускаются с ошибкой, без переназначения',async()=>{
      await addAccount(ACC_A,{status:'frozen'});
      await addAccount(ACC_B,{});
      addGroup(GROUP,{membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active'});
      addGroup(GROUP_2,{url:'https://t.me/second_chat',accountId:ACC_B});

      const res=await post({action:'rescan_groups',force:true});
      const body=await res.json() as {groupIds:string[];unavailable:{id:string;error:string}[];needJoin:number;rejoinItems?:unknown};

      expect(res.status).toBe(200);
      expect(body.groupIds).toEqual([]);
      expect(body.unavailable.map(u=>u.id)).toEqual([GROUP]);
      expect(body.unavailable[0]?.error).toBeTruthy();
      expect(body.needJoin).toBe(1);
      expect(body.rejoinItems).toBeUndefined();
      expect(rec(GROUP).accountId).toBe(ACC_A);
      expect(rec(GROUP_2).joinState||'').toBe('');
    });
  });

  describe('REQ-5 ответ лиду только с аккаунта лида',()=>{
    function addLead(data:Record<string,unknown>){
      testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(LEAD_ID);
      addRecord(LEAD_ID,'lead',{name:'Лид',message:'Ищу сервис для остатков',status:'new',senderId:'777',senderUsername:'client',...data});
    }

    it('аккаунт лида на отлёжке — ошибка, другой аккаунт не используется',async()=>{
      await addAccount(ACC_A,{status:'cooldown',cooldownUntil:new Date(Date.now()+3600_000).toISOString()});
      await addAccount(ACC_B,{});
      addLead({accountId:ACC_A});

      const res=await post({action:'send_lead_message',id:LEAD_ID,mode:'dm',text:'Здравствуйте'});

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(workerPaths()).not.toContain('/send-message');
      expect(rec(LEAD_ID).accountId).toBe(ACC_A);
    });

    it('исчерпан дневной лимит аккаунта лида — ошибка без переключения',async()=>{
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      await addAccount(ACC_A,{limits:{invite:40,message:1,chat:40},messagesToday:1,messagesDay:day});
      await addAccount(ACC_B,{});
      addLead({accountId:ACC_A});

      const res=await post({action:'send_lead_message',id:LEAD_ID,mode:'dm',text:'Здравствуйте'});

      expect(res.status).toBe(429);
      expect(workerPaths()).not.toContain('/send-message');
    });

    it('у лида нет аккаунта — ошибка, аккаунт фермы не подбирается',async()=>{
      await addAccount(ACC_B,{});
      addLead({accountId:''});

      const res=await post({action:'send_lead_message',id:LEAD_ID,mode:'dm',text:'Здравствуйте'});

      expect(res.status).toBe(400);
      expect(workerPaths()).not.toContain('/send-message');
    });

    it('рабочий аккаунт лида отправляет сам',async()=>{
      await addAccount(ACC_A,{});
      await addAccount(ACC_B,{});
      addLead({accountId:ACC_A});
      replies['/send-message']={ok:true,messageId:'5',chatId:'777'};

      const res=await post({action:'send_lead_message',id:LEAD_ID,mode:'dm',text:'Здравствуйте'});

      expect(res.status).toBe(200);
      expect(calls.filter(c=>c.path==='/send-message').map(c=>c.session)).toEqual([ACC_A]);
    });
  });

  describe('REQ-7 импорт каталога',()=>{
    it('добавляет группы без вступления и без очереди',async()=>{
      await addAccount(ACC_A,{});

      const res=await post({action:'import_catalog',accountId:ACC_A});
      const body=await res.json() as {added:number};
      const groups=testDb().sqlite.prepare("SELECT data FROM records WHERE kind='group'").all() as {data:string}[];

      expect(res.status).toBe(200);
      expect(body.added).toBeGreaterThan(0);
      expect(workerPaths()).not.toContain('/join-group');
      expect(groups.every(g=>{const d=JSON.parse(g.data);return !d.joinState&&!d.joinWanted&&d.membership==='none'})).toBe(true);
    });

  });
});
