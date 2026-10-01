import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,LEAD_ID,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {ACC_A,API_ID,addSealedAccount,dropHarnessAccount} from './helpers/chats-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {defaultProjectId} from '@/lib/leads';

/** Lead core v2 through the real route (docs/project/specs/lead-core-v2.md REQ-1..4, 9, 10, 12, 14..19, 21..24). */

const GROUP_ID='99999999-9999-4999-8999-999999999999';
const GROUP_2='99999999-9999-4999-8999-999999999998';
const FOREIGN_PROJECT='f0000000-0000-4000-8000-00000000000f';
const DEFAULT_PROJECT=defaultProjectId(OWNER);
const SETTINGS={
  name:'Uniseller',
  product:'Сервис синхронизации остатков для селлеров маркетплейсов',
  audience:'Селлеры WB и Ozon',
  leadCriteria:'Ищет сервис для учёта остатков',
  keywords:'остатки, мойсклад',
  minusKeywords:'казино',
  notifyEnabled:false,
};

type Verdict={isLead?:boolean;score:number;reason?:string;projectId?:string|null};
type Judge=(ids:string[],call:number)=>Verdict|Response;
/** Stored JSON as the assertions read it (loose on purpose: records are untyped JSON). */
type Json=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Row={id:string;data:Json};

const calls={worker:[] as {path:string;body:Json}[],judge:[] as string[][],dm:[] as string[][],draft:[] as string[],other:[] as {system:string;user:string}[]};
let judge:Judge=()=>({isLead:true,score:90});
let dmJudge:(ids:string[])=>Verdict|Response=()=>({score:90,projectId:DEFAULT_PROJECT});
let otherAnswer:()=>string=()=>'{}';
let workerMessages:Record<string,unknown>[]=[];
let workerCursor='';
let inboxMessages:Record<string,unknown>[]=[];

const nowIso=()=>new Date().toISOString();
const msg=(id:number|string,text?:string,over:Record<string,unknown>={})=>({
  tgMsgId:String(id),message:text??`Подскажите сервис для учёта остатков, магазин номер ${id}`,
  name:`User ${id}`,date:nowIso(),senderId:`7${id}`,senderUsername:`user${id}`,messageKind:'group',...over,
});
const messages=(n:number,from=100)=>Array.from({length:n},(_,i)=>msg(from+i));

function idsOf(user:string):string[]{
  const block=user.slice(user.indexOf('<data>'),user.indexOf('</data>'));
  return [...block.matchAll(/"id":"([^"]+)"/g)].map(m=>m[1]!);
}
const llmText=(content:string)=>Response.json({choices:[{message:{content}}]});

function answerJudge(user:string):Response{
  const ids=idsOf(user);
  calls.judge.push(ids);
  const verdicts:Record<string,unknown>[]=[];
  for(const id of ids){
    const v=judge([id],calls.judge.length);
    if(v instanceof Response)return v;
    verdicts.push({id,reason:'нужен сервис',isLead:v.isLead??true,...v});
  }
  return llmText(JSON.stringify({verdicts}));
}

function answerDm(user:string):Response{
  const ids=idsOf(user);
  calls.dm.push(ids);
  const verdicts:Record<string,unknown>[]=[];
  for(const id of ids){
    const v=dmJudge([id]);
    if(v instanceof Response)return v;
    verdicts.push({id,reason:'ищет сервис',projectId:DEFAULT_PROJECT,...v});
  }
  return llmText(JSON.stringify({verdicts}));
}

function installFetch(){
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const u=String(url);
    const body=init?.body?JSON.parse(String(init.body)):{};
    if(u.includes('/chat/completions')){
      const system=String(body.messages?.[0]?.content||'');
      const user=String(body.messages?.[1]?.content||'');
      if(system.startsWith('Ты — судья лидов проекта'))return answerJudge(user);
      if(system.startsWith('Ты — судья входящих'))return answerDm(user);
      if(system.startsWith('Ты пишешь черновик')){calls.draft.push(user);return llmText(`Черновик ${calls.draft.length}`)}
      calls.other.push({system,user});
      return llmText(otherAnswer());
    }
    if(u.includes('api.telegram.org'))return Response.json({ok:true});
    const path=new URL(u).pathname;
    calls.worker.push({path,body});
    if(path==='/scan-group')return Response.json({ok:true,title:'Sellers',cursor:workerCursor,fetched:workerMessages.length,skippedNotUser:0,skippedOld:0,skippedError:0,messages:workerMessages});
    if(path==='/inbox-dms')return Response.json(body.apiId===API_ID[ACC_A]?{ok:true,messages:inboxMessages,complete:true,scanStartedTs:Math.floor(Date.now()/1000)}:{ok:true,messages:[],complete:true});
    if(path==='/send-message')return Response.json({ok:true,chatId:'777',messageId:'55'});
    throw new Error(`unexpected fetch ${u}`);
  }));
}

