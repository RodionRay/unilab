import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,PROXY_ID,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {TOKENS,vkCallResponse,vkWorker} from './helpers/vk-worker';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';
import {ACTION_RULES,authorizeWorkspaceAction} from '@/lib/security/workspace-authz';

const PROXY_2='66666666-6666-4666-8666-666666666666';
const PASSWORD='MarketplacePass:with:colons';

type Row={id:string;data:Record<string,unknown>;secret:string|null};

function rows(kind:string):Row[]{
  return (testDb().sqlite.prepare('SELECT id,data,secret FROM records WHERE kind=? ORDER BY created').all(kind) as {id:string;data:string;secret:string|null}[])
    .map(r=>({id:r.id,data:JSON.parse(r.data),secret:r.secret}));
}

function setSettings(patch:Record<string,unknown>){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'Проект',...patch}),SETTINGS_ID);
}

async function call(body:Record<string,unknown>){
  const res=await POST(postRequest(body));
  return {status:res.status,body:await res.json() as Reply};
}

type Reply={ok?:boolean;id?:string;created?:boolean;source?:Record<string,unknown>;error?:string;duplicate?:boolean;removed?:number;results:{line:number;status:string;reason?:string}[]};

const importText=(lines:string[],extra:Record<string,unknown>={})=>call({action:'vk_accounts_import',text:lines.join('\n'),...extra});

function installFetch(){
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const u=String(url);
    if(u.endsWith('/vk-call'))return vkCallResponse(JSON.parse(String(init?.body)));
    if(u.endsWith('/health'))return Response.json({ok:true});
    throw new Error(`unexpected fetch ${u}`);
  }));
}

