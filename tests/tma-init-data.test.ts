import {afterEach,describe,expect,it,vi} from 'vitest';
import {TMA_BOT_TOKEN,launchFields,signInitData} from './helpers/tma-fixture';
import {botIdFromToken,initDataMaxAgeSec,verifyInitData} from '@/lib/tma/init-data';

const NOW=1_790_000_000;
const USER={id:424242,first_name:'Анна',username:'anna_mgr'};

afterEach(()=>vi.unstubAllEnvs());

describe('REQ-A1 · initData HMAC (WebAppData)',()=>{
 it('валидная подпись → пользователь и auth_date',async()=>{
  const initData=signInitData(launchFields(USER,NOW-10),TMA_BOT_TOKEN);

  const r=await verifyInitData(initData,TMA_BOT_TOKEN,{nowSec:NOW});

  expect(r).toEqual({ok:true,authDate:NOW-10,user:{id:424242,username:'anna_mgr',firstName:'Анна',lastName:''}});
 });

 it('изменённое поле после подписи → invalid_init_data',async()=>{
  const initData=signInitData(launchFields(USER,NOW-10),TMA_BOT_TOKEN);
  const tampered=initData.replace('424242','424243');

  expect(tampered).not.toBe(initData);
  expect(await verifyInitData(tampered,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'invalid_init_data'});
 });

 it('порядок полей в строке не важен (dcs сортируется)',async()=>{
  const initData=signInitData(launchFields(USER,NOW-10),TMA_BOT_TOKEN);
  const reordered=initData.split('&').reverse().join('&');

  expect((await verifyInitData(reordered,TMA_BOT_TOKEN,{nowSec:NOW})).ok).toBe(true);
 });

 it('подпись другим токеном бота → invalid_init_data',async()=>{
  const initData=signInitData(launchFields(USER,NOW-10),'7000002:other-bot');

  expect(await verifyInitData(initData,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'invalid_init_data'});
 });

 it('user в URL-кодировке (кириллица, спецсимволы) проверяется по декодированному значению',async()=>{
  const user={id:5,first_name:'Иван & Co = "x"',username:'ivan'};
  const initData=signInitData(launchFields(user,NOW),TMA_BOT_TOKEN);

  expect(initData).toContain('%D0%98');
  const r=await verifyInitData(initData,TMA_BOT_TOKEN,{nowSec:NOW});
  expect(r.ok&&r.user.firstName).toBe('Иван & Co = "x"');
 });

 it('нет hash → invalid_init_data',async()=>{
  const initData=signInitData(launchFields(USER,NOW),TMA_BOT_TOKEN).replace(/&?hash=[0-9a-f]+/,'');

  expect(await verifyInitData(initData,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'invalid_init_data'});
 });

 it('повтор ключа (двусмысленный dcs) → invalid_init_data',async()=>{
  const initData=signInitData(launchFields(USER,NOW),TMA_BOT_TOKEN)+'&auth_date=1';

  expect(await verifyInitData(initData,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'invalid_init_data'});
 });

 it('подписанный, но без user / с битым user → invalid_init_data',async()=>{
  const noUser=signInitData({auth_date:String(NOW),query_id:'q'},TMA_BOT_TOKEN);
  const badUser=signInitData({auth_date:String(NOW),user:'{"id":"x"}'},TMA_BOT_TOKEN);

  expect((await verifyInitData(noUser,TMA_BOT_TOKEN,{nowSec:NOW})).ok).toBe(false);
  expect((await verifyInitData(badUser,TMA_BOT_TOKEN,{nowSec:NOW})).ok).toBe(false);
 });

 it('пустой токен бота → invalid_init_data (не подписываем пустым ключом)',async()=>{
  const initData=signInitData(launchFields(USER,NOW),'');

  expect(await verifyInitData(initData,'',{nowSec:NOW})).toEqual({ok:false,code:'invalid_init_data'});
 });
});

describe('REQ-A2 · свежесть auth_date',()=>{
 it('ровно max age — ещё принимается, на секунду старше — init_data_expired',async()=>{
  const edge=signInitData(launchFields(USER,NOW-3600),TMA_BOT_TOKEN);
  const old=signInitData(launchFields(USER,NOW-3601),TMA_BOT_TOKEN);

  expect((await verifyInitData(edge,TMA_BOT_TOKEN,{nowSec:NOW})).ok).toBe(true);
  expect(await verifyInitData(old,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'init_data_expired'});
 });

 it('будущее: +60 с допускается, +61 с — init_data_expired',async()=>{
  const skew=signInitData(launchFields(USER,NOW+60),TMA_BOT_TOKEN);
  const future=signInitData(launchFields(USER,NOW+61),TMA_BOT_TOKEN);

  expect((await verifyInitData(skew,TMA_BOT_TOKEN,{nowSec:NOW})).ok).toBe(true);
  expect(await verifyInitData(future,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'init_data_expired'});
 });

 it('поддельная подпись со старой датой — invalid, а не expired (не раскрываем, что дата прочитана)',async()=>{
  const old=signInitData(launchFields(USER,NOW-99999),'1:wrong');

  expect(await verifyInitData(old,TMA_BOT_TOKEN,{nowSec:NOW})).toEqual({ok:false,code:'invalid_init_data'});
 });

 it('TMA_INITDATA_MAX_AGE переопределяет окно; мусор → 3600',()=>{
  vi.stubEnv('TMA_INITDATA_MAX_AGE','600');
  expect(initDataMaxAgeSec()).toBe(600);
  vi.stubEnv('TMA_INITDATA_MAX_AGE','abc');
  expect(initDataMaxAgeSec()).toBe(3600);
 });
});

describe('botIdFromToken',()=>{
 it('id бота = числовой префикс токена; иначе пусто',()=>{
  expect(botIdFromToken('7000001:abc')).toBe('7000001');
  expect(botIdFromToken('garbage')).toBe('');
  expect(botIdFromToken('')).toBe('');
 });
});
