import {readFileSync} from 'node:fs';
import path from 'node:path';

/**
 * Fake worker route /vk-call for route tests: answers from tests/fixtures/vk (lead-like texts
 * patched in), records every batch and lets a test fail chosen calls per token.
 */
export type VkOutcome={ok:true;response:unknown}|{ok:false;error:{code:number;msg:string}};
export type VkBatchLog={token:string;proxy:unknown;methods:string[];params:Record<string,unknown>[]};
type Override=(method:string,params:Record<string,unknown>,token:string)=>VkOutcome|undefined;

const fixture=(name:string)=>JSON.parse(readFileSync(path.resolve(__dirname,'../fixtures/vk',name),'utf8'));

/** Texts the lead core accepts with the test settings (see tests/lead-scan-route.test.ts SETTINGS). */
export const leadText=(n:number)=>`Ищу сервис для синхронизации остатков WB и МойСклад, магазин номер ${n}`;

export const TOKENS={
 a:`vk1.a.${'A'.repeat(48)}`,
 b:`vk1.a.${'B'.repeat(48)}`,
 c:`vk1.a.${'C'.repeat(48)}`,
 bad:`vk1.a.${'X'.repeat(48)}`,
};
const USERS:Record<string,number>={[TOKENS.a]:700101,[TOKENS.b]:700102,[TOKENS.c]:700103};

function defaults():Record<string,unknown>{
 const search=fixture('newsfeed.search.json').response;
 search.items[0].text=leadText(501);
 search.items[2].text=leadText(77);
 const wall=fixture('wall.get.json').response;
 wall.items[0].text=leadText(9001);
 const comments=fixture('wall.getComments.json').response;
 comments.items[0].text=leadText(31);
 const board=fixture('board.getComments.json').response;
 board.items[0].text=leadText(120);
 return {
  'newsfeed.search':search,
  'wall.get':wall,
  'wall.getComments':comments,
  'board.getTopics':fixture('board.getTopics.json').response,
  'board.getComments':board,
  'groups.getById':fixture('groups.getById.json').response,
  'utils.resolveScreenName':fixture('utils.resolveScreenName.json').group.response,
 };
}

export const vkWorker={
 batches:[] as VkBatchLog[],
 responses:defaults(),
 override:null as Override|null,
 gate:null as Promise<void>|null,
 reset(){
  this.batches.length=0;
  this.responses=defaults();
  this.override=null;
  this.gate=null;
 },
 methods():string[]{return this.batches.flatMap(b=>b.methods)},
};

function answer(method:string,params:Record<string,unknown>,token:string):VkOutcome{
 const forced=vkWorker.override?.(method,params,token);
 if(forced)return forced;
 if(token===TOKENS.bad)return {ok:false,error:{code:5,msg:'User authorization failed'}};
 if(method==='users.get'){
  const id=USERS[token];
  return id?{ok:true,response:[{id,first_name:'Тест',last_name:String(id)}]}:{ok:false,error:{code:5,msg:'User authorization failed'}};
 }
 const response=vkWorker.responses[method];
 return response===undefined?{ok:false,error:{code:100,msg:'unknown method'}}:{ok:true,response:structuredClone(response)};
}

export async function vkCallResponse(body:{token:string;proxy:unknown;calls:{method:string;params:Record<string,unknown>}[]}){
 vkWorker.batches.push({token:body.token,proxy:body.proxy,methods:body.calls.map(c=>c.method),params:body.calls.map(c=>c.params)});
 if(vkWorker.gate)await vkWorker.gate;
 return Response.json({ok:true,results:body.calls.map(c=>answer(c.method,c.params,body.token))});
}
