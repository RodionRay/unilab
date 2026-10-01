import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {
  ACCOUNT_ID,OWNER,PROXY_ID,
  addRecord,login,postRequest,resetWorkspace,testDb,
} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const GROUP_A='66666666-6666-4666-8666-666666666666';
const GROUP_B='77777777-7777-4777-8777-777777777777';
const OTHER_ACCOUNT='88888888-8888-4888-8888-888888888888';

function groupData(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string}|undefined;
  return row?JSON.parse(row.data):undefined;
}

beforeEach(()=>{resetWorkspace();login(OWNER)});
afterEach(()=>vi.unstubAllGlobals());

describe('удаление аккаунта, назначенного группам',()=>{
  // Замороженный аккаунт (FROZEN_METHOD_INVALID) сидит в группах — его нужно убрать, а не упираться в 409.
  beforeEach(()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?')
      .run(JSON.stringify({name:'Farm 1',phone:'+79990001122',status:'frozen',proxyId:''}),ACCOUNT_ID);
    addRecord(GROUP_A,'group',{name:'A',url:'@sellers_a',accountId:ACCOUNT_ID,membership:'joined',joinedAt:'2026-09-30T00:00:00Z'});
    addRecord(GROUP_B,'group',{name:'B',url:'@sellers_b',accountId:OTHER_ACCOUNT,membership:'joined'});
  });

  it('удаляет аккаунт и отвязывает только его группы',async()=>{
    const res=await POST(postRequest({action:'delete',kind:'account',id:ACCOUNT_ID}));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ok:true,groupsDetached:1});
    expect(testDb().sqlite.prepare('SELECT id FROM records WHERE id=?').get(ACCOUNT_ID)).toBeUndefined();
    expect(groupData(GROUP_A)).toMatchObject({name:'A',accountId:'',membership:'joined'});
    expect(groupData(GROUP_B)).toMatchObject({accountId:OTHER_ACCOUNT});
  });

  it('повторное удаление идемпотентно',async()=>{
    await POST(postRequest({action:'delete',kind:'account',id:ACCOUNT_ID}));
    const res=await POST(postRequest({action:'delete',kind:'account',id:ACCOUNT_ID}));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ok:true,groupsDetached:0});
  });
});

describe('удаление прокси, назначенного аккаунту',()=>{
  it('по-прежнему блокируется 409',async()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?')
      .run(JSON.stringify({name:'Farm 1',phone:'+79990001122',status:'active',proxyId:PROXY_ID}),ACCOUNT_ID);

    const res=await POST(postRequest({action:'delete',kind:'proxy',id:PROXY_ID}));

    expect(res.status).toBe(409);
    expect(testDb().sqlite.prepare('SELECT id FROM records WHERE id=?').get(PROXY_ID)).toBeTruthy();
  });
});
