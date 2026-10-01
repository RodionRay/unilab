import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {ACTION_RULES,KIND_ACCESS,READ_RECORD_KINDS,RECORD_KINDS,authorizeWorkspaceAction,type WorkspaceActor} from '@/lib/security/workspace-authz';
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

  it('наблюдатель может только читать: воронка разрешена, мутации — нет',()=>{
    const viewer=member('viewer',{...ROLE_PRESETS.viewer,ai:true});

    expect(authorizeWorkspaceAction(viewer,'funnel',undefined).ok).toBe(true);
    for(const action of ['project_create','project_update','project_delete','set_group_project','rebuild_product'])expect(authorizeWorkspaceAction(viewer,action,undefined).ok).toBe(false);
    for(const kind of RECORD_KINDS)expect(authorizeWorkspaceAction(viewer,'save',kind).ok).toBe(false);
  });

  it('lead core v2: проекты — раздел AI, отзывы и черновики — раздел лидов (REQ-23)',()=>{
    const none=Object.fromEntries(Object.keys(ALL_CRM_ACCESS).map(k=>[k,false])) as typeof ALL_CRM_ACCESS;
    const aiOnly=member('manager',{...none,ai:true});
    const leadsOnly=member('manager',{...none,leads:true});

    for(const action of ['project_create','project_update','project_delete','set_group_project','funnel']){
      expect(authorizeWorkspaceAction(aiOnly,action,undefined).ok,action).toBe(true);
      expect(authorizeWorkspaceAction(leadsOnly,action,undefined).ok,action).toBe(false);
    }
    for(const action of ['lead_feedback','dismiss_draft','draft']){
      expect(authorizeWorkspaceAction(leadsOnly,action,undefined).ok,action).toBe(true);
      expect(authorizeWorkspaceAction(aiOnly,action,undefined).ok,action).toBe(false);
    }
  });

  it('проект не пишется generic save/delete, а читается разделами AI и лидов (REQ-23)',()=>{
    expect(RECORD_KINDS).not.toContain('project');
    expect(READ_RECORD_KINDS).toContain('project');
    expect(KIND_ACCESS.project).toEqual(['ai','leads']);
    expect(authorizeWorkspaceAction(member('admin'),'save','project').ok).toBe(false);
    expect(authorizeWorkspaceAction(member('admin'),'delete','project').ok).toBe(false);
  });

  it('удалённые действия обучения стоп-словам не описаны в карте (REQ-22)',()=>{
    for(const action of ['preview_lead_core','train_from_hot','train_from_ignored','reject_lead_stopwords','suggest_stopwords']){
      expect(action in ACTION_RULES,action).toBe(false);
      expect(authorizeWorkspaceAction(member('admin'),action,undefined).ok,action).toBe(false);
    }
  });

  it('прототипные ключи не считаются действиями',()=>{
    expect(authorizeWorkspaceAction(member('admin'),'constructor',undefined).ok).toBe(false);
    expect(authorizeWorkspaceAction(member('admin'),'__proto__',undefined).ok).toBe(false);
  });
});
