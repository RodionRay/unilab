import {vi} from 'vitest';
import type {WorkerCall} from './chats-fixture';

/** One Telegram Bot API call seen by the stub: method name from the URL and the JSON body. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API payloads are read field-by-field in assertions
export type BotCall={method:string;body:Record<string,any>;url:string};
export type BotHandler=(call:BotCall)=>unknown|Promise<unknown>;

const BOT_PREFIX='https://api.telegram.org/bot';

/**
 * Stubs global fetch for tests that drive both the Telegram worker and the owner's notification bot.
 * Worker paths go to `worker`; Bot API calls go to `bot` (default: sendMessage → ok with a growing message_id,
 * getUpdates → the next queued batch, anything else → ok). A handler may return a Response to pass it as is.
 */
export function stubWorkerAndBot(worker:(call:WorkerCall)=>unknown|Promise<unknown>,bot?:BotHandler){
 const calls:WorkerCall[]=[];
 const botCalls:BotCall[]=[];
 const updates:unknown[][]=[];
 let nextMessageId=5000;
 const defaultBot:BotHandler=(call)=>{
  if(call.method==='sendMessage')return {ok:true,result:{message_id:++nextMessageId,chat:{id:Number(call.body.chat_id)}}};
  if(call.method==='getUpdates')return {ok:true,result:updates.shift()||[]};
  return {ok:true,result:true};
 };
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  const u=String(url);
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(u.startsWith(BOT_PREFIX)){
   const call={method:u.split('/').pop()||'',body,url:u};
   botCalls.push(call);
   const out=await (bot?bot(call):undefined)??await defaultBot(call);
   return out instanceof Response?out:Response.json(out);
  }
  const call={path:new URL(u).pathname,body};
  calls.push(call);
  const out=await worker(call);
  return out instanceof Response?out:Response.json(out);
 }));
 const sent=()=>botCalls.filter(c=>c.method==='sendMessage');
 return {calls,botCalls,sent,queueUpdates:(batch:unknown[])=>{updates.push(batch)}};
}

/** Inline keyboard buttons of a sendMessage call, flattened. */
export function buttonsOf(call:BotCall|undefined):Record<string,string>[]{
 const rows=call?.body?.reply_markup?.inline_keyboard;
 return Array.isArray(rows)?rows.flat():[];
}