const post=async(body:Record<string,unknown>)=>{
  const res=await POST(postRequest(body));
  return {status:res.status,body:await res.json() as Json};
};
const scan=(id=GROUP_ID)=>post({action:'scan_group',id,force:true});

function rows(kind:string,owner=OWNER):Row[]{
  return (testDb().sqlite.prepare('SELECT id,data FROM records WHERE kind=? AND owner=? ORDER BY created,rowid').all(kind,owner) as {id:string;data:string}[])
    .map(r=>({id:r.id,data:JSON.parse(r.data)}));
}
const record=(id:string)=>JSON.parse((testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string}).data) as Json;
const scanLeads=()=>rows('lead').filter(l=>l.data.groupId===GROUP_ID);
const setSettings=(patch:Record<string,unknown>={})=>testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...SETTINGS,...patch}),SETTINGS_ID);
const patchRecord=(id:string,patch:Record<string,unknown>)=>testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...record(id),...patch}),id);

function addForeignProject(){
  testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .run(FOREIGN_PROJECT,'owner-2','project',JSON.stringify({name:'Чужой',product:'чужое'}),null,nowIso());
}

async function createProject(name:string,extra:Record<string,unknown>={}){
  const r=await post({action:'project_create',data:{name,...extra}});
  expect(r.status).toBe(200);
  return String(r.body.id);
}

