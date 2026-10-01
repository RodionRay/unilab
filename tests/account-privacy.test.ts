import {describe,expect,it} from 'vitest';
import {lastSeenNeedsApply,lastSeenStatus} from '@/lib/account-privacy';

const at='2026-10-01T10:00:00.000Z';

describe('lastSeenNeedsApply',()=>{
 it('никогда не применяли: только «скрыть» идёт в Telegram',()=>{
  expect(lastSeenNeedsApply(true,undefined)).toBe(true);
  expect(lastSeenNeedsApply(false,undefined)).toBe(false);
 });
 it('применено и совпадает — повторно не зовём',()=>{
  expect(lastSeenNeedsApply(true,{hidden:true,applied:true,at,error:''})).toBe(false);
 });
 it('применено, но желаемое изменилось — зовём',()=>{
  expect(lastSeenNeedsApply(false,{hidden:true,applied:true,at,error:''})).toBe(true);
 });
 it('прошлая попытка не прошла — повторяем',()=>{
  expect(lastSeenNeedsApply(true,{hidden:true,applied:false,at,error:'FloodWait'})).toBe(true);
 });
 it('новая/удалённая сессия: прежнее «применено» не в счёт (сервер его сбрасывает)',()=>{
  expect(lastSeenNeedsApply(true,{hidden:true,applied:true,at,error:''},true)).toBe(true);
  expect(lastSeenNeedsApply(false,{hidden:true,applied:true,at,error:''},true)).toBe(false);
 });
 it('битое состояние считается отсутствующим',()=>{
  expect(lastSeenNeedsApply(true,{hidden:'yes'})).toBe(true);
  expect(lastSeenNeedsApply(false,'x')).toBe(false);
 });
});

describe('lastSeenStatus',()=>{
 it('применено',()=>{
  expect(lastSeenStatus(true,{hidden:true,applied:true,at,error:''},true)).toEqual({tone:'ok',text:'Скрыто в Telegram'});
  expect(lastSeenStatus(false,{hidden:false,applied:true,at,error:''},true)).toEqual({tone:'ok',text:'Видно в Telegram'});
 });
 it('ошибка показывает причину',()=>{
  const s=lastSeenStatus(true,{hidden:true,applied:false,at,error:'Нет сессии'},true);
  expect(s.tone).toBe('error');
  expect(s.text).toContain('Нет сессии');
 });
 it('изменено, но не сохранено — ожидание',()=>{
  expect(lastSeenStatus(false,{hidden:true,applied:true,at,error:''},true).tone).toBe('pending');
  expect(lastSeenStatus(true,undefined,true).tone).toBe('pending');
 });
 it('без сессии и без изменения — пусто; с «скрыть» — ждёт сессию',()=>{
  expect(lastSeenStatus(false,undefined,false)).toEqual({tone:'none',text:''});
  expect(lastSeenStatus(true,undefined,false).text).toContain('сессия');
 });
});
