import {describe,expect,it} from 'vitest';
import {ACTION_RULES,RECORD_KINDS,authorizeWorkspaceAction,visibleRecordsFor,type WorkspaceActor} from '@/lib/security/workspace-authz';
import {ALL_CRM_ACCESS,ROLE_PRESETS,STAFF_ROLES} from '@/lib/staff-types';
import {TMA_ACTIONS} from '@/lib/tma/contract';

const ACTORS:WorkspaceActor[]=[
 {userId:'o',ownerId:'o',isOwner:true,role:'owner',access:ALL_CRM_ACCESS},
 ...STAFF_ROLES.map(role=>({userId:role,ownerId:'o',isOwner:false,role,access:ROLE_PRESETS[role]})),
];
const CALLS:[string,string|undefined][]=[
 ...Object.keys(ACTION_RULES).map(a=>[a,undefined] as [string,undefined]),
 ...RECORD_KINDS.flatMap(k=>[['save',k],['delete',k]] as [string,string][]),
 ['unknown_action',undefined],
];

describe('REQ-A6 · TMA_ACTIONS ∩ веб-правила',()=>{
 it('каждое действие из TMA_ACTIONS есть в ACTION_RULES (нет «мертвых» разрешений)',()=>{
  for(const a of TMA_ACTIONS)expect(Object.keys(ACTION_RULES)).toContain(a);
 });

 it.each(ACTORS.map(a=>[a.role,a] as const))('%s: tma разрешает ровно веб-решение для TMA_ACTIONS и ничего сверх',(_role,actor)=>{
  const tma={...actor,channel:'tma' as const};
  for(const [action,kind] of CALLS){
   const web=authorizeWorkspaceAction(actor,action,kind);
   const viaTma=authorizeWorkspaceAction(tma,action,kind);
   const allowed=(TMA_ACTIONS as readonly string[]).includes(action);
   expect(viaTma.ok,`${action}/${kind}`).toBe(allowed&&web.ok);
  }
 });

 it('REQ-A7: владелец через tma получает настройки без notifyBotToken',()=>{
  const owner={...ACTORS[0],channel:'tma' as const};
  const [settings]=visibleRecordsFor(owner,[{kind:'settings',data:{name:'P',notifyBotToken:'1:secret'}}]);

  expect(settings.data.notifyBotToken).toBe('');
  expect(visibleRecordsFor(ACTORS[0],[{kind:'settings',data:{notifyBotToken:'1:secret'}}])[0].data.notifyBotToken).toBe('1:secret');
 });
});
