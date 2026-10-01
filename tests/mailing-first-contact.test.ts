import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {ACC_A,addSealedAccount,dropHarnessAccount,enableNotifications,readRecord} from './helpers/chats-fixture';
import {buttonsOf,stubWorkerAndBot} from './helpers/bot-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const AUD='e1000000-0000-4000-8000-000000000011';
const MAIL='e2000000-0000-4000-8000-000000000012';
const LEAD='e3000000-0000-4000-8000-000000000013';

const tick=()=>POST(postRequest({action:'tick_mailing',id:MAIL}));

function seedMailing(extra:Record<string,unknown>={}){
  addRecord(MAIL,'mailing_task',{
    name:'Осенняя',sourceKind:'audience',audienceTaskId:AUD,contentMode:'template',templateText:'Привет, это Uniseller',deliveryMode:'dm',
    accountIds:[ACC_A],batchPerTick:1,dailyLimitEnabled:false,pauseFromSec:45,pauseToSec:45,pauseBetweenAccounts:false,
    status:'running',sentTotal:0,sentToday:0,failed:0,deliveredKeys:[],deferredUntil:{},deliveries:[],log:[],...extra,
  });
}

function leadsOf(){
  const rows=testDb().sqlite.prepare("SELECT id,data FROM records WHERE owner=? AND kind='lead'").all(OWNER) as {id:string;data:string}[];
  return rows.map(r=>({id:r.id,...JSON.parse(r.data)})) as (Record<string,unknown>&{id:string})[];
}

describe('рассылка · первый контакт сразу в «Переписках»',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubEnv('APP_URL','https://app.test');
    vi.spyOn(console,'error').mockImplementation(()=>{});
    dropHarnessAccount();
    testDb().sqlite.prepare("DELETE FROM records WHERE kind='lead'").run();
    await addSealedAccount(ACC_A,{});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('REQ-1: ЛС рассылки по аудитории создаёт открытую переписку и шлёт уведомление о первом контакте',async()=>{
    addRecord(AUD,'audience_task',{name:'Src',url:'https://t.me/src_chat',status:'completed',accountIds:[ACC_A],log:[]});
    addRecord('f0002001-0000-4000-8000-000000000000','audience_user',{taskId:AUD,userId:'2001',username:'buyer2001'});
    seedMailing();
    enableNotifications();
    const w=stubWorkerAndBot(()=>({ok:true,messageId:'1',chatId:'2001'}));

    await tick();

    const lead=leadsOf().find(l=>l.senderId==='2001');
    expect(lead).toMatchObject({conversationOpen:true,source:'Рассылка'});
    expect(Date.parse(String(lead?.conversationAt))).toBeGreaterThan(Date.now()-60_000);
    const notice=w.sent()[0];
    expect(String(notice?.body.text)).toContain('Начата переписка');
    expect(String(notice?.body.text)).toContain('Осенняя');
    expect(buttonsOf(notice)).toEqual(expect.arrayContaining([
      {text:'Открыть чат',url:`https://app.test/app?view=chats&lead=${lead?.id}`},
      {text:'Написать в Telegram',url:'https://t.me/buyer2001'},
    ]));
  });

  it('REQ-1: ЛС рассылки по лидам открывает переписку у существующего лида',async()=>{
    addRecord(LEAD,'lead',{name:'Пётр',message:'Ищу склад',status:'new',temperature:'hot',senderId:'3002',senderUsername:'petr',replies:[],conversationOpen:false});
    seedMailing({sourceKind:'leads',leadFilter:'hot_warm',audienceTaskId:''});
    stubWorkerAndBot(()=>({ok:true,messageId:'2',chatId:'3002'}));

    await tick();

    const lead=readRecord(LEAD);
    expect(lead.conversationOpen).toBe(true);
    expect(Date.parse(String(lead.conversationAt))).toBeGreaterThan(Date.now()-60_000);
    expect(lead.replies.at(-1)).toMatchObject({from:'us',ok:true});
  });

  it('REQ-1: лиду, которому мы уже писали, рассылка не шлёт второе «Начата переписка»',async()=>{
    addRecord(LEAD,'lead',{name:'Пётр',message:'Ищу склад',status:'working',temperature:'hot',senderId:'3003',senderUsername:'petr3',conversationOpen:true,conversationAt:'2026-09-30T10:00:00.000Z',
      replies:[{text:'Ранее',mode:'dm',at:'2026-09-30T10:00:00.000Z',ok:true,error:'',messageId:'1',link:'',chatId:'3003',from:'us'}]});
    seedMailing({sourceKind:'leads',leadFilter:'hot_warm',audienceTaskId:''});
    enableNotifications();
    const w=stubWorkerAndBot(()=>({ok:true,messageId:'3',chatId:'3003'}));

    await tick();

    expect(w.sent().filter(c=>String(c.body.text).includes('Начата переписка'))).toHaveLength(0);
    expect(readRecord(LEAD).conversationAt).toBe('2026-09-30T10:00:00.000Z');
  });
});
