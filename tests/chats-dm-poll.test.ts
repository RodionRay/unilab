import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {
  ACC_A,ACC_B,API_ID,CHAT_LEAD,type WorkerCall,
  type StoredRecord,addChatLead,addSealedAccount,dropHarnessAccount,enableNotifications,readRecord,stubWorker,writeRecord,
} from './helpers/chats-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const poll=()=>POST(postRequest({action:'poll_dm_replies'}));
const NOW_TS=Math.floor(Date.now()/1000);
const clientMsg=(messageId:string,text='Да, интересно')=>({
  userId:'777',username:'client_nick',name:'Клиент',text,messageId,
  at:new Date(NOW_TS*1000).toISOString(),ts:NOW_TS,hasMedia:false,
});
const inbox=(messages:unknown[],extra:Record<string,unknown>={})=>({ok:true,messages,complete:true,scanStartedTs:NOW_TS,...extra});
/** Answers /inbox-dms only for one fixture account, empty inbox for the others. */
const onlyFor=(accountId:string,answer:()=>unknown)=>(call:WorkerCall)=>
  call.body.apiId===API_ID[accountId]?answer():inbox([]);
const leadsOf=()=>(testDb().sqlite.prepare("SELECT id,data FROM records WHERE owner=? AND kind='lead'").all(OWNER) as {id:string;data:string}[])
 .map(r=>({id:r.id,...JSON.parse(r.data)}) as StoredRecord&{id:string});
const clientEntries=(lead:StoredRecord)=>lead.replies.filter(x=>x.from==='client');

