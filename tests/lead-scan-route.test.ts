import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const GROUP_ID='99999999-9999-4999-8999-999999999999';

const SETTINGS={
  name:'Проект',
  keywords:'остатки, синхронизация, МойСклад, несколько кабинетов',
  minusKeywords:'вакансия',
  avoidTopics:'',
  leadCriteria:'Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов',
  hotSignals:'ищу сервис, кто пользуется, синхронизация остатков',
  product:'Платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов',
  notifyEnabled:false,
  notifyBotToken:'123456:bot-token-secret',
  notifyChatId:'42',
};

type WorkerMsg={tgMsgId:string;message:string};
type AiAnswer=(ids:string[],call:number)=>Response|Promise<Response>;
type Verdict={id:string;isLead?:boolean;score?:number};

const calls={worker:[] as Record<string,unknown>[],ai:[] as string[][],tg:[] as string[]};
let workerMessages:WorkerMsg[]=[];
let workerCursor='';
let workerGate:Promise<void>|null=null;
let aiAnswer:AiAnswer=(ids)=>aiJson(ids.map(id=>({id})));
let tgAnswer:()=>Response=()=>Response.json({ok:true});

/** Judge answer (lead core v2 REQ-8): one verdict per listed id; unlisted ids count as rejected. */
function aiJson(items:Verdict[]){
  const content=JSON.stringify({verdicts:items.map(i=>({id:i.id,isLead:i.isLead??true,score:i.score??90,reason:'ok'}))});
  return Response.json({choices:[{message:{content}}]});
}

function msg(tgMsgId:string,message:string):WorkerMsg{return {tgMsgId,message}}

/** Distinct messages that pass the cheap filters. */
function targets(n:number,from=100):WorkerMsg[]{
  return Array.from({length:n},(_,i)=>msg(String(from+i),`Ищу сервис для синхронизации остатков WB и МойСклад, магазин номер ${from+i}`));
}

function installFetch(){
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const u=String(url);
    const body=init?.body?JSON.parse(String(init.body)):{};
    if(u.includes('/scan-group')){
      calls.worker.push(body);
      if(workerGate)await workerGate;
      const now=new Date().toISOString();
      return Response.json({
        ok:true,
        title:'Sellers',
        cursor:workerCursor,
        fetched:workerMessages.length,
        messages:workerMessages.map(m=>({...m,name:'Иван',date:now,senderId:'700',senderUsername:'ivan'})),
      });
    }
    if(u.includes('/chat/completions')){
      const user=String(body.messages?.[1]?.content||'');
      const block=user.slice(user.indexOf('<data>'),user.indexOf('</data>'));
      const ids=[...block.matchAll(/"id":"([^"]+)"/g)].map(m=>m[1]!);
      calls.ai.push(ids);
      return aiAnswer(ids,calls.ai.length);
    }
    if(u.includes('api.telegram.org')){
      calls.tg.push(String(body.text||''));
      return tgAnswer();
    }
    throw new Error(`unexpected fetch ${u}`);
  }));
}

function setSettings(patch:Record<string,unknown>={}){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...SETTINGS,...patch}),SETTINGS_ID);
}

function groupData():Record<string,unknown>{
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='group'").get(GROUP_ID) as {data:string};
  return JSON.parse(row.data);
}

/** Lead fields the assertions read. */
type LeadData={tgMsgId?:string;score?:number;notifiedAt?:string;status?:string;draft?:string;replies?:unknown[];needsManager?:boolean;incomingLastText?:string;[k:string]:unknown};

function leads():{id:string;data:LeadData}[]{
  const rows=testDb().sqlite.prepare("SELECT id,data FROM records WHERE kind='lead' AND json_extract(data,'$.groupId')=?").all(GROUP_ID) as {id:string;data:string}[];
  return rows.map(r=>({id:r.id,data:JSON.parse(r.data)}));
}

function leadIds():string[]{return leads().map(l=>String(l.data.tgMsgId)).sort()}

async function scan(){
  const res=await POST(postRequest({action:'scan_group',id:GROUP_ID,force:true}));
  return {status:res.status,body:await res.json() as {skipped?:boolean;locked?:boolean}};
}

