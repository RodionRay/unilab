import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,PROXY_ID,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {TOKENS,leadText,vkCallResponse,vkWorker} from './helpers/vk-worker';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {moscowDayKey,moscowNextMidnightIso} from '@/lib/telegram-accounts';
import {VK_AI_ITEMS_PER_RUN} from '@/lib/processes/vk-scan';

const NOW=Date.parse('2026-10-01T10:00:00Z');
const SEARCH_ID='a0000000-0000-4000-8000-000000000001';
const GROUP_ID='a0000000-0000-4000-8000-000000000002';
const ACC_A='b0000000-0000-4000-8000-00000000000a';
const ACC_B='b0000000-0000-4000-8000-00000000000b';

const SETTINGS={
  name:'Проект',
  keywords:'остатки, синхронизация, МойСклад, несколько кабинетов',
  minusKeywords:'вакансия',
  leadCriteria:'Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов',
  hotSignals:'ищу сервис, кто пользуется, синхронизация остатков',
  product:'Платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов',
  aiQualify:false,
  notifyEnabled:false,
  notifyBotToken:'123456:bot-token-secret',
  notifyChatId:'42',
  scanDepthDays:30,
};

/** Stored record fields the assertions read; anything else stays unknown. */
type Stored={
  [k:string]:unknown;
  cursor?:Record<string,number>;
  error?:string;
  status?:string;
  leaseId?:string;
  leadTombstones?:string[];
  counters?:{searchCalls:number};
  searchBlockedUntil?:Record<string,string>;
};
type LeadRow={[k:string]:unknown;msgKey:string;message:string;url:string;notifiedAt?:string};
type ScanReply={[k:string]:unknown;added:number;more?:boolean;failovers?:number;accountsUsed?:number;partial?:boolean;locked?:boolean;skipped?:boolean;noAccount?:boolean};
type Feed={items:Record<string,unknown>[]};
const feed=()=>vkWorker.responses['newsfeed.search'] as Feed;
const calls={tg:[] as string[]};
const proxyErrorTokens=new Set<string>();
const logged:string[]=[];
let aiGate:Promise<void>|null=null;
let aiCalls=0;

function setSettings(patch:Record<string,unknown>={}){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...SETTINGS,...patch}),SETTINGS_ID);
}

async function addAccount(id:string,token:string,patch:Record<string,unknown>={}){
  addRecord(id,'vk_account',{vkUserId:id.endsWith('a')?700101:700102,name:id,proxyId:PROXY_ID,status:'active',error:'',
    counters:{day:moscowDayKey(new Date(NOW)),calls:id.endsWith('a')?0:5,searchCalls:0},...patch},await seal(token,OWNER));
}

function record(id:string):Stored{
  return JSON.parse((testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string}).data);
}

function leads():{id:string;data:LeadRow}[]{
  return (testDb().sqlite.prepare("SELECT id,data FROM records WHERE kind='lead' AND json_extract(data,'$.platform')='vk' ORDER BY created").all() as {id:string;data:string}[])
    .map(r=>({id:r.id,data:JSON.parse(r.data)}));
}
const keys=()=>leads().map(l=>String(l.data.msgKey)).sort();

async function scan(id:string){
  const res=await POST(postRequest({action:'scan_vk_source',id,force:true}));
  return {status:res.status,body:await res.json() as ScanReply};
}

function installFetch(){
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const u=String(url);
    const body=init?.body?JSON.parse(String(init.body)):{};
    if(u.endsWith('/vk-call')){
      if(proxyErrorTokens.has(body.token)){
        vkWorker.batches.push({token:body.token,proxy:body.proxy,methods:body.calls.map((c:{method:string})=>c.method),params:[]});
        return Response.json({ok:false,status:'proxy_error',error:'proxy refused'});
      }
      return vkCallResponse(body);
    }
    if(u.includes('api.telegram.org')){calls.tg.push(String(body.text||''));return Response.json({ok:true})}
    if(u.includes('/chat/completions')){
      aiCalls+=1;
      if(aiGate)await aiGate;
      const ids=[...String(body.messages?.[1]?.content||'').matchAll(/id=(\S+)/g)].map(m=>m[1]!);
      return Response.json({choices:[{message:{content:JSON.stringify(ids.map(id=>({id,reason:'ok',temperature:'hot'})))}}]});
    }
    throw new Error(`unexpected fetch ${u}`);
  }));
}

