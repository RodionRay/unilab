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

function group(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}

describe('вступление только по ручному действию владельца',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    const base={membership:'none',status:'setup',joinedAt:''};
    // Хвост старой очереди браузера: joinState='queued' больше ничего не запускает.
    addRecord(CATALOG_ID,'group',{...base,name:'Каталог',url:'https://t.me/catalog_chat',accountId:ACCOUNT_ID,source:'catalog',joinState:'queued',joinWanted:true});
    addRecord(ORPHAN_ID,'group',{...base,name:'Без аккаунта',url:'https://t.me/orphan_chat',accountId:'',source:'catalog'});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('rescan_groups не вступает, не ставит в очередь и не назначает аккаунт',async()=>{
    const res=await POST(postRequest({action:'rescan_groups',force:true}));
    const body=await res.json() as {groupIds:string[];needJoin:number};

    expect(res.status).toBe(200);
    expect(body.groupIds).toEqual([]);
    expect(body.needJoin).toBe(1);
    expect(workerCalls.some(u=>u.includes('/join-group'))).toBe(false);
    expect(group(ORPHAN_ID).accountId).toBe('');
    expect(group(CATALOG_ID).accountId).toBe(ACCOUNT_ID);
  });

  it('join_group по кнопке не требует очереди вступления',async()=>{
    testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.joinWanted',json('false')) WHERE id=?").run(CATALOG_ID);

    const res=await POST(postRequest({action:'join_group',id:CATALOG_ID}));
    const body=await res.json() as {notWanted?:boolean};

    expect(res.status).not.toBe(409);
    expect(body.notWanted).toBeUndefined();
  },10_000);
});
