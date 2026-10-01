import {createHmac} from 'node:crypto';

/** Test bot token of the TMA fixtures; its bot id is the part before the colon. */
export const TMA_BOT_TOKEN='7000001:tma-test-bot-token-secret';
export const TMA_BOT_ID='7000001';

/**
 * Builds a Telegram WebApp initData string signed like Telegram does (core.telegram.org/bots/webapps,
 * «Validating data received via the Mini App»): data_check_string = sorted `k=v` lines without `hash`,
 * secret = HMAC_SHA256(key="WebAppData", bot_token), hash = hex(HMAC_SHA256(secret, dcs)).
 * Independent of lib/tma/init-data.ts (node:crypto, not WebCrypto) so the tests cross-check it.
 */
export function signInitData(fields:Record<string,string>,botToken:string):string{
 const dcs=Object.keys(fields).sort().map(k=>`${k}=${fields[k]}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest();
 const hash=createHmac('sha256',secret).update(dcs).digest('hex');
 const params=new URLSearchParams();
 for(const [k,v] of Object.entries(fields))params.set(k,v);
 params.set('hash',hash);
 return params.toString();
}

export type TgFixtureUser={id:number;first_name:string;username?:string;last_name?:string};

/** Typical launch fields for `user` at `authDate` (unix seconds). */
export function launchFields(user:TgFixtureUser,authDate:number):Record<string,string>{
 return {
  query_id:'AAHdF6IQAAAAAN0XohDhrOrc',
  user:JSON.stringify(user),
  auth_date:String(authDate),
  signature:'sig-ed25519-not-checked',
 };
}

export function nowSec():number{
 return Math.floor(Date.now()/1000);
}
