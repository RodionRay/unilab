import {getSessionUser} from '@/lib/auth';
import {GROUP_CATALOG,isCatalogPlaceholderUrl} from '@/lib/group-catalog';
import {JOIN_SUCCESS_PATCH,JOIN_WORKER_ERROR_RETRY_MS,LIVE_JOIN_STATES,accountBlindPatch,clearStaleJoinState,type JoinAccountState,type JoinGateResult,type JoinProxyState,evaluateAccountJoinReadiness,isAccountBlindResult,isJoinFarmCandidate,joinFailurePatch,sanitizeJoinStateError} from '@/lib/processes/join-flow';
import {database,seal,unseal} from '@/lib/server-store';
import {envAiApiKey,resolveAiConfig} from '@/lib/ai-client';
import {parseLeadTemperature,ratingFromTemperatures} from '@/lib/lead-filter';
import {addLeadTombstone,evaluateScanGate,keepServerOwnedFields} from '@/lib/processes/scan-flow';
import {DRAFT_KINDS,defaultProjectId as defaultProjectIdOf,generateDraft,normalizeDmMessage,projectIdOf,type DmMessage,type ProjectRow} from '@/lib/leads';
import {dailyCapOf,findOwnedProject,loadSettingsRow,mutateLead,reserveDailyCap,withoutDraft} from '@/lib/processes/lead-store';
import {autoDraftCandidates,autoDraftLeads,autoDraftKind,draftLlm,draftLeadOf,judgeInboxDms,scanGroupLeads,type InsertedLead} from '@/lib/processes/lead-scan';
import {createProject,deleteProject,generateAccountAbout,leadFeedback,projectFunnel,rebuildProduct,requestedProject,setGroupProject,updateProject,type ActionResult} from '@/lib/processes/lead-actions';
import {after} from 'next/server';
import {ACCOUNT_STATUSES,DEFAULT_ACCOUNT_LIMITS,JOIN_GAP_DEFAULT_SEC,PROXY_STATUSES,applyQuotaCooldownIfExhausted,bumpJoinCounters,bumpMessageCounters,canPollDmInbox,generateTelegramUsername,hasMessageQuota,isAccountUsable,isOnCooldown,withFrozenStatus} from '@/lib/telegram-accounts';
import {pushTaskLog} from '@/lib/audience-invite';
import {canonicalizeTgUrl,duplicateReason,isDuplicateKind,telegramEntityKey} from '@/lib/record-identity';
import {DEFAULT_DM_SOFT_CLOSE} from '@/lib/mailing';
import {checkProxyTarget} from '@/lib/security/net-guard';
import {proxyCheckTimeoutMs,workerSlots} from '@/lib/worker-timeouts';
import {WorkerBusyError} from '@/lib/worker-busy';
import {READ_RECORD_KINDS,RECORD_KINDS,authorizeWorkspaceAction,canSeeLeadText,redactLeadTextFor,keepOwnerSecretsOnSave,visibleRecordsFor,type WorkspaceActor} from '@/lib/security/workspace-authz';
import {ALL_CRM_ACCESS} from '@/lib/staff-types';
import {INBOX_CURSOR_MARGIN_SEC,applySendOutcome,findSendBlock,leadReplies,markLeadOpened,mergeIncomingDm,nextInboxCursor,withPendingSend,type LeadData,type ReplyEntry,type SendOutcome} from '@/lib/lead-conversation';
import type {D1LikeDatabase} from '@/lib/db';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
export const dynamic='force-dynamic';
const kindSchema=z.enum(RECORD_KINDS);
const short=z.string().trim().min(1).max(200);
const settingsSchema=z.object({
 name:short,
 product:z.string().max(12000).default(''),
 projectUrl:z.string().max(500).default(''),
 audience:z.string().max(2000).default(''),
 leadCriteria:z.string().max(4000).default(''),
 keywords:z.string().max(8000).default(''),
 minusKeywords:z.string().max(8000).default(''),
 model:z.string().max(100).default('deepseek-chat'),
 provider:z.enum(['deepseek','openai','custom']).default('deepseek'),
 apiBase:z.string().max(300).default('https://api.deepseek.com'),
 tone:z.string().max(500).default(''),
 cta:z.string().max(500).default(''),
 pains:z.string().max(4000).default(''),
 valueProps:z.string().max(4000).default(''),
 avoidTopics:z.string().max(4000).default(''),
 hotSignals:z.string().max(4000).default(''),
 productNotes:z.string().max(4000).default(''),
 learnExamples:z.string().max(4000).default(''),
 /** Мягкое закрытие в ЛС: не банить / не мутить */
 dmSoftClose:z.string().max(2000).default(DEFAULT_DM_SOFT_CLOSE),
 aiQualify:z.boolean().default(true),
 autoRescanEnabled:z.boolean().default(true),
 autoRescanMinutes:z.coerce.number().int().min(5).max(180).default(30),
 lastAutoRescanAt:z.string().max(40).default(''),
 /** Последние стоп-слова, добавленные кнопкой «В стоп-слова». */
 lastMinusAdded:z.array(z.string().max(80)).max(20).default([]),
 lastMinusAddedAt:z.string().max(40).default(''),
 /** Журнал переобходов групп (глобальный). */
 rescanLog:z.array(z.object({
  at:z.string().max(40),
  level:z.enum(['info','ok','warn','error']),
  text:z.string().max(400),
 })).max(150).default([]),
 /** Глубина просмотра истории чата (дней). */
 scanDepthDays:z.coerce.number().int().min(1).max(90).default(7),
 /** Профиль кабинета */
 profileName:z.string().max(120).default(''),
 profileAbout:z.string().max(500).default(''),
 profileContact:z.string().max(200).default(''),
 /** Уведомления о новых лидах через Telegram-бота */
 notifyEnabled:z.boolean().default(false),
 notifyBotToken:z.string().max(200).default(''),
 notifyChatId:z.string().max(100).default(''),
 /** Дневные лимиты AI на владельца (lead core v2): сообщений судье и черновиков. */
 judgeDailyCap:z.coerce.number().int().min(0).max(100000).default(3000),
 draftDailyCap:z.coerce.number().int().min(0).max(10000).default(200),
});
const limitsSchema=z.object({
 invite:z.coerce.number().int().min(0).max(10000).default(DEFAULT_ACCOUNT_LIMITS.invite),
 message:z.coerce.number().int().min(0).max(10000).default(DEFAULT_ACCOUNT_LIMITS.message),
 chat:z.coerce.number().int().min(0).max(10000).default(DEFAULT_ACCOUNT_LIMITS.chat),
});
const schemas={
 account:z.object({
  name:short,
  phone:z.string().regex(/^\+[1-9]\d{7,14}$/),
  proxyId:z.string().max(100).default(''),
  status:z.enum(ACCOUNT_STATUSES).default('setup'),
  format:z.enum(['tdata','session','session_json','manual']).default('manual'),
  sessionMode:z.enum(['keep','new']).default('keep'),
  limits:limitsSchema.default(DEFAULT_ACCOUNT_LIMITS),
  cooldownUntil:z.string().max(40).default(''),
  lastJoinAt:z.string().max(40).default(''),
  joinsToday:z.coerce.number().int().min(0).default(0),
  joinsDay:z.string().max(20).default(''),
  firstName:z.string().max(200).default(''),
  lastName:z.string().max(200).default(''),
  username:z.string().max(64).default(''),
  about:z.string().max(500).default(''),
  hasPhoto:z.boolean().default(false),
  error:z.string().max(500).default(''),
 }),
 proxy:z.object({
  name:short,
  host:z.string().trim().regex(/^[a-zA-Z0-9.-]+$/).max(253).refine(h=>checkProxyTarget(h,1).ok,{message:'forbidden_host'}),
  port:z.coerce.number().int().min(1).max(65535),
  protocol:z.enum(['socks5','http']),
  username:z.string().max(200).default(''),
  status:z.enum(PROXY_STATUSES).default('inactive'),
  exitIp:z.string().max(64).default(''),
  lastChecked:z.string().max(40).default(''),
  checkError:z.string().max(500).default(''),
  /** false = интернет есть, но DC Telegram через прокси недоступны */
  telegramOk:z.boolean().optional(),
 }),
 group:z.object({
  name:short,
  url:z.string().trim().regex(/^(?:https:\/\/t\.me\/(?:\+|joinchat\/)?[a-zA-Z0-9_-]+|@[a-zA-Z0-9_]{5,32})$/),
  accountId:z.string().max(100).default(''),
  status:z.enum(['setup','pending','active','error']).default('setup'),
  error:z.string().max(500).default(''),
  membership:z.enum(['none','pending','joined']).default('none'),
  joinedAt:z.string().max(40).default(''),
  /** С каким аккаунтом группа вступила в Telegram */
  joinedAccountId:z.string().max(100).default(''),
  /** Состояние ручного вступления/скана для UI; queued/waiting удалённой очереди читаем как «не вступали» */
  joinState:z.preprocess((v)=>v==='queued'||v==='waiting'?'':v,z.enum(['',...LIVE_JOIN_STATES]).default('')),
  joinStateAt:z.string().max(40).default(''),
  // coerce: раньше set_group_join_state мог сохранить не-строку; длинные ошибки TG режем.
  joinStateError:z.preprocess(
   (v)=>{
    if(v==null)return '';
    if(typeof v==='object')return ''; // битый JSON от старого бага
    return String(v).slice(0,500);
   },
   z.string().max(500),
  ).default(''),
  leadsTotal:z.coerce.number().int().min(0).default(0),
  leadsHot:z.coerce.number().int().min(0).default(0),
  leadsWarm:z.coerce.number().int().min(0).default(0),
  leadsCold:z.coerce.number().int().min(0).default(0),
  scanMatched:z.coerce.number().int().min(0).default(0),
  rating:z.coerce.number().min(0).max(5).default(0),
  lastScanned:z.string().max(40).default(''),
  scanLog:z.array(z.object({
   at:z.string().max(40),
   level:z.enum(['info','ok','warn','error']),
   text:z.string().max(400),
  })).max(60).default([]),
 }),
 lead:z.object({
  name:short,
  message:z.string().trim().min(3).max(8000),
  source:z.string().max(200).default('Вручную'),
  status:z.enum(['new','working','archived']).default('new'),
  temperature:z.enum(['hot','warm','cold']).default('warm'),
  draft:z.string().max(10000).default(''),
  tgMsgId:z.string().max(40).default(''),
  groupId:z.string().max(100).default(''),
  reason:z.string().max(500).default(''),
  viewed:z.boolean().default(false),
  viewedAt:z.string().max(40).default(''),
  excludeFromTraining:z.boolean().default(false),
  senderId:z.string().max(40).default(''),
  senderUsername:z.string().max(64).default(''),
  /** Telethon access_hash — нужен для ЛС без кэша сессии */
  senderAccessHash:z.string().max(40).default(''),
  /** group | discussion | comment — откуда взято сообщение */
  messageKind:z.enum(['group','discussion','comment','']).default(''),
  peerId:z.string().max(40).default(''),
  replyToMsgId:z.string().max(40).default(''),
  replies:z.array(z.object({
   text:z.string().max(4000),
   mode:z.enum(['dm','chat']),
   at:z.string().max(40),
   ok:z.boolean(),
   error:z.string().max(400).default(''),
   messageId:z.string().max(40).default(''),
   link:z.string().max(300).default(''),
   chatId:z.string().max(40).default(''),
   from:z.enum(['us','client']).default('us'),
  })).max(50).default([]),
  conversationOpen:z.boolean().default(false),
  conversationAt:z.string().max(40).default(''),
  incomingLastText:z.string().max(4000).default(''),
  needsManager:z.boolean().default(false),
  accountId:z.string().max(100).default(''),
 }),
 settings:settingsSchema,
};
function reply(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
function replyResult(r:ActionResult){return reply(r.body,r.status)}
/** Project / funnel answers without lead and DM texts for staff without lead access. */
function replyRedacted(actor:WorkspaceActor,r:ActionResult){return reply(redactLeadTextFor(actor,r.body),r.status)}
/** Messages safe to show the user verbatim; any other error text stays in server logs. */
class UserFacingError extends Error{}

function internalError(context:string,e:unknown,publicMessage:string){
 if(e instanceof UserFacingError)return e.message;
 console.error(`[workspace] ${context}:`,String((e as Error)?.message||e).slice(0,500));
 return publicMessage;
}

async function readActor():Promise<WorkspaceActor|undefined>{
  const u=await getSessionUser();
  if(!u?.userId)return;
  try{
    const {resolveWorkspaceContext}=await import('@/lib/staff');
    const ctx=await resolveWorkspaceContext(u.userId);
    return {userId:u.userId,ownerId:ctx.ownerId,isOwner:ctx.isOwner,role:ctx.role,access:ctx.access};
  }catch(e){
    // Staff tables unavailable: fall back to the user's own (possibly empty) workspace, never the employer's.
    console.error('[workspace] resolve context:',String((e as Error)?.message||e).slice(0,300));
    return {userId:u.userId,ownerId:u.userId,isOwner:true,role:'owner',access:ALL_CRM_ACCESS};
  }
}

function workerUrl(){
 const fromEnv=(env as unknown as {TELEGRAM_WORKER_URL?:string}).TELEGRAM_WORKER_URL||process.env.TELEGRAM_WORKER_URL;
 return (fromEnv||'http://127.0.0.1:8790').replace(/\/$/,'');
}
function workerToken(){
 return (env as unknown as {TG_WORKER_TOKEN?:string}).TG_WORKER_TOKEN||process.env.TG_WORKER_TOKEN||'';
}

/** @param batchSize checks sent to the worker at the same time (they queue beyond its slots) */
async function runProxyCheck(owner:string,id:string,batchSize=1){
 const db=database();
 const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'proxy').first();
 if(!row)return {id,ok:false as const,error:'Прокси не найден',latencyMs:0,status:'inactive' as const};
 const data=JSON.parse(row.data);
 const target=checkProxyTarget(String(data.host||''),Number(data.port));
 if(!target.ok){
  const failed={...data,status:'inactive',lastChecked:new Date().toISOString(),checkError:target.reason,exitIp:'',telegramOk:false,checkingAt:''};
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(failed),owner,id,'proxy').run();
  return {id,ok:false as const,error:target.reason,latencyMs:0,status:'inactive' as const};
 }
 const checkingAt=new Date().toISOString();
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...data,status:'checking',checkError:'',checkingAt}),owner,id,'proxy').run();
 if(!row.secret){
  const failed={...data,status:'inactive',lastChecked:new Date().toISOString(),checkError:'Нет сохранённого пароля',exitIp:'',telegramOk:false,checkingAt:''};
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(failed),owner,id,'proxy').run();
  return {id,ok:false as const,error:failed.checkError,latencyMs:0,status:'inactive' as const};
 }
 let password='';
 try{password=await unseal(row.secret,owner)}catch{
  const failed={...data,status:'inactive',lastChecked:new Date().toISOString(),checkError:'Не удалось расшифровать пароль',exitIp:'',telegramOk:false,checkingAt:''};
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(failed),owner,id,'proxy').run();
  return {id,ok:false as const,error:failed.checkError,latencyMs:0,status:'inactive' as const};
 }
 const input={host:data.host,port:Number(data.port),protocol:data.protocol==='http'?'http':'socks5' as const,username:data.username||'',password};
 // Только через tg-worker: в vinext/CF исходящий TCP к прокси даёт jsg.Error
 let result:{ok:boolean;latencyMs:number;exitIp?:string;error?:string;telegramOk?:boolean;protocol?:string;warning?:string};
 // Worker busy/down/timeout says nothing about the proxy: keep its previous status.
 let inconclusive=false;
 try{
  const wr=await workerPost('/check-proxy',input,proxyCheckTimeoutMs(batchSize,workerSlots(process.env.TG_WORKER_MAX_CONCURRENCY)));
  result={
   ok:!!wr.ok,
   latencyMs:Number(wr.latencyMs)||0,
   exitIp:wr.exitIp?String(wr.exitIp):undefined,
   error:wr.error?String(wr.error):undefined,
   warning:wr.warning?String(wr.warning):undefined,
   telegramOk:wr.ok?(wr.telegramOk!==false):false,
   protocol:wr.protocol==='socks5'||wr.protocol==='http'?String(wr.protocol):undefined,
  };
 }catch(e){
  const msg=String((e as Error).message||e);
  const busy=e instanceof WorkerBusyError;
  const workerDown=!busy&&/ECONNREFUSED|fetch failed|AbortError|timeout|воркер/i.test(msg);
  inconclusive=busy||workerDown;
  result={
   ok:false,
   latencyMs:0,
   error:busy
    ?'Telegram-воркер занят другими проверками. Повторите через несколько секунд.'
    :workerDown
    ?(/AbortError|timeout/i.test(msg)
      ?'Таймаут проверки прокси. Повторите или смените прокси.'
      :'Telegram-воркер недоступен для проверки прокси. Запустите: npm run dev')
    :msg.slice(0,400),
  };
 }
 if(result.error&&/jsg\.Error|cannot connect to the specified address/i.test(result.error)){
  result={
   ...result,
   ok:false,
   error:'Сбой проверки в среде кабинета. Нужен Telegram-воркер (он стартует с npm run dev) и верный логин/пароль прокси.',
  };
 }
 const next=inconclusive
  ?{...data,checkError:(result.error||'Проверка не выполнена').slice(0,500),checkingAt:''}
  :{
   ...data,
   status:result.ok?'active':'inactive',
   protocol:result.protocol||data.protocol||'socks5',
   exitIp:result.exitIp||data.exitIp||'',
   lastChecked:new Date().toISOString(),
   checkError:result.ok
    ?(result.telegramOk===false?(result.warning||result.error||'').slice(0,500):'')
    :(result.error||'Ошибка проверки').slice(0,500),
   telegramOk:result.ok?result.telegramOk!==false:false,
   checkingAt:'',
  };
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'proxy').run();
 return {id,ok:result.ok,exitIp:next.exitIp,latencyMs:result.latencyMs,error:result.error||result.warning,telegramOk:next.telegramOk,protocol:next.protocol,status:next.status as string};
}

