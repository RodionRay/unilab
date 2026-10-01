import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {
  ACCOUNT_ID,BOT_TOKEN,LEAD_ID,MAILING_ID,OWNER,PROXY_ID,SETTINGS_ID,
  login,postRequest,resetWorkspace,testDb,
} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';
import {ALL_CRM_ACCESS,ROLE_PRESETS,ensureStaffTables,type CrmAccess,type StaffRole} from '@/lib/staff';

type ViewRecord={kind:string;data:Record<string,unknown>};

function addMember(userId:string,role:StaffRole,access:CrmAccess=ROLE_PRESETS[role]){
  testDb().sqlite.prepare('INSERT INTO workspace_members(id,workspace_owner_id,user_id,role,access,created) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomUUID(),OWNER,userId,role,JSON.stringify(access),new Date().toISOString());
}

async function visibleRecords():Promise<ViewRecord[]>{
  const res=await GET();
  expect(res.status).toBe(200);
  return (await res.json() as {records:ViewRecord[]}).records;
}

beforeAll(async()=>{
  testDb();
  await ensureStaffTables();
});
beforeEach(()=>resetWorkspace());
afterEach(()=>vi.unstubAllGlobals());

describe('workspace API: роль «Наблюдатель» только читает',()=>{
  // Даже с галочками на все разделы роль viewer не может ничего менять.
  beforeEach(()=>{addMember('viewer-1','viewer',{...ALL_CRM_ACCESS,staff:false});login('viewer-1')});

  it.each([
    ['удаление аккаунта',{action:'delete',kind:'account',id:ACCOUNT_ID}],
    ['запуск рассылки',{action:'start_mailing',id:MAILING_ID}],
    ['отправка сообщения лиду',{action:'send_lead_message',id:LEAD_ID,mode:'dm',text:'Привет'}],
    ['сохранение настроек',{action:'save',kind:'settings',data:{name:'X'}}],
    ['отметка лида просмотренным',{action:'mark_lead_viewed',id:LEAD_ID}],
  ])('%s → 403',async(_label,body)=>{
    const res=await POST(postRequest(body));

    expect(res.status).toBe(403);
  });

  it('данные не меняются после отказа',async()=>{
    await POST(postRequest({action:'delete',kind:'account',id:ACCOUNT_ID}));

    expect(testDb().sqlite.prepare('SELECT id FROM records WHERE id=?').get(ACCOUNT_ID)).toBeTruthy();
  });

  it('чтение (GET) разрешено',async()=>{
    expect((await visibleRecords()).some(r=>r.kind==='lead')).toBe(true);
  });
});

describe('workspace API: доступ по разделам',()=>{
  it('сотрудник без доступа «Аккаунты» не видит аккаунты, прокси и чужие разделы в GET',async()=>{
    addMember('op-1','operator',{...ROLE_PRESETS.operator,groups:false});
    login('op-1');

    const kinds=new Set((await visibleRecords()).map(r=>r.kind));

    expect(kinds.has('account')).toBe(false);
    expect(kinds.has('proxy')).toBe(false);
    expect(kinds.has('mailing_task')).toBe(false);
    expect(kinds.has('lead')).toBe(true);
  });

  it('сотрудник (даже администратор) не получает токен бота из настроек',async()=>{
    addMember('admin-1','admin');
    login('admin-1');

    expect(JSON.stringify(await visibleRecords())).not.toContain(BOT_TOKEN);
  });

  it('менеджер без доступа «Аккаунты» не может удалить аккаунт',async()=>{
    addMember('mgr-1','manager');
    login('mgr-1');

    const res=await POST(postRequest({action:'delete',kind:'account',id:ACCOUNT_ID}));

    expect(res.status).toBe(403);
  });

  it('менеджер с рассылками видит аккаунты только как список для выбора, без телефона',async()=>{
    addMember('mgr-1','manager');
    login('mgr-1');

    const acc=(await visibleRecords()).find(r=>r.kind==='account');

    expect(acc?.data.name).toBe('Farm 1');
    expect(acc?.data.phone).toBeUndefined();
  });

  it('неизвестное действие для сотрудника запрещено (deny by default)',async()=>{
    addMember('admin-1','admin');
    login('admin-1');

    const res=await POST(postRequest({action:'drop_everything'}));

    expect(res.status).toBe(403);
  });

  it('администратор может удалить прокси',async()=>{
    addMember('admin-1','admin');
    login('admin-1');

    const res=await POST(postRequest({action:'delete',kind:'proxy',id:PROXY_ID}));

    expect(res.status).toBe(200);
  });

  it('при сохранении настроек сотрудником токен бота не затирается',async()=>{
    addMember('admin-1','admin');
    login('admin-1');

    const res=await POST(postRequest({action:'save',kind:'settings',id:SETTINGS_ID,data:{name:'Проект 2',notifyBotToken:''}}));

    expect(res.status).toBe(200);
    const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(SETTINGS_ID) as {data:string};
    expect(JSON.parse(row.data).notifyBotToken).toBe(BOT_TOKEN);
  });

  it('сотрудник с доступом к настройкам не может перенаправить бота (chat id / токен / вкл.)',async()=>{
    addMember('staff-s','manager',{...ROLE_PRESETS.manager,settings:true});
    login('staff-s');

    const res=await POST(postRequest({action:'save',kind:'settings',id:SETTINGS_ID,data:{name:'Проект',notifyBotToken:'999:attacker-bot',notifyChatId:'777000',notifyEnabled:true}}));

    expect(res.status).toBe(200);
    const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(SETTINGS_ID) as {data:string};
    expect(JSON.parse(row.data)).toMatchObject({notifyBotToken:BOT_TOKEN,notifyChatId:'42',notifyEnabled:false});
  });
});

describe('workspace API: владелец без изменений',()=>{
  beforeEach(()=>login(OWNER));

  it('видит все записи и токен бота',async()=>{
    const records=await visibleRecords();

    expect(new Set(records.map(r=>r.kind))).toEqual(new Set(['account','proxy','lead','mailing_task','settings']));
    expect(JSON.stringify(records)).toContain(BOT_TOKEN);
  });

  it('удаляет аккаунт',async()=>{
    const res=await POST(postRequest({action:'delete',kind:'account',id:ACCOUNT_ID}));

    expect(res.status).toBe(200);
  });

  it('может очистить токен бота',async()=>{
    await POST(postRequest({action:'save',kind:'settings',id:SETTINGS_ID,data:{name:'Проект',notifyBotToken:''}}));

    const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(SETTINGS_ID) as {data:string};
    expect(JSON.parse(row.data).notifyBotToken).toBe('');
  });
});
