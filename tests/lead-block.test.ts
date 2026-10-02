import {describe,expect,it} from 'vitest';
import {
 blockBadge,markChecked,observeIncoming,observePeer,observeSendError,observeSendOk,parsePeerSnapshot,
 peerSendErrorCode,sameSignal,type LeadBlockSignal,
} from '@/lib/lead-block';

const NOW='2026-10-01T12:00:00.000Z';
const NOW_SEC=Date.parse(NOW)/1000;
const later=(h:number)=>new Date(Date.parse(NOW)+h*3600_000).toISOString();

describe('peerSendErrorCode',()=>{
 it('reads the worker errorCode and code names in error text',()=>{
  expect(peerSendErrorCode({errorCode:'USER_IS_BLOCKED'})).toBe('USER_IS_BLOCKED');
  expect(peerSendErrorCode({error:'RPCError 403: PRIVACY_PREMIUM_REQUIRED (caused by SendMessageRequest)'})).toBe('PRIVACY_PREMIUM_REQUIRED');
  expect(peerSendErrorCode({error:'FloodWait 30с'})).toBeNull();
  expect(peerSendErrorCode(null)).toBeNull();
 });
});

describe('parsePeerSnapshot',()=>{
 it('rejects unknown shapes and clamps numbers',()=>{
  expect(parsePeerSnapshot({status:'weird'})).toBeNull();
  expect(parsePeerSnapshot('x')).toBeNull();
  expect(parsePeerSnapshot({status:'hidden',wasOnline:-5,photo:'yes'})).toEqual({status:'hidden',wasOnline:0,photo:false,deleted:false,outUnread:false,lastOutAt:0});
 });
});

describe('send errors',()=>{
 it('USER_IS_BLOCKED → «Вероятно, заблокировал» with the reason',()=>{
  const s=observeSendError(undefined,'USER_IS_BLOCKED','acc1',NOW);
  expect(blockBadge(s)).toMatchObject({label:'Вероятно, заблокировал',likelyBlocked:true,tone:'danger'});
  expect(blockBadge(s)?.reason).toContain('USER_IS_BLOCKED');
 });
 it('privacy codes → «Вероятно, закрыл ЛС»; deleted → «Аккаунт удалён» wins',()=>{
  let s=observeSendError(undefined,'PRIVACY_PREMIUM_REQUIRED','acc1',NOW);
  expect(blockBadge(s)?.label).toBe('Вероятно, закрыл ЛС');
  s=observeSendError(s,'INPUT_USER_DEACTIVATED','acc1',later(1));
  expect(blockBadge(s)?.label).toBe('Аккаунт удалён');
 });
 it('repeated error keeps the first time (idempotent)',()=>{
  const a=observeSendError(undefined,'USER_IS_BLOCKED','acc1',NOW);
  const b=observeSendError(a,'USER_IS_BLOCKED','acc1',later(2));
  expect(b.reasons).toHaveLength(1);
  expect(b.reasons[0]!.at).toBe(NOW);
  expect(sameSignal(a,b)).toBe(true);
 });
 it('a delivered message clears send-error reasons',()=>{
  const s=observeSendOk(observeSendError(undefined,'USER_IS_BLOCKED','acc1',NOW),null,'acc1',later(1));
  expect(blockBadge(s)).toBeNull();
 });
});

describe('profile visibility',()=>{
 const visible={status:'recently' as const,photo:true};
 const hidden={status:'hidden' as const,photo:false};
 it('visible → hidden (status and photo) → likely blocked',()=>{
  const s1=observePeer(undefined,visible,'acc1',NOW);
  expect(blockBadge(s1)).toBeNull();
  const s2=observePeer(s1,{...hidden,outUnread:true,lastOutAt:NOW_SEC-60},'acc1',later(6));
  const badge=blockBadge(s2);
  expect(badge).toMatchObject({label:'Вероятно, заблокировал',likelyBlocked:true});
  expect(badge?.reason).toContain('«был(а) в сети» и фото');
  expect(badge?.reason).toContain('не прочитано');
 });
 it('hidden from the very first look is not a signal (privacy «никто»)',()=>{
  expect(blockBadge(observePeer(undefined,hidden,'acc1',NOW))).toBeNull();
 });
 it('visible again clears the signal',()=>{
  const s=observePeer(observePeer(observePeer(undefined,visible,'acc1',NOW),hidden,'acc1',later(6)),visible,'acc1',later(12));
  expect(blockBadge(s)).toBeNull();
 });
 it('another account starts a fresh baseline',()=>{
  const s=observePeer(observePeer(undefined,visible,'acc1',NOW),hidden,'acc2',later(6));
  expect(s.accountId).toBe('acc2');
  expect(blockBadge(s)).toBeNull();
 });
 it('deleted snapshot → «Аккаунт удалён»',()=>{
  expect(blockBadge(observePeer(undefined,{status:'hidden',deleted:true},'acc1',NOW))?.label).toBe('Аккаунт удалён');
 });
});

describe('unread while seen online',()=>{
 it('online ≥1 h after our unread message → «Вероятно, не читает» (not «blocked»)',()=>{
  const s=observePeer(undefined,{status:'offline',wasOnline:NOW_SEC,outUnread:true,lastOutAt:NOW_SEC-2*3600},'acc1',NOW);
  expect(blockBadge(s)).toMatchObject({label:'Вероятно, не читает',likelyBlocked:false});
 });
 it('online shortly after or read → no signal',()=>{
  expect(blockBadge(observePeer(undefined,{status:'offline',wasOnline:NOW_SEC,outUnread:true,lastOutAt:NOW_SEC-600},'acc1',NOW))).toBeNull();
  const s=observePeer(undefined,{status:'online',outUnread:true,lastOutAt:NOW_SEC-7200},'acc1',NOW);
  expect(blockBadge(observePeer(s,{status:'online',outUnread:false},'acc1',later(1)))).toBeNull();
 });
});

describe('incoming and check stamps',()=>{
 it('an incoming DM from the same account disproves a block',()=>{
  const s=observeSendError(undefined,'USER_IS_BLOCKED','acc1',NOW);
  expect(blockBadge(observeIncoming(s,'acc1'))).toBeNull();
  expect(blockBadge(observeIncoming(s,'acc2'))).not.toBeNull();
  expect(observeIncoming(undefined,'acc1')).toBeUndefined();
 });
 it('markChecked keeps reasons and ignores checkedAt in sameSignal',()=>{
  const s:LeadBlockSignal=observeSendError(undefined,'USER_IS_BLOCKED','acc1',NOW);
  const c=markChecked(s,'acc1',later(1));
  expect(c.reasons).toHaveLength(1);
  expect(c.checkedAt).toBe(later(1));
  expect(sameSignal(s,c)).toBe(true);
 });
});
