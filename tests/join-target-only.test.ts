import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb,workerCalls} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const CATALOG_ID='66666666-6666-4666-8666-666666666666';
const ORPHAN_ID='77777777-7777-4777-8777-777777777777';
const WANTED_ID='88888888-8888-4888-8888-888888888888';

function group(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}

describe('вступление только в группы, поставленные владельцем',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    const base={membership:'none',status:'setup',joinedAt:''};
    addRecord(CATALOG_ID,'group',{...base,name:'Каталог',url:'https://t.me/catalog_chat',accountId:ACCOUNT_ID,source:'catalog',joinState:'queued'});
    addRecord(ORPHAN_ID,'group',{...base,name:'Без аккаунта',url:'https://t.me/orphan_chat',accountId:'',source:'catalog'});
    addRecord(WANTED_ID,'group',{...base,name:'Целевая',url:'https://t.me/wanted_chat',accountId:ACCOUNT_ID,joinWanted:true});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('join_group отказывает группе вне очереди и не зовёт воркер',async()=>{
    const res=await POST(postRequest({action:'join_group',id:CATALOG_ID}));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({notWanted:true});
    expect(workerCalls.some(u=>u.includes('/join-group'))).toBe(false);
    expect(group(CATALOG_ID).joinState).toBe('');
  });

  it('автопочинка не берёт в очередь и не назначает аккаунт нецелевым группам',async()=>{
    const res=await POST(postRequest({action:'heal_dead_group_accounts'}));
    const body=await res.json() as {items?:{id:string}[]};

    const ids=(body.items||[]).map(i=>i.id);
    expect(ids).not.toContain(CATALOG_ID);
    expect(ids).not.toContain(ORPHAN_ID);
    expect(group(ORPHAN_ID).accountId).toBe('');
    expect(group(CATALOG_ID).joinState).toBe('');
  });

  it('enqueue_joins помечает группу целевой и пропускает её к вступлению',async()=>{
    const enq=await POST(postRequest({action:'enqueue_joins',groupIds:[CATALOG_ID]}));
    expect(enq.status).toBe(200);
    expect(group(CATALOG_ID).joinWanted).toBe(true);

    const res=await POST(postRequest({action:'join_group',id:CATALOG_ID}));
    expect(res.status).not.toBe(409);
  },10_000);
});