describe('lead core v2 · workspace route',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubEnv('AI_API_KEY','sk-test-not-real');
    vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.spyOn(console,'warn').mockImplementation(()=>{});
    login(OWNER);
    const {sqlite}=testDb();
    sqlite.prepare('UPDATE records SET secret=? WHERE id=?').run(await seal(JSON.stringify({kind:'tdata',zipBase64:'eA==',apiId:9,apiHash:'h'}),OWNER),ACCOUNT_ID);
    addRecord(GROUP_ID,'group',{name:'Sellers',url:'https://t.me/sellers_chat',accountId:ACCOUNT_ID,status:'active',membership:'joined'});
    setSettings();
    for(const list of Object.values(calls))list.length=0;
    judge=()=>({isLead:true,score:90});
    dmJudge=()=>({score:90,projectId:DEFAULT_PROJECT});
    otherAnswer=()=>'{}';
    workerMessages=[];workerCursor='';inboxMessages=[];
    installFetch();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('REQ-2 lazy default project',()=>{
    it('a scan of a group without projectId creates the default project from settings and tags the leads',async()=>{
      workerMessages=messages(1);

      const r=await scan();

      expect(r.status).toBe(200);
      const projects=rows('project');
      expect(projects.map(p=>p.id)).toEqual([DEFAULT_PROJECT]);
      expect(projects[0]!.data.product).toBe(SETTINGS.product);
      expect(projects[0]!.data.stopWords).toEqual(['казино']);
      expect(scanLeads()[0]!.data.projectId).toBe(DEFAULT_PROJECT);
    });

    it('GET serves the default project but never scan_day or ai_guard rows',async()=>{
      workerMessages=messages(1);
      await scan();

      const res=await GET();
      const body=await res.json() as {records:{kind:string;id:string}[]};

      expect(body.records.filter(r=>r.kind==='project').map(r=>r.id)).toEqual([DEFAULT_PROJECT]);
      expect(body.records.some(r=>r.kind==='scan_day'||r.kind==='ai_guard')).toBe(false);
    });
  });

  describe('REQ-1 project CRUD',()=>{
    it('creates, patches one field and deletes a project',async()=>{
      const id=await createProject('Второй',{product:'CRM'});

      const upd=await post({action:'project_update',id,patch:{minScore:70}});
      expect(upd.status).toBe(200);
      expect(record(id)).toMatchObject({name:'Второй',product:'CRM',minScore:70});

      const del=await post({action:'project_delete',id});
      expect(del.status).toBe(200);
      expect(rows('project').map(p=>p.id)).toEqual([DEFAULT_PROJECT]);
    });

    it('rejects unknown patch fields and keeps the project unchanged',async()=>{
      const id=await createProject('Второй');

      const upd=await post({action:'project_update',id,patch:{name:'X',owner:'owner-2'}});

      expect(upd.status).toBe(400);
      expect(record(id).name).toBe('Второй');
    });

    it('allows at most 10 projects per owner',async()=>{
      for(let i=0;i<9;i++)await createProject(`P${i}`);

      const r=await post({action:'project_create',data:{name:'Лишний'}});

      expect(r.status).toBe(409);
      expect(rows('project')).toHaveLength(10);
    });

    it('a project with groups is deleted only with moveToProjectId, groups move there',async()=>{
      const id=await createProject('Второй');
      await post({action:'set_group_project',groupIds:[GROUP_ID],projectId:id});

      const refused=await post({action:'project_delete',id});
      expect(refused.status).toBe(409);

      const moved=await post({action:'project_delete',id,moveToProjectId:DEFAULT_PROJECT});
      expect(moved.status).toBe(200);
      expect(record(GROUP_ID).projectId).toBe(DEFAULT_PROJECT);
    });

    it('the default project cannot be deleted',async()=>{
      await createProject('Второй');
      const r=await post({action:'project_delete',id:DEFAULT_PROJECT});
      expect(r.status).toBe(400);
    });
  });

  describe('REQ-3 groups get a project',()=>{
    it('a new group gets the given project, else the default one; a client save cannot move it',async()=>{
      const id=await createProject('Второй');
      const a=await post({action:'save',kind:'group',projectId:id,data:{name:'A',url:'https://t.me/group_a1'}});
      const b=await post({action:'save',kind:'group',data:{name:'B',url:'https://t.me/group_b1'}});

      expect(record(a.body.id).projectId).toBe(id);
      expect(record(b.body.id).projectId).toBe(DEFAULT_PROJECT);

      await post({action:'save',kind:'group',id:a.body.id,data:{name:'A2',url:'https://t.me/group_a1',projectId:DEFAULT_PROJECT}});
      expect(record(a.body.id)).toMatchObject({name:'A2',projectId:id});
    });

    it('set_group_project moves groups; import_catalog assigns the project',async()=>{
      const id=await createProject('Второй');
      addRecord(GROUP_2,'group',{name:'G2',url:'https://t.me/g2_chat'});

      const r=await post({action:'set_group_project',groupIds:[GROUP_ID,GROUP_2],projectId:id});
      expect(r.body.updated).toBe(2);
      expect(record(GROUP_2).projectId).toBe(id);

      const imp=await post({action:'import_catalog',projectId:id});
      expect(imp.status).toBe(200);
      const imported=rows('group').filter(g=>g.data.source);
      expect(imported.length).toBeGreaterThan(0);
      expect(imported.every(g=>g.data.projectId===id)).toBe(true);
    });
  });

  describe('REQ-24 project ids are validated against the owner',()=>{
    beforeEach(()=>addForeignProject());

    it.each([
      ['project_update',{id:FOREIGN_PROJECT,patch:{name:'взлом'}}],
      ['project_delete',{id:FOREIGN_PROJECT}],
      ['set_group_project',{groupIds:[GROUP_ID],projectId:FOREIGN_PROJECT}],
      ['funnel',{projectId:FOREIGN_PROJECT,days:1}],
      ['rebuild_product',{projectId:FOREIGN_PROJECT}],
      ['import_catalog',{projectId:FOREIGN_PROJECT}],
    ])('%s with another owner\'s project → 404, nothing changes',async(action,body)=>{
      const r=await post({action,...body});

      expect(r.status).toBe(404);
      expect(record(FOREIGN_PROJECT).name).toBe('Чужой');
      expect(record(GROUP_ID).projectId).toBeUndefined();
      expect(rows('group').length).toBe(1);
    });

    it('a group save with another owner\'s projectId is refused',async()=>{
      const r=await post({action:'save',kind:'group',projectId:FOREIGN_PROJECT,data:{name:'A',url:'https://t.me/group_a1'}});
      expect(r.status).toBe(404);
    });

    it('project_delete cannot move groups into another owner\'s project',async()=>{
      const id=await createProject('Второй');
      await post({action:'set_group_project',groupIds:[GROUP_ID],projectId:id});
      const r=await post({action:'project_delete',id,moveToProjectId:FOREIGN_PROJECT});
      expect(r.status).toBe(404);
      expect(record(GROUP_ID).projectId).toBe(id);
    });
  });

  describe('REQ-23 project is read-only for generic save/delete',()=>{
    it('save and delete of kind project are rejected',async()=>{
      await createProject('Второй');
      const save=await post({action:'save',kind:'project',data:{name:'X'}});
      const del=await post({action:'delete',kind:'project',id:DEFAULT_PROJECT});

      expect(save.status).toBe(400);
      expect(del.status).toBe(400);
      expect(rows('project')).toHaveLength(2);
    });
  });

  describe('REQ-22 removed actions',()=>{
    it.each(['preview_lead_core','train_from_hot','train_from_ignored','reject_lead_stopwords','suggest_stopwords'])('%s → 400',async(action)=>{
      const r=await post({action,id:LEAD_ID});
      expect(r.status).toBe(400);
    });
  });

  describe('REQ-9 judge verdicts make leads',()=>{
    it('a lead keeps score, reason, sourceKind; hot ≥80, warm below; under minScore no lead',async()=>{
      workerMessages=[msg(100),msg(101),msg(102,undefined,{messageKind:'discussion'})];
      judge=([id])=>id==='100'?{score:85}:id==='101'?{score:60}:{score:40};

      const r=await scan();

      expect(r.body.added).toBe(2);
      const byId=Object.fromEntries(scanLeads().map(l=>[l.data.tgMsgId,l.data]));
      expect(byId['100']).toMatchObject({temperature:'hot',score:85,reason:'нужен сервис',sourceKind:'group',projectId:DEFAULT_PROJECT});
      expect(byId['101']).toMatchObject({temperature:'warm',score:60});
      expect(byId['102']).toBeUndefined();
    });

    it('rejected ids are remembered: the next scan does not judge them again',async()=>{
      workerMessages=messages(2);
      judge=()=>({isLead:false,score:5});
      await scan();
      await scan();

      expect(calls.judge).toHaveLength(1);
      expect(record(GROUP_ID).aiRejected.until).toHaveProperty('100');
    });

    it('the worker gets days and minId, no keyword or limit fields',async()=>{
      workerMessages=messages(1);
      workerCursor='150';
      await scan();
      await scan();

      const scans=calls.worker.filter(c=>c.path==='/scan-group');
      expect(scans[0]!.body).toMatchObject({days:7,minId:''});
      expect(scans[1]!.body.minId).toBe('150');
      for(const key of ['keywords','minusKeywords','limit'])expect(scans[0]!.body).not.toHaveProperty(key);
    });
  });

  describe('REQ-10 cursor rewinds to the first unjudged message',()=>{
    it('a failed second batch → cursor = first id of that batch − 1, first batch leads kept',async()=>{
      workerMessages=messages(25);
      workerCursor='124';
      judge=(_ids,call)=>call>=2?new Response('down',{status:500}):{score:90};

      const r=await scan();

      expect(r.status).toBe(200);
      expect(scanLeads()).toHaveLength(20);
      expect(record(GROUP_ID).scanCursor).toBe('119');
    });

    it('a judge failing 3 scans in a row advances the cursor and logs it in Russian',async()=>{
      workerMessages=messages(3);
      workerCursor='102';
      judge=()=>new Response('down',{status:500});

      await scan();
      expect(record(GROUP_ID)).toMatchObject({scanCursor:'99',judgeFailStreak:1});
      await scan();
      expect(record(GROUP_ID)).toMatchObject({scanCursor:'99',judgeFailStreak:2});
      await scan();

      const g=record(GROUP_ID);
      expect(g).toMatchObject({scanCursor:'102',judgeFailStreak:0});
      expect(g.scanLog.some((e:Json)=>e.level==='warn'&&/3 скана подряд/.test(e.text))).toBe(true);
    });

    it('a client save cannot reset judgeFailStreak',async()=>{
      patchRecord(GROUP_ID,{judgeFailStreak:2});
      await post({action:'save',kind:'group',id:GROUP_ID,data:{...record(GROUP_ID),judgeFailStreak:0}});
      expect(record(GROUP_ID).judgeFailStreak).toBe(2);
    });

    it('no AI key → nothing judged, nothing lost: cursor stays before the first message',async()=>{
      vi.stubEnv('AI_API_KEY','');
      workerMessages=messages(3);
      workerCursor='102';

      await scan();

      expect(calls.judge).toHaveLength(0);
      expect(scanLeads()).toHaveLength(0);
      expect(record(GROUP_ID).scanCursor).toBe('99');
    });

    it('the daily judge cap skips judging and counts judgeSkipped',async()=>{
      setSettings({judgeDailyCap:2});
      workerMessages=messages(3);
      workerCursor='102';

      await scan();
      const f=await post({action:'funnel',projectId:DEFAULT_PROJECT,days:1});

      expect(calls.judge).toHaveLength(0);
      expect(record(GROUP_ID).scanCursor).toBe('99');
      expect(f.body.funnel.counts.judgeSkipped).toBe(3);
      expect(f.body.funnel.samples.judgeSkipped[0].reason).toBe('daily_cap');
    });

    it('a retry reserves the daily cap again: no room → no second paid call',async()=>{
      setSettings({judgeDailyCap:25});
      workerMessages=messages(20);
      workerCursor='119';
      judge=()=>new Response('down',{status:500});

      await scan();

      expect(calls.judge).toHaveLength(1);
      expect(record(GROUP_ID).scanCursor).toBe('99');
      const day=new Date().toISOString().slice(0,10);
      expect(record(`judge-day:${OWNER}:${day}`).count).toBe(20);
    });

    it('a retry within the cap is charged for its messages',async()=>{
      setSettings({judgeDailyCap:100});
      workerMessages=messages(5);
      let n=0;
      judge=()=>++n===1?new Response('down',{status:500}):{score:90};

      await scan();

      expect(calls.judge).toHaveLength(2);
      expect(scanLeads()).toHaveLength(5);
      expect(record(`judge-day:${OWNER}:${new Date().toISOString().slice(0,10)}`).count).toBe(10);
    });

    it('comment ids never reach the cursor',async()=>{
      vi.stubEnv('AI_API_KEY','');
      workerMessages=[msg(9000,undefined,{messageKind:'comment'})];
      workerCursor='300';
      patchRecord(GROUP_ID,{scanCursor:'250'});

      await scan();

      expect(record(GROUP_ID).scanCursor).toBe('300');
    });
  });

  describe('REQ-12 funnel',()=>{
    it('a scan upserts scan_day; funnel returns the project counters and the DM row',async()=>{
      workerMessages=[msg(100),msg(101,'коротко'),msg(102)];
      judge=([id])=>id==='100'?{score:90}:{isLead:false,score:10};

      await scan();
      await scan();
      const f=await post({action:'funnel',projectId:DEFAULT_PROJECT,days:7});

      expect(f.status).toBe(200);
      expect(f.body.funnel).toMatchObject({projectId:DEFAULT_PROJECT,days:7});
      expect(f.body.funnel.counts).toMatchObject({returned:6,short:2,judged:2,leads:1,rejected:1,duplicate:2});
      expect(f.body.funnel.runs).toHaveLength(2);
      expect(f.body.dm.counts.fetched).toBe(0);
      expect(rows('scan_day')).toHaveLength(1);
    });

    it('a scan prunes the owner\'s scan_day rows older than 30 days, not other owners\' rows',async()=>{
      const day=(daysAgo:number)=>new Date(Date.now()-daysAgo*86400000).toISOString().slice(0,10);
      const insert=(owner:string,id:string,d:string)=>testDb().sqlite.prepare("INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,'scan_day',?,NULL,?)")
        .run(id,owner,JSON.stringify({projectId:'p',day:d,counts:{},samples:{},runs:[]}),nowIso());
      insert(OWNER,'scan-day:old-a',day(31));
      insert(OWNER,'scan-day:old-b',day(90));
      insert(OWNER,'scan-day:keep',day(29));
      insert('owner-2','scan-day:foreign-old',day(90));
      workerMessages=messages(1);

      await scan();

      const ids=(testDb().sqlite.prepare("SELECT id FROM records WHERE kind='scan_day'").all() as {id:string}[]).map(r=>r.id);
      expect(ids).not.toContain('scan-day:old-a');
      expect(ids).not.toContain('scan-day:old-b');
      expect(ids).toEqual(expect.arrayContaining(['scan-day:keep','scan-day:foreign-old']));
    });

    it('rejects days other than 1 or 7',async()=>{
      const f=await post({action:'funnel',projectId:DEFAULT_PROJECT,days:30});
      expect(f.status).toBe(400);
    });
  });

  describe('REQ-18 auto drafts',()=>{
    it('drafts at most 3 hot leads per scan, sets draftKind, never sends',async()=>{
      workerMessages=messages(5);
      judge=()=>({score:95});

      await scan();

      await vi.waitFor(()=>expect(scanLeads().filter(l=>l.data.draft)).toHaveLength(3));
      const drafted=scanLeads().filter(l=>l.data.draft);
      expect(drafted.every(l=>l.data.draftKind==='dm_first')).toBe(true);
      expect(calls.draft).toHaveLength(3);
      expect(calls.worker.some(c=>c.path==='/send-message')).toBe(false);
    });

    it('autoDraft off or warm leads → no drafts',async()=>{
      workerMessages=messages(2);
      judge=([id])=>id==='100'?{score:60}:{score:95};
      await scan();
      await post({action:'project_update',id:DEFAULT_PROJECT,patch:{autoDraft:false}});
      workerMessages=messages(2,200);
      await scan();
      await new Promise(r=>setTimeout(r,30));

      expect(calls.draft).toHaveLength(1);
      expect(scanLeads().filter(l=>l.data.draft).map(l=>l.data.tgMsgId)).toEqual(['101']);
    });

    it('the daily draft cap stops auto drafts',async()=>{
      setSettings({draftDailyCap:1});
      workerMessages=messages(3);
      judge=()=>({score:95});

      await scan();
      await vi.waitFor(()=>expect(calls.draft).toHaveLength(1));
      await new Promise(r=>setTimeout(r,30));

      expect(calls.draft).toHaveLength(1);
    });
  });

  describe('REQ-17 / REQ-19 manual drafts and sending',()=>{
    it('draft {id, kind} stores the text without draftKind; the 1/min guard stays',async()=>{
      const first=await post({action:'draft',id:LEAD_ID,kind:'dm_first'});
      const second=await post({action:'draft',id:LEAD_ID,kind:'dm_first'});

      expect(first.status).toBe(200);
      expect(first.body.draft).toBe('Черновик 1');
      expect(record(LEAD_ID).draft).toBe('Черновик 1');
      expect(record(LEAD_ID).draftKind).toBeUndefined();
      expect(second.status).toBe(429);
    });

    it('regenerating an auto draft keeps draftKind: the lead stays in the approval queue',async()=>{
      patchRecord(LEAD_ID,{draft:'Авто',draftKind:'dm_first'});

      const r=await post({action:'draft',id:LEAD_ID,kind:'dm_first'});

      expect(r.status).toBe(200);
      expect(record(LEAD_ID)).toMatchObject({draft:'Черновик 1',draftKind:'dm_first'});
    });

    it('a lead whose project is gone reads as the default project in draft and feedback',async()=>{
      const gone='a0000000-0000-4000-8000-00000000dead';
      patchRecord(LEAD_ID,{projectId:gone});

      const draft=await post({action:'draft',id:LEAD_ID,kind:'dm_first'});
      const feedback=await post({action:'lead_feedback',id:LEAD_ID,verdict:'good'});

      expect(draft.status).toBe(200);
      expect(calls.draft).toHaveLength(1);
      expect(feedback.status).toBe(200);
      expect(feedback.body.projectId).toBe(DEFAULT_PROJECT);
      expect(record(DEFAULT_PROJECT).goodExamples).toEqual(['Ищу сервис для остатков']);
    });

    it('draft with an unknown kind → 400',async()=>{
      const r=await post({action:'draft',id:LEAD_ID,kind:'mass_mail'});
      expect(r.status).toBe(400);
    });

    it('dismiss_draft clears draft and draftKind',async()=>{
      patchRecord(LEAD_ID,{draft:'Авто',draftKind:'dm_first'});

      const r=await post({action:'dismiss_draft',id:LEAD_ID});

      expect(r.status).toBe(200);
      expect(record(LEAD_ID).draft).toBe('');
      expect(record(LEAD_ID).draftKind).toBeUndefined();
    });

    it('send_lead_message clears draft and draftKind on success',async()=>{
      dropHarnessAccount();
      await addSealedAccount(ACC_A,{});
      patchRecord(LEAD_ID,{draft:'Авто',draftKind:'dm_first',senderId:'777',accountId:ACC_A});

      const r=await post({action:'send_lead_message',id:LEAD_ID,mode:'dm',text:'Здравствуйте!'});

      expect(r.status).toBe(200);
      expect(record(LEAD_ID).draft).toBe('');
      expect(record(LEAD_ID).draftKind).toBeUndefined();
    });
  });

  describe('REQ-21 feedback',()=>{
    it('good/bad add examples to the lead\'s project, stop words unchanged',async()=>{
      workerMessages=messages(2);
      await scan();
      const [a,b]=scanLeads();

      await post({action:'lead_feedback',id:a!.id,verdict:'good'});
      const r=await post({action:'lead_feedback',id:b!.id,verdict:'bad'});

      expect(r.status).toBe(200);
      const p=record(DEFAULT_PROJECT);
      expect(p.goodExamples).toEqual([a!.data.message]);
      expect(p.badExamples).toEqual([b!.data.message]);
      expect(p.stopWords).toEqual(['казино']);
    });

    it('rejects an unknown verdict',async()=>{
      const r=await post({action:'lead_feedback',id:LEAD_ID,verdict:'meh'});
      expect(r.status).toBe(400);
    });
  });

  describe('REQ-24 server-owned lead fields',()=>{
    it('a client save cannot change projectId, score, reason, sourceKind or draftKind',async()=>{
      workerMessages=messages(1);
      judge=()=>({score:70});
      await scan();
      const lead=scanLeads()[0]!;

      await post({action:'save',kind:'lead',id:lead.id,data:{...lead.data,projectId:'x',score:1,reason:'взлом',sourceKind:'dm',draftKind:'dm_first',status:'working'}});

      expect(record(lead.id)).toMatchObject({projectId:DEFAULT_PROJECT,score:70,reason:'нужен сервис',sourceKind:'group',status:'working'});
      expect(record(lead.id).draftKind).toBeUndefined();
    });
  });

  describe('REQ-4 project card owns the product fields',()=>{
    it('rebuild_product fills the project card from AI, settings stay untouched',async()=>{
      otherAnswer=()=>JSON.stringify({product:'Новый продукт',audience:'Селлеры',leadCriteria:'Ищет CRM',notLead:'Вакансии',valueProps:'Быстро',tone:'дружелюбно',cta:'Демо',keywords:['crm','остатки']});
      const id=await createProject('Второй',{url:'https://example.com'});

      const r=await post({action:'rebuild_product',projectId:id});

      expect(r.status).toBe(200);
      expect(record(id)).toMatchObject({product:'Новый продукт',leadCriteria:'Ищет CRM',keywords:['crm','остатки'],stopWords:[]});
      expect(calls.other[0]!.user).toContain('https://example.com');
      expect(record(SETTINGS_ID).product).toBe(SETTINGS.product);
    });

    it('a settings save never writes project fields; legacy values stay for the default-project read',async()=>{
      const dead={product:'взлом',keywords:'a',minusKeywords:'b',audience:'новая',leadCriteria:'x',projectUrl:'https://evil.test',
        tone:'t',cta:'c',pains:'p',valueProps:'v',avoidTopics:'n',hotSignals:'h',productNotes:'pn',learnExamples:'l',
        aiQualify:false,lastMinusAdded:['x'],lastMinusAddedAt:nowIso(),scanDepthDays:30};

      const r=await post({action:'save',kind:'settings',id:SETTINGS_ID,data:{name:'Кабинет',notifyEnabled:false,autoRescanMinutes:45,...dead}});

      expect(r.status).toBe(200);
      const s=record(SETTINGS_ID);
      expect(s).toMatchObject({name:'Кабинет',autoRescanMinutes:45,product:SETTINGS.product,keywords:SETTINGS.keywords,
        minusKeywords:SETTINGS.minusKeywords,audience:SETTINGS.audience,leadCriteria:SETTINGS.leadCriteria});
      for(const key of ['projectUrl','tone','cta','pains','valueProps','avoidTopics','hotSignals','productNotes','learnExamples','aiQualify','lastMinusAdded','lastMinusAddedAt','scanDepthDays']){
        expect(s).not.toHaveProperty(key);
      }
    });

    it('generate_account_about reads the project card',async()=>{
      otherAnswer=()=>JSON.stringify({about:'Остатки без ошибок',firstName:'Анна',lastName:''});
      const id=await createProject('Второй',{product:'Уникальный продукт XYZ'});

      const r=await post({action:'generate_account_about',projectId:id});

      expect(r.body.about).toBe('Остатки без ошибок');
      expect(calls.other[0]!.user).toContain('Уникальный продукт XYZ');
    });
  });

  describe('REQ-15 own-account id is server-owned',()=>{
    it('a generic save of an account keeps tgUserId',async()=>{
      patchRecord(ACCOUNT_ID,{tgUserId:'424242'});

      const r=await post({action:'save',kind:'account',id:ACCOUNT_ID,data:{name:'Farm 1 renamed',phone:'+79990001122',tgUserId:'1'}});

      expect(r.status).toBe(200);
      expect(record(ACCOUNT_ID)).toMatchObject({name:'Farm 1 renamed',tgUserId:'424242'});
    });
  });

  describe('REQ-14..16 incoming DMs',()=>{
    const dm=(userId:string,text:string,messageId:string,username=`u${userId}`)=>({
      userId,username,name:`Name ${userId}`,text,messageId,at:nowIso(),ts:Math.floor(Date.now()/1000),hasMedia:false,
    });
    beforeEach(async()=>{
      dropHarnessAccount();
      await addSealedAccount(ACC_A,{username:'our_farm'});
    });
    const poll=()=>post({action:'poll_dm_replies'});

    it('an unmatched stranger DM is judged once and becomes a dm lead with an open conversation',async()=>{
      inboxMessages=[dm('501','Здравствуйте, ищу сервис для остатков на WB','1'),dm('501','Сколько стоит подключение?','2')];

      const r=await poll();

      expect(r.status).toBe(200);
      expect(calls.dm).toEqual([['501']]);
      const lead=rows('lead').find(l=>l.data.senderId==='501')!;
      expect(lead.data).toMatchObject({sourceKind:'dm',conversationOpen:true,projectId:DEFAULT_PROJECT,temperature:'hot'});
      expect(lead.data.replies).toHaveLength(2);
    });

    it('our own accounts are not judged',async()=>{
      inboxMessages=[dm('601','Привет, это второй аккаунт фермы, проверка связи','1','our_farm')];

      await poll();

      expect(calls.dm).toHaveLength(0);
      expect(rows('lead').some(l=>l.data.senderId==='601')).toBe(false);
    });

    it('a failed DM judge is counted and the inbox cursor still advances',async()=>{
      inboxMessages=[dm('701','Нужна помощь с синхронизацией остатков','1')];
      dmJudge=()=>new Response('down',{status:500});
      const before=record(ACC_A).inboxSinceTs;

      const r=await poll();
      const f=await post({action:'funnel',projectId:DEFAULT_PROJECT,days:1});

      expect(r.status).toBe(200);
      expect(record(ACC_A).inboxSinceTs).not.toBe(before);
      expect(f.body.dm.counts.judgeError).toBe(1);
      expect(rows('lead').some(l=>l.data.senderId==='701')).toBe(false);
    });

    it('a sender that already is a lead is not judged again',async()=>{
      addRecord('d0000000-0000-4000-8000-0000000000aa','lead',{name:'Old',message:'старое сообщение лида',senderId:'801',status:'new'});
      inboxMessages=[dm('801','Ещё раз пишу про остатки, ответьте','5')];

      await poll();

      expect(calls.dm).toHaveLength(0);
      const lead=record('d0000000-0000-4000-8000-0000000000aa');
      expect(lead).toMatchObject({conversationOpen:true,incomingLastText:'Ещё раз пишу про остатки, ответьте'});
      expect(lead.replies).toEqual([expect.objectContaining({from:'client',messageId:'5',text:'Ещё раз пишу про остатки, ответьте'})]);
      expect(rows('lead').filter(l=>l.data.senderId==='801')).toHaveLength(1);
    });

    it('a DM from an existing lead goes into its open conversation, not into an older lead of the same sender',async()=>{
      addRecord('d0000000-0000-4000-8000-0000000000ab','lead',{name:'Group',message:'из группы',senderId:'802',status:'new'});
      addRecord('d0000000-0000-4000-8000-0000000000ac','lead',{name:'Talk',message:'переписка',senderId:'802',status:'working',conversationOpen:true});
      inboxMessages=[dm('802','Добрый день, напомню о себе','6')];

      await poll();

      expect(record('d0000000-0000-4000-8000-0000000000ac').replies).toHaveLength(1);
      expect(record('d0000000-0000-4000-8000-0000000000ab').replies??[]).toHaveLength(0);
    });

    it('a username match opens the conversation of a lead without senderId',async()=>{
      addRecord('d0000000-0000-4000-8000-0000000000ad','lead',{name:'Nick',message:'старое',senderUsername:'@Nick_803',status:'new'});
      inboxMessages=[dm('803','Пишу вам напрямую','7','nick_803')];

      await poll();

      expect(calls.dm).toHaveLength(0);
      expect(record('d0000000-0000-4000-8000-0000000000ad')).toMatchObject({conversationOpen:true,senderId:'803'});
    });

    it('a DM rejected by the judge is remembered and not judged again',async()=>{
      inboxMessages=[dm('901','Продаю рекламу в своём канале, недорого','1')];
      dmJudge=()=>({score:5,projectId:null});

      await poll();
      await poll();

      expect(calls.dm).toHaveLength(1);
      expect(record(SETTINGS_ID).dmAiRejected.until).toHaveProperty('901:1');
    });
  });
});