async function healStuckProxyChecks(owner:string,maxAgeMs=45_000){
 const db=database();
 const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='proxy'").bind(owner).all();
 let fixed=0;
 const now=Date.now();
 for(const row of rows.results){
  try{
   const d=JSON.parse(String(row.data));
   if(String(d.status||'')!=='checking')continue;
   const started=Date.parse(String(d.checkingAt||''));
   const stale=maxAgeMs===0||!Number.isFinite(started)||now-started>maxAgeMs;
   if(!stale)continue;
   const next={
    ...d,
    status:'inactive',
    telegramOk:false,
    checkingAt:'',
    lastChecked:new Date().toISOString(),
    checkError:(d.checkError&&String(d.checkError).trim()&&!/проверя/i.test(String(d.checkError))
      ?String(d.checkError)
      :'Проверка прервана (таймаут). Нажмите проверку снова.').slice(0,500),
   };
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,String(row.id),'proxy').run();
   fixed++;
  }catch{/* */}
 }
 return fixed;
}

async function loadAccountSessionPayload(owner:string,accountId:string){
 const db=database();
 const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,accountId,'account').first();
 if(!row)throw new UserFacingError('Аккаунт не найден');
 if(!row.secret)throw new UserFacingError('У аккаунта нет сессии');
 const data=JSON.parse(row.data);
 const secretRaw=await unseal(row.secret,owner);
 const session=JSON.parse(secretRaw);
 let proxyPayload:any=null;
 if(data.proxyId){
  const prow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,data.proxyId,'proxy').first();
  if(prow){
   const pdata=JSON.parse(prow.data);
   const target=checkProxyTarget(String(pdata.host||''),Number(pdata.port));
   if(!target.ok)throw new UserFacingError(target.reason);
   let password='';
   if(prow.secret){try{password=await unseal(prow.secret,owner)}catch{/* */}}
   proxyPayload={host:pdata.host,port:Number(pdata.port),protocol:pdata.protocol||'socks5',username:pdata.username||'',password};
  }
 }
 return {
  account:data,
  payload:{
   format:session.kind||data.format||'tdata',
   zipBase64:session.zipBase64,
   twoFA:session.twoFA||'',
   apiId:session.apiId,
   apiHash:session.apiHash,
   proxy:proxyPayload,
  }
 };
}

async function workerPost(path:string,body:unknown,timeoutMs=120_000){
 const headers:Record<string,string>={'Content-Type':'application/json'};
 const token=workerToken();
 if(token)headers.Authorization=`Bearer ${token}`;
 const res=await fetch(workerUrl()+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
 const data:any=await res.json().catch(()=>({}));
 if(res.status===429)throw new WorkerBusyError(data?.error||'Воркер занят');
 if(!res.ok&&!data?.ok&&!data?.status)throw new Error(data?.error||`Воркер ${res.status}`);
 return data;
}

async function healStuckAccountChecks(owner:string,maxAgeMs=180_000){
 const db=database();
 const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='account'").bind(owner).all();
 let fixed=0;
 const now=Date.now();
 for(const row of rows.results){
  try{
   const d=JSON.parse(String(row.data));
   if(String(d.status||'')!=='checking')continue;
   const started=Date.parse(String(d.checkingAt||''));
   const stale=!Number.isFinite(started)||now-started>maxAgeMs;
   if(!stale)continue;
   const next={
    ...d,
    status:'setup',
    error:'Проверка прервана (таймаут). Нажмите проверку снова.',
    checkingAt:'',
   };
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,String(row.id),'account').run();
   fixed++;
  }catch{/* */}
 }
 return fixed;
}

/** Активные прокси; сначала с подтверждённым TG, потом остальные active. */
async function listActiveProxyIds(owner:string,excludeId?:string,onlyActive=false){
 const db=database();
 const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='proxy'").bind(owner).all();
 const tgOk:string[]=[];
 const soft:string[]=[];
 const unknown:string[]=[];
 const other:string[]=[];
 const now=Date.now();
 for(const r of rows.results){
  const id=String(r.id);
  if(excludeId&&id===excludeId)continue;
  try{
   const d=JSON.parse(String(r.data));
   const st=String(d.status||'');
   if(st==='active'){
    if(d.telegramOk===true)tgOk.push(id);
    else if(d.telegramOk===false){
     // Soft bad: не отдаём в rotate, пока не истечёт quarantine
     const until=Date.parse(String(d.telegramBadUntil||''));
     if(Number.isFinite(until)&&until>now)continue;
     soft.push(id);
    }else unknown.push(id);
   }else if(!onlyActive)other.push(id);
  }catch{if(!onlyActive)other.push(id)}
 }
 // Rotate (onlyActive): только подтверждённые / неизвестные — без soft
 if(onlyActive)return [...tgOk,...unknown];
 return [...tgOk,...unknown,...soft,...other];
}

async function markProxyTelegramBad(owner:string,proxyId:string,reason:string){
 if(!proxyId)return;
 const db=database();
 const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,proxyId,'proxy').first();
 if(!row)return;
 try{
  const d=JSON.parse(String(row.data));
  // Не гасим прокси целиком: quarantine 30 мин для rotate
  const next={
   ...d,
   telegramOk:false,
   telegramBadUntil:new Date(Date.now()+30*60_000).toISOString(),
   status:d.status==='checking'?'active':(d.status||'active'),
   lastChecked:new Date().toISOString(),
   checkError:(reason||'Быстрый TG-probe не прошёл — проверьте аккаунтом').slice(0,500),
  };
  if(next.status==='inactive')next.status='active';
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,proxyId,'proxy').run();
 }catch{/* */}
}

function isSessionDeadError(status:string,error:string){
 const e=String(error||'').toLowerCase();
 return (
  status==='unauthorized'||
  /сессия больше не действительн|session.*(revoked|invalid|expired)|authkey|authorization key|not authorized/i.test(e)
 );
}

const CONNECT_MAX_ATTEMPTS=3;
const CONNECT_RETRY_PAUSE_MS=400;
const ACCOUNT_CHECK_TIMEOUT_MS=22_000;
const ACCOUNT_CHECK_CONCURRENCY=3;

/** Ошибка коннекта/прокси — статус disconnected/proxy_error, БЕЗ отлёжки. */
async function putAccountConnectFailed(owner:string,id:string,data:any,opts:{
 attempts:number;
 lastError:string;
 proxyRotated?:string;
 status?:'disconnected'|'proxy_error';
}){
 const db=database();
 const tip=
  `Не удалось подключить за ${opts.attempts} попыток${opts.proxyRotated?' со сменой прокси':''}. `+
  `Проверьте прокси и свежий tdata/session. `+
  `Последняя ошибка: ${String(opts.lastError||'').slice(0,180)}`;
 const status=opts.status||(/proxy|socks|ECONN|прокси/i.test(String(opts.lastError||''))?'proxy_error':'disconnected');
 const next={
  ...data,
  status,
  // Не ставим cooldownUntil — отлёжка только по лимитам / спамблоку / заморозке.
  cooldownUntil:'',
  checkingAt:'',
  error:tip.slice(0,500),
  ...(opts.proxyRotated?{proxyId:opts.proxyRotated}:{}),
 };
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'account').run();
 return {
  id,
  ok:false,
  status:next.status,
  error:next.error,
  proxyRotated:opts.proxyRotated||undefined,
 };
}

async function putAccountUnauthorized(owner:string,id:string,data:any,opts:{
 lastError:string;
 proxyRotated?:string;
}){
 const db=database();
 const tip=
  `Сессия недействительна (смена прокси не помогла). `+
  `Перелогиньтесь в Telegram Desktop и заново загрузите tdata/session. `+
  `${String(opts.lastError||'').slice(0,160)}`;
 const next={
  ...data,
  status:'unauthorized' as const,
  cooldownUntil:'',
  checkingAt:'',
  error:tip.slice(0,500),
  ...(opts.proxyRotated?{proxyId:opts.proxyRotated}:{}),
 };
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'account').run();
 return {
  id,
  ok:false,
  status:'unauthorized' as const,
  error:next.error,
  proxyRotated:opts.proxyRotated||undefined,
 };
}

async function runAccountCheck(owner:string,id:string,opts?:{
 checkRestrictions?:boolean;
 ensureUsername?:boolean;
 forceUsername?:boolean;
 rotateProxy?:boolean;
}){
 const db=database();
 const checkRestrictions=opts?.checkRestrictions===true;
 const ensureUsername=opts?.ensureUsername!==false;
 const forceUsername=opts?.forceUsername===true;
 const rotateProxy=opts?.rotateProxy!==false;
 const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'account').first();
 if(!row)return {id,ok:false,status:'unauthorized',error:'Аккаунт не найден'};
 let data=JSON.parse(row.data);
 const checkingAt=new Date().toISOString();
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...data,status:'checking',error:'',checkingAt}),owner,id,'account').run();

 const triedProxies=new Set<string>(data.proxyId?[String(data.proxyId)]:[]);
 let proxyRotated='';
 const maxAttempts=rotateProxy?CONNECT_MAX_ATTEMPTS:1;
 let lastError='';
 let lastStatus='disconnected';

 for(let attempt=0;attempt<maxAttempts;attempt++){
  if(attempt>0){
   await new Promise(r=>setTimeout(r,CONNECT_RETRY_PAUSE_MS));
  }
  const currentProxyId=String(data.proxyId||'');
  try{
   const {payload}=await loadAccountSessionPayload(owner,id);
   const workerResult=await workerPost('/check-account',{
    ...payload,
    checkRestrictions,
    ensureUsername,
    forceUsername,
    desiredUsername:String(data.username||'').replace(/^@/,'').trim(),
   },ACCOUNT_CHECK_TIMEOUT_MS);
   const status=ACCOUNT_STATUSES.includes(workerResult.status)?workerResult.status:(workerResult.ok?'active':'disconnected');
   const profile=workerResult.profile||{};
   const err=(workerResult.error||'').slice(0,500);
   lastError=err||status;
   lastStatus=status;

   const next={
    ...data,
    status,
    error:err,
    checkingAt:'',
    firstName:profile.firstName??data.firstName??'',
    lastName:profile.lastName??data.lastName??'',
    username:profile.username??data.username??'',
    // Telegram id аккаунта: входящие ЛС от своих аккаунтов не судим как лиды (lead core v2 REQ-15)
    tgUserId:String(profile.userId??data.tgUserId??'').slice(0,40),
    phone:profile.phone&&/^\+[1-9]\d{7,14}$/.test(profile.phone)?profile.phone:data.phone,
    name:data.name?.startsWith('Аккаунт')&&profile.firstName?`${profile.firstName}${profile.lastName?' '+profile.lastName:''}`:data.name,
    ...(proxyRotated?{proxyId:proxyRotated}:{}),
   };

   if(workerResult.ok||status==='active'){
    const okNext={...next,status:'active',cooldownUntil:'',cooldownReason:'',error:''};
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(okNext),owner,id,'account').run();
    return {
     id,ok:true,status:'active',error:'',profile,
     proxyRotated:proxyRotated||undefined,
     sessionRefreshed:!!workerResult.sessionRefreshed,
    };
   }

   const sessionDead=isSessionDeadError(status,err);
   if(sessionDead){
    // Без кручения прокси — быстрее и безопаснее
    return putAccountUnauthorized(owner,id,data,{
     lastError:err||status,
     proxyRotated:proxyRotated||undefined,
    });
   }

   if(status==='frozen'||status==='spamblock'){
    // Подтверждённый проверкой спамблок без таймера: старый истёкший cooldownUntil не должен «снять» его (REQ-M8)
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...next,cooldownUntil:'',cooldownReason:status}),owner,id,'account').run();
    return {id,ok:false,status:next.status,error:next.error,profile,proxyRotated:proxyRotated||undefined};
   }

   if(status==='proxy_error'&&currentProxyId){
    await markProxyTelegramBad(owner,currentProxyId,err||'Ошибка прокси при подключении к Telegram');
   }

   const canRotate=
    rotateProxy&&
    attempt<maxAttempts-1&&
    (status==='proxy_error'||status==='disconnected');

   if(canRotate){
    const pool=await listActiveProxyIds(owner,currentProxyId,true);
    const nextProxy=pool.find(pid=>!triedProxies.has(pid));
    if(nextProxy){
     triedProxies.add(nextProxy);
     proxyRotated=nextProxy;
     data={...data,proxyId:nextProxy};
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({
      ...data,
      status:'checking',
      checkingAt:new Date().toISOString(),
      error:`Смена прокси · попытка ${attempt+2}/${maxAttempts}…`,
     }),owner,id,'account').run();
     continue;
    }
   }

   if(rotateProxy&&(status==='proxy_error'||status==='disconnected'||status==='unauthorized')){
    return putAccountConnectFailed(owner,id,data,{
     attempts:attempt+1,
     lastError:err||status,
     proxyRotated:proxyRotated||undefined,
    });
   }

   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'account').run();
   return {id,ok:false,status:next.status,error:next.error,profile,proxyRotated:proxyRotated||undefined};
  }catch(e){
   const msg=String((e as Error).message||e);
   lastError=msg;
   lastStatus='disconnected';
   const isTimeout=/timeout|AbortError|таймаут/i.test(msg);
   const looksProxy=/proxy|socks|ECONN|connection to telegram|прокси/i.test(msg);
   const sessionish=/сессия больше не действительн|session.*(revoked|invalid)|unauthorized|authkey/i.test(msg);
   if(sessionish){
    return putAccountUnauthorized(owner,id,data,{
     lastError:msg,
     proxyRotated:proxyRotated||undefined,
    });
   }
   if(looksProxy&&currentProxyId){
    await markProxyTelegramBad(owner,currentProxyId,msg);
   }
   const looksRetryable=isTimeout||looksProxy||/fetch failed|connection/i.test(msg);

   if(rotateProxy&&looksRetryable&&attempt<maxAttempts-1){
    const pool=await listActiveProxyIds(owner,currentProxyId,true);
    const nextProxy=pool.find(pid=>!triedProxies.has(pid));
    if(nextProxy){
     triedProxies.add(nextProxy);
     proxyRotated=nextProxy;
     data={...data,proxyId:nextProxy};
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({
      ...data,
      status:'checking',
      checkingAt:new Date().toISOString(),
      error:isTimeout
       ?`Таймаут · попытка ${attempt+2}/${maxAttempts}, смена прокси…`
       :`Сеть · попытка ${attempt+2}/${maxAttempts}, смена прокси…`,
     }),owner,id,'account').run();
     continue;
    }
   }
   if(rotateProxy){
    return putAccountConnectFailed(owner,id,data,{
     attempts:attempt+1,
     lastError:msg,
     proxyRotated:proxyRotated||undefined,
    });
   }
   const failed={
    ...data,
    status:msg.includes('воркер')||msg.includes('fetch')||isTimeout?'disconnected':'unauthorized',
    error:msg.includes('ECONNREFUSED')||msg.includes('fetch failed')
     ?'Telegram-воркер недоступен. Запустите: npm run dev'
     :(isTimeout?'Таймаут проверки — смените прокси или повторите':msg.slice(0,500)),
    checkingAt:'',
    ...(proxyRotated?{proxyId:proxyRotated}:{}),
   };
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(failed),owner,id,'account').run();
   return {id,ok:false,status:failed.status,error:failed.error,proxyRotated:proxyRotated||undefined};
  }
 }

 return putAccountConnectFailed(owner,id,data,{
  attempts:maxAttempts,
  lastError:lastError||lastStatus,
  proxyRotated:proxyRotated||undefined,
 });
}

