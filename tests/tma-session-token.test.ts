import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {TMA_TOKEN_TTL_SEC,issueTmaToken,readTmaBearer,verifyTmaToken} from '@/lib/tma/session';
import {createSessionToken,verifySessionToken} from '@/lib/auth';

const NOW=1_790_000_000;
const CLAIMS={sub:'user-1',own:'owner-1',tg:424242,bot:'7000001',lnk:'link-1'};

beforeEach(()=>vi.stubEnv('SESSION_SECRET','s'.repeat(40)));
afterEach(()=>vi.unstubAllEnvs());

function b64(json:unknown){return Buffer.from(JSON.stringify(json)).toString('base64url')}

describe('REQ-A4 · tma bearer',()=>{
 it('выдаётся с префиксом tma., живёт ≤1 ч и проверяется в те же claims',async()=>{
  const {token,expiresAt}=await issueTmaToken(CLAIMS,NOW);

  expect(token.startsWith('tma.')).toBe(true);
  expect(expiresAt).toBe(NOW+TMA_TOKEN_TTL_SEC);
  expect(TMA_TOKEN_TTL_SEC).toBeLessThanOrEqual(3600);
  expect(await verifyTmaToken(token,NOW+10)).toEqual({...CLAIMS,exp:NOW+3600});
 });

 it('просрочен (exp в прошлом) → null',async()=>{
  const {token}=await issueTmaToken(CLAIMS,NOW);

  expect(await verifyTmaToken(token,NOW+3600)).toBeNull();
 });

 it('подменённый payload (чужой owner) → null',async()=>{
  const {token}=await issueTmaToken(CLAIMS,NOW);
  const [, , sig]=token.split('.');
  const forged=`tma.${b64({...CLAIMS,own:'owner-2',exp:NOW+3600})}.${sig}`;

  expect(await verifyTmaToken(forged,NOW)).toBeNull();
 });

 it('без префикса tma. или с другим префиксом → null',async()=>{
  const {token}=await issueTmaToken(CLAIMS,NOW);

  expect(await verifyTmaToken(token.slice(4),NOW)).toBeNull();
  expect(await verifyTmaToken('web.'+token.slice(4),NOW)).toBeNull();
 });

 it('payload с exp дальше часа от выдачи не принимается даже с верной подписью (защита от ручного exp)',async()=>{
  const {token}=await issueTmaToken(CLAIMS,NOW);

  expect(await verifyTmaToken(token,NOW-10)).not.toBeNull();
  expect(await verifyTmaToken(token,NOW-3600)).toBeNull();
 });

 it('cookie-сессия веба не годится как tma bearer, а tma bearer — как cookie (разделение доменов подписи)',async()=>{
  const web=await createSessionToken({userId:'user-1',email:'a@b.c'});
  const {token}=await issueTmaToken(CLAIMS,Math.floor(Date.now()/1000));

  expect(await verifyTmaToken('tma.'+web,NOW)).toBeNull();
  expect(await verifySessionToken(token)).toBeNull();
  expect(await verifySessionToken(token.slice(4))).toBeNull();
 });

 it('битые claims (нет sub / tg не число) → null',async()=>{
  const {token}=await issueTmaToken({...CLAIMS,sub:''},NOW);

  expect(await verifyTmaToken(token,NOW)).toBeNull();
 });
});

describe('readTmaBearer',()=>{
 const req=(auth?:string)=>new Request('http://crm.test/x',{headers:auth?{authorization:auth}:{}});

 it('Bearer tma.* → токен; иначе null',()=>{
  expect(readTmaBearer(req('Bearer tma.a.b'))).toBe('tma.a.b');
  expect(readTmaBearer(req('bearer   tma.a.b '))).toBe('tma.a.b');
  expect(readTmaBearer(req('Bearer other'))).toBeNull();
  expect(readTmaBearer(req('Basic tma.a.b'))).toBeNull();
  expect(readTmaBearer(req())).toBeNull();
 });
});
