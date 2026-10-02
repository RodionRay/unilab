import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,resetWorkspace,testDb} from './helpers/workspace-harness';
import {HARNESS_BOT_ID,clearTmaState,prepareTmaTables,wsKeyOf} from './helpers/tma-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);

import {OutsideTelegramGate} from '@/components/tma/gates';
import {botLinkForKey,rememberBotIdentity} from '@/lib/tma/workspace';

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(()=>{
 resetWorkspace();
 clearTmaState();
});

describe('REQ-S3 · вне Telegram: «Откройте из бота» со ссылкой на бота',()=>{
 it('ссылка на бота известна → кнопка t.me/<bot>',()=>{
  const html=renderToStaticMarkup(createElement(OutsideTelegramGate,{botLink:'https://t.me/unilab_test_bot'}));

  expect(html).toContain('Откройте из бота');
  expect(html).toContain('href="https://t.me/unilab_test_bot"');
 });

 it('ссылка неизвестна → прежний текст без ссылки',()=>{
  const html=renderToStaticMarkup(createElement(OutsideTelegramGate,{botLink:''}));

  expect(html).toContain('Откройте из бота');
  expect(html).toContain('Настройки → Telegram-приложение');
  expect(html).not.toContain('href=');
 });

 it('botLinkForKey: только кешированный username текущего бота; неизвестный ключ → пусто',async()=>{
  const {db}=testDb();
  const key=await wsKeyOf();
  expect(await botLinkForKey(db,key)).toBe('');

  await rememberBotIdentity(db,OWNER,HARNESS_BOT_ID,'unilab_test_bot');
  expect(await botLinkForKey(db,key)).toBe('https://t.me/unilab_test_bot');
  await rememberBotIdentity(db,OWNER,'999',"old_bot");
  expect(await botLinkForKey(db,key)).toBe('');
  expect(await botLinkForKey(db,'A'.repeat(32))).toBe('');
 });
});
