import type {CrmAccess,CrmAccessKey,StaffRole} from '@/lib/staff-types';
import {TMA_ACTIONS} from '@/lib/tma/contract';

/**
 * Server-side authorization for /api/workspace. The UI hides sections by CrmAccess, but the API
 * used to trust any workspace member; this module is the single source of what a member may do.
 *
 * Rules: owner → everything (unchanged behaviour); admin → every section; viewer → read-only;
 * other roles → the section keys granted in `access`. Unknown actions/kinds are denied.
 */

export type WorkspaceActor={
 userId:string;
 ownerId:string;
 isOwner:boolean;
 role:StaffRole|'owner';
 access:CrmAccess;
 /** 'tma' = Telegram Mini App bearer: web rules ∩ TMA_ACTIONS, no full-dump reads. Absent = web cookie. */
 channel?:'web'|'tma';
};

export type AuthzDecision={ok:true}|{ok:false;error:string};

type ActionRule={anyOf:readonly CrmAccessKey[];mutates:boolean};

export const RECORD_KINDS=['account','proxy','group','lead','settings','audience_task','audience_user','invite_task','mailing_task'] as const;
export type RecordKind=(typeof RECORD_KINDS)[number];

/** Section that owns each record kind (save/delete/GET visibility). */
export const KIND_ACCESS:Readonly<Record<RecordKind,readonly CrmAccessKey[]>>={
 account:['accounts'],
 proxy:['proxies'],
 group:['groups'],
 lead:['leads','chats'],
 settings:['settings','ai'],
 audience_task:['audience'],
 audience_user:['audience'],
 invite_task:['invite'],
 mailing_task:['mailing'],
};

const LEADS:readonly CrmAccessKey[]=['leads','chats'];
const AI:readonly CrmAccessKey[]=['ai','settings'];
const rule=(anyOf:readonly CrmAccessKey[],mutates=true):ActionRule=>({anyOf,mutates});

/** Every non-CRUD POST action of /api/workspace. Anything absent here is denied to members. */
export const ACTION_RULES:Readonly<Record<string,ActionRule>>={
 draft:rule(LEADS),
 mark_lead_viewed:rule(LEADS),
 send_lead_message:rule(LEADS),
 poll_dm_replies:rule(['chats','leads']),
 poll_bot_updates:rule(['chats','leads']),

 check_proxy:rule(['proxies']),
 check_proxies:rule(['proxies']),
 check_account:rule(['accounts']),
 check_accounts:rule(['accounts']),
 reset_checking_accounts:rule(['accounts','proxies']),
 generate_account_about:rule(['accounts']),
 apply_account_profiles:rule(['accounts']),
 upload_account_photos:rule(['accounts']),

 join_group:rule(['groups']),
 scan_group:rule(['groups']),
 rescan_groups:rule(['groups']),
 heal_dead_group_accounts:rule(['groups']),
 import_catalog:rule(['groups']),
 mark_auto_rescan:rule(['groups']),
 enqueue_joins:rule(['groups']),
 set_group_join_state:rule(['groups']),
 assign_group_accounts:rule(['groups']),
 heal_group_join_state:rule(['groups']),

 rebuild_product:rule(AI),
 train_from_hot:rule(AI),
 preview_lead_core:rule(AI,false),
 test_notify:rule(['settings']),

 start_audience:rule(['audience']),
 pause_audience:rule(['audience']),
 tick_audience:rule(['audience']),
 export_audience:rule(['audience'],false),

 start_invite:rule(['invite']),
 pause_invite:rule(['invite']),
 tick_invite:rule(['invite']),

 start_mailing:rule(['mailing']),
 pause_mailing:rule(['mailing']),
 refill_mailing_ai_pool:rule(['mailing']),
 tick_mailing:rule(['mailing']),
};

const DENY_UNKNOWN='Действие недоступно для вашей роли';
const DENY_VIEWER='Роль «Наблюдатель» только просматривает данные';
const DENY_SECTION='Нет доступа к этому разделу. Обратитесь к владельцу кабинета.';
const DENY_TMA='Это действие недоступно в мини-приложении — откройте веб-версию кабинета.';

function isTmaAction(action:unknown):boolean{
 return typeof action==='string'&&(TMA_ACTIONS as readonly string[]).includes(action);
}

function isRecordKind(kind:unknown):kind is RecordKind{
 return typeof kind==='string'&&(RECORD_KINDS as readonly string[]).includes(kind);
}

function hasAnyAccess(actor:WorkspaceActor,keys:readonly CrmAccessKey[]):boolean{
 if(actor.isOwner||actor.role==='admin')return true;
 return keys.some(k=>actor.access[k]===true);
}