describe('workspace API: scan_group lead pipeline',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubEnv('AI_API_KEY','sk-test-not-real');
    login(OWNER);
    const {sqlite}=testDb();
    sqlite.prepare("DELETE FROM records WHERE kind='lead'").run();
    sqlite.prepare('UPDATE records SET secret=? WHERE id=?').run(await seal(JSON.stringify({kind:'tdata',zipBase64:'eA==',apiId:1,apiHash:'h'}),OWNER),ACCOUNT_ID);
    addRecord(GROUP_ID,'group',{name:'Sellers',url:'https://t.me/sellers_chat',accountId:ACCOUNT_ID,status:'active',membership:'joined'});
    setSettings();
    calls.worker.length=0;calls.ai.length=0;calls.tg.length=0;
    workerMessages=[];workerCursor='';workerGate=null;
    aiAnswer=(ids)=>aiJson(ids.map(id=>({id})));
    tgAnswer=()=>Response.json({ok:true});
    installFetch();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('lead core v2 REQ-9/10 judge verdict per batch',()=>{
    it('a valid answer without verdicts rejects all of its messages',async()=>{
      workerMessages=targets(3);
      aiAnswer=()=>aiJson([]);

      const r=await scan();

      expect(r.status).toBe(200);
      expect(calls.ai).toHaveLength(1);
      expect(leads()).toHaveLength(0);
    });

    it('a failed batch is never decided without the judge: its messages wait for the next scan',async()=>{
      workerMessages=targets(25);
      workerCursor='124';
      aiAnswer=(ids,call)=>call<=2?new Response('rate limited',{status:429}):aiJson(ids.map(id=>({id})));

      await scan();
      expect(leads()).toHaveLength(0);
      expect(groupData().scanCursor).toBe('99');

      await scan();
      expect(leadIds()).toHaveLength(25);
    });
  });

  describe('REQ-L11 AI-rejected messages are remembered',()=>{
    it('does not re-send a rejected message to AI on the next rescan',async()=>{
      workerMessages=targets(2);
      aiAnswer=()=>aiJson([]);
      await scan();
      await scan();

      expect(calls.ai).toHaveLength(1);
      expect(leads()).toHaveLength(0);
    });

    it('forgets rejections when the project card changes',async()=>{
      workerMessages=targets(2);
      aiAnswer=()=>aiJson([]);
      await scan();
      const projects=testDb().sqlite.prepare("SELECT id FROM records WHERE kind='project'").all() as {id:string}[];
      await POST(postRequest({action:'project_update',id:projects[0]!.id,patch:{leadCriteria:'Ищет сервис для цен'}}));
      await scan();

      expect(calls.ai).toHaveLength(2);
    });

    it('does not remember messages of a failed batch',async()=>{
      workerMessages=targets(2);
      aiAnswer=()=>new Response('down',{status:503});
      await scan();
      await scan();

      expect(calls.ai).toHaveLength(4);
    });
  });

  describe('REQ-L2 one scan per group at a time',()=>{
    it('two concurrent scans of one group call the worker once and create each lead once',async()=>{
      workerMessages=targets(2);
      setSettings({notifyEnabled:true});
      let open!:()=>void;
      workerGate=new Promise<void>(res=>{open=res});

      const first=scan();
      const second=scan();
      await new Promise(r=>setTimeout(r,20));
      open();
      const results=await Promise.all([first,second]);

      expect(calls.worker).toHaveLength(1);
      expect(leads()).toHaveLength(2);
      expect(calls.tg).toHaveLength(1);
      expect(results.filter(r=>r.body.skipped&&r.body.locked)).toHaveLength(1);
    });

    it('releases the lock after a scan so the next one runs',async()=>{
      workerMessages=targets(1);
      await scan();
      await scan();

      expect(calls.worker).toHaveLength(2);
      expect(String(groupData().scanLockUntil||'')).toBe('');
    });

    it('releases the lock when the worker call fails',async()=>{
      vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('worker down')}));
      await scan();
      installFetch();
      workerMessages=targets(1);
      await scan();

      expect(calls.worker).toHaveLength(1);
      expect(leads()).toHaveLength(1);
    });
  });

  describe('REQ-L6 deleted lead is not re-created',()=>{
    it('a lead deleted by the user does not come back on rescan',async()=>{
      workerMessages=targets(2);
      await scan();
      const victim=leads().find(l=>l.data.tgMsgId==='100')!;

      const del=await POST(postRequest({action:'delete',kind:'lead',id:victim.id}));
      expect(del.status).toBe(200);
      await scan();

      expect(leadIds()).toEqual(['101']);
    });
  });

  describe('REQ-L8 dedupe by groupId:tgMsgId',()=>{
    it('an edited message does not produce a second lead',async()=>{
      workerMessages=[msg('100','Ищу сервис для синхронизации остатков WB и МойСклад')];
      await scan();
      workerMessages=[msg('100','Ищу сервис для синхронизации остатков WB и МойСклад (upd: срочно)')];
      await scan();

      expect(leads()).toHaveLength(1);
    });
  });

  describe('REQ-L7 per-group cursor',()=>{
    it('passes the stored cursor to the worker and stores the new one',async()=>{
      workerMessages=targets(1);
      workerCursor='150';
      await scan();
      expect(calls.worker[0]!.minId).toBe('');
      expect(groupData().scanCursor).toBe('150');

      workerCursor='180';
      await scan();
      expect(calls.worker[1]!.minId).toBe('150');
      expect(groupData().scanCursor).toBe('180');
    });

    it('a client save of the group keeps the server-owned scan state',async()=>{
      workerCursor='150';
      await scan();

      const res=await POST(postRequest({action:'save',kind:'group',id:GROUP_ID,data:{name:'Sellers 2',url:'https://t.me/sellers_chat',accountId:ACCOUNT_ID}}));

      expect(res.status).toBe(200);
      expect(groupData().name).toBe('Sellers 2');
      expect(groupData().scanCursor).toBe('150');
    });
  });

  describe('REQ-L9 failed notification is retried',()=>{
    it('keeps the lead pending, logs the failure and sends it on the next scan',async()=>{
      setSettings({notifyEnabled:true});
      workerMessages=targets(1);
      tgAnswer=()=>Response.json({ok:false,description:'Bad Gateway'},{status:502});
      await scan();

      expect(calls.tg).toHaveLength(1);
      expect(leads()[0]!.data.notifiedAt||'').toBe('');
      const log=JSON.stringify(testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(SETTINGS_ID));
      expect(log).toContain('Bad Gateway');

      tgAnswer=()=>Response.json({ok:true});
      await scan();

      expect(calls.tg).toHaveLength(2);
      expect(calls.tg[1]).toContain('магазин номер 100');
      expect(leads()[0]!.data.notifiedAt).toBeTruthy();

      await scan();
      expect(calls.tg).toHaveLength(2);
    });
  });

  describe('REQ-L10 lead save merges server-owned fields',()=>{
    it('a stale client save keeps replies, needsManager and the judge score',async()=>{
      workerMessages=targets(1);
      await scan();
      const lead=leads()[0]!;
      const score=lead.data.score;
      expect(score).toBe(90);
      const serverSide={...lead.data,needsManager:true,incomingLastText:'Да, интересно',replies:[{text:'Здравствуйте',mode:'dm',at:'2026-09-30T10:00:00.000Z',ok:true,from:'us'},{text:'Да, интересно',mode:'dm',at:'2026-09-30T10:05:00.000Z',ok:true,from:'client'}]};
      testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(serverSide),lead.id);

      const staleClient={...lead.data,status:'working',draft:'Новый черновик',replies:[],needsManager:false};
      const res=await POST(postRequest({action:'save',kind:'lead',id:lead.id,data:staleClient}));

      expect(res.status).toBe(200);
      const saved=leads()[0]!.data;
      expect(saved.status).toBe('working');
      expect(saved.draft).toBe('Новый черновик');
      expect(saved.replies).toHaveLength(2);
      expect(saved.needsManager).toBe(true);
      expect(saved.incomingLastText).toBe('Да, интересно');
      expect(saved.score).toBe(score);
    });
  });
});
