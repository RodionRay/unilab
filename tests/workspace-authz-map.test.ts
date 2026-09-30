import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {ACTION_RULES,RECORD_KINDS,authorizeWorkspaceAction,type WorkspaceActor} from '@/lib/security/workspace-authz';
import {ALL_CRM_ACCESS,ROLE_PRESETS} from '@/lib/staff-types';

const routeSource=readFileSync(path.resolve(__dirname,'../app/api/workspace/route.ts'),'utf8');
const routeActions=[...new Set([...routeSource.matchAll(/b\.action===?'([a-z_]+)'/g)].map(m=>m[1]))];

const member=(role:WorkspaceActor['role'],access=ALL_CRM_ACCESS):WorkspaceActor=>({userId:'u',ownerId:'o',isOwner:false,role,access});

describe('карта прав workspace API',()=>{
  it('каждое действие маршрута явно описано в ACTION_RULES',()=>{
    const unmapped=routeActions.filter(a=>a!=='save'&&a!=='delete'&&!(a in ACTION_RULES));

    // Санити-проверка разбора маршрута: действий заведомо больше двух десятков.
    expect(routeActions.length).toBeGreaterThan(20);
    expect(unmapped).toEqual([]);
  });

  it('в карте нет действий, которых нет в маршруте',()=>{
    expect(Object.keys(ACTION_RULES).filter(a=>!routeActions.includes(a))).toEqual([]);
  });

  it('владелец проходит любое действие, включая неизвестное',()=>{
    const owner:WorkspaceActor={userId:'o',ownerId:'o',isOwner:true,role:'owner',access:ALL_CRM_ACCESS};

    expect(authorizeWorkspaceAction(owner,'anything','whatever').ok).toBe(true);
  });

  it('save/delete неизвестного вида записей запрещены сотруднику',()=>{
    expect(authorizeWorkspaceAction(member('admin'),'save','ai_guard').ok).toBe(false);
    expect(authorizeWorkspaceAction(member('admin'),'delete',undefined).ok).toBe(false);
  });

  it('наблюдатель может только читать: предпросмотр ядра разрешён, мутации — нет',()=>{
    const viewer=member('viewer',{...ROLE_PRESETS.viewer,ai:true});

    expect(authorizeWorkspaceAction(viewer,'preview_lead_core',undefined).ok).toBe(true);
    for(const kind of RECORD_KINDS)expect(authorizeWorkspaceAction(viewer,'save',kind).ok).toBe(false);
  });

  it('прототипные ключи не считаются действиями',()=>{
    expect(authorizeWorkspaceAction(member('admin'),'constructor',undefined).ok).toBe(false);
    expect(authorizeWorkspaceAction(member('admin'),'__proto__',undefined).ok).toBe(false);
  });
});
