import {vi} from 'vitest';
import {createTestD1,type TestD1} from './d1-sqlite';

/**
 * Shared state for tests that drive app/api/workspace/route.ts. Test files wire it with:
 *   vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
 *   vi.mock('@/lib/auth',async(orig)=>({...await orig<object>(),getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user}));
 */
export const cfModule={env:{} as {DB?:unknown}};
export const authState={user:null as null|{userId:string;displayName:string;email:string;fullName:null}};

export const OWNER='owner-1';
export const ACCOUNT_ID='11111111-1111-4111-8111-111111111111';
export const PROXY_ID='22222222-2222-4222-8222-222222222222';
export const LEAD_ID='33333333-3333-4333-8333-333333333333';
export const MAILING_ID='44444444-4444-4444-8444-444444444444';
export const SETTINGS_ID='55555555-5555-4555-8555-555555555555';
export const BOT_TOKEN='123456:bot-token-secret';
/** What the stubbed Telegram worker "leaks" in its errors. */
export const WORKER_ERROR='ECONNREFUSED internal worker 10.0.0.5:8790 stack at /srv/app';

let d1:TestD1|null=null;
export const workerCalls:string[]=[];

export function testDb():TestD1{
 if(!d1){d1=createTestD1();cfModule.env.DB=d1.db}
 return d1;
}

export function login(userId:string){authState.user={userId,displayName:userId,email:`${userId}@example.com`,fullName:null}}

export function addRecord(id:string,kind:string,data:Record<string,unknown>,secret:string|null=null){
 testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
  .run(id,OWNER,kind,JSON.stringify(data),secret,new Date().toISOString());
}

/** Fresh records + a worker whose every call fails with an internal-looking error. */
export function resetWorkspace(){
 const {sqlite}=testDb();
 sqlite.exec('DELETE FROM records;');
 try{sqlite.exec('DELETE FROM workspace_members;')}catch{/* staff tables not created yet */}
 workerCalls.length=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  workerCalls.push(String(url));
  throw new Error(WORKER_ERROR);
 }));
 addRecord(ACCOUNT_ID,'account',{name:'Farm 1',phone:'+79990001122',status:'active',proxyId:''},'sealed-session');
 addRecord(PROXY_ID,'proxy',{name:'P1',host:'proxy.example.com',port:1080,protocol:'socks5',username:'u'},null);
 addRecord(LEAD_ID,'lead',{name:'Lead',message:'Ищу сервис для остатков',status:'new'});
 addRecord(MAILING_ID,'mailing_task',{name:'M',status:'paused',accountIds:[ACCOUNT_ID]});
 addRecord(SETTINGS_ID,'settings',{name:'Проект',notifyBotToken:BOT_TOKEN,notifyChatId:'42'},null);
}

export function postRequest(body:Record<string,unknown>){
 return new Request('http://crm.test/api/workspace',{
  method:'POST',
  headers:{'Content-Type':'application/json',origin:'http://crm.test'},
  body:JSON.stringify(body),
 });
}