async function resolveApiKey(owner:string,config:any){
 const fromEnv=envAiApiKey();
 if(fromEnv)return fromEnv;
 if(config?.secret){
  try{return await unseal(config.secret,owner)}catch{/* */}
 }
 return '';
}

function isHardDeadAccountStatus(status:string){
 const st=String(status||'');
 return ['disconnected','unauthorized','frozen','spamblock','proxy_error'].includes(st);
}

/** Нормализация joinStateError — см. lib/processes/join-flow.sanitizeJoinStateError */

/**
 * Починить joinState групп: битый joinStateError (Zod-объект от старого бага), queued/waiting от
 * удалённой фоновой очереди и joining/scanning брошенной вкладки — иначе «Вступить» скрыт навсегда.
 */
async function healCorruptGroupJoinFields(owner:string){
 const db=database();
 const groups=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='group'").bind(owner).all();
 let fixed=0;
 const now=Date.now();
 for(const row of groups.results){
  try{
   const gdata=JSON.parse(String(row.data));
   const rawErr=gdata.joinStateError;
   const nextErr=sanitizeJoinStateError(rawErr);
   const badErr=rawErr!=null&&(typeof rawErr==='object'||String(rawErr)!==nextErr&&String(rawErr).length>500);
   const cleared=clearStaleJoinState(gdata,now);
   if(!badErr&&!cleared)continue;
   const next={...(cleared??gdata),joinStateError:nextErr};
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,String(row.id),'group').run();
   fixed++;
  }catch{/* */}
 }
 return fixed;
}

/** Нельзя использовать прямо сейчас (hard-dead или отлёжка). */
function isDeadAccountStatus(status:string,cooldownUntil?:string|null){
 return !isAccountUsable({status,cooldownUntil});
}

function groupAlreadyMember(d:any){
 return (
  d?.membership==='joined'||
  d?.membership==='pending'||
  d?.status==='pending'||
  !!d?.joinedAt
 );
}

/** Реальное членство — только membership/joinedAt. Лиды/scanLog ≠ доказательство вступления. */
function groupLooksJoined(d:any){
 return groupAlreadyMember(d);
}

function restoreJoinedMembership(d:any){
 const pending=d.membership==='pending'||d.status==='pending';
 if(pending)return d;
 return {
  ...d,
  membership:'joined' as const,
  status:d.status==='error'?'error':'active',
  joinedAt:d.joinedAt||new Date().toISOString(),
  joinedAccountId:d.joinedAccountId||d.accountId||'',
  joinState:'',
  joinStateAt:'',
  joinStateError:'',
  error:'',
 };
}

/** Живые аккаунты (не frozen/offline/отлёжка) для скана уже вступивших групп. */
async function listLiveAccountIds(owner:string){
 const db=database();
 const accRows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='account'").bind(owner).all();
 const live:{id:string;load:number}[]=[];
 const load=new Map<string,number>();
 const groups=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='group'").bind(owner).all();
 for(const r of groups.results){
  try{
   const d=JSON.parse(String(r.data));
   const aid=String(d.accountId||'');
   if(aid)load.set(aid,(load.get(aid)||0)+1);
  }catch{/* */}
 }
 for(const r of accRows.results){
  try{
   const a=JSON.parse(String(r.data));
   if(!isAccountUsable(a))continue;
   const id=String(r.id);
   live.push({id,load:load.get(id)||0});
  }catch{/* */}
 }
 live.sort((a,b)=>a.load-b.load);
 return live.map(x=>x.id);
}

async function loadProxyStates(owner:string){
 const db=database();
 const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='proxy'").bind(owner).all();
 const proxies=new Map<string,JoinProxyState>();
 for(const r of rows.results){
  try{proxies.set(String(r.id),JSON.parse(String(r.data)))}catch{/* битая запись = прокси нет */}
 }
 return proxies;
}

function proxyStateFor(adata:JoinAccountState,proxies:Map<string,JoinProxyState>){
 const pid=String(adata?.proxyId||'');
 return pid?proxies.get(pid)??null:undefined;
}

/** Правило join-готовности (join-flow) для одного аккаунта с его прокси из БД. */
async function accountJoinGate(owner:string,adata:JoinAccountState){
 return evaluateAccountJoinReadiness(adata,{proxy:proxyStateFor(adata,await loadProxyStates(owner))});
}

/**
 * Занять слот вступления аккаунта: lastJoinAt/joinsToday пишутся, только если запись не менялась
 * с чтения (сравнение data). null = параллельный запрос успел первым.
 */
async function reserveJoinSlot(owner:string,accountId:string,prevRaw:string,adata:JoinAccountState){
 const reserved={...adata,...bumpJoinCounters(adata)};
 const res=await database().prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=? AND data=?')
  .bind(JSON.stringify(reserved),owner,accountId,'account',prevRaw).run();
 return res.meta.changes?reserved:null;
}

const JOIN_SLOT_FIELDS=['lastJoinAt','joinsDay','joinsToday'] as const;
const JOIN_QUOTA_FIELDS=['joinsDay','joinsToday'] as const;

/** Вступление не потрачено (сбой, отказ до Telegram): вернуть темп и счётчик к значениям до резерва. */
async function releaseJoinSlot(owner:string,accountId:string,before:JoinAccountState){
 await restoreJoinFields(owner,accountId,before,JOIN_SLOT_FIELDS);
}

/**
 * Исходы воркера, которым предшествовал реальный JoinChannel/ImportChatInvite: темп держим,
 * а новой группы нет — дневной счётчик назад. Остальные неудачи до Telegram не доходили.
 */
const JOIN_AFTER_TELEGRAM_CALL=['already','banned','private','failed'];

/** Запрос вступления в Telegram был (темп остаётся), но группа не добавилась — дневной счётчик назад. */
async function releaseJoinQuota(owner:string,accountId:string,before:JoinAccountState){
 await restoreJoinFields(owner,accountId,before,JOIN_QUOTA_FIELDS);
}

async function restoreJoinFields(owner:string,accountId:string,before:JoinAccountState,keys:readonly (keyof JoinAccountState)[]){
 const db=database();
 const row=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,accountId,'account').first<{data:string}>();
 if(!row)return;
 const next:Record<string,unknown>=JSON.parse(String(row.data));
 for(const key of keys){
  if(before[key]===undefined)delete next[key];
  else next[key]=before[key];
 }
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,accountId,'account').run();
}

/**
 * Итог вступления в обсуждение канала: членство и peer канала не трогаем. Успех снимает флаг и
 * ошибку, чтобы следующий скан пошёл; иначе флаг остаётся, а ошибка показывается в строке группы.
 */
function discussionJoinPatch(gdata:Record<string,unknown>,result:{error?:unknown},joined:boolean){
 if(joined)return {...gdata,needDiscussionJoin:false,error:''};
 return {...gdata,needDiscussionJoin:true,error:String(result.error||'Не удалось вступить в обсуждение').slice(0,500)};
}

type JoinGateRefusal=Extract<JoinGateResult,{ok:false}>;

/** Ответ join_group, когда гейт аккаунта не пускает (отлёжка, лимит, темп, недоступен). */
async function joinGateRefusal(owner:string,gdata:{accountId:string},adata:JoinAccountState,gate:JoinGateRefusal){
 const db=database();
 const accountId=gdata.accountId;
 if(gate.reason==='cooldown'||gate.reason==='spamblock'||gate.reason==='frozen'){
  const until=String(adata.cooldownUntil||'');
  return reply({
   error:until?`Аккаунт на отлежке до ${new Date(until).toLocaleString('ru-RU')}`:'Аккаунт на отлёжке (спамблок/заморозка/лимит)',
   waitSec:until?Math.max(60,Math.ceil((Date.parse(until)-Date.now())/1000)||300):300,
   cooldown:true,
  },429);
 }
 if(gate.reason==='resolve_blind'){
  return reply({
   error:'Аккаунт группы не резолвит @username (ограничен Telegram) — дождитесь отлёжки или назначьте группе другой аккаунт',
   waitSec:gate.waitSec,
   accountBlind:true,
   cooldown:true,
  },429);
 }
 if(gate.reason==='quota'){
  const inviteLimit=Number(adata.limits?.invite??DEFAULT_ACCOUNT_LIMITS.invite);
  const cooled=applyQuotaCooldownIfExhausted(adata);
  if(cooled!==adata){
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(cooled),owner,accountId,'account').run();
  }
  return reply({error:`Дневной лимит вступлений аккаунта группы (${inviteLimit}). Завтра или назначьте группе другой аккаунт.`,limitReached:true,cooldown:cooled.status==='cooldown'},429);
 }
 if(gate.reason==='pace'){
  const wait=gate.waitSec||JOIN_GAP_DEFAULT_SEC;
  return reply({
   error:`Пауза между вступлениями: подождите ${Math.ceil(wait/60)} мин (${wait} с), чтобы не словить бан`,
   waitSec:wait,
   nextJoinAt:new Date(Date.now()+wait*1000).toISOString(),
   pace:true,
   group:gdata,
  },429);
 }
 return reply({error:gate.message,accountUnavailable:true,reason:gate.reason,group:gdata},409);
}

/** Аккаунт годится для групп, которым предстоит вступление: готов сейчас или ждёт только паузу темпа. */
async function accountCanJoinGroups(owner:string,adata:JoinAccountState|null){
 if(!adata)return false;
 return isJoinFarmCandidate(adata,{proxy:proxyStateFor(adata,await loadProxyStates(owner))});
}

function workerLooksFrozen(result:any,msg?:string){
 const text=`${result?.status||''} ${result?.join||''} ${result?.error||''} ${msg||''}`;
 return result?.status==='frozen'||result?.join==='frozen'||/FROZEN|заморожен/i.test(text);
}

/** Ответ воркера на join: упала сессия/прокси аккаунта — метим аккаунт, группу не штрафуем. */
const JOIN_ACCOUNT_FAULT_STATUSES=['unauthorized','proxy_error'];
/**
 * disconnected воркер отдаёт и на свои сбои (таймаут, abort, нет JSON, spawn) — это не диагноз
 * аккаунта: пометка вывела бы его из вступлений и скана, а падение воркера — все аккаунты сразу.
 */
const JOIN_WORKER_TRANSIENT_STATUSES=['disconnected'];

const ACCOUNT_DEAD_SCAN_ERROR='Аккаунт группы недоступен — скан пропущен. Назначьте группе другой аккаунт.';
const ACCOUNT_FROZEN_SCAN_ERROR='Аккаунт группы заморожен Telegram — скан пропущен. Назначьте группе другой аккаунт.';

function workerLooksDeadAccount(result:any){
 const st=String(result?.status||'');
 return workerLooksFrozen(result)||['unauthorized','spamblock','proxy_error'].includes(st);
}

/** Воркер сообщил, что аккаунт мёртв (заморозка/сессия/спамблок): метим его, группу не трогаем. */
async function markAccountDead(owner:string,accountId:string,patch:Record<string,unknown>){
 if(!accountId)return;
 const db=database();
 const arow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,accountId,'account').first();
 if(!arow)return;
 try{
  const adata=JSON.parse(arow.data);
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...adata,...patch}),owner,accountId,'account').run();
 }catch{/* битая запись аккаунта — нечего метить */}
}

async function appendGlobalRescanLog(owner:string,level:'info'|'ok'|'warn'|'error',text:string){
 const db=database();
 const config:any=await db.prepare('SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1').bind(owner,'settings').first();
 if(!config)return;
 try{
  const current=JSON.parse(config.data);
  const next={...current,rescanLog:pushTaskLog(current.rescanLog,level,text,120)};
  // Не через settingsSchema — чтобы не сбрасывать прочие поля при частичном апдейте
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,config.id,'settings').run();
 }catch{/* */}
}

async function notifyNewLeadsTelegram(settings:any,leads:{name:string;message:string;temperature:string;source:string}[]){
 if(!settings?.notifyEnabled||!leads.length)return {ok:false as const,skipped:true as const};
 const token=String(settings.notifyBotToken||'').trim();
 const chatId=String(settings.notifyChatId||'').trim();
 if(!token||!chatId)return {ok:false as const,error:'Нет bot token или chat id'};
 const lines=leads.slice(0,8).map((l,i)=>{
  const msg=String(l.message||'').replace(/\s+/g,' ').slice(0,180);
  return `${i+1}. [${l.temperature}] ${l.name||'Лид'} · ${l.source||''}\n${msg}`;
 });
 const text=`UniLab · новые лиды (${leads.length})\n\n${lines.join('\n\n')}`;
 return notifyTelegramText(token,chatId,text);
}

async function notifyTelegramText(token:string,chatId:string,text:string){
 try{
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({chat_id:chatId,text:text.slice(0,3500),disable_web_page_preview:true}),
   signal:AbortSignal.timeout(8000),
  });
  const data:any=await r.json().catch(()=>({}));
  if(!r.ok||!data.ok)return {ok:false as const,error:String(data.description||`HTTP ${r.status}`).slice(0,300)};
  return {ok:true as const};
 }catch(e){
  return {ok:false as const,error:String((e as Error).message||e).slice(0,300)};
 }
}

