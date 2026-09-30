import {describe,expect,it} from 'vitest';
import {
  isPeerFloodMailingError,
  isPermanentMailingRecipientError,
  isRateLimitMailingError,
  isTransientPeerResolveError,
  mailingEmptyBatchDecision,
  mailingFailText,
  mailingOkText,
  mailingTextPreview,
  parseMailingFloodWaitSec,
  pickMailingSendAccountId,
} from '@/lib/mailing';

describe('рассылка · flood / лог / очередь',()=>{
  it('отличает FloodWait от PEER_FLOOD',()=>{
    expect(isRateLimitMailingError('Too many requests')).toBe(true);
    expect(isRateLimitMailingError('FloodWaitError: A wait of 312 seconds is required')).toBe(true);
    expect(isRateLimitMailingError('PEER_FLOOD')).toBe(false);
    expect(isPeerFloodMailingError('PEER_FLOOD')).toBe(true);
    expect(isPeerFloodMailingError('spamblock')).toBe(true);
  });

  it('парсит секунды FloodWait',()=>{
    expect(parseMailingFloodWaitSec('FloodWait 312',900)).toBe(312);
    expect(parseMailingFloodWaitSec('A wait of 120 seconds is required',900)).toBe(120);
    expect(parseMailingFloodWaitSec('Too many requests',900)).toBeGreaterThanOrEqual(600);
  });

  it('не завершает задачу, пока есть отложенные получатели',()=>{
    const now=Date.parse('2026-09-18T08:35:00.000Z');
    const wait=mailingEmptyBatchDecision({
      'u:1':'2026-09-18T08:50:00.000Z',
      'u:2':'2026-09-18T08:40:00.000Z',
    },now);
    expect(wait.action).toBe('wait');
    if(wait.action==='wait'){
      expect(wait.nextAt).toBe('2026-09-18T08:40:00.000Z');
      expect(wait.waitSec).toBe(300);
    }
    expect(mailingEmptyBatchDecision({},now)).toEqual({action:'complete'});
    expect(mailingEmptyBatchDecision({'u:1':'2026-09-18T08:00:00.000Z'},now)).toEqual({action:'complete'});
  });

  it('в логе доставки показывает превью текста',()=>{
    expect(mailingTextPreview('  Привет   мир  ',80)).toBe('Привет мир');
    expect(mailingOkText('dana','','https://t.me/dana','Здравствуйте! Это тестовая рассылка UniLab')).toContain('«Здравствуйте! Это тестовая рассылка UniLab»');
    expect(mailingOkText('dana','1','','')).toBe('Доставлено @dana');
  });

  it('peer/entity miss — transient, не permanent (ретрай другим слотом)',()=>{
    const raw='Could not find the input entity for PeerUser(user_id=342560478)';
    expect(isTransientPeerResolveError(raw)).toBe(true);
    expect(isPermanentMailingRecipientError(raw)).toBe(false);
    expect(mailingFailText('timosha_07','342560478',raw)).toMatch(/сессия не видит peer|@username|групп/i);
    expect(isTransientPeerResolveError('Не удалось открыть пользователя')).toBe(true);
    expect(isPermanentMailingRecipientError('Не удалось открыть пользователя')).toBe(false);
    expect(isPermanentMailingRecipientError('UserPrivacyRestrictedError')).toBe(true);
  });

  it('sticky: предпочитает аккаунт, который видел peer',()=>{
    const live=['a','b','c'];
    expect(pickMailingSendAccountId(live,['b'],0)).toBe('b');
    expect(pickMailingSendAccountId(live,['x','c'],1)).toBe('c');
    expect(pickMailingSendAccountId(live,[''],2)).toBe('c');
  });

  it('бан на запись в супергруппы → spamblock аккаунта, не FloodWait',()=>{
    const raw="You're banned from sending messages in superroups/channels (caused by SendMessageRequest)";
    expect(isPeerFloodMailingError(raw)).toBe(true);
    expect(isRateLimitMailingError(raw)).toBe(false);
    expect(mailingFailText('x','1',raw)).toContain('ограничен Telegram');
  });
});
