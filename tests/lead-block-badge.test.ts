import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LeadBlockBadge} from '@/components/product/lead-block-badge';
import {AccountPenaltyCell} from '@/components/product/account-penalties';
import {accountEventTitle,formatWait} from '@/lib/account-events';

const blocked={accountId:'a1',reasons:[{code:'profile_hidden',at:'2026-10-01T10:00:00.000Z',detail:'Раньше были видны «был(а) в сети» и фото, теперь скрыты'}]};

describe('LeadBlockBadge',()=>{
 it('renders nothing without a signal',()=>{
  expect(renderToStaticMarkup(createElement(LeadBlockBadge,{signal:undefined}))).toBe('');
  expect(renderToStaticMarkup(createElement(LeadBlockBadge,{signal:{accountId:'a1',reasons:[]}}))).toBe('');
 });
 it('labels honestly as «вероятно» and keeps the reason in the header variant',()=>{
  const row=renderToStaticMarkup(createElement(LeadBlockBadge,{signal:blocked}));
  expect(row).toContain('Вероятно, заблокировал');
  expect(row).toContain('косвенным признакам');
  const header=renderToStaticMarkup(createElement(LeadBlockBadge,{signal:blocked,withReason:true}));
  expect(header).toContain('lead-block-reason');
  expect(header).toContain('теперь скрыты');
 });
});

describe('AccountPenaltyCell',()=>{
 it('shows 24h / 7d / all counters with an accessible label',()=>{
  const html=renderToStaticMarkup(createElement(AccountPenaltyCell,{counts:{day:1,week:3,all:9,lastAt:'2026-10-01T10:00:00.000Z'},onOpen:()=>{}}));
  expect(html).toContain('is-hot');
  expect(html).toContain('Штрафы Telegram: 1 за 24 ч, 3 за 7 дней, 9 всего');
 });
 it('zero state without counts',()=>{
  expect(renderToStaticMarkup(createElement(AccountPenaltyCell,{onOpen:()=>{}}))).toContain('is-none');
 });
});

describe('journal row titles',()=>{
 it('formats type, context and wait',()=>{
  expect(accountEventTitle({type:'flood_wait',context:'join',waitSec:420})).toBe('FloodWait · вступление · 7 мин');
  expect(accountEventTitle({type:'spambot',context:'check',waitSec:null})).toBe('@SpamBot: ограничен · проверка');
  expect(formatWait(30)).toBe('30 с');
  expect(formatWait(3600)).toBe('1 ч');
  expect(formatWait(5400)).toBe('1 ч 30 мин');
 });
});