/** REQ-L6: a scanned lead the user deletes is remembered on its group, so the next scan does not re-create it. */
async function rememberDeletedLead(owner:string,leadId:string){
 const db=database();
 const row=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,leadId,'lead').first<{data:string}>();
 if(!row)return;
 let lead:{groupId?:unknown;tgMsgId?:unknown};
 try{lead=JSON.parse(String(row.data))}catch{return}
 const groupId=String(lead.groupId||'');
 const tgMsgId=String(lead.tgMsgId||'');
 if(!groupId||!tgMsgId)return;
 const grow=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,groupId,'group').first<{data:string}>();
 if(!grow)return;
 let gdata:Record<string,unknown>;
 try{gdata=JSON.parse(String(grow.data))}catch{return}
 const next={...gdata,leadTombstones:addLeadTombstone(gdata.leadTombstones,tgMsgId)};
 await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,groupId,'group').run();
}

/** Lead counters and rating of one group, recomputed from its leads after a scan. */
async function groupLeadMetrics(db:D1LikeDatabase,owner:string,groupId:string){
 const rows=await db.prepare("SELECT json_extract(data,'$.temperature') AS temperature FROM records WHERE owner=? AND kind='lead' AND json_extract(data,'$.groupId')=?").bind(owner,groupId).all();
 const counts={hot:0,warm:0,cold:0};
 for(const row of rows.results)counts[parseLeadTemperature(row.temperature||'warm')]++;
 return {
  leadsTotal:counts.hot+counts.warm+counts.cold,
  leadsHot:counts.hot,
  leadsWarm:counts.warm,
  leadsCold:counts.cold,
  rating:ratingFromTemperatures(counts),
 };
}

/** Scan of one group runs at most once at a time (cron + manual force); TTL covers worker + AI batches. */
const SCAN_LOCK_TTL_MS=10*60_000;

async function acquireGroupScanLock(owner:string,groupId:string){
 const token=crypto.randomUUID();
 const until=new Date(Date.now()+SCAN_LOCK_TTL_MS).toISOString();
 const res=await database().prepare("UPDATE records SET data=json_set(data,'$.scanLockUntil',?,'$.scanLockToken',?) WHERE owner=? AND id=? AND kind='group' AND COALESCE(json_extract(data,'$.scanLockUntil'),'')<?")
  .bind(until,token,owner,groupId,new Date().toISOString()).run();
 return res.meta.changes===1?{token,until}:null;
}

async function releaseGroupScanLock(owner:string,groupId:string,token:string){
 try{
  await database().prepare("UPDATE records SET data=json_set(data,'$.scanLockUntil','','$.scanLockToken','') WHERE owner=? AND id=? AND kind='group' AND json_extract(data,'$.scanLockToken')=?")
   .bind(owner,groupId,token).run();
 }catch(e){
  console.error('[workspace] release_scan_lock:',String((e as Error)?.message||e).slice(0,300));
 }
}

const NOTIFY_MAX_ATTEMPTS=5;
const NOTIFY_CLAIM_MS=60_000;
const NOTIFY_BATCH=20;

/**
 * REQ-L9: leads with notifyPending are claimed (so parallel scans never send one lead twice), sent in one
 * Telegram message, then marked notifiedAt; a failed send is logged and retried on the next scan.
 */
async function flushLeadNotifications(owner:string,settings:{notifyEnabled?:unknown}){
 if(!settings?.notifyEnabled)return;
 const db=database();
 const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='lead' AND json_extract(data,'$.notifyPending')=1 ORDER BY created LIMIT ?").bind(owner,NOTIFY_BATCH).all();
 const nowIso=new Date().toISOString();
 const claimUntil=new Date(Date.now()+NOTIFY_CLAIM_MS).toISOString();
 const claimed:{id:string;data:Record<string,unknown>}[]=[];
 for(const r of rows.results){
  const res=await db.prepare("UPDATE records SET data=json_set(data,'$.notifyClaimUntil',?) WHERE owner=? AND id=? AND kind='lead' AND json_extract(data,'$.notifyPending')=1 AND COALESCE(json_extract(data,'$.notifyClaimUntil'),'')<?")
   .bind(claimUntil,owner,String(r.id),nowIso).run();
  if(res.meta.changes!==1)continue;
  try{claimed.push({id:String(r.id),data:JSON.parse(String(r.data))})}catch{/* битая запись: claim истечёт */}
 }
 if(!claimed.length)return;
 const sent=await notifyNewLeadsTelegram(settings,claimed.map(c=>({
  name:String(c.data.name||''),
  message:String(c.data.message||''),
  temperature:String(c.data.temperature||''),
  source:String(c.data.source||''),
 })));
 if(sent.ok){
  for(const c of claimed){
   await db.prepare("UPDATE records SET data=json_set(data,'$.notifyPending',json('false'),'$.notifiedAt',?,'$.notifyClaimUntil','') WHERE owner=? AND id=? AND kind='lead'").bind(new Date().toISOString(),owner,c.id).run();
  }
  return;
 }
 const error='error' in sent?String(sent.error||''):'уведомления выключены';
 for(const c of claimed){
  await db.prepare("UPDATE records SET data=json_set(data,'$.notifyAttempts',COALESCE(json_extract(data,'$.notifyAttempts'),0)+1,'$.notifyClaimUntil','','$.notifyPending',CASE WHEN COALESCE(json_extract(data,'$.notifyAttempts'),0)+1>=? THEN json('false') ELSE json('true') END) WHERE owner=? AND id=? AND kind='lead'")
   .bind(NOTIFY_MAX_ATTEMPTS,owner,c.id).run();
 }
 await appendGlobalRescanLog(owner,'warn',`Уведомление о новых лидах (${claimed.length}) не отправлено: ${error.slice(0,160)} — повтор при следующем скане`);
}

async function loadNotifySettings(db:any,owner:string){
 const row:any=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='settings' LIMIT 1").bind(owner).first();
 if(!row)return null;
 try{return JSON.parse(String(row.data))}catch{return null}
}

async function notifyConversationEvent(db:any,owner:string,name:string,username:string,text:string){
 const settings=await loadNotifySettings(db,owner);
 if(!settings?.notifyEnabled)return;
 const token=String(settings.notifyBotToken||'').trim();
 const chatId=String(settings.notifyChatId||'').trim();
 if(!token||!chatId)return;
 const who=username?`@${String(username).replace(/^@/,'')}`:(name||'Клиент');
 const body=`UniLab · переписка\nКлиент ответил: ${who}\n${String(text||'').slice(0,500)}\nОткройте «Переписки» — менеджер может подключиться.`.slice(0,3500);
 try{await notifyTelegramText(token,chatId,body)}catch{/* */}
}

function normTgUser(v:unknown){
 return String(v||'').replace(/^@/,'').trim().toLowerCase();
}

function sameTelegramPeer(lead:any,msg:any){
 const ids=new Set(
  [lead?.senderId,lead?.userId,lead?.peerId,lead?.chatId]
   .map((v)=>String(v||'').replace(/^-/,'').trim())
   .filter(Boolean),
 );
 const mid=String(msg?.userId||msg?.chatId||'').replace(/^-/,'').trim();
 if(mid&&ids.has(mid))return true;
 const a=normTgUser(lead?.senderUsername||lead?.username);
 const b=normTgUser(msg?.username);
 return !!(a&&b&&a===b);
}

/**
 * Worker send job may take 120 s (worker-app.mjs timeoutForAction) after waiting for a slot; aborting kills the job,
 * so a shorter app timeout turns a slow-but-delivered reply into an «unknown» result.
 */
const SEND_MESSAGE_TIMEOUT_MS=185_000;
/** /inbox-dms: 120 s worker job + queue margin. */
const INBOX_DMS_TIMEOUT_MS=150_000;
/** One poll_dm_replies per owner; covers the worst case of up to 4 accounts × INBOX_DMS_TIMEOUT_MS. */
const DM_POLL_LEASE_MS=11*60_000;

type LiveAccount={id:string;data:Record<string,unknown>};
type InboxMessage=Record<string,unknown>;
type ConversationLead={id:string;data:LeadData};

const dmPollLeaseId=(owner:string)=>`dm-poll-lease:${owner}`;

/** Lease row lives with the AI guard rows (kind ai_guard is hidden from GET); returns the stamp to release with. */
async function acquireDmPollLease(db:D1LikeDatabase,owner:string):Promise<string|null>{
 const now=Date.now();
 const stamp=new Date(now).toISOString();
 const r=await db.prepare('INSERT INTO records(id,owner,kind,data,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created=excluded.created WHERE records.created < ?')
  .bind(dmPollLeaseId(owner),owner,'ai_guard','{}',stamp,new Date(now-DM_POLL_LEASE_MS).toISOString()).run();
 return r.meta.changes?stamp:null;
}

/** Releases only our own lease (an expired one may already belong to another poll). */
async function releaseDmPollLease(db:D1LikeDatabase,owner:string,stamp:string){
 await db.prepare('UPDATE records SET created=? WHERE id=? AND owner=? AND created=?').bind(new Date(0).toISOString(),dmPollLeaseId(owner),owner,stamp).run();
}

/** Ответ клиента берём только в переписку, которую мы уже начали с этим лидом. */
async function loadConversationLeads(db:D1LikeDatabase,owner:string){
 const leadRows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='lead'").bind(owner).all();
 const leads=leadRows.results.map(r=>{
  try{return {id:String(r.id),data:JSON.parse(String(r.data)) as LeadData}}catch{return null}
 }).filter(Boolean) as ConversationLead[];
 const match=(msg:InboxMessage):ConversationLead|null=>leads.find(L=>{
  if(!sameTelegramPeer(L.data,msg))return false;
  const d=L.data||{};
  if(d.conversationOpen)return true;
  return leadReplies(d).some(x=>x.from==='us'||x.mode==='dm');
 })??null;
 return {match};
}

/**
 * Records one incoming DM into the freshly re-read lead (CAS).
 * Returns the client name when something new was recorded (and notified), null for an already known message.
 */
async function recordIncomingDm(db:D1LikeDatabase,owner:string,accountId:string,msg:InboxMessage,leadRow:ConversationLead):Promise<string|null>{
 const text=String(msg.text||'').trim()||(msg.hasMedia?'[медиа]':'');
 if(!text)return null;
 const nowIso=new Date().toISOString();
 const incoming:ReplyEntry={
  text:text.slice(0,4000),
  mode:'dm',
  at:String(msg.at||nowIso).slice(0,40),
  ok:true,
  error:'',
  messageId:String(msg.messageId||'').slice(0,40),
  link:msg.username?`https://t.me/${String(msg.username).replace(/^@/,'')}`:'',
  chatId:String(msg.userId||'').slice(0,40),
  from:'client',
  accountId,
 };
 const ctx={accountId,userId:String(msg.userId||''),username:String(msg.username||''),nowIso};
 const done=await mutateLead(db,owner,leadRow.id,cur=>{
  const next=mergeIncomingDm(cur,incoming,ctx);
  return {next:next??undefined,result:!!next};
 });
 if(!done)return null;
 leadRow.data=done.lead;
 if(!done.result)return null;
 const name=String(done.lead.name||msg.name||msg.username||'Клиент');
 void notifyConversationEvent(db,owner,String(done.lead.name||''),String(done.lead.senderUsername||msg.username||''),incoming.text);
 return name;
}

/** REQ-18: hot leads are drafted after the response; outside a request scope (tests, scripts) the task runs detached. */
function draftAfterResponse(owner:string,leads:InsertedLead[],projects:readonly ProjectRow[],settings:Record<string,unknown>,apiKey:string){
 if(!leads.length||!apiKey)return;
 const task=async()=>{
  try{await autoDraftLeads(database(),{owner,leads,projects,settings,apiKey,nowMs:Date.now()})}
  catch(e){console.error('[workspace] auto_draft:',String((e as Error)?.message||e).slice(0,300))}
 };
 try{after(task)}catch{void task()}
}

/**
 * REQ-15/16: unmatched DMs of this pass go to one DM judge call. Its failure is counted in the funnel
 * and never blocks the pass: the inbox cursors are already advanced.
 */
async function judgeUnmatchedDms(db:D1LikeDatabase,owner:string,messages:DmMessage[]){
 if(!messages.length)return 0;
 try{
  const settings=await loadSettingsRow(db,owner);
  const apiKey=await resolveApiKey(owner,settings);
  const dm=await judgeInboxDms(db,{owner,messages,settingsId:settings.id,settings:settings.data,apiKey,nowMs:Date.now()});
  draftAfterResponse(owner,autoDraftCandidates(dm.projects,dm.inserted),dm.projects,settings.data,apiKey);
  if(dm.inserted.length){
   try{await flushLeadNotifications(owner,settings.data)}catch(e){console.error('[workspace] notify_leads:',String((e as Error)?.message||e).slice(0,300))}
  }
  return dm.inserted.length;
 }catch(e){
  console.error('[workspace] dm_judge:',String((e as Error)?.message||e).slice(0,300));
  return 0;
 }
}

/** One inbox pass over a rotating slice of live accounts (caller holds the per-owner lease). */
async function pollDmReplies(db:D1LikeDatabase,owner:string,live:LiveAccount[]){
 const {match}=await loadConversationLeads(db,owner);
 const settingsRow=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='settings' LIMIT 1").bind(owner).first<{id:string;data:string}>();
 let cursor=0;
 if(settingsRow){
  try{cursor=Math.max(0,Number(JSON.parse(String(settingsRow.data)).inboxPollCursor)||0)}catch{/* */}
 }
 const take=Math.min(4,Math.max(2,live.length));
 const slice=live.slice(cursor%live.length).concat(live.slice(0,cursor%live.length)).slice(0,take);
 const nextCursor=(cursor+slice.length)%Math.max(1,live.length);

 let opened=0;
 const names:string[]=[];
 const unmatched:DmMessage[]=[];
 for(const acc of slice){
  let result:{ok?:unknown;messages?:unknown;complete?:unknown;nextOffsetDate?:unknown;scanStartedTs?:unknown};
  try{
   const {payload}=await loadAccountSessionPayload(owner,acc.id);
   result=await workerPost('/inbox-dms',{
    ...payload,
    sinceTs:Number(acc.data.inboxSinceTs)||0,
    offsetDate:Number(acc.data.inboxPageOffset)||0,
    maxUserDialogs:30,
   },INBOX_DMS_TIMEOUT_MS);
  }catch{
   continue;
  }
  if(!result?.ok)continue;
  const msgs:InboxMessage[]=Array.isArray(result.messages)?result.messages:[];
  let persisted=true;
  let maxTs=0;
  for(const msg of msgs){
   maxTs=Math.max(maxTs,Number(msg.ts)||0);
   const leadRow=match(msg);
   if(!leadRow){
    unmatched.push(normalizeDmMessage(msg,acc.id));
    continue;
   }
   try{
    const name=await recordIncomingDm(db,owner,acc.id,msg,leadRow);
    if(name){opened++;names.push(name)}
   }catch(e){
    persisted=false;
    console.error('[workspace] poll_dm_replies:',String((e as Error)?.message||e).slice(0,300));
   }
  }
  // Курсор двигаем только по тому, что воркер реально просмотрел и мы сохранили
  if(persisted){
   const next=nextInboxCursor(acc.data,result,maxTs?maxTs-INBOX_CURSOR_MARGIN_SEC:0);
   await db.prepare("UPDATE records SET data=json_set(data,'$.inboxSinceTs',?,'$.inboxPageOffset',?,'$.inboxPageStartTs',?) WHERE owner=? AND id=? AND kind='account'")
    .bind(next.inboxSinceTs,next.inboxPageOffset,next.inboxPageStartTs,owner,acc.id).run();
  }
 }
 if(settingsRow){
  await db.prepare("UPDATE records SET data=json_set(data,'$.inboxPollCursor',?) WHERE owner=? AND id=? AND kind='settings'").bind(nextCursor,owner,String(settingsRow.id)).run();
 }
 const dmLeads=await judgeUnmatchedDms(db,owner,unmatched);
 return {ok:true,opened,names:names.slice(0,12),nextCursor,dmLeads};
}

