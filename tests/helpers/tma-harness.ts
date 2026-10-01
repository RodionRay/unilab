import {ROLE_PRESETS,ensureStaffTables,type CrmAccess,type StaffRole} from '@/lib/staff';
import {ensureUserTables} from '@/lib/users';
import {ensureTmaTables,getOrCreateWorkspaceKey} from '@/lib/tma/workspace';
import {createLinkCode,redeemLinkCode} from '@/lib/tma/links';
import {BOT_TOKEN,OWNER,testDb} from './workspace-harness';
import {launchFields,nowSec,signInitData} from './tma-fixture';

/**
 * TMA route tests on top of workspace-harness (same in-memory D1, same OWNER/records).
 * The harness settings record holds BOT_TOKEN, so its bot id is 123456.
 */
export const HARNESS_BOT_ID='123456';
export const CLIENT_IP='203.0.113.5';

export async function prepareTmaTables(){
 const {db}=testDb();
 await ensureStaffTables();
 await ensureUserTables();
 await ensureTmaTables(db);
}

export function clearTmaState(){
 const {sqlite}=testDb();
 sqlite.exec('DELETE FROM tma_links; DELETE FROM tma_link_codes; DELETE FROM tma_workspaces; DELETE FROM oauth_accounts; DELETE FROM users;');
 try{sqlite.exec('DELETE FROM rate_limits;')}catch{/* created on first consume */}
}

export function addMember(userId:string,role:StaffRole,owner=OWNER,access:CrmAccess=ROLE_PRESETS[role]){
 testDb().sqlite.prepare('INSERT INTO workspace_members(id,workspace_owner_id,user_id,role,access,created) VALUES(?,?,?,?,?,?)')
  .run(crypto.randomUUID(),owner,userId,role,JSON.stringify(access),new Date().toISOString());
}

/** Links `tgId` to `userId` in `owner` through a real code redemption. */
export async function linkTelegram(userId:string,tgId:number,owner=OWNER){
 const {db}=testDb();
 const {code}=await createLinkCode(db,owner,userId);
 const r=await redeemLinkCode(db,owner,code,{id:tgId,username:`tg${tgId}`},HARNESS_BOT_ID);
 if(!r.ok)throw new Error(`link failed: ${r.reason}`);
 return r.linkId;
}

export async function wsKeyOf(owner=OWNER){
 return getOrCreateWorkspaceKey(testDb().db,owner);
}

export function initDataFor(tgId:number,token=BOT_TOKEN,authDate=nowSec()){
 return signInitData(launchFields({id:tgId,first_name:'Анна',username:`tg${tgId}`},authDate),token);
}

export function sessionRequest(body:unknown,ip=CLIENT_IP){
 return new Request('http://crm.test/api/tma/session',{
  method:'POST',
  headers:{'Content-Type':'application/json','cf-connecting-ip':ip},
  body:JSON.stringify(body),
 });
}

export function bearerPost(token:string,body:Record<string,unknown>){
 return new Request('http://crm.test/api/workspace',{
  method:'POST',
  headers:{'Content-Type':'application/json',origin:'http://crm.test',authorization:`Bearer ${token}`},
  body:JSON.stringify(body),
 });
}

export function feedRequest(token:string|null,query:string){
 return new Request(`http://crm.test/api/tma/feed?${query}`,{headers:token?{authorization:`Bearer ${token}`}:{}});
}
