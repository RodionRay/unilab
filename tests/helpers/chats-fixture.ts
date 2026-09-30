import {vi} from 'vitest';
import {seal} from '@/lib/server-store';
import {ACCOUNT_ID,OWNER,SETTINGS_ID,addRecord,testDb} from './workspace-harness';

/** Conversation fixtures shared by tests/chats-*.test.ts (send_lead_message, poll_dm_replies, mark_lead_viewed). */
export const ACC_A='a0000000-0000-4000-8000-00000000000a';
export const ACC_B='b0000000-0000-4000-8000-00000000000b';
export const GROUP_ID='c0000000-0000-4000-8000-00000000000c';
export const CHAT_LEAD='d0000000-0000-4000-8000-00000000000d';

export type WorkerCall={path:string;body:Record<string,unknown>};
export type WorkerHandler=(call:WorkerCall)=>unknown|Promise<unknown>;

/** Worker payload apiId per fixture account, so a stub can answer per account. */
export const API_ID:Record<string,number>={[ACC_A]:1,[ACC_B]:2};

export async function addSealedAccount(id:string,data:Record<string,unknown>){
 const secret=await seal(JSON.stringify({kind:'tdata',zipBase64:'eA==',apiId:API_ID[id]??9,apiHash:'h'}),OWNER);
 testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(id);
 addRecord(id,'account',{name:id.slice(0,4),phone:'+7999',status:'active',proxyId:'',...data},secret);
}

/** The harness account has an unreadable session; conversations here use sealed ACC_A/ACC_B only. */
export function dropHarnessAccount(){
 testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
}

export function addChatLead(data:Record<string,unknown>={}){
 addRecord(GROUP_ID,'group',{name:'Продавцы WB',url:'https://t.me/sellers_wb',accountId:ACC_A},null);
 addRecord(CHAT_LEAD,'lead',{
  name:'Клиент',message:'Ищу поставщика',status:'working',groupId:GROUP_ID,tgMsgId:'321',
  senderId:'777',senderUsername:'client_nick',senderAccessHash:'hash-a',accountId:ACC_A,
  viewed:false,needsManager:true,conversationOpen:true,
  replies:[{text:'Здравствуйте',mode:'dm',at:'2026-09-29T10:00:00.000Z',ok:true,error:'',messageId:'10',link:'',chatId:'777',from:'us'}],
  ...data,
 });
}

export function readRecord(id:string):Record<string,any>{
 const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string}|undefined;
 if(!row)throw new Error(`record ${id} not found`);
 return JSON.parse(row.data);
}

export function writeRecord(id:string,data:Record<string,unknown>){
 testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),id);
}

export function enableNotifications(){
 writeRecord(SETTINGS_ID,{...readRecord(SETTINGS_ID),notifyEnabled:true});
}

/**
 * Stubs global fetch: worker paths go to `handler`, Telegram Bot API calls are counted as notifications.
 * Returns the recorded worker calls and notification texts.
 */
export function stubWorker(handler:WorkerHandler){
 const calls:WorkerCall[]=[];
 const notifications:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  const u=String(url);
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(u.startsWith('https://api.telegram.org/')){
   notifications.push(String(body.text||''));
   return Response.json({ok:true});
  }
  const path=new URL(u).pathname;
  const call={path,body};
  calls.push(call);
  return Response.json(await handler(call));
 }));
 return {calls,notifications};
}
