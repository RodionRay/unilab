import {describe,expect,it} from 'vitest';
import {createTestD1} from './helpers/d1-sqlite';
import {
 ACCOUNT_EVENTS_LIST_MAX,accountEventCounts,accountEventFor,accountEventFromWorkerResult,listAccountEvents,
 recordAccountEvent,recordAccountEventSafe,
} from '@/lib/account-events';

const AT=new Date('2026-10-01T12:00:00.000Z');
const ago=(h:number)=>new Date(AT.getTime()-h*3600_000);

describe('accountEventFromWorkerResult',()=>{
 it('classifies worker answers',()=>{
  expect(accountEventFromWorkerResult({ok:false,status:'flood',waitSec:120,error:'FloodWait 120с'},'dm')).toMatchObject({type:'flood_wait',waitSec:120,context:'dm'});
  expect(accountEventFromWorkerResult({ok:false,status:'floodwait',floodWait:300},'invite')).toMatchObject({type:'flood_wait',waitSec:300});
  expect(accountEventFromWorkerResult({ok:false,join:'flood',error:'FloodWait 900'},'join')).toMatchObject({type:'flood_wait',waitSec:900});
  expect(accountEventFromWorkerResult({ok:false,status:'spamblock',error:'PEER_FLOOD: Too many requests'},'mailing')).toMatchObject({type:'spamblock'});
  expect(accountEventFromWorkerResult({ok:false,status:'spamblock',error:'Аккаунт ограничен Telegram: нельзя писать в чаты/каналы'},'dm')).toMatchObject({type:'write_ban'});
  expect(accountEventFromWorkerResult({ok:false,status:'spamblock',error:'limited'},'check')).toMatchObject({type:'spambot'});
  expect(accountEventFromWorkerResult({ok:false,join:'peer_flood'},'join')).toMatchObject({type:'spamblock'});
  expect(accountEventFromWorkerResult({ok:false,status:'frozen'},'scan')).toMatchObject({type:'frozen'});
  expect(accountEventFromWorkerResult({ok:false,errorCode:'USER_IS_BLOCKED',error:'x'},'dm')).toMatchObject({type:'peer_blocked'});
  expect(accountEventFromWorkerResult({ok:false,errorCode:'PRIVACY_PREMIUM_REQUIRED'},'mailing')).toMatchObject({type:'privacy'});
 });
 it('ignores successes and unrelated errors',()=>{
  expect(accountEventFromWorkerResult({ok:true,status:'flood'},'dm')).toBeNull();
  expect(accountEventFromWorkerResult({ok:false,error:'invalid peer'},'dm')).toBeNull();
  expect(accountEventFromWorkerResult({ok:false,errorCode:'INPUT_USER_DEACTIVATED'},'dm')).toBeNull();
  expect(accountEventFromWorkerResult(null,'dm')).toBeNull();
  expect(accountEventFor('',{ok:false,status:'frozen'},'scan')).toBeNull();
 });
});

describe('journal storage',()=>{
 it('writes idempotently within a minute and keeps distinct subjects',async()=>{
  const {db}=createTestD1();
  const e={accountId:'a1',type:'flood_wait' as const,context:'join' as const,waitSec:60,reason:'FloodWait 60',at:AT};
  expect(await recordAccountEvent(db,'o1',e)).toBe(true);
  expect(await recordAccountEvent(db,'o1',{...e,at:new Date(AT.getTime()+20_000)})).toBe(false);
  expect(await recordAccountEvent(db,'o1',{...e,at:new Date(AT.getTime()+61_000)})).toBe(true);
  const p={accountId:'a1',type:'privacy' as const,context:'mailing' as const,at:AT};
  expect(await recordAccountEvent(db,'o1',{...p,subject:'u1'})).toBe(true);
  expect(await recordAccountEvent(db,'o1',{...p,subject:'u2'})).toBe(true);
  expect((await listAccountEvents(db,'o1','a1')).length).toBe(4);
 });
 it('rejects unknown types and empty account',async()=>{
  const {db}=createTestD1();
  expect(await recordAccountEvent(db,'o1',{accountId:'',type:'frozen',context:'scan'})).toBe(false);
  expect(await recordAccountEvent(db,'o1',{accountId:'a1',type:'bogus' as never,context:'scan'})).toBe(false);
 });
 it('counts 24h / 7d / all per account in one query, owners isolated',async()=>{
  const {db}=createTestD1();
  for(const h of [1,5,30,24*6,24*20])await recordAccountEvent(db,'o1',{accountId:'a1',type:'spamblock',context:'mailing',at:ago(h)});
  await recordAccountEvent(db,'o1',{accountId:'a2',type:'frozen',context:'scan',at:ago(2)});
  await recordAccountEvent(db,'o2',{accountId:'a1',type:'frozen',context:'scan',at:ago(2)});
  const c=await accountEventCounts(db,'o1',AT);
  expect(c.a1).toEqual({day:2,week:4,all:5,lastAt:ago(1).toISOString()});
  expect(c.a2?.all).toBe(1);
  expect(Object.keys(c).sort()).toEqual(['a1','a2']);
 });
 it('lists newest first with a hard cap',async()=>{
  const {db}=createTestD1();
  for(let i=0;i<5;i++)await recordAccountEvent(db,'o1',{accountId:'a1',type:'flood_wait',context:'dm',waitSec:i+1,at:ago(i)});
  const list=await listAccountEvents(db,'o1','a1',2);
  expect(list.map(x=>x.waitSec)).toEqual([1,2]);
  expect((await listAccountEvents(db,'o1','a1',10_000)).length).toBe(5);
  expect(ACCOUNT_EVENTS_LIST_MAX).toBe(200);
 });
 it('safe writer swallows storage errors',async()=>{
  const broken={prepare(){throw new Error('db down')}} as never;
  await expect(recordAccountEventSafe(broken,'o1',{accountId:'a1',type:'frozen',context:'scan'})).resolves.toBeUndefined();
 });
});