/** A thrown send: busy worker = not sent (retry allowed); our timeout/abort = maybe sent (retry blocked). */
function sendFailureOutcome(e:unknown):{outcome:SendOutcome;httpStatus:number}{
 if(e instanceof WorkerBusyError){
  return {outcome:{status:'failed',error:'Telegram-воркер занят — повторите через минуту'},httpStatus:429};
 }
 const name=String((e as Error)?.name||'');
 if(name==='TimeoutError'||name==='AbortError'){
  console.error('[workspace] send_lead_message: worker timeout, delivery unknown');
  return {outcome:{status:'unknown',error:'Нет ответа Telegram-воркера — сообщение могло уйти. Проверьте переписку в Telegram перед повтором.'},httpStatus:504};
 }
 return {outcome:{status:'failed',error:internalError('send_lead_message',e,'Не удалось отправить сообщение. Повторите попытку.')},httpStatus:503};
}

async function ensureOwnerProject(owner:string){
 const db=database();
 const any=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='project' LIMIT 1").bind(owner).first();
 if(any)return;
 const settings=await loadSettingsRow(db,owner);
 await findOwnedProject(db,owner,defaultProjectIdOf(owner),settings.data,Date.now());
}

export async function GET(){const session=await getSessionUser();if(!session?.userId)return reply({error:'Войдите в рабочее пространство'},401);
 const actor=await readActor();
 if(!actor)return reply({error:'Войдите в рабочее пространство'},401);
 const owner=actor.ownerId;
 const workspace={ownerId:actor.ownerId,isOwner:actor.isOwner,role:actor.role,access:actor.access};
 try{
 // Снять залипшие «Проверяется», чтобы UI не блокировался
 try{await healStuckAccountChecks(owner,180_000)}catch{/* */}
 try{await healStuckProxyChecks(owner,45_000)}catch{/* */}
 try{await healCorruptGroupJoinFields(owner)}catch{/* */}
 // REQ-2: у владельца всегда есть основной проект (создаётся лениво из settings)
 try{await ensureOwnerProject(owner)}catch(e){internalError('GET default project',e,'')}
 // Только живые виды: строки удалённых функций (аудитория, инвайт, рассылка), ai_guard и scan_day не отдаём
 const result=await database().prepare(`SELECT id,kind,data,created,secret IS NOT NULL AS hasSecret FROM records WHERE owner=? AND kind IN (${READ_RECORD_KINDS.map(()=>'?').join(',')}) ORDER BY created DESC`).bind(owner,...READ_RECORD_KINDS).all();
 let telegramConnected=false;
 try{const h=await fetch(workerUrl()+'/health',{signal:AbortSignal.timeout(1500)});telegramConnected=h.ok}catch{telegramConnected=false}
 const envKey=!!envAiApiKey();
 return reply({
  records:visibleRecordsFor(actor,result.results.map((r:any)=>({
   ...r,
   data:JSON.parse(r.data),
   hasSecret:r.kind==='settings'?!!(r.hasSecret||envKey):!!r.hasSecret,
  }))),
  telegramConnected,
  ai:{provider:process.env.AI_PROVIDER||'deepseek',hasEnvKey:envKey},
  workspace,
  me:{userId:session.userId,email:session.email,name:session.displayName},
 });
}catch(e){internalError('GET',e,'');return reply({error:'Не удалось загрузить данные. Повторите попытку.'},503)}}
export async function POST(req:Request){const actor=await readActor();if(!actor)return reply({error:'Войдите в рабочее пространство'},401);const owner=actor.ownerId;const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return reply({error:'Недопустимый источник запроса'},403);try{const bodyText=await req.text();if(bodyText.length>250000)return reply({error:'Слишком большой запрос'},413);const b=JSON.parse(bodyText);
 if(!b||typeof b!=='object'||Array.isArray(b))return reply({error:'Некорректный запрос'},400);
 const authz=authorizeWorkspaceAction(actor,b.action,b.kind);
 if(!authz.ok)return reply({error:authz.error},403);
 const db=database();
 if(b.action==='draft'){
  const id=z.string().uuid().parse(b.id);
  const requestedKind=b.kind===undefined||b.kind===null?null:z.enum(DRAFT_KINDS).parse(b.kind);
  const row=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'lead').first<{data:string}>();
  if(!row)return reply({error:'Лид не найден'},404);
  const settings=await loadSettingsRow(db,owner);
  const apiKey=await resolveApiKey(owner,settings);
  if(!apiKey)return reply({error:'DeepSeek не настроен: добавьте AI_API_KEY в .env и перезапустите сервер'},409);
  const lead=JSON.parse(String(row.data));
  const now=new Date();
  const project=await findOwnedProject(db,owner,projectIdOf(lead,owner),settings.data,now.getTime());
  if(!project)return reply({error:'Проект лида не найден — перенесите лид в проект'},404);
  const guard=await db.prepare('INSERT INTO records(id,owner,kind,data,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created=excluded.created WHERE records.created < ?').bind('ai-guard:'+owner,owner,'ai_guard','{}',now.toISOString(),new Date(now.getTime()-60000).toISOString()).run();
  if(!guard.meta.changes)return reply({error:'Можно готовить один ответ в минуту. Подождите и повторите запрос.'},429);
  if(!(await reserveDailyCap(db,owner,'draft-day',dailyCapOf(settings.data,'draft-day'),1,now.getTime()))){
   return reply({error:'Дневной лимит черновиков AI исчерпан — завтра или увеличьте лимит в настройках',limitReached:true},429);
  }
  const kind=requestedKind??autoDraftKind(lead);
  try{
   const draft=await generateDraft(kind,project.project,draftLeadOf(lead),draftLlm(apiKey));
   // Ручной черновик — без draftKind: он идёт в «Переписки», а не в очередь авто-черновиков (REQ-20)
   const done=await mutateLead(db,owner,id,cur=>String(cur.message??'')!==String(lead.message??'')
    ?{result:false}
    :{next:{...withoutDraft(cur),draft},result:true});
   if(!done?.result)return reply({error:'Сообщение изменено или лид удалён во время подготовки. Откройте актуальную карточку.'},409);
   return reply({ok:true,draft,kind,model:resolveAiConfig().model});
  }catch(e){
   return reply({error:internalError('draft',e,'AI не смог подготовить черновик. Повторите попытку позже.')},502);
  }
 }
 if(b.action==='dismiss_draft'){
  const id=z.string().uuid().parse(b.id);
  const done=await mutateLead(db,owner,id,cur=>({next:withoutDraft(cur),result:null}));
  if(!done)return reply({error:'Лид не найден'},404);
  return reply({ok:true,lead:done.lead});
 }
 if(b.action==='check_proxy'){
  await healStuckProxyChecks(owner,45_000);
  const id=z.string().uuid().parse(b.id);
  return reply({ok:true,result:await runProxyCheck(owner,id)});
 }
 if(b.action==='check_proxies'){
  await healStuckProxyChecks(owner,0);
  const mode=z.enum(['all','inactive']).default('all').parse(b.mode??'all');
  const concurrency=Math.min(10,Math.max(1,z.coerce.number().int().default(8).parse(b.concurrency??8)));
  const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='proxy' ORDER BY created DESC").bind(owner).all();
  const ids=rows.results
   .map((r:any)=>({id:r.id as string,data:JSON.parse(r.data as string)}))
   .filter((r:{id:string;data:any})=>mode==='all'||r.data.status!=='active')
   .map(r=>r.id)
   .slice(0,100);
  const results:Awaited<ReturnType<typeof runProxyCheck>>[]=[];
  for(let i=0;i<ids.length;i+=concurrency){
   const batch=ids.slice(i,i+concurrency);
   const part=await Promise.all(batch.map(id=>runProxyCheck(owner,id,batch.length)));
   results.push(...part);
  }
  const active=results.filter(r=>r.ok).length;
  return reply({ok:true,checked:results.length,active,inactive:results.length-active,results});
 }
 if(b.action==='check_account'){
  await healStuckAccountChecks(owner,180_000);
  const id=z.string().uuid().parse(b.id);
  const deep=b.deep===true||b.checkRestrictions===true;
  return reply({ok:true,result:await runAccountCheck(owner,id,{
   checkRestrictions:deep,
   ensureUsername:b.ensureUsername!==false,
   forceUsername:b.forceUsername===true,
   rotateProxy:b.rotateProxy!==false,
  })});
 }
 if(b.action==='check_accounts'){
  await healStuckAccountChecks(owner,0);
  const mode=z.enum(['all','problem']).default('all').parse(b.mode??'all');
  const concurrency=Math.min(5,Math.max(1,z.coerce.number().int().default(ACCOUNT_CHECK_CONCURRENCY).parse(b.concurrency??ACCOUNT_CHECK_CONCURRENCY)));
  const rows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='account' ORDER BY created DESC").bind(owner).all();
  const ids=rows.results
   .map((r:any)=>({id:r.id as string,data:JSON.parse(r.data as string)}))
   .filter((r:{id:string;data:any})=>mode==='all'||r.data.status!=='active')
   .map(r=>r.id)
   .slice(0,40);
  const results:Awaited<ReturnType<typeof runAccountCheck>>[]=[];
  for(let i=0;i<ids.length;i+=concurrency){
   const batch=ids.slice(i,i+concurrency);
   const part=await Promise.all(batch.map(id=>runAccountCheck(owner,id,{checkRestrictions:false,ensureUsername:b.ensureUsername!==false,forceUsername:b.forceUsername===true,rotateProxy:true})));
   results.push(...part);
  }
  const active=results.filter(r=>r.status==='active').length;
  return reply({ok:true,checked:results.length,active,results});
 }
 if(b.action==='reset_checking_accounts'){
  const fixedAcc=await healStuckAccountChecks(owner,0);
  const fixedProxy=await healStuckProxyChecks(owner,0);
  return reply({ok:true,fixed:fixedAcc+fixedProxy,accounts:fixedAcc,proxies:fixedProxy});
 }
 if(b.action==='generate_account_about'){
  const settings=await loadSettingsRow(db,owner);
  return replyResult(await generateAccountAbout({db,owner,nowMs:Date.now()},b,await resolveApiKey(owner,settings)));
 }
 if(b.action==='apply_account_profiles'){
  const ids=z.array(z.string().uuid()).min(1).max(50).parse(b.ids);
  const about=z.string().max(70).optional().parse(b.about);
  const firstName=z.string().max(64).optional().parse(b.firstName);
  const lastName=z.string().max(64).optional().parse(b.lastName);
  const pushToTelegram=b.pushToTelegram!==false;
  if(about==null&&firstName==null&&lastName==null)return reply({error:'Укажите about и/или имя'},400);
  const results:any[]=[];
  for(const id of ids){
   const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'account').first();
   if(!row){results.push({id,ok:false,error:'Не найден'});continue}
   const data=JSON.parse(row.data);
   const next={
    ...data,
    ...(about!=null?{about}:{}),
    ...(firstName!=null?{firstName}:{}),
    ...(lastName!=null?{lastName}:{}),
   };
   let tgOk=true;
   let tgError='';
   if(pushToTelegram){
    if(!row.secret){
     tgOk=false;tgError='Нет сессии';
    }else{
     try{
      const {payload}=await loadAccountSessionPayload(owner,id);
      const wr=await workerPost('/update-profile',{
       ...payload,
       ...(about!=null?{about}:{}),
       ...(firstName!=null?{firstName}:{}),
       ...(lastName!=null?{lastName}:{}),
      },45_000);
      tgOk=!!wr.ok;
      tgError=wr.error||'';
      if(wr.profile){
       next.firstName=wr.profile.firstName??next.firstName;
       next.lastName=wr.profile.lastName??next.lastName;
       if(about!=null)next.about=about;
      }
      if(wr.status==='frozen')next.status='frozen';
     }catch(e){
      tgOk=false;
      tgError=internalError('apply_account_profiles',e,'Не удалось обновить профиль в Telegram');
     }
    }
   }
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'account').run();
   results.push({id,ok:tgOk||!pushToTelegram,tgOk,error:tgError,about:next.about,firstName:next.firstName,lastName:next.lastName});
   if(pushToTelegram)await new Promise(r=>setTimeout(r,1200));
  }
  return reply({ok:true,updated:results.filter(r=>r.ok).length,results});
 }
 if(b.action==='upload_account_photos'){
  const ids=z.array(z.string().uuid()).min(1).max(50).parse(b.ids);
  const photoBase64=z.string().min(100).max(7_000_000).parse(b.photoBase64);
  const results:any[]=[];
  for(const id of ids){
   const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'account').first();
   if(!row){results.push({id,ok:false,error:'Не найден'});continue}
   if(!row.secret){results.push({id,ok:false,error:'Нет сессии'});continue}
   const data=JSON.parse(row.data);
   try{
    const {payload}=await loadAccountSessionPayload(owner,id);
    const wr=await workerPost('/upload-photo',{...payload,photoBase64});
    if(wr.ok){
     const next={...data,hasPhoto:true};
     if(wr.status==='frozen')next.status='frozen';
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'account').run();
     results.push({id,ok:true});
    }else{
     if(wr.status==='frozen'){
      await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...data,status:'frozen'}),owner,id,'account').run();
     }
     results.push({id,ok:false,error:wr.error||'Ошибка фото'});
    }
   }catch(e){
    results.push({id,ok:false,error:internalError('upload_account_photos',e,'Не удалось загрузить фото')});
   }
   await new Promise(r=>setTimeout(r,1500));
  }
  return reply({ok:true,updated:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,results});
 }
 if(b.action==='join_group'){
  const id=z.string().uuid().parse(b.id);
  const grow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'group').first();
  if(!grow)return reply({error:'Группа не найдена'},404);
  const gdata=JSON.parse(grow.data);
  if(!gdata.accountId)return reply({error:'Назначьте аккаунт группе'},400);
  if(isCatalogPlaceholderUrl(gdata.url||'')){
   const next={...gdata,status:'setup',error:'Нужна реальная ссылка t.me/… или инвайт (это шаблон каталога)'};
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'group').run();
   return reply({error:next.error,needUrl:true},400);
  }
  // discussion: вступление в привязанное обсуждение уже вступленного канала — тот же гейт, один join
  const target=z.enum(['group','discussion']).default('group').parse(b.target);
  const alreadyIn=groupLooksJoined(gdata);
  if(target==='discussion'&&(!alreadyIn||gdata.membership==='pending'||gdata.status==='pending')){
   return reply({error:'Сначала вступите в канал — кнопка «Вступить»',needJoin:true,group:gdata},409);
  }
  const needsPeerRefresh=alreadyIn&&!(String(gdata.channelId||'')&&String(gdata.accessHash||''));
  if(target==='group'&&alreadyIn&&!needsPeerRefresh){
   const next=gdata.membership==='pending'||gdata.status==='pending'?gdata:restoreJoinedMembership(gdata);
   if(next!==gdata){
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'group').run();
   }
   return reply({ok:true,result:{ok:true,join:next.membership==='pending'?'requested':'already'},group:next,skipped:true});
  }
  // Вступает только назначенный группе аккаунт: недоступен — ошибка, другой не подставляем.
  const arow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,gdata.accountId,'account').first();
  if(!arow)return reply({error:'Аккаунт группы не найден — назначьте группе другой аккаунт'},404);
  let adata=JSON.parse(arow.data);
  let gate=await accountJoinGate(owner,adata);
  if(!gate.ok)return await joinGateRefusal(owner,gdata,adata,gate);
  // Слот темпа и дневной счётчик занимаем до воркера условным UPDATE: параллельный клик по
  // другой группе того же аккаунта проигрывает сравнение data и получает паузу темпа.
  let reserved=await reserveJoinSlot(owner,gdata.accountId,String(arow.data),adata);
  if(!reserved){
   // Запись аккаунта могла смениться не из-за вступления (проверка, прокси, имя): одно перечтение и повтор
   const fresh=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,gdata.accountId,'account').first<{data:string}>();
   if(!fresh)return reply({error:'Аккаунт группы не найден — назначьте группе другой аккаунт'},404);
   adata=JSON.parse(fresh.data);
   gate=await accountJoinGate(owner,adata);
   if(!gate.ok)return await joinGateRefusal(owner,gdata,adata,gate);
   reserved=await reserveJoinSlot(owner,gdata.accountId,fresh.data,adata);
  }
  if(!reserved){
   return reply({
    error:`Аккаунт группы уже вступает в другую группу — подождите ${Math.ceil(JOIN_GAP_DEFAULT_SEC/60)} мин`,
    waitSec:JOIN_GAP_DEFAULT_SEC,
    nextJoinAt:new Date(Date.now()+JOIN_GAP_DEFAULT_SEC*1000).toISOString(),
    pace:true,
    group:gdata,
   },429);
  }
  try{
   const {payload}=await loadAccountSessionPayload(owner,gdata.accountId);
   const result=await workerPost('/join-group',{...payload,url:gdata.url,...(target==='discussion'?{target}:{})});
   const frozen=result.status==='frozen'||result.join==='frozen'||/FROZEN|заморожен/i.test(String(result.error||''));
   const flood=result.join==='flood'||/FloodWait/i.test(String(result.error||''));
   // Слеп аккаунт, а не группа — попытку группе не засчитываем (иначе живые группы уходят в отказ)
   const accountBlind=isAccountBlindResult(result);
   // Сессия/прокси/коннект упали — вина аккаунта, не группы (frozen обрабатывается ниже)
   const accountFault=!frozen&&!result.ok&&JOIN_ACCOUNT_FAULT_STATUSES.includes(String(result.status||''));
   const workerTransient=!frozen&&!result.ok&&JOIN_WORKER_TRANSIENT_STATUSES.includes(String(result.status||''));
   const joinedOk=!!result.ok||result.join==='already'||result.join==='requested';
   // «already» не добавляет группу — дневной лимит не тратит; паузу держит: по инвайту
   // (и при UserAlreadyParticipant) ему предшествовал реальный запрос вступления в Telegram
   const spentJoin=joinedOk&&result.join!=='already';
   const reallyJoined=result.join==='already'||(!!result.ok&&result.join!=='requested'&&result.join!=='flood'&&result.join!=='missing'&&result.join!=='frozen');
   const status=result.join==='requested'?'pending':reallyJoined?'active':frozen?'error':'error';
   const next=target==='discussion'?discussionJoinPatch(gdata,result,reallyJoined):{
    ...gdata,
    status,
    error:(result.error||'').slice(0,500),
    joinedAt:reallyJoined?(gdata.joinedAt||new Date().toISOString()):(gdata.joinedAt||''),
    membership:result.join==='requested'?'pending':reallyJoined?'joined':(gdata.membership||'none'),
    joinedAccountId:reallyJoined||result.join==='requested'?(gdata.accountId||gdata.joinedAccountId||''):(gdata.joinedAccountId||''),
    channelId:String(result.channelId||gdata.channelId||'').slice(0,40),
    accessHash:String(result.accessHash||(reallyJoined?result.accessHash:'')||gdata.accessHash||'').slice(0,40),
    joinState:'',
    joinStateAt:'',
    joinStateError:reallyJoined||result.join==='requested'?'':(result.error||'Не удалось вступить').slice(0,500),
    // FloodWait — проблема аккаунта, не группы: попытку не считаем
    ...(joinedOk?JOIN_SUCCESS_PATCH:flood||accountBlind||accountFault?{}:workerTransient?{joinNextAt:new Date(Date.now()+JOIN_WORKER_ERROR_RETRY_MS).toISOString()}:joinFailurePatch(gdata)),
    name:result.title&&(!gdata.name||gdata.name.startsWith('http')||gdata.name==='Группа')?result.title:gdata.name,
   };
   // accessHash только от фактического join/already этой сессии
   if(target==='group'&&result.channelId)next.channelId=String(result.channelId).slice(0,40);
   if(target==='group'&&result.accessHash&&(reallyJoined||result.join==='already'||result.join==='requested')){
    next.accessHash=String(result.accessHash).slice(0,40);
   }
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'group').run();
   if(spentJoin){
    // Счётчик уже поднят резервом; осталось уйти в отлёжку, если это вступление исчерпало лимит
    const cooled=applyQuotaCooldownIfExhausted(reserved,'invite');
    if(cooled!==reserved){
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(cooled),owner,gdata.accountId,'account').run();
    }
   }else if(JOIN_AFTER_TELEGRAM_CALL.includes(String(result.join||''))){
    await releaseJoinQuota(owner,gdata.accountId,adata);
   }else{
    await releaseJoinSlot(owner,gdata.accountId,adata);
   }
   if(flood){
    const m=/FloodWait\s+(\d+)/i.exec(String(result.error||''));
    const sec=Math.max(60,Number(result.waitSec)||Number(result.floodWait)||(m?Number(m[1]):0)||900);
    // FloodWait — пауза темпа на весь срок Telegram (joinFloodUntil), без статуса «Отлежка».
    const paced={
     ...adata,
     lastJoinAt:new Date().toISOString(),
     joinFloodUntil:new Date(Date.now()+sec*1000).toISOString(),
     error:(result.error||'').slice(0,500),
    };
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(paced),owner,gdata.accountId,'account').run();
    return reply({ok:false,result,error:result.error,waitSec:sec,flood:true,pace:true},429);
   }
   if(accountFault){
    const errMsg=String(result.error||'Аккаунт недоступен');
    if(String(result.status)==='unauthorized'){
     await putAccountUnauthorized(owner,gdata.accountId,adata,{lastError:errMsg});
    }else{
     await putAccountConnectFailed(owner,gdata.accountId,adata,{attempts:1,lastError:errMsg,status:'proxy_error'});
    }
   }
   if(accountBlind){
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...adata,...accountBlindPatch(),error:String(result.error||'').slice(0,500)}),owner,gdata.accountId,'account').run();
    try{await appendGlobalRescanLog(owner,'warn',`Аккаунт ${String(gdata.accountId).slice(0,8)} слеп на ResolveUsername${result.sessionRefreshed?' (новая сессия)':''} — отлёжка 6 ч`)}catch{/* */}
   }
   if(frozen){
    const cooled=withFrozenStatus(adata,result.error||'Аккаунт заморожен Telegram');
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(cooled),owner,gdata.accountId,'account').run();
    return reply({ok:false,accountFrozen:true,result:{...result,status:'error'},group:next,error:'Аккаунт группы заморожен Telegram — назначьте группе другой аккаунт'},409);
   }
   return reply({ok:reallyJoined||result.join==='requested',result:{...result,status,membership:next.membership,joinedAt:next.joinedAt},group:next,accountFrozen:false,joinGapSec:JOIN_GAP_DEFAULT_SEC});
  }catch(e){
   const msg=String((e as Error).message||e);
   const frozen=workerLooksFrozen(null,msg);
   const next={...gdata,status:'error',error:msg.slice(0,500),joinState:'',joinStateAt:'',joinStateError:msg.slice(0,500),joinNextAt:new Date(Date.now()+JOIN_WORKER_ERROR_RETRY_MS).toISOString()};
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'group').run();
   // Таймаут/сеть: воркер мог успеть вступить — резерв остаётся. Возвращаем только при отказе до Telegram.
   const neverReachedTelegram=e instanceof UserFacingError||e instanceof WorkerBusyError;
   if(neverReachedTelegram)await releaseJoinSlot(owner,gdata.accountId,adata);
   else if(!frozen){
    const cooled=applyQuotaCooldownIfExhausted(reserved);
    if(cooled!==reserved){
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(cooled),owner,gdata.accountId,'account').run();
    }
   }
   if(frozen){
    const base=neverReachedTelegram?adata:reserved;
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify({...base,status:'frozen',error:msg.slice(0,500)}),owner,gdata.accountId,'account').run();
   }
   return reply({error:next.error,accountFrozen:frozen},frozen?400:503);
  }
 }
 if(b.action==='scan_group'){
  const id=z.string().uuid().parse(b.id);
  const force=b.force===true;
  const grow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'group').first();
  if(!grow)return reply({error:'Группа не найдена'},404);
  let gdata=JSON.parse(grow.data);
  if(!gdata.accountId)return reply({error:'Назначьте аккаунт группе'},400);
  if(isCatalogPlaceholderUrl(gdata.url||''))return reply({error:'Нужна реальная ссылка t.me/… или инвайт (это шаблон каталога)',needUrl:true},400);
  // Сканирует только назначенный аккаунт: отлёжка — позже, мёртвый — ошибка без подмены.
  {
   const arow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,gdata.accountId,'account').first();
   const adata=arow?JSON.parse(arow.data):null;
   if(!adata){
    return reply({error:'Аккаунт группы не найден',accountDead:true},400);
   }
   const st=String(adata.status||'');
   const gate=evaluateScanGate(adata);
   if(!gate.ok&&gate.reason==='cooldown'){
    return reply({
     ok:false,
     skipped:true,
     accountCooldown:true,
     waitSec:gate.waitSec,
     error:'Аккаунт группы на отлёжке — скан позже',
     group:gdata,
    },429);
   }
   // Просроченный cooldown в статусе — снимаем, чтобы скан шёл
   if(st==='cooldown'&&!isOnCooldown(adata.cooldownUntil)){
    const healedAcc={...adata,status:'active',cooldownUntil:'',error:''};
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(healedAcc),owner,gdata.accountId,'account').run();
   }
   if(isHardDeadAccountStatus(st)){
    return reply({error:ACCOUNT_DEAD_SCAN_ERROR,accountDead:true,preserved:true,group:gdata},409);
   }
  }
  const settingsRow=await loadSettingsRow(db,owner);
  const settings=settingsRow.data;
  const rescanMinutes=Math.max(5,Math.min(180,Number(settings.autoRescanMinutes)||30));
  if(!force&&gdata.lastScanned){
   const last=Date.parse(gdata.lastScanned);
   if(Number.isFinite(last)){
    const elapsedSec=Math.floor((Date.now()-last)/1000);
    const needSec=rescanMinutes*60;
    if(elapsedSec<needSec){
     return reply({
      ok:true,
      skipped:true,
      waitSec:needSec-elapsedSec,
      rescanMinutes,
      scanned:0,
      matched:0,
      added:0,
      message:`Скан не чаще 1 раза в ${rescanMinutes} мин. Через ${Math.ceil((needSec-elapsedSec)/60)} мин.`,
     });
    }
   }
  }
  // Проект группы (REQ-2/3): без projectId или с удалённым проектом группа читается как основной проект
  const project=await findOwnedProject(db,owner,projectIdOf(gdata,owner),settings,Date.now())
   ??await findOwnedProject(db,owner,defaultProjectIdOf(owner),settings,Date.now());
  if(!project)return reply({error:'Проект группы не найден'},404);
  if(!project.project.active){
   return reply({ok:true,skipped:true,projectInactive:true,scanned:0,matched:0,added:0,message:'Проект группы выключен — скан пропущен'});
  }
  const lock=await acquireGroupScanLock(owner,id);
  if(!lock)return reply({ok:true,skipped:true,locked:true,scanned:0,matched:0,added:0,message:'Скан этой группы уже идёт'});
  gdata={...gdata,scanLockUntil:lock.until,scanLockToken:lock.token};
  try{
  try{
   const {payload}=await loadAccountSessionPayload(owner,gdata.accountId);
   // REQ-5: воркер отдаёт сырые сообщения с курсора; отбор — только фильтры и судья проекта
   const result=await workerPost('/scan-group',{...payload,url:gdata.url,days:project.project.scanDepthDays,minId:String(gdata.scanCursor||'')});
    if(!result.ok){
    if(workerLooksDeadAccount(result)){
     const frozen=workerLooksFrozen(result);
     const errText=String(result.error||'Аккаунт недоступен').slice(0,500);
     await markAccountDead(owner,gdata.accountId,{status:frozen?'frozen':String(result.status||'unauthorized'),error:errText});
     try{await appendGlobalRescanLog(owner,'error',`${gdata.name||'Группа'}: аккаунт группы недоступен (${errText.slice(0,120)})`)}catch{/* */}
     return reply({ok:false,accountDead:true,accountFrozen:frozen,group:gdata,error:frozen?ACCOUNT_FROZEN_SCAN_ERROR:ACCOUNT_DEAD_SCAN_ERROR},409);
    }
    // Аккаунт группы не открывает ссылку — ошибка группы; другой аккаунт не подставляем.
    const usernameMissing=!!result.usernameMissing||result.join==='missing'||/не видит @|no user has|nobody is using|username_not_occupied/i.test(String(result.error||''));
    if(usernameMissing){
     const deadUrl={
      ...gdata,
      status:'error',
      usernameMissing:true,
      error:String(result.error||'Ссылка группы не открывается').slice(0,500),
      // Не пишем lastScanned — иначе группа выпадает из auto-rescan на весь интервал
      joinState:'',
      joinStateError:sanitizeJoinStateError(String(result.error||'')),
     };
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(deadUrl),owner,id,'group').run();
     try{await appendGlobalRescanLog(owner,'error',`${gdata.name||'Группа'}: ${String(result.error||'ссылка не открывается').slice(0,160)}`)}catch{/* */}
     return reply({
      ok:false,
      skipped:true,
      usernameMissing:true,
      error:deadUrl.error,
      group:deadUrl,
     },422);
    }
    // Скан без членства: не сбрасываем свежие/подтверждённые вступления —
    // после join Telegram часто лажит (CheckChatInvite / GetParticipant),
    // а wipe → heal/UI снова ставят группу в очередь по кругу.
    if(result.join==='need_join'||/вступ/i.test(String(result.error||''))){
     const errMsg=String(result.error||'Сначала вступите в группу').slice(0,500);
     const joinedAtMs=Date.parse(String(gdata.joinedAt||''));
     const recentlyJoined=Number.isFinite(joinedAtMs)&&Date.now()-joinedAtMs<45*60_000;
     const discussionOnly=!!result.needDiscussionJoin;

     if(discussionOnly||recentlyJoined){
      // Мягкий отказ только при свежем join или linked discussion — не по лидам/scanLog
      const soft={
       ...gdata,
       ...(discussionOnly?{needDiscussionJoin:true}:{}),
       joinState:'',
       joinStateAt:'',
       joinStateError:'',
       error:discussionOnly
        ?errMsg
        :'Скан чуть позже — Telegram ещё подтверждает членство',
      };
      await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(soft),owner,id,'group').run();
      return reply({
       error:soft.error||errMsg,
       needJoin:true,
       soft:true,
       preserved:true,
       needDiscussionJoin:discussionOnly,
       group:soft,
      },409);
     }

     // Членство потеряно: вступить заново владелец может только вручную (кнопка «Вступить»).
     const healed={
      ...gdata,
      status:'setup',
      membership:'none',
      needDiscussionJoin:false,
      joinedAt:'',
      error:errMsg,
      lastScanned:'',
      joinState:'',
      joinStateAt:'',
      joinStateError:sanitizeJoinStateError(errMsg),
     };
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(healed),owner,id,'group').run();
     return reply({
      error:errMsg,
      needJoin:true,
      restaleMembership:true,
      group:healed,
     },409);
    }
    return reply({error:result.error||'Скан не удался'},502);
   }
   const nowMs=Date.now();
   const apiKey=await resolveApiKey(owner,settingsRow);
   const {scan,inserted}=await scanGroupLeads(db,{
    owner,groupId:id,group:gdata,source:String(result.title||gdata.name||gdata.url||''),
    worker:result,project,settings,apiKey,nowMs,
   });
   const counts=scan.delta.counts;
   const addedByTemp={hot:0,warm:0};
   for(const l of inserted)addedByTemp[l.lead.temperature]++;
   draftAfterResponse(owner,autoDraftCandidates([project],inserted),[project],settings,apiKey);
   try{await flushLeadNotifications(owner,settings)}catch(e){console.error('[workspace] notify_leads:',String((e as Error)?.message||e).slice(0,300))}
   const metrics=await groupLeadMetrics(db,owner,id);
   // Успешный скан только если аккаунт в группе → чиним membership/status
   // База — свежая запись: удаления лидов (tombstones) и правки группы во время скана не теряем
   const freshGroup=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'group').first<{data:string}>();
   let base=gdata;
   try{if(freshGroup)base={...JSON.parse(String(freshGroup.data)),scanLockUntil:gdata.scanLockUntil,scanLockToken:gdata.scanLockToken}}catch{/* битая запись — берём снимок */}
   const isPending=gdata.status==='pending'||gdata.membership==='pending';
   const lastScanned=new Date(nowMs).toISOString();
   const groupNext={
    ...base,
    status:isPending?'pending':'active',
    membership:isPending?'pending':'joined',
    joinedAt:isPending?(gdata.joinedAt||''):(gdata.joinedAt||lastScanned),
    joinedAccountId:gdata.joinedAccountId||gdata.accountId||'',
    error:'',
    needDiscussionJoin:false,
    joinState:'',
    joinStateAt:'',
    joinStateError:'',
    name:result.title&&(!gdata.name||gdata.name.startsWith('http')||gdata.name==='Группа')?result.title:gdata.name,
    ...metrics,
    scanMatched:counts.judged,
    lastScanned,
    // REQ-10: при сбое/пропуске судьи курсор откатывается к первому несуждённому сообщению
    scanCursor:scan.nextCursor,
    aiRejected:scan.aiRejected,
    scanLog:pushTaskLog(base.scanLog,inserted.length?'ok':scan.judgeError?'warn':'info',`Переобход · ${scan.delta.run}`,50),
   };
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(groupNext),owner,id,'group').run();
   await appendGlobalRescanLog(owner,inserted.length?'ok':scan.judgeError?'warn':'info',scan.delta.run);
   return reply({
    ok:true,
    scanned:counts.returned,
    fetched:counts.fetched,
    judged:counts.judged,
    matched:counts.judged,
    added:inserted.length,
    addedByTemp,
    projectId:project.id,
    funnel:counts,
    judgeError:scan.judgeError?'AI-судья не ответил — сообщения проверятся при следующем скане':'',
    title:result.title||gdata.name,
    metrics:{...metrics,lastScanned},
    taskLog:groupNext.scanLog,
   });
  }catch(e){
   const errMsg=String((e as Error).message||e).slice(0,500);
   if(workerLooksFrozen(null,errMsg)){
    await markAccountDead(owner,gdata.accountId,{status:'frozen',error:errMsg});
    try{await appendGlobalRescanLog(owner,'error',`${gdata.name||'Группа'}: аккаунт группы заморожен`)}catch{/* */}
    return reply({error:ACCOUNT_FROZEN_SCAN_ERROR,accountFrozen:true,accountDead:true,group:gdata},409);
   }
   try{
    const failNext={
     ...gdata,
     scanLog:pushTaskLog(gdata.scanLog,'error',`Ошибка переобхода: ${errMsg.slice(0,200)}`,50),
    };
    await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(failNext),owner,id,'group').run();
    await appendGlobalRescanLog(owner,'error',`${gdata.name||'Группа'}: ${errMsg.slice(0,160)}`);
   }catch{/* */}
   return reply({error:errMsg},503);
  }
  }finally{
   await releaseGroupScanLock(owner,id,lock.token);
  }
 }
 if(b.action==='mark_lead_viewed'){
  const id=z.string().uuid().parse(b.id);
  const nowIso=new Date().toISOString();
  const done=await mutateLead(db,owner,id,lead=>{
   const patch=markLeadOpened(lead,nowIso);
   return {next:patch?{...lead,...patch}:undefined,result:!patch};
  });
  if(!done)return reply({error:'Лид не найден'},404);
  return done.result?reply({ok:true,already:true}):reply({ok:true,lead:done.lead});
 }
 if(b.action==='set_lead_training_exclude'){
  const id=z.string().uuid().parse(b.id);
  const exclude=z.boolean().parse(b.exclude??true);
  const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'lead').first();
  if(!row)return reply({error:'Лид не найден'},404);
  const data=JSON.parse(row.data);
  const next={
   ...data,
   excludeFromTraining:exclude,
   ...(exclude&&!data.viewed?{viewed:true,viewedAt:new Date().toISOString()}:{}),
  };
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'lead').run();
  return reply({ok:true,lead:next});
 }
 if(b.action==='bulk_set_lead_training_exclude'){
  const ids=z.array(z.string().uuid()).min(1).max(200).parse(b.ids);
  const exclude=z.boolean().parse(b.exclude??true);
  let updated=0;
  const now=new Date().toISOString();
  for(const id of ids){
   const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'lead').first();
   if(!row)continue;
   const data=JSON.parse(row.data);
   const next={
    ...data,
    excludeFromTraining:exclude,
    ...(exclude&&!data.viewed?{viewed:true,viewedAt:now}:{}),
   };
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'lead').run();
   updated++;
  }
  return reply({ok:true,updated,exclude});
 }
 if(b.action==='rebuild_product'){
  const settings=await loadSettingsRow(db,owner);
  return replyRedacted(actor,await rebuildProduct({db,owner,nowMs:Date.now()},b,await resolveApiKey(owner,settings)));
 }
 if(b.action==='project_create')return replyRedacted(actor,await createProject({db,owner,nowMs:Date.now()},b));
 if(b.action==='project_update'&&!canSeeLeadText(actor)&&b.patch&&typeof b.patch==='object'&&('goodExamples' in b.patch||'badExamples' in b.patch)){
  return reply({error:'Примеры лидов меняет только раздел «Лиды»'},403);
 }
 if(b.action==='project_update')return replyRedacted(actor,await updateProject({db,owner,nowMs:Date.now()},b));
 if(b.action==='project_delete')return replyResult(await deleteProject({db,owner,nowMs:Date.now()},b));
 if(b.action==='set_group_project')return replyResult(await setGroupProject({db,owner,nowMs:Date.now()},b));
 if(b.action==='funnel')return replyRedacted(actor,await projectFunnel({db,owner,nowMs:Date.now()},b));
 if(b.action==='lead_feedback')return replyResult(await leadFeedback({db,owner,nowMs:Date.now()},b));
 if(b.action==='send_lead_message'){
  const id=z.string().uuid().parse(b.id);
  const mode=z.enum(['dm','chat']).parse(b.mode||'dm');
  const text=z.string().trim().min(1).max(4000).parse(b.text);
  const clientMsgId=z.string().trim().max(80).optional().parse(b.clientMsgId)||'';
  const force=b.force===true;
  const silent=b.silent===true;
  const row:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'lead').first();
  if(!row)return reply({error:'Лид не найден'},404);
  const lead=JSON.parse(row.data);
  if(mode==='dm'&&!lead.senderId&&!lead.senderUsername){
   return reply({error:'Нет Telegram id/username клиента — нельзя писать в личку'},400);
  }
  let gdata:any={url:'',accountId:String(lead.accountId||'')};
  if(lead.groupId){
   const grow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,lead.groupId,'group').first();
   if(grow){
    const parsed=JSON.parse(grow.data);
    gdata={...parsed,accountId:String(lead.accountId||parsed.accountId||'')};
   }
  }
  if(mode==='chat'&&!gdata.url)return reply({error:'У лида нет привязки к группе — ответ в чат недоступен'},400);
  // Пишем только с аккаунта лида (или его группы): недоступен — ошибка, другой не подставляем.
  const sendAccountId=String(lead.accountId||gdata.accountId||'');
  if(!sendAccountId)return reply({error:'У лида нет аккаунта — назначьте аккаунт группе лида'},400);
  const arow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,sendAccountId,'account').first();
  const adata=arow?JSON.parse(arow.data):null;
  if(!adata)return reply({error:'Аккаунт лида не найден'},404);
  // Открытая переписка тоже не обходит отлёжку/спамблок/лимит: ответ только с этого же аккаунта позже
  if(!isAccountUsable(adata)){
   return reply({
    error:'Аккаунт лида на отлежке или в спамблоке — с другого аккаунта ответить нельзя. Повторите позже.',
    cooldown:true,
    cooldownUntil:String(adata.cooldownUntil||''),
   },429);
  }
  if(!hasMessageQuota(adata)){
   return reply({error:'Дневной лимит сообщений аккаунта лида исчерпан — ответ после полуночи (МСК)',limitReached:true},429);
  }
  let payload:Record<string,unknown>;
  try{
   ({payload}=await loadAccountSessionPayload(owner,sendAccountId));
  }catch(e){
   return reply({error:internalError('send_lead_message',e,'Не удалось отправить сообщение. Повторите попытку.')},503);
  }
  // Берём лучший peer из истории лички (chatId ответа в чат — это группа, не клиент)
  const replyPeers=(Array.isArray(lead.replies)?lead.replies:[])
   .filter((x:any)=>x&&x.mode!=='chat'&&x.ok!==false&&(x.chatId||x.from==='client'))
   .map((x:any)=>String(x.chatId||'').replace(/^-/,'').trim())
   .filter(Boolean);
  let senderId=String(lead.senderId||'').replace(/^-/,'').trim();
  if((!senderId||senderId.startsWith('100'))&&replyPeers[0])senderId=replyPeers[0];
  // access_hash чужого аккаунта ломает SendMessage → invalid Peer
  const sameAccount=String(lead.accountId||'')===String(sendAccountId);
  const accessHash=sameAccount?String(lead.senderAccessHash||''):'';

  // Запись «отправляется» до вызова воркера: повтор после таймаута не шлёт дубль
  const sendKey=clientMsgId||`srv:${crypto.randomUUID()}`;
  const pendingEntry:ReplyEntry={text,mode,at:new Date().toISOString(),ok:false,status:'pending',error:'',messageId:'',link:'',chatId:'',from:'us',sendKey,accountId:sendAccountId};
  const claim=await mutateLead(db,owner,id,cur=>{
   const block=findSendBlock(cur,{clientMsgId,text,mode},Date.now());
   if(block&&!(force&&block.kind==='unknown'))return {result:block};
   return {next:{...withPendingSend(cur,pendingEntry,block?.entry.sendKey||''),draft:text},result:null};
  });
  if(!claim)return reply({error:'Лид не найден'},404);
  const block=claim.result;
  if(block?.kind==='delivered'){
   return reply({ok:true,duplicate:true,lead:claim.lead,mode,link:block.entry.link,messageId:block.entry.messageId,accountId:String(claim.lead.accountId||'')});
  }
  if(block){
   return reply({
    error:block.kind==='inflight'
     ?'Это сообщение уже отправляется — дождитесь результата'
     :'Результат прошлой отправки этого сообщения неизвестен. Проверьте переписку в Telegram — если сообщения нет, отправьте ещё раз.',
    inflight:block.kind==='inflight',
    unknown:block.kind==='unknown',
    lead:claim.lead,
   },409);
  }

  const sendBody={
   ...payload,
   mode,
   text,
   url:gdata.url,
   replyTo:mode==='chat'?(lead.tgMsgId||''):'',
   tgMsgId:lead.tgMsgId||'',
   senderId:senderId||lead.senderId||'',
   senderUsername:lead.senderUsername||'',
   silent,
   deleteDialog:false,
  };
  let finalResult:Record<string,unknown>={};
  let usedHash=accessHash;
  let outcome:SendOutcome;
  let failStatus=502;
  try{
   finalResult=await workerPost('/send-message',{...sendBody,senderAccessHash:accessHash},SEND_MESSAGE_TIMEOUT_MS);
   // Повтор без access_hash, если peer битый
   if(!finalResult.ok&&/invalid peer/i.test(String(finalResult.error||''))&&accessHash){
    usedHash='';
    finalResult=await workerPost('/send-message',{...sendBody,senderAccessHash:''},SEND_MESSAGE_TIMEOUT_MS);
   }
   outcome={
    status:finalResult.ok?'sent':'failed',
    error:String(finalResult.error||(finalResult.ok?'':'Не удалось отправить')),
    messageId:String(finalResult.messageId||''),
    link:String(finalResult.link||''),
    chatId:String(finalResult.chatId||''),
    chatUsername:String(finalResult.chatUsername||''),
    senderAccessHash:String(finalResult.senderAccessHash||''),
   };
  }catch(e){
   ({outcome,httpStatus:failStatus}=sendFailureOutcome(e));
  }
  const saved=await mutateLead(db,owner,id,cur=>{
   const applied=applySendOutcome(cur,{sendKey,mode,accountId:sendAccountId,peerId:senderId,accessHash:usedHash,nowIso:new Date().toISOString()},outcome);
   // REQ-19: отправленный текст закрывает черновик (ручной и авто); при сбое черновик остаётся для повтора
   return {next:outcome.status==='sent'?withoutDraft(applied):applied,result:null};
  });
  const next=saved?.lead||lead;
  if(outcome.status==='unknown')return reply({ok:false,unknown:true,error:outcome.error,lead:next},504);
  if(finalResult.flood||finalResult.status==='flood'){
   const sec=Number(finalResult.waitSec)||900;
   // FloodWait на ЛС — пауза ответа, аккаунт не уводим в «Отлежка».
   return reply({ok:false,error:finalResult.error||'FloodWait',waitSec:sec,lead:next,pace:true},429);
  }
  if(outcome.status!=='sent')return reply({ok:false,error:outcome.error,busy:failStatus===429,lead:next},failStatus);
  const accRow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,sendAccountId,'account').first();
  if(accRow){
   const acc=JSON.parse(accRow.data);
   const bumped=applyQuotaCooldownIfExhausted({...acc,...bumpMessageCounters(acc,1)},'message');
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(bumped),owner,sendAccountId,'account').run();
  }
  const link=String(finalResult.link||'').slice(0,300);
  const messageId=String(finalResult.messageId||'').slice(0,40);
  return reply({ok:true,lead:next,mode,link,messageId,accountId:sendAccountId});
 }
 if(b.action==='rescan_groups'){
  const force=b.force===true;
  const limit=Math.max(1,Math.min(40,Number(b.limit)||40));
  const config:any=await db.prepare('SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1').bind(owner,'settings').first();
  const settings=config?.data?JSON.parse(config.data):{};
  const rescanMinutes=Math.max(5,Math.min(180,Number(settings.autoRescanMinutes)||30));
  const needMs=rescanMinutes*60*1000;
  const now=Date.now();
  const liveIds=new Set(await listLiveAccountIds(owner));
  const groups=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='group'").bind(owner).all();
  type Due={id:string;last:number};
  const due:Due[]=[];
  // Обход не вступает и не переназначает: группы без членства и на недоступном аккаунте только считаем.
  let needJoin=0;
  const unavailable:{id:string;name:string;accountId:string;error:string}[]=[];
  for(const r of groups.results){
   try{
    const d=JSON.parse(String(r.data));
    if(!d.accountId||isCatalogPlaceholderUrl(d.url||''))continue;
    const joined=d.membership==='joined'||!!d.joinedAt;
    if(!joined){needJoin++;continue}
    if(!liveIds.has(String(d.accountId))){
     unavailable.push({id:String(r.id),name:String(d.name||'Группа'),accountId:String(d.accountId),error:'Аккаунт группы недоступен — скан пропущен'});
     continue;
    }
    // Битая/невидимая ссылка — не крутить в каждом обходе (force всё ещё берёт)
    if(!force&&(String(d.status||'')==='error'||d.usernameMissing))continue;
    const last=d.lastScanned?Date.parse(d.lastScanned):0;
    if(!force&&Number.isFinite(last)&&last>0&&now-last<needMs)continue;
    due.push({id:String(r.id),last:Number.isFinite(last)?last:0});
   }catch{/* */}
  }
  due.sort((a,b)=>a.last-b.last);
  const ids=due.slice(0,limit).map(x=>x.id);
  return reply({
   ok:true,
   groupIds:ids,
   total:due.length,
   queued:ids.length,
   rescanMinutes,
   needJoin,
   unavailable:unavailable.slice(0,50),
   unavailableTotal:unavailable.length,
  });
 }
 /** Залить весь каталог (verified t.me) в «Группы и каналы» текущего workspace. */
 if(b.action==='import_catalog'){
  const accountId=typeof b.accountId==='string'?b.accountId:'';
  if(accountId){
   const arow:any=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,accountId,'account').first();
   if(!arow)return reply({error:'Аккаунт не найден'},400);
   let adata:JoinAccountState|null=null;
   try{adata=JSON.parse(String(arow.data))}catch{adata=null}
   if(!(await accountCanJoinGroups(owner,adata))){
    return reply({error:'Аккаунт не может вступать в группы (отлёжка/спамблок/заморозка/прокси/лимит)'},400);
   }
  }
  // REQ-3: группы каталога получают выбранный проект владельца (иначе основной)
  const catalogProject=await requestedProject({db,owner,nowMs:Date.now()},b.projectId);
  if(!catalogProject)return reply({error:'Проект не найден'},404);
  const existing=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='group'").bind(owner).all();
  const byUrl=new Map<string,string>();
  for(const r of existing.results){
   try{
    const d=JSON.parse(String(r.data));
    const k=telegramEntityKey(String(d.url||''));
    if(k)byUrl.set(k,String(r.id));
   }catch{/* */}
  }
  const ready=GROUP_CATALOG.filter(g=>g.verified&&g.url&&!isCatalogPlaceholderUrl(g.url));
  let added=0;
  let skipped=0;
  const created:{id:string;name:string;url:string}[]=[];
  for(const g of ready){
   const url=canonicalizeTgUrl(g.url);
   const key=telegramEntityKey(url);
   if(key&&byUrl.has(key)){skipped++;continue}
   const id=crypto.randomUUID();
   const data={
    name:g.name,
    url,
    accountId:accountId||'',
    status:'setup',
    error:'',
    membership:'none',
    joinedAt:'',
    leadsTotal:0,
    leadsHot:0,
    leadsWarm:0,
    leadsCold:0,
    scanMatched:0,
    rating:0,
    lastScanned:'',
    source:g.niches.includes('blogs')?'tgstat-blogs':'catalog',
    projectId:catalogProject.id,
   };
   await db.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .bind(id,owner,'group',JSON.stringify(data),null,new Date().toISOString()).run();
   if(key)byUrl.set(key,id);
   added++;
   created.push({id,name:g.name,url});
  }
  return reply({ok:true,added,skipped,total:ready.length,created:created.slice(0,20)});
 }
 if(b.action==='mark_auto_rescan'){
  const config:any=await db.prepare('SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1').bind(owner,'settings').first();
  if(!config)return reply({ok:true,skipped:true});
  const current=JSON.parse(config.data);
  const at=new Date().toISOString();
  const next={
   ...current,
   lastAutoRescanAt:at,
   rescanLog:pushTaskLog(
    current.rescanLog,
    b.hasErrors===true?'warn':'info',
    String(b.summary||'').trim().slice(0,400)||'Автообход групп выполнен',
    120,
   ),
  };
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,config.id,'settings').run();
  return reply({ok:true,lastAutoRescanAt:at});
 }
 if(b.action==='set_group_join_state'){
  const id=z.string().uuid().parse(b.id);
  const joinState=z.enum(['',...LIVE_JOIN_STATES]).parse(b.joinState??'');
  // Без zod.string().parse — только строка; иначе снова «Проверьте поля: joinStateError».
  const joinStateError=sanitizeJoinStateError(b.joinStateError);
  const grow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,'group').first();
  if(!grow)return reply({error:'Группа не найдена'},404);
  const gdata=JSON.parse(grow.data);
  const next={
   ...gdata,
   joinState,
   joinStateAt:joinState?new Date().toISOString():'',
   joinStateError,
  };
  await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,id,'group').run();
  return reply({ok:true,group:next});
 }
 if(b.action==='assign_group_accounts'){
  // Один аккаунт на все выбранные группы: смесь аккаунтов (mode:'mix') удалена.
  if(b.mode!==undefined&&b.mode!=='single')return reply({error:'Смешивание аккаунтов отключено — выберите один аккаунт'},400);
  const legacyIds:unknown[]=Array.isArray(b.accountIds)?b.accountIds:[];
  if(legacyIds.length>1)return reply({error:'Выберите один аккаунт для групп'},400);
  const accountId=z.string().uuid().parse(b.accountId??legacyIds[0]);
  const groupIds=z.array(z.string().uuid()).min(1).max(500).parse(b.groupIds);
  const arow:any=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,accountId,'account').first();
  let adata:JoinAccountState|null=null;
  try{adata=arow?JSON.parse(String(arow.data)):null}catch{adata=null}
  // Группам предстоит вступление — только аккаунт, который может вступать (пауза темпа допустима)
  if(!(await accountCanJoinGroups(owner,adata)))return reply({error:'Аккаунт не может вступать в группы (отлёжка/спамблок/заморозка/мёртвый прокси/лимит)'},400);
  let updated=0;
  let skipped=0;
  const assignments:{groupId:string;accountId:string}[]=[];
  for(const gid of groupIds){
   const grow:any=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,gid,'group').first();
   if(!grow)continue;
   const gdata=JSON.parse(grow.data);
   if(groupLooksJoined(gdata)){
    if(!groupAlreadyMember(gdata)){
     const restored=restoreJoinedMembership(gdata);
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(restored),owner,gid,'group').run();
    }
    skipped++;
    continue;
   }
   const next={
    ...gdata,
    accountId,
    error:gdata.accountId===accountId?gdata.error:'',
   };
   await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,gid,'group').run();
   assignments.push({groupId:gid,accountId});
   updated++;
  }
  return reply({ok:true,updated,skipped,accountId,assignments});
 }
 if(b.action==='heal_group_join_state'){
  let fixed=await healCorruptGroupJoinFields(owner);
  const groups=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='group'").bind(owner).all();
  for(const row of groups.results){
   try{
    const gdata=JSON.parse(row.data as string);
    const pending=gdata.status==='pending'||gdata.membership==='pending';
    if(groupLooksJoined(gdata)&&!pending&&gdata.membership!=='joined'){
     const next=restoreJoinedMembership(gdata);
     await db.prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(next),owner,row.id,'group').run();
     fixed++;
    }
   }catch{/* */}
  }
  return reply({ok:true,fixed});
 }
 if(b.action==='test_notify'){
  const config:any=await db.prepare('SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1').bind(owner,'settings').first();
  if(!config)return reply({error:'Сначала сохраните настройки'},404);
  const settings=JSON.parse(config.data);
  const token=String(b.botToken||settings.notifyBotToken||'').trim()||settings.notifyBotToken;
  const chatId=String(b.chatId||settings.notifyChatId||'').trim();
  const probe={
   ...settings,
   notifyEnabled:true,
   notifyBotToken:token||settings.notifyBotToken,
   notifyChatId:chatId||settings.notifyChatId,
  };
  const r=await notifyNewLeadsTelegram(probe,[{
   name:'Тест UniLab',
   message:'Проверка уведомлений: бот подключён и может присылать новые лиды.',
   temperature:'warm',
   source:'Настройки',
  }]);
  if(!r.ok)return reply({error:('error' in r&&r.error)||'Не удалось отправить'},502);
  return reply({ok:true});
 }

 if(b.action==='poll_dm_replies'){
  const accRows=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='account'").bind(owner).all();
  const live:LiveAccount[]=[];
  for(const r of accRows.results){
   try{
    const a=JSON.parse(String(r.data));
    if(canPollDmInbox(a))live.push({id:String(r.id),data:a});
   }catch{/* */}
  }
  if(!live.length)return reply({ok:true,opened:0,skipped:true,reason:'no_accounts'});
  // Каждая вкладка опрашивает раз в 15 с — одновременно работает один опрос на владельца
  const lease=await acquireDmPollLease(db,owner);
  if(!lease)return reply({ok:true,opened:0,skipped:true,reason:'busy'});
  try{
   return reply(await pollDmReplies(db,owner,live));
  }finally{
   await releaseDmPollLease(db,owner,lease);
  }
 }

 // Действия удалённых функций (сбор аудитории, инвайтинг, рассылка, массовое вступление) сюда тоже попадают.
 if(b.action!=='save'&&b.action!=='delete')return reply({error:'Неизвестное действие'},400);
 const kind=kindSchema.parse(b.kind);
 if(b.action==='delete'){
  const id=z.string().uuid().parse(b.id);
  const refs=await db.prepare('SELECT data FROM records WHERE owner=? AND kind=?').bind(owner,kind==='proxy'?'account':'group').all();
  if((kind==='proxy'||kind==='account')&&refs.results.some((r:any)=>{const v=JSON.parse(r.data);return v.proxyId===id||v.accountId===id}))return reply({error:'Сначала измените привязку в аккаунтах или группах'},409);
  if(kind==='group'){
   const leads=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='lead'").bind(owner).all();
   let removed=0;
   for(const row of leads.results){
    try{
     const d=JSON.parse(row.data as string);
     if(d.groupId===id){
      await db.prepare('DELETE FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,row.id,'lead').run();
      removed++;
     }
    }catch{/* */}
   }
   await db.prepare('DELETE FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,kind).run();
   return reply({ok:true,leadsRemoved:removed});
  }
  if(kind==='lead')await rememberDeletedLead(owner,id);
  await db.prepare('DELETE FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,kind).run();
  return reply({ok:true});
 }
 // До zod: вычистить битый joinStateError (иначе локальные записи после старого бага валят save).
 if(b.kind==='group'&&b.data&&typeof b.data==='object'){
  b.data={...b.data,joinStateError:sanitizeJoinStateError(b.data.joinStateError)};
 }
 const data:any=schemas[kind].parse(b.data);let id=b.id?z.string().uuid().parse(b.id):crypto.randomUUID();let existing:any=null;
 if(kind==='settings'){existing=await db.prepare('SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1').bind(owner,kind).first();if(existing)id=existing.id}else if(b.id){existing=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,id,kind).first();if(!existing)return reply({error:'Запись не найдена'},404)}
 if(kind==='settings'){
  data.provider='deepseek';
  data.model='deepseek-chat';
  data.apiBase='https://api.deepseek.com';
  if(existing){try{Object.assign(data,keepOwnerSecretsOnSave(actor,data,JSON.parse(existing.data)))}catch{/* битые старые настройки — перезаписываем */}}
 }
 if(kind==='group'&&isCatalogPlaceholderUrl(data.url||''))return reply({error:'Это шаблон каталога, не группа Telegram. Вставьте реальную ссылку t.me/… или инвайт +…'},400);
 if(kind==='group')data.url=canonicalizeTgUrl(data.url);
 // REQ-3: новая группа получает выбранный проект владельца (иначе основной); дальше projectId — серверное поле
 if(kind==='group'&&!existing){
  const groupProject=await requestedProject({db,owner,nowMs:Date.now()},b.projectId);
  if(!groupProject)return reply({error:'Проект не найден'},404);
  data.projectId=groupProject.id;
 }
 if(isDuplicateKind(kind)){
  const siblings=await db.prepare('SELECT id,data FROM records WHERE owner=? AND kind=?').bind(owner,kind).all();
  for(const row of siblings.results as {id:string;data:string}[]){
   if(existing&&row.id===id)continue;
   let other:any=null;
   try{other=JSON.parse(row.data)}catch{continue}
   const reason=duplicateReason(kind,data,other);
   if(reason)return reply({error:reason,duplicate:true},409);
  }
 }
 // REQ-L10: поля, которыми владеет сервер (переписка, скан, уведомления), клиентский save не затирает
 if(existing&&(kind==='lead'||kind==='group'||kind==='settings')){
  try{Object.assign(data,keepServerOwnedFields(kind,JSON.parse(existing.data),data))}catch{/* битая запись — сохраняем как пришло */}
 }
 if(kind==='group'&&existing){
  try{
   const prev=JSON.parse(existing.data);
   const active=new Set<string>(LIVE_JOIN_STATES);
   if(active.has(String(prev.joinState||''))&&!data.joinState){
    data.joinState=prev.joinState;
    data.joinStateAt=prev.joinStateAt||'';
    // Не возвращаем битый joinStateError из БД (объект Zod от старого бага).
    data.joinStateError=sanitizeJoinStateError(prev.joinStateError);
   }
  }catch{/* */}
 }
 const refId=kind==='account'?data.proxyId:kind==='group'?data.accountId:null;if(refId){const ref=await db.prepare('SELECT id FROM records WHERE owner=? AND id=? AND kind=?').bind(owner,refId,kind==='account'?'proxy':'account').first();if(!ref)return reply({error:'Выбранное подключение не найдено'},400)}
 if(kind==='account'&&!existing){
  const uname=String(data.username||'').replace(/^@/,'').trim();
  if(!uname){
   const accs=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='account'").bind(owner).all();
   const taken=accs.results.map((r:any)=>{try{return JSON.parse(r.data).username||''}catch{return ''}});
   data.username=generateTelegramUsername(taken);
  }else data.username=uname;
 }
 if(b.clearSecret!==undefined&&typeof b.clearSecret!=='boolean')return reply({error:'Некорректная команда очистки секрета'},400);if(b.clearSecret&&b.secret)return reply({error:'Нельзя одновременно заменить и удалить секрет'},400);const secret=b.clearSecret?null:b.secret?await seal(z.string().max(200000).parse(b.secret),owner):existing?.secret??null;
 if(existing)await db.prepare('UPDATE records SET data=?,secret=? WHERE owner=? AND id=? AND kind=?').bind(JSON.stringify(data),secret,owner,id,kind).run();
 else await db.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)').bind(id,owner,kind,JSON.stringify(data),secret,new Date().toISOString()).run();
 let provision:any=null;
 if(!existing&&kind==='account'&&secret&&b.provisionUsername===true){
  try{
   // Явный opt-in + жёсткий потолок: иначе импорт ZIP зависает на минуты (прокси×ретраи×автообход).
   provision=await Promise.race([
    runAccountCheck(owner,id,{ensureUsername:true,forceUsername:true,checkRestrictions:false,rotateProxy:false}),
    new Promise<never>((_,rej)=>setTimeout(()=>rej(new UserFacingError('Таймаут записи @username')),18_000)),
   ]);
  }catch(e){
   provision={ok:false,error:internalError('provision_username',e,'Не удалось записать @username')};
  }
 }
 return reply({ok:true,id,username:provision?.profile?.username||data.username||undefined,provision});
 }catch(e){if(e instanceof z.ZodError)return reply({error:'Проверьте поля: '+e.issues.map(i=>i.path.join('.')).join(', ')},400);if(e instanceof SyntaxError)return reply({error:'Некорректный запрос'},400);internalError('POST',e,'');return reply({error:'Не удалось выполнить действие. Данные формы сохранены — повторите попытку.'},503)}}