describe('workspace API: VK accounts and sources',()=>{
  const logged:string[]=[];
  beforeEach(()=>{
    resetWorkspace();
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    login(OWNER);
    const {sqlite}=testDb();
    sqlite.prepare('UPDATE records SET data=json_set(data,\'$.status\',\'active\') WHERE id=?').run(PROXY_ID);
    addRecord(PROXY_2,'proxy',{name:'P2',host:'proxy2.example.com',port:1080,protocol:'socks5',username:'u2',status:'active'});
    vkWorker.reset();
    installFetch();
    logged.length=0;
    for(const level of ['log','warn','error'] as const){
      vi.spyOn(console,level).mockImplementation((...args:unknown[])=>{logged.push(args.map(String).join(' '))});
    }
  });
  afterEach(()=>{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('REQ-1 bulk import',()=>{
    it('validates each token through its proxy, seals it and drops the password',async()=>{
      const r=await importText([TOKENS.a,`login@mail.ru:${PASSWORD}:${TOKENS.b}`]);

      expect(r.status).toBe(200);
      expect(r.body.results.map(x=>x.status)).toEqual(['added','added']);
      const accounts=rows('vk_account');
      expect(accounts.map(a=>a.data.vkUserId)).toEqual([700101,700102]);
      expect(accounts.every(a=>a.data.status==='active'&&a.secret)).toBe(true);
      expect(vkWorker.batches.map(b=>b.methods)).toEqual([['users.get'],['users.get']]);
      expect(vkWorker.batches.every(b=>(b.proxy as {host:string}).host.endsWith('example.com'))).toBe(true);
      const dump=JSON.stringify(testDb().sqlite.prepare('SELECT * FROM records').all());
      expect(dump).not.toContain(TOKENS.a);
      expect(dump).not.toContain(TOKENS.b);
      expect(dump).not.toContain('MarketplacePass');
    });

    it('reports duplicates: a repeat inside the paste and an account already stored',async()=>{
      await importText([TOKENS.a]);

      const r=await importText([TOKENS.a,TOKENS.b,TOKENS.b]);

      expect(r.body.results.map(x=>x.status)).toEqual(['duplicate','added','duplicate']);
      expect(rows('vk_account')).toHaveLength(2);
    });

    it('reports an invalid token with the VK reason and an unparsable line, saving neither',async()=>{
      const r=await importText([TOKENS.bad,'login:password']);

      expect(r.body.results[0]).toMatchObject({line:1,status:'invalid'});
      expect(r.body.results[0]!.reason).toContain('VK 5');
      expect(r.body.results[1]).toMatchObject({line:2,status:'invalid'});
      expect(rows('vk_account')).toHaveLength(0);
    });

    it('REQ-1a: spreads accounts over active proxies under the cap and saves the rest no_proxy without calling VK',async()=>{
      setSettings({vkAccountsPerProxy:1});

      const r=await importText([TOKENS.a,TOKENS.b,TOKENS.c]);

      expect(r.body.results.map(x=>x.status)).toEqual(['added','added','no_proxy']);
      const accounts=rows('vk_account');
      expect(new Set(accounts.slice(0,2).map(a=>a.data.proxyId))).toEqual(new Set([PROXY_ID,PROXY_2]));
      expect(accounts[2]!.data).toMatchObject({status:'no_proxy',proxyId:''});
      expect(vkWorker.batches).toHaveLength(2);
    });

    it('AM-11: Telegram accounts on a proxy count toward its cap',async()=>{
      setSettings({vkAccountsPerProxy:1});
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.proxyId',?) WHERE kind='account'").run(PROXY_ID);

      await importText([TOKENS.a]);

      expect(rows('vk_account')[0]!.data.proxyId).toBe(PROXY_2);
    });

    it('AM-10: refuses more than 20 lines per request',async()=>{
      const lines=Array.from({length:21},(_,i)=>`vk1.a.${String(i).padStart(2,'0')}${'Z'.repeat(40)}`);

      const r=await importText(lines);

      expect(r.status).toBe(413);
      expect(vkWorker.batches).toHaveLength(0);
    });

    it('REQ-12: the first active account creates exactly one search source',async()=>{
      await importText([TOKENS.a]);
      await importText([TOKENS.b]);

      const sources=rows('vk_source');
      expect(sources).toHaveLength(1);
      expect(sources[0]!.data.type).toBe('search');
    });
  });

  describe('account management',()=>{
    it('binding a proxy validates a no_proxy account and activates it',async()=>{
      setSettings({vkAccountsPerProxy:1});
      await importText([TOKENS.a,TOKENS.b,TOKENS.c]);
      const parked=rows('vk_account')[2]!;
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.proxyId','') WHERE kind='vk_account' AND id!=?").run(parked.id);

      const r=await call({action:'vk_account_set_proxy',id:parked.id,proxyId:PROXY_ID});

      expect(r.status).toBe(200);
      expect(rows('vk_account')[2]!.data).toMatchObject({status:'active',proxyId:PROXY_ID,vkUserId:700103});
    });

    it('refuses a proxy that is already full',async()=>{
      setSettings({vkAccountsPerProxy:1});
      await importText([TOKENS.a,TOKENS.b]);
      const second=rows('vk_account').find(a=>a.data.proxyId===PROXY_2)!;

      const r=await call({action:'vk_account_set_proxy',id:second.id,proxyId:PROXY_ID});

      expect(r.status).toBe(409);
    });

    it('deletes accounts in bulk',async()=>{
      await importText([TOKENS.a,TOKENS.b]);
      const ids=rows('vk_account').map(a=>a.id);

      const r=await call({action:'vk_account_delete',ids});

      expect(r.body).toMatchObject({ok:true,removed:2});
      expect(rows('vk_account')).toHaveLength(0);
    });

    it('AM-4: a proxy bound to a VK account cannot be deleted',async()=>{
      await importText([TOKENS.a]);
      const bound=String(rows('vk_account')[0]!.data.proxyId);

      const r=await call({action:'delete',kind:'proxy',id:bound});

      expect(r.status).toBe(409);
    });

    it('AM-4: the generic save never writes VK kinds',async()=>{
      const r=await call({action:'save',kind:'vk_account',data:{vkUserId:1,name:'x',status:'active'}});

      expect(r.status).toBe(400);
      expect(rows('vk_account')).toHaveLength(0);
    });
  });

  describe('token secrecy',()=>{
    it('the list payload carries hasSecret, never the token; logs never see it',async()=>{
      await importText([TOKENS.a,TOKENS.bad]);

      const res=await GET();
      const text=await res.text();
      const payload=JSON.parse(text) as {records:{kind:string;hasSecret:boolean;secret?:unknown}[]};

      const vk=payload.records.filter(r=>r.kind==='vk_account');
      expect(vk).toHaveLength(1);
      expect(vk[0]!.hasSecret).toBe(true);
      expect(vk[0]).not.toHaveProperty('secret');
      expect(payload.records.some(r=>r.kind==='vk_source')).toBe(true);
      expect(text).not.toContain(TOKENS.a);
      expect(logged.join('\n')).not.toContain(TOKENS.a);
      expect(logged.join('\n')).not.toContain(TOKENS.bad);
    });
  });

  describe('REQ-4 group sources',()=>{
    beforeEach(async()=>{await importText([TOKENS.a])});

    it('resolves a screen name link and stores the group by numeric id',async()=>{
      const r=await call({action:'vk_source_add',url:'https://vk.com/niche_test'});

      expect(r.status).toBe(200);
      const group=rows('vk_source').find(s=>s.data.type==='group')!;
      expect(group.data).toMatchObject({vkGroupId:22000,title:'Нишевая группа',url:'https://vk.com/club22000'});
      expect(vkWorker.batches.at(-1)!.methods).toEqual(['utils.resolveScreenName','groups.getById']);
    });

    it('rejects the same community added again by another link form',async()=>{
      await call({action:'vk_source_add',url:'vk.com/niche_test'});

      const r=await call({action:'vk_source_add',url:'https://m.vk.com/club22000'});

      expect(r.status).toBe(409);
      expect(r.body.duplicate).toBe(true);
      expect(rows('vk_source').filter(s=>s.data.type==='group')).toHaveLength(1);
    });

    it('rejects a link that is not a community without calling VK',async()=>{
      const before=vkWorker.batches.length;

      const r=await call({action:'vk_source_add',url:'https://vk.com/id1'});

      expect(r.status).toBe(400);
      expect(vkWorker.batches).toHaveLength(before);
    });

    it('rejects a screen name that resolves to a user',async()=>{
      vkWorker.responses['utils.resolveScreenName']={type:'user',object_id:700100};

      const r=await call({action:'vk_source_add',url:'vk.com/some_person'});

      expect(r.status).toBe(422);
    });

    it('vk_source_ensure_search creates the search source once and returns it on every call',async()=>{
      // The import above already made it; the user then deleted it.
      testDb().sqlite.prepare("DELETE FROM records WHERE kind='vk_source'").run();

      const first=await call({action:'vk_source_ensure_search'});
      const second=await call({action:'vk_source_ensure_search'});

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ok:true,created:true,source:{type:'search',cursor:{},lastScanAt:''}});
      expect(second.body).toMatchObject({ok:true,created:false,id:first.body.id});
      expect(rows('vk_source').filter(r=>r.data.type==='search').map(r=>r.id)).toEqual([first.body.id]);
    });

    it('vk_source_ensure_search has the vk_source_add access rule (owner, admin, staff with groups)',()=>{
      const staff=(groups:boolean)=>({userId:'u',ownerId:OWNER,isOwner:false,role:'manager' as const,access:{groups} as never});

      expect(ACTION_RULES.vk_source_ensure_search).toEqual(ACTION_RULES.vk_source_add);
      expect(authorizeWorkspaceAction(staff(true),'vk_source_ensure_search',undefined)).toEqual({ok:true});
      expect(authorizeWorkspaceAction(staff(false),'vk_source_ensure_search',undefined).ok).toBe(false);
    });

    it('deleting a source keeps its tombstones on the owner-level holder',async()=>{
      await call({action:'vk_source_add',url:'vk.com/niche_test'});
      const group=rows('vk_source').find(s=>s.data.type==='group')!;
      testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.leadTombstones',json(?)) WHERE id=?").run(JSON.stringify(['vk:-22000_1']),group.id);

      const r=await call({action:'vk_source_delete',id:group.id});

      expect(r.status).toBe(200);
      expect(rows('vk_source')).toHaveLength(1);
      expect(rows('vk_tombstones').map(r=>r.data.leadTombstones)).toEqual([['vk:-22000_1']]);
    });
  });
});
