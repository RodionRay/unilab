import {groupSchema} from '@/lib/workspace-schemas';

export type GroupLike={
  name?:string;
  url?:string;
  accountId?:string;
  status?:string;
};

export type InviteStatus='invalid'|'needs_account'|'ready';

/** Валидация источника (группы/канала) для будущих инвайтов и вступлений. */
export function parseGroupSource(data:unknown){
  return groupSchema.parse(data);
}

/** Разбор цели Telegram из URL или @username. */
export function parseInviteTarget(url:string):{kind:'username'|'invite'|'joinchat';value:string}|null{
  const trimmed=url.trim();
  const at=trimmed.match(/^@([a-zA-Z0-9_]{5,32})$/);
  if(at)return {kind:'username',value:at[1]};
  const invite=trimmed.match(/^https:\/\/t\.me\/\+([a-zA-Z0-9_-]+)$/);
  if(invite)return {kind:'invite',value:invite[1]};
  const join=trimmed.match(/^https:\/\/t\.me\/joinchat\/([a-zA-Z0-9_-]+)$/);
  if(join)return {kind:'joinchat',value:join[1]};
  const publicUrl=trimmed.match(/^https:\/\/t\.me\/([a-zA-Z0-9_]{5,32})$/);
  if(publicUrl)return {kind:'username',value:publicUrl[1]};
  return null;
}

/** Можно ли ставить задачу на вступление/заявку (инвайт) для группы. */
export function inviteReadiness(group:GroupLike):{status:InviteStatus;reason:string}{
  const target=group.url?parseInviteTarget(group.url):null;
  if(!target)return {status:'invalid',reason:'Некорректная ссылка на группу или канал'};
  if(!group.accountId)return {status:'needs_account',reason:'Назначьте аккаунт для вступления'};
  return {status:'ready',reason:'Готово к постановке задачи на вступление'};
}

/** Приоритет очереди инвайтов: сначала публичные username, затем invite-hash. */
export function inviteQueuePriority(url:string):number{
  const target=parseInviteTarget(url);
  if(!target)return 99;
  if(target.kind==='username')return 1;
  if(target.kind==='invite')return 2;
  return 3;
}