describe('переписки · входящие ЛС (poll_dm_replies)',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    dropHarnessAccount();
    await addSealedAccount(ACC_A,{});
    await addSealedAccount(ACC_B,{});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('REQ-C2: ответ менеджера, записанный во время опроса, не теряется',async()=>{
    addChatLead();
    stubWorker(onlyFor(ACC_A,()=>{
      const lead=readRecord(CHAT_LEAD);
      writeRecord(CHAT_LEAD,{...lead,replies:[...lead.replies,{text:'Менеджер: ловите прайс',mode:'dm',at:new Date().toISOString(),ok:true,error:'',messageId:'11',chatId:'777',from:'us'}]});
      return inbox([clientMsg('900')]);
    }));

    await poll();

    const texts=readRecord(CHAT_LEAD).replies.map(x=>x.text);
    expect(texts).toContain('Менеджер: ловите прайс');
    expect(texts).toContain('Да, интересно');
  });

  it('REQ-C9: входящее не переоткрывает закрытого (archived) лида',async()=>{
    addChatLead({status:'archived',temperature:'cold'});
    stubWorker(onlyFor(ACC_A,()=>inbox([clientMsg('901')])));

    await poll();

    const lead=readRecord(CHAT_LEAD);
    expect(lead.status).toBe('archived');
    expect(lead.temperature).toBe('cold');
    expect(clientEntries(lead)).toHaveLength(1);
  });

  it('REQ-C9: входящее в новом лиде переводит его в работу',async()=>{
    addChatLead({status:'new'});
    stubWorker(onlyFor(ACC_A,()=>inbox([clientMsg('902')])));

    await poll();

    expect(readRecord(CHAT_LEAD).status).toBe('working');
  });

  it('REQ-C10: одинаковый messageId с другого аккаунта — это другое сообщение',async()=>{
    addChatLead({replies:[{text:'старое',mode:'dm',at:'2026-09-29T10:00:00.000Z',ok:true,error:'',messageId:'903',chatId:'777',from:'client',accountId:ACC_B}]});
    stubWorker(onlyFor(ACC_A,()=>inbox([clientMsg('903','новое')])));

    await poll();
    await poll();

    const texts=clientEntries(readRecord(CHAT_LEAD)).map(x=>x.text);
    expect(texts).toEqual(['старое','новое']);
  });

  it('REQ-C10: повторно увиденное сообщение того же аккаунта не дублируется и не шлёт второе уведомление',async()=>{
    addChatLead();
    enableNotifications();
    const {notifications}=stubWorker(onlyFor(ACC_A,()=>inbox([clientMsg('904')])));

    await poll();
    await poll();

    expect(clientEntries(readRecord(CHAT_LEAD))).toHaveLength(1);
    await vi.waitFor(()=>expect(notifications).toHaveLength(1));
  });

  it('REQ-C7: параллельный опрос того же владельца пропускается (lease), уведомление одно',async()=>{
    addChatLead();
    enableNotifications();
    let release:()=>void=()=>{};
    const gate=new Promise<void>(r=>{release=r});
    const {calls,notifications}=stubWorker(onlyFor(ACC_A,async()=>{await gate;return inbox([clientMsg('905')])}));

    const first=poll();
    await vi.waitFor(()=>expect(calls.length).toBeGreaterThan(0));
    const secondPending=poll();
    await new Promise(r=>setTimeout(r,50));
    release();
    const [,second]=await Promise.all([first,secondPending]);

    expect(await second.json()).toMatchObject({skipped:true,reason:'busy'});
    expect(calls).toHaveLength(2);
    expect(clientEntries(readRecord(CHAT_LEAD))).toHaveLength(1);
    await vi.waitFor(()=>expect(notifications).toHaveLength(1));
    const third=await poll();
    expect(await third.json()).not.toMatchObject({skipped:true});
  });

  it('REQ-C3: неполный проход входящих не сдвигает курсор, а продолжает с offsetDate',async()=>{
    addChatLead();
    await addSealedAccount(ACC_A,{inboxSinceTs:NOW_TS-3600});
    const seen:WorkerCall[]=[];
    stubWorker(call=>{
      if(call.body.apiId!==API_ID[ACC_A])return inbox([]);
      seen.push(call);
      return seen.length===1
        ?inbox([clientMsg('906')],{complete:false,nextOffsetDate:NOW_TS-1800,scanStartedTs:NOW_TS})
        :inbox([],{complete:true,scanStartedTs:NOW_TS+30});
    });

    await poll();
    const mid=readRecord(ACC_A);
    await poll();
    const done=readRecord(ACC_A);

    expect(mid.inboxSinceTs).toBe(NOW_TS-3600);
    expect(seen[0]?.body).toMatchObject({sinceTs:NOW_TS-3600});
    expect(seen[0]?.body.offsetDate||0).toBe(0);
    expect(seen[1]?.body).toMatchObject({sinceTs:NOW_TS-3600,offsetDate:NOW_TS-1800});
    expect(done.inboxSinceTs).toBeGreaterThan(NOW_TS-3600);
    expect(done.inboxSinceTs).toBeLessThanOrEqual(NOW_TS);
    expect(done.inboxPageOffset||0).toBe(0);
  });

  it('REQ-D1: первое входящее от незнакомого человека создаёт лида в Переписках',async()=>{
    stubWorker(onlyFor(ACC_A,()=>inbox([{...clientMsg('910','Здравствуйте, вопрос по CRM'),userId:'888',username:'stranger',name:'Иван'}])));

    await poll();

    const leads=leadsOf().filter(l=>l.senderId==='888');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      name:'Иван',source:'Входящее в ЛС',conversationOpen:true,needsManager:true,
      senderUsername:'stranger',accountId:ACC_A,incomingLastText:'Здравствуйте, вопрос по CRM',
    });
    expect(clientEntries(leads[0]!)).toHaveLength(1);
  });

  it('REQ-D1: второе сообщение незнакомца идёт в того же лида, без дубля',async()=>{
    const stranger=(id:string,text:string)=>({...clientMsg(id,text),userId:'888',username:'stranger'});
    let n=0;
    stubWorker(onlyFor(ACC_A,()=>inbox(++n===1?[stranger('911','раз')]:[stranger('911','раз'),stranger('912','два')])));

    await poll();
    await poll();

    const leads=leadsOf().filter(l=>l.senderId==='888');
    expect(leads).toHaveLength(1);
    expect(clientEntries(leads[0]!).map(x=>x.text)).toEqual(['раз','два']);
  });

  it('REQ-D1: входящее от лида, которому мы не писали, открывает его переписку',async()=>{
    addChatLead({conversationOpen:false,replies:[]});
    stubWorker(onlyFor(ACC_A,()=>inbox([clientMsg('913','Пишу сам')])));

    await poll();

    const lead=readRecord(CHAT_LEAD);
    expect(lead.conversationOpen).toBe(true);
    expect(clientEntries(lead).map(x=>x.text)).toEqual(['Пишу сам']);
    expect(leadsOf().filter(l=>l.senderId==='777')).toHaveLength(1);
  });

  it('REQ-D2: сообщение от нашего же аккаунта лида не создаёт',async()=>{
    await addSealedAccount(ACC_B,{username:'Our_Bot_Acc'});
    stubWorker(onlyFor(ACC_A,()=>inbox([{...clientMsg('914','прогрев'),userId:'555',username:'our_bot_acc'}])));

    await poll();

    expect(leadsOf().filter(l=>l.senderId==='555')).toHaveLength(0);
  });
});