/** VK fails `method` with `code` for one token; other tokens answer normally. */
function failFor(token:string,code:number,method?:string){
  vkWorker.override=(m,_p,t)=>t===token&&(!method||m===method)?{ok:false,error:{code,msg:`error ${code}`}}:undefined;
}

describe('workspace API: scan_vk_source',()=>{
  beforeEach(async()=>{
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(NOW);
    resetWorkspace();
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubEnv('AI_API_KEY','');
    login(OWNER);
    testDb().sqlite.prepare("DELETE FROM records WHERE kind='lead'").run();
    testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.status','active') WHERE id=?").run(PROXY_ID);
    setSettings();
    addRecord(SEARCH_ID,'vk_source',{type:'search',title:'Поиск VK',cursor:{},lastScanAt:'',leadTombstones:[]});
    addRecord(GROUP_ID,'vk_source',{type:'group',title:'Нишевая группа',vkGroupId:22000,cursor:{},lastScanAt:'',leadTombstones:[]});
    await addAccount(ACC_A,TOKENS.a);
    vkWorker.reset();
    proxyErrorTokens.clear();
    aiGate=null;
    aiCalls=0;
    calls.tg.length=0;
    installFetch();
    logged.length=0;
    for(const level of ['log','warn','error'] as const){
      vi.spyOn(console,level).mockImplementation((...args:unknown[])=>{logged.push(args.map(String).join(' '))});
    }
  });
  afterEach(()=>{
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('REQ-3 search',()=>{
    it('creates VK leads from newsfeed.search with platform, key, link, author and source',async()=>{
      const r=await scan(SEARCH_ID);

      expect(r.status).toBe(200);
      expect(r.body.added).toBe(2);
      expect(keys()).toEqual(['vk:-11000_501','vk:700300_77']);
      const post=leads().find(l=>l.data.msgKey==='vk:-11000_501')!;
      expect(post.data).toMatchObject({
        platform:'vk',url:'https://vk.com/wall-11000_501',vkSourceId:SEARCH_ID,name:'Пётр Подписной',
        source:'Поиск VK',message:leadText(501),status:'new',
      });
      expect(post.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(['hot','warm']).toContain(post.data.temperature);
      expect(post.data.reason).toBeTruthy();
    });

    it('searches each strong keyword since the depth window and moves the cursor',async()=>{
      await scan(SEARCH_ID);

      const sent=vkWorker.batches[0]!;
      expect(sent.methods.every(m=>m==='newsfeed.search')).toBe(true);
      expect(sent.params.map(p=>p.q)).toEqual(['остатки','синхронизация','мойсклад','несколько кабинетов']);
      expect(sent.params[0]!.start_time).toBe(Math.floor(NOW/1000)-30*86400);
      expect(record(SEARCH_ID).cursor?.searchStartTime).toBe(Math.floor(NOW/1000));
      expect(record(SEARCH_ID)).toMatchObject({leadsTotal:2,error:''});
      expect(record(ACC_A).counters?.searchCalls).toBe(4);
    });

    it('without strong keywords marks the source scanned with an error and calls no VK',async()=>{
      setSettings({keywords:''});

      const r=await scan(SEARCH_ID);

      expect(r.status).toBe(400);
      expect(record(SEARCH_ID)).toMatchObject({lastScanAt:new Date(NOW).toISOString(),error:'Нет ключевых слов'});
      expect(vkWorker.batches).toHaveLength(0);
      expect(record(ACC_A).leaseId).toBeUndefined();
    });

    describe('paging (next_from)',()=>{
      const post=(id:number)=>({id,owner_id:700400,from_id:700400,date:1790000000+id,text:leadText(id)});
      const PAGES:Record<string,{items:Record<string,unknown>[];next_from?:string}>={
        '':{items:[post(1)],next_from:'p2'},
        p2:{items:[post(2)],next_from:'p3'},
        p3:{items:[post(3)],next_from:'p4'},
        p4:{items:[post(4)]},
      };
      const searched=()=>vkWorker.batches.flatMap(b=>b.params).filter(p=>p.q==='остатки');
      beforeEach(()=>{
        vkWorker.override=(m,p)=>m!=='newsfeed.search'?undefined
          :{ok:true,response:p.q==='остатки'?{...PAGES[String(p.start_from??'')]!,profiles:[],groups:[]}:{items:[],profiles:[],groups:[]}};
      });

      it('follows next_from up to 3 pages per keyword in one pinned interval and keeps the cursor',async()=>{
        const r=await scan(SEARCH_ID);

        expect(r.body.added).toBe(3);
        expect(searched().map(p=>p.start_from)).toEqual([undefined,'p2','p3']);
        expect(searched().every(p=>p.end_time===Math.floor(NOW/1000))).toBe(true);
        expect(record(SEARCH_ID).cursor).toEqual({searchPaging:{endTime:Math.floor(NOW/1000),next:{'остатки':'p4'}}});
      });

      it('the next run finishes only the unfinished keyword, then moves the cursor to the interval end',async()=>{
        await scan(SEARCH_ID);
        vkWorker.batches.length=0;
        vi.setSystemTime(NOW+60_000);

        const r=await scan(SEARCH_ID);

        expect(r.body.added).toBe(1);
        expect(vkWorker.batches.flatMap(b=>b.params).map(p=>[p.q,p.start_from,p.end_time])).toEqual([['остатки','p4',Math.floor(NOW/1000)]]);
        expect(record(SEARCH_ID).cursor).toEqual({searchStartTime:Math.floor(NOW/1000)});
        expect(leads()).toHaveLength(4);
      });
    });

    it('cuts a long post to 8000 characters (AM-3)',async()=>{
      feed().items[0]!.text=leadText(501)+' x'.repeat(6000);

      await scan(SEARCH_ID);

      expect(leads().find(l=>l.data.msgKey==='vk:-11000_501')!.data.message.length).toBe(8000);
    });

    it('a rerun creates no new leads',async()=>{
      await scan(SEARCH_ID);

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(0);
      expect(leads()).toHaveLength(2);
    });
  });

  describe('REQ-4 group',()=>{
    it('reads wall posts, their comments and board comments',async()=>{
      const r=await scan(GROUP_ID);

      expect(r.status).toBe(200);
      expect(keys()).toEqual(['vk:-22000_9001','vk:-22000_9001_c31','vk:board22000_4400_120']);
      expect(vkWorker.methods()).toEqual(['wall.get','board.getTopics','wall.getComments','board.getComments']);
      expect(leads().find(l=>l.data.msgKey==='vk:board22000_4400_120')!.data.url).toBe('https://vk.com/topic-22000_4400?post=120');
      expect(record(GROUP_ID).cursor).toEqual({wallMaxPostId:9001,boardSince:1790002000});
    });

    it('does not re-read posts below the wall cursor',async()=>{
      await scan(GROUP_ID);
      testDb().sqlite.prepare("DELETE FROM records WHERE kind='lead'").run();

      await scan(GROUP_ID);

      expect(keys()).not.toContain('vk:-22000_9001');
    });
  });

  describe('REQ-6 one lead per VK item',()=>{
    it('search and group finding one post create one lead',async()=>{
      feed().items.push({id:9001,owner_id:-22000,from_id:-22000,date:1790001000,text:leadText(9001)});

      await scan(SEARCH_ID);
      await scan(GROUP_ID);

      expect(leads().filter(l=>l.data.msgKey==='vk:-22000_9001')).toHaveLength(1);
    });

    it('two concurrent scans of one source call VK once and lock the second',async()=>{
      let open!:()=>void;
      vkWorker.gate=new Promise<void>(res=>{open=res});

      const first=scan(SEARCH_ID);
      const second=scan(SEARCH_ID);
      await new Promise(r=>setTimeout(r,20));
      open();
      const results=await Promise.all([first,second]);

      expect(vkWorker.batches).toHaveLength(1);
      expect(results.filter(r=>r.body.locked)).toHaveLength(1);
      expect(leads()).toHaveLength(2);
    });

    it('two sources scanned at once with one shared item insert it once (AM-1)',async()=>{
      await addAccount(ACC_B,TOKENS.b);
      feed().items.push({id:9001,owner_id:-22000,from_id:-22000,date:1790001000,text:leadText(9001)});
      // Both runs read `seen` before either inserts: the AI step is held open until both are waiting on it.
      setSettings({aiQualify:true});
      vi.stubEnv('AI_API_KEY','sk-test-not-real');
      let open!:()=>void;
      aiGate=new Promise<void>(res=>{open=res});

      const both=Promise.all([scan(SEARCH_ID),scan(GROUP_ID)]);
      await vi.waitFor(()=>expect(aiCalls).toBe(2));
      open();
      const [s,g]=await both;

      expect(leads().filter(l=>l.data.msgKey==='vk:-22000_9001')).toHaveLength(1);
      expect(s.body.added+g.body.added).toBe(leads().length);
      expect(new Set(vkWorker.batches.map(b=>b.token)).size).toBe(2);
    });
  });

  describe('AI work per run (cron budget)',()=>{
    beforeEach(()=>{
      setSettings({aiQualify:true});
      vi.stubEnv('AI_API_KEY','sk-test-not-real');
      feed().items=Array.from({length:70},(_,i)=>({id:2000+i,owner_id:700300,from_id:700300,date:1790000000+i,text:leadText(2000+i)}));
    });

    it('sends at most 60 items to AI per run, keeps the cursor and asks for more',async()=>{
      const r=await scan(SEARCH_ID);

      expect(r.status).toBe(200);
      expect(r.body.added).toBe(VK_AI_ITEMS_PER_RUN);
      expect(r.body.more).toBe(true);
      expect(record(SEARCH_ID).cursor?.searchStartTime).toBeUndefined();
    });

    it('the next run qualifies the rest and then moves the cursor',async()=>{
      await scan(SEARCH_ID);

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(70-VK_AI_ITEMS_PER_RUN);
      expect(r.body.more).toBe(false);
      expect(leads()).toHaveLength(70);
      expect(record(SEARCH_ID).cursor?.searchStartTime).toBe(Math.floor(NOW/1000));
    });
  });

  describe('REQ-14 deleted VK lead',()=>{
    it('is tombstoned on its source and not re-created by any source',async()=>{
      feed().items.push({id:9001,owner_id:-22000,from_id:-22000,date:1790001000,text:leadText(9001)});
      await scan(SEARCH_ID);
      const victim=leads().find(l=>l.data.msgKey==='vk:-22000_9001')!;

      const del=await POST(postRequest({action:'delete',kind:'lead',id:victim.id}));
      await scan(SEARCH_ID);
      await scan(GROUP_ID);

      expect(del.status).toBe(200);
      expect(record(SEARCH_ID).leadTombstones).toEqual(['vk:-22000_9001']);
      expect(keys()).not.toContain('vk:-22000_9001');
    });
  });

  describe('REQ-2 / REQ-9 / AM-8 VK errors',()=>{
    beforeEach(async()=>{await addAccount(ACC_B,TOKENS.b)});

    it('error 5 marks the account error and the run fails over to the next one',async()=>{
      failFor(TOKENS.a,5);

      const r=await scan(SEARCH_ID);

      expect(r.body).toMatchObject({added:2,failovers:1,accountsUsed:2});
      expect(record(ACC_A)).toMatchObject({status:'error'});
      expect(record(ACC_A).error).toContain('VK 5');
      expect(record(ACC_B).status).toBe('active');
      vkWorker.batches.length=0;
      await scan(GROUP_ID);
      expect(new Set(vkWorker.batches.map(b=>b.token))).toEqual(new Set([TOKENS.b]));
    });

    it('error 6 fails over and leaves the account active',async()=>{
      failFor(TOKENS.a,6);

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(2);
      expect(record(ACC_A).status).toBe('active');
    });

    it.each([
      [9,30],
      [14,60],
    ])('error %i puts the account on a %i min cooldown and fails over',async(code,minutes)=>{
      failFor(TOKENS.a,code);

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(2);
      expect(record(ACC_A)).toMatchObject({status:'cooldown',cooldownUntil:new Date(NOW+minutes*60_000).toISOString()});
      expect(record(SEARCH_ID).error).toBe('');
    });

    it('error 29 blocks newsfeed.search on that account until Moscow midnight only',async()=>{
      failFor(TOKENS.a,29,'newsfeed.search');

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(2);
      expect(record(ACC_A).status).toBe('active');
      expect(record(ACC_A).searchBlockedUntil?.['newsfeed.search']).toBe(moscowNextMidnightIso(NOW));
    });

    it('a proxy the worker rejects (-5) rests the account 15 min',async()=>{
      proxyErrorTokens.add(TOKENS.a);

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(2);
      expect(record(ACC_A)).toMatchObject({status:'cooldown',cooldownUntil:new Date(NOW+15*60_000).toISOString()});
    });

    it('error 15 on the wall marks the source, without failover or account penalty',async()=>{
      failFor(TOKENS.a,15,'wall.get');

      const r=await scan(GROUP_ID);

      expect(r.status).toBe(200);
      expect(r.body.failovers).toBe(0);
      expect(record(GROUP_ID).error).toBe('Нет доступа');
      expect(record(GROUP_ID).cursor).toEqual({});
      expect(record(ACC_A).status).toBe('active');
    });

    it('when every account is rate limited the cursor stays and the source is not marked error',async()=>{
      vkWorker.override=()=>({ok:false,error:{code:9,msg:'Flood control'}});

      const r=await scan(SEARCH_ID);

      expect(r.status).toBe(200);
      expect(r.body.partial).toBe(true);
      expect(r.body.added).toBe(0);
      expect(record(SEARCH_ID).cursor).toEqual({});
      expect(record(SEARCH_ID).error).toBe('');
      expect([record(ACC_A).status,record(ACC_B).status]).toEqual(['cooldown','cooldown']);
    });

    it('the next scan skips cooling accounts and reports a soft skip when none is free',async()=>{
      vkWorker.override=()=>({ok:false,error:{code:9,msg:'Flood control'}});
      await scan(SEARCH_ID);
      vkWorker.batches.length=0;

      const r=await scan(SEARCH_ID);

      expect(r.body).toMatchObject({skipped:true,noAccount:true});
      expect(vkWorker.batches).toHaveLength(0);
    });
  });

  describe('REQ-1b / AM-9 / REQ-10 pool',()=>{
    beforeEach(async()=>{await addAccount(ACC_B,TOKENS.b)});

    it('skips an account leased by another live scan',async()=>{
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.leaseId','other','$.leaseUntil',?) WHERE id=?").run(new Date(NOW+60_000).toISOString(),ACC_A);

      await scan(SEARCH_ID);

      expect(new Set(vkWorker.batches.map(b=>b.token))).toEqual(new Set([TOKENS.b]));
      expect(record(ACC_A).leaseId).toBe('other');
      expect(record(ACC_B).leaseId).toBeUndefined();
    });

    it('skips an account at its daily search cap',async()=>{
      setSettings({vkSearchDailyCap:10});
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.counters.searchCalls',10) WHERE id=?").run(ACC_A);

      await scan(SEARCH_ID);

      expect(new Set(vkWorker.batches.map(b=>b.token))).toEqual(new Set([TOKENS.b]));
    });

    it('REQ-2: with no active account left the scan stops and says so on the source',async()=>{
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.status','error') WHERE kind='vk_account'").run();

      const r=await scan(SEARCH_ID);

      expect(r.status).toBe(409);
      expect(r.body.noAccount).toBe(true);
      expect(record(SEARCH_ID).error).toContain('Нет активного VK-аккаунта');
      expect(vkWorker.batches).toHaveLength(0);
    });
  });

  describe('REQ-7 notify',()=>{
    it('marks VK leads in the Telegram notification with the deep link',async()=>{
      setSettings({notifyEnabled:true});

      await scan(SEARCH_ID);

      expect(calls.tg).toHaveLength(1);
      expect(calls.tg[0]).toContain('[VK]');
      expect(calls.tg[0]).toContain('https://vk.com/wall-11000_501');
      expect(leads().every(l=>l.data.notifiedAt)).toBe(true);
    });
  });

  describe('REQ-15 lead saves',()=>{
    it('a client save of a VK lead keeps platform, key, link and source',async()=>{
      await scan(SEARCH_ID);
      const lead=leads()[0]!;
      const client={...lead.data,status:'working',platform:'telegram',msgKey:'vk:forged',url:'https://evil.test',vkSourceId:''};

      const res=await POST(postRequest({action:'save',kind:'lead',id:lead.id,data:client}));

      expect(res.status).toBe(200);
      expect(record(lead.id)).toMatchObject({status:'working',platform:'vk',msgKey:lead.data.msgKey,url:lead.data.url,vkSourceId:SEARCH_ID});
    });

    it('a Telegram lead saves exactly as before, without VK fields',async()=>{
      const res=await POST(postRequest({action:'save',kind:'lead',data:{name:'Иван',message:'Ищу сервис для остатков'}}));
      const {id}=await res.json() as {id:string};

      expect(res.status).toBe(200);
      const saved=record(id);
      expect(saved).not.toHaveProperty('platform');
      expect(saved).not.toHaveProperty('msgKey');
      expect(saved.tgMsgId).toBe('');
    });

    it('a created lead never stores client-sent server-owned fields (javascript: link, VK identity)',async()=>{
      const res=await POST(postRequest({action:'save',kind:'lead',data:{name:'X',message:'Ищу сервис для остатков',platform:'vk',msgKey:'vk:-11000_501',url:'javascript:alert(1)',vkSourceId:SEARCH_ID,senderId:'666',coreScore:99}}));
      const {id}=await res.json() as {id:string};

      expect(res.status).toBe(200);
      const saved=record(id);
      for(const f of ['platform','msgKey','url','vkSourceId','coreScore'])expect(saved).not.toHaveProperty(f);
      expect(saved.senderId??'').toBe('');
    });

    it('an update of a Telegram lead cannot add url, platform or msgKey',async()=>{
      const tgId='c0000000-0000-4000-8000-000000000001';
      addRecord(tgId,'lead',{name:'T',message:'Ищу сервис для остатков',status:'new',tgMsgId:'55',groupId:'g1'});

      const res=await POST(postRequest({action:'save',kind:'lead',id:tgId,data:{name:'T',message:'Ищу сервис для остатков',status:'working',platform:'vk',msgKey:'vk:-11000_501',url:'https://vk.com/wall-1_1'}}));

      expect(res.status).toBe(200);
      const saved=record(tgId);
      expect(saved).toMatchObject({status:'working',tgMsgId:'55',groupId:'g1'});
      for(const f of ['platform','msgKey','url'])expect(saved).not.toHaveProperty(f);
    });

    it('a forged msgKey from a client save cannot suppress the real VK lead',async()=>{
      await POST(postRequest({action:'save',kind:'lead',data:{name:'X',message:'Ищу сервис для остатков',platform:'vk',msgKey:'vk:-11000_501'}}));

      const r=await scan(SEARCH_ID);

      expect(r.body.added).toBe(2);
      expect(keys()).toEqual(['vk:-11000_501','vk:700300_77']);
    });

    it('the notification omits a VK link that is not https://vk.com/',async()=>{
      setSettings({notifyEnabled:true});
      addRecord('c0000000-0000-4000-8000-000000000002','lead',{name:'Bad',message:'Ищу сервис для остатков',status:'new',temperature:'hot',source:'s',platform:'vk',msgKey:'vk:1_1',url:'javascript:alert(1)',notifyPending:true});

      await scan(SEARCH_ID);

      expect(calls.tg.join('\n')).not.toContain('javascript:');
      expect(calls.tg.join('\n')).toContain('https://vk.com/wall-11000_501');
    });
  });

  describe('REQ-8 rescan_groups',()=>{
    async function due(){
      const res=await POST(postRequest({action:'rescan_groups'}));
      return await res.json() as {vkSourceIds:string[];vkTotal:number};
    }

    it('lists VK sources never scanned or older than autoRescanMinutes, oldest first',async()=>{
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.lastScanAt',?) WHERE id=?").run(new Date(NOW-5*60_000).toISOString(),SEARCH_ID);

      expect(await due()).toMatchObject({vkSourceIds:[GROUP_ID],vkTotal:1});

      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.lastScanAt',?) WHERE id=?").run(new Date(NOW-31*60_000).toISOString(),SEARCH_ID);
      expect((await due()).vkSourceIds).toEqual([GROUP_ID,SEARCH_ID]);
    });

    it('skips the search source while settings have no strong keyword, lists it again once they do',async()=>{
      setSettings({keywords:''});

      expect((await due()).vkSourceIds).toEqual([GROUP_ID]);

      setSettings();
      expect((await due()).vkSourceIds).toEqual([SEARCH_ID,GROUP_ID]);
    });

    it('lists none while no VK account can scan',async()=>{
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.status','error') WHERE kind='vk_account'").run();

      expect(await due()).toMatchObject({vkSourceIds:[],vkTotal:0});
    });
  });

  it('never writes the token to records other than the sealed secret, or to logs',async()=>{
    await addAccount(ACC_B,TOKENS.b);
    failFor(TOKENS.a,5);

    await scan(SEARCH_ID);
    await scan(GROUP_ID);

    const data=JSON.stringify(testDb().sqlite.prepare('SELECT id,kind,data FROM records').all());
    expect(data).not.toContain(TOKENS.a);
    expect(data).not.toContain(TOKENS.b);
    expect(logged.join('\n')).not.toContain(TOKENS.a);
  });
});
