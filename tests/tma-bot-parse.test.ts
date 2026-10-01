import {describe,expect,it} from 'vitest';
import {buildPrivateConversationNotice,buildPrivateLeadNotice,isDmUndeliverable,parseBotUpdate} from '@/lib/telegram-bot';

const GROUP='-1001';
const PRIVATE_OWNER='42';
const person={id:900,is_bot:false,first_name:'Анна',username:'anna_tg'};
const privateMsg=(updateId:number,text:string,chatId=900,extra:Record<string,unknown>={})=>({
 update_id:updateId,
 message:{message_id:10+updateId,chat:{id:chatId,type:'private'},from:{...person,id:chatId},date:1,text,...extra},
});
const groupMsg=(updateId:number,extra:Record<string,unknown>)=>({
 update_id:updateId,
 message:{message_id:600+updateId,chat:{id:Number(GROUP),type:'supergroup'},from:{id:7,is_bot:false},date:1,...extra},
});

describe('parseBotUpdate · личный чат (REQ-L2/L5)',()=>{
 it('/start link_<code> в личке → link: tg = from.id, code без префикса',()=>{
  expect(parseBotUpdate(privateMsg(1,'/start link_AbC-_123'),GROUP)).toEqual({
   kind:'link',updateId:1,chatId:'900',messageId:11,tg:{id:900,username:'anna_tg'},code:'AbC-_123',
  });
 });

 it('/start link_ в личке, которая же настроена как чат уведомлений, — тоже link',()=>{
  expect(parseBotUpdate(privateMsg(2,'/start link_xyz',42),PRIVATE_OWNER)).toMatchObject({kind:'link',chatId:'42',code:'xyz'});
 });

 it('link работает и без настроенного чата уведомлений',()=>{
  expect(parseBotUpdate(privateMsg(3,'/start link_xyz'),'')).toMatchObject({kind:'link'});
 });

 it('/start link_ в группе — не привязка',()=>{
  expect(parseBotUpdate(groupMsg(4,{text:'/start link_xyz'}),GROUP)).toMatchObject({kind:'start'});
  expect(parseBotUpdate(groupMsg(5,{text:'/start link_xyz'}),'-1009')).toMatchObject({kind:'ignore',reason:'foreign_chat'});
 });

 it('бот в личке игнорируется',()=>{
  const u={update_id:6,message:{message_id:1,chat:{id:900,type:'private'},from:{id:900,is_bot:true},text:'/start link_x'}};
  expect(parseBotUpdate(u,GROUP)).toMatchObject({kind:'ignore'});
 });

 it('прочая личка вне чата уведомлений → private_message (start / не start)',()=>{
  expect(parseBotUpdate(privateMsg(7,'/start'),GROUP)).toEqual({kind:'private_message',updateId:7,chatId:'900',messageId:17,tgUserId:900,start:true});
  expect(parseBotUpdate(privateMsg(8,'привет',900,{reply_to_message:{message_id:5}}),GROUP)).toMatchObject({kind:'private_message',start:false});
  expect(parseBotUpdate(privateMsg(9,'',900,{photo:[{}]}),'')).toMatchObject({kind:'private_message',start:false});
 });

 it('callback из лички вне чата уведомлений → private_callback',()=>{
  const u={update_id:10,callback_query:{id:'cb',from:{id:900,is_bot:false},data:'r:x',message:{message_id:1,chat:{id:900,type:'private'}}}};
  expect(parseBotUpdate(u,GROUP)).toEqual({kind:'private_callback',updateId:10,callbackId:'cb',tgUserId:900});
 });
});

describe('parseBotUpdate · чат уведомлений без изменений',()=>{
 it('настроенный личный чат: /start, reply, hint, callback как раньше',()=>{
  expect(parseBotUpdate(privateMsg(20,'/start',42),PRIVATE_OWNER)).toEqual({kind:'start',updateId:20,chatId:'42',messageId:30});
  expect(parseBotUpdate(privateMsg(21,'Ловите',42,{reply_to_message:{message_id:5}}),PRIVATE_OWNER))
   .toEqual({kind:'reply',updateId:21,chatId:'42',messageId:31,replyTo:5,text:'Ловите',inGroup:false,legacyNotice:false});
  expect(parseBotUpdate(privateMsg(22,'текст',42),PRIVATE_OWNER)).toEqual({kind:'hint',updateId:22,chatId:'42',messageId:32,reason:'no_reply_to'});
  const cb={update_id:23,callback_query:{id:'c',from:{id:42,is_bot:false},data:'r:lead',message:{message_id:1,chat:{id:42,type:'private'}}}};
  expect(parseBotUpdate(cb,PRIVATE_OWNER)).toEqual({kind:'reply_button',updateId:23,chatId:'42',callbackId:'c',leadId:'lead'});
 });

 it('группа: болтовня игнорируется, reply боту — reply, чужая группа — foreign_chat',()=>{
  expect(parseBotUpdate(groupMsg(30,{text:'привет'}),GROUP)).toEqual({kind:'ignore',updateId:30,reason:'group_chatter'});
  expect(parseBotUpdate(groupMsg(31,{text:'ок',reply_to_message:{message_id:5,from:{id:1,is_bot:true}}}),GROUP))
   .toEqual({kind:'reply',updateId:31,chatId:GROUP,messageId:631,replyTo:5,text:'ок',inGroup:true,legacyNotice:false});
  expect(parseBotUpdate(groupMsg(32,{text:'ок'}),'')).toEqual({kind:'ignore',updateId:32,reason:'foreign_chat'});
  const cb={update_id:33,callback_query:{id:'c',from:{id:7,is_bot:false},data:'r:x',message:{message_id:1,chat:{id:-5,type:'group'}}}};
  expect(parseBotUpdate(cb,GROUP)).toEqual({kind:'ignore',updateId:33,reason:'foreign_chat'});
 });
});

describe('личные уведомления (REQ-N1)',()=>{
 it('о переписке: факты без инструкции Reply',()=>{
  const n=buildPrivateConversationNotice({event:'client_reply',leadId:'L1',clientName:'Клиент <b>',username:'client_nick',userId:'777',source:'Группа «WB»',accountName:'Ферма',text:'Сколько стоит?'});
  expect(n.html).toContain('Клиент ответил');
  expect(n.html).toContain('Клиент &lt;b&gt;');
  expect(n.html).toContain('Сколько стоит?');
  expect(n.html).not.toContain('Reply');
  expect(n.plain).toContain('Сколько стоит?');
 });

 it('о горячем лиде: имя, источник, сообщение',()=>{
  const n=buildPrivateLeadNotice({name:'Иван',source:'Sellers',message:'Ищу сервис'});
  expect(n.html).toContain('Горячий лид');
  expect(n.html).toContain('Иван');
  expect(n.html).toContain('Ищу сервис');
 });

 it('недоставляемые ЛС: blocked / chat not found / deactivated / 403',()=>{
  expect(isDmUndeliverable('Forbidden: bot was blocked by the user')).toBe(true);
  expect(isDmUndeliverable('Bad Request: chat not found')).toBe(true);
  expect(isDmUndeliverable('Forbidden: user is deactivated')).toBe(true);
  expect(isDmUndeliverable('Too Many Requests: retry after 5')).toBe(false);
  expect(isDmUndeliverable('The operation was aborted due to timeout')).toBe(false);
 });
});