function ruleFor(action:unknown,kind:unknown):ActionRule|null{
 if(action==='save'||action==='delete')return isRecordKind(kind)?rule(KIND_ACCESS[kind]):null;
 if(typeof action!=='string'||!Object.prototype.hasOwnProperty.call(ACTION_RULES,action))return null;
 return ACTION_RULES[action];
}

export function authorizeWorkspaceAction(actor:WorkspaceActor,action:unknown,kind:unknown):AuthzDecision{
 // The mini app allowlist binds the owner too: no deletes, settings, staff or proxy edits from a phone session.
 if(actor.channel==='tma'&&!isTmaAction(action))return {ok:false,error:DENY_TMA};
 if(actor.isOwner)return {ok:true};
 const r=ruleFor(action,kind);
 if(!r)return {ok:false,error:DENY_UNKNOWN};
 if(r.mutates&&actor.role==='viewer')return {ok:false,error:DENY_VIEWER};
 return hasAnyAccess(actor,r.anyOf)?{ok:true}:{ok:false,error:DENY_SECTION};
}

/** Sections that pick farm accounts for their tasks without managing the accounts themselves. */
const ACCOUNT_PICKER_SECTIONS:readonly CrmAccessKey[]=['mailing','audience','invite','groups'];
const ACCOUNT_PICKER_FIELDS=[
 'name','username','firstName','lastName','status','cooldownUntil','limits','hasPhoto',
 'joinsToday','joinsDay','memberInvitesToday','memberInviteDay',
] as const;
/** Owner-only secrets that live inside record data (not in the sealed `secret` column). */
const OWNER_ONLY_SETTINGS_FIELDS=['notifyBotToken'] as const;

export type WorkspaceRecordView={kind:string;data:Record<string,unknown>}&Record<string,unknown>;

function pick(data:Record<string,unknown>,fields:readonly string[]):Record<string,unknown>{
 return Object.fromEntries(fields.filter(f=>f in data).map(f=>[f,data[f]]));
}

function redactOwnerSecrets(data:Record<string,unknown>):Record<string,unknown>{
 const next={...data};
 for(const f of OWNER_ONLY_SETTINGS_FIELDS)if(f in next)next[f]='';
 return next;
}

function viewRecord<T extends WorkspaceRecordView>(actor:WorkspaceActor,rec:T):T|null{
 if(!isRecordKind(rec.kind))return null;
 if(rec.kind==='settings')return {...rec,data:redactOwnerSecrets(rec.data)};
 if(hasAnyAccess(actor,KIND_ACCESS[rec.kind]))return rec;
 if(rec.kind==='account'&&hasAnyAccess(actor,ACCOUNT_PICKER_SECTIONS)){
  return {...rec,data:pick(rec.data,ACCOUNT_PICKER_FIELDS)};
 }
 return null;
}

/** GET projection: drop kinds outside the member's sections, strip owner-only secrets. */
export function visibleRecordsFor<T extends WorkspaceRecordView>(actor:WorkspaceActor,records:readonly T[]):T[]{
 // A tma owner still gets owner-only secrets blanked (REQ-A7); viewRecord does that for settings.
 if(actor.isOwner&&actor.channel!=='tma')return [...records];
 return records.flatMap(r=>{const v=viewRecord(actor,r);return v?[v]:[]});
}

/**
 * Where the owner's bot delivers client messages and whose replies it sends to clients as the owner:
 * only the owner may change it (a member repointing the chat would read every conversation and write
 * to clients through the bot without the chats section).
 */
const OWNER_ONLY_NOTIFY_ROUTING={notifyEnabled:false,notifyBotToken:'',notifyChatId:''} as const;

/**
 * Members receive settings with owner-only secrets blanked; when they save settings back, keep
 * the stored values instead of wiping them with the blanks. The bot routing fields are never taken
 * from a member: stored values win, and without stored settings they stay off.
 */
export function keepOwnerSecretsOnSave(actor:WorkspaceActor,incoming:Record<string,unknown>,stored:Record<string,unknown>|null):Record<string,unknown>{
 if(actor.isOwner)return incoming;
 const next={...incoming};
 for(const f of OWNER_ONLY_SETTINGS_FIELDS){
  if(stored&&!String(next[f]??'').trim()&&stored[f]!=null)next[f]=stored[f];
 }
 for(const [f,off] of Object.entries(OWNER_ONLY_NOTIFY_ROUTING)){
  next[f]=stored&&stored[f]!=null?stored[f]:off;
 }
 return next;
}
