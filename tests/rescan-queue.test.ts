import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {lastRescanTouch,rescanNotDue} from '@/lib/rescan-queue';

const DISCUSSION_GROUP='99999999-9999-4999-8999-999999999991';
const OK_GROUP='99999999-9999-4999-8999-999999999992';
const HOUR=60*60_000;

function groupData(id:string):Record<string,unknown>{
  const row=testDb().sqlite.prepare("SELECT data FROM records WHERE id=? AND kind='group'").get(id) as {data:string};
  return JSON.parse(row.data);
}

async function rescanPack(limit:number){
  const res=await POST(postRequest({action:'rescan_groups',limit}));
  return await res.json() as {groupIds:string[];total:number};
}

describe('lib/rescan-queue',()=>{
  const now=Date.parse('2026-10-01T15:00:00Z');
  it('a soft-failed attempt counts as a touch',()=>{
    expect(lastRescanTouch({lastScanned:'',scanTriedAt:'2026-10-01T14:50:00Z'})).toBe(Date.parse('2026-10-01T14:50:00Z'));
    expect(lastRescanTouch({lastScanned:'2026-10-01T14:00:00Z',scanTriedAt:'2026-10-01T13:00:00Z'})).toBe(Date.parse('2026-10-01T14:00:00Z'));
    expect(lastRescanTouch({})).toBe(0);
    expect(lastRescanTouch({lastScanned:'garbage'})).toBe(0);
  });
  it('waits the interval after an attempt; never-touched and force are due',()=>{
    expect(rescanNotDue({scanTriedAt:'2026-10-01T14:50:00Z'},30*60_000,now)).toBe(true);
    expect(rescanNotDue({scanTriedAt:'2026-10-01T14:00:00Z'},30*60_000,now)).toBe(false);
    expect(rescanNotDue({},30*60_000,now)).toBe(false);
    expect(rescanNotDue({scanTriedAt:'2026-10-01T14:50:00Z'},30*60_000,now,true)).toBe(false);
  });
});

describe('workspace API: auto-rescan queue does not starve on soft-failed groups',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    login(OWNER);
    testDb().sqlite.prepare('UPDATE records SET secret=? WHERE id=?').run(await seal(JSON.stringify({kind:'tdata',zipBase64:'eA==',apiId:1,apiHash:'h'}),OWNER),ACCOUNT_ID);
    // Never scanned: its linked discussion is not joined, so every scan soft-fails.
    addRecord(DISCUSSION_GROUP,'group',{name:'Channel',url:'https://t.me/some_channel',accountId:ACCOUNT_ID,status:'active',membership:'joined',joinedAt:new Date(Date.now()-24*HOUR).toISOString()});
    // Scanned an hour ago — due again (default interval 30 min).
    addRecord(OK_GROUP,'group',{name:'Chat',url:'https://t.me/some_chat',accountId:ACCOUNT_ID,status:'active',membership:'joined',lastScanned:new Date(Date.now()-HOUR).toISOString()});
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(String(url).includes('/scan-group'))return Response.json({ok:false,join:'need_join',needDiscussionJoin:true,error:'Вступите в обсуждение канала'});
      throw new Error(`unexpected fetch ${url}`);
    }));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('after a soft fail the next tick takes the other due group',async()=>{
    expect((await rescanPack(1)).groupIds).toEqual([DISCUSSION_GROUP]);

    const res=await POST(postRequest({action:'scan_group',id:DISCUSSION_GROUP}));
    expect(res.status).toBe(409);
    expect((await res.json() as {soft?:boolean}).soft).toBe(true);
    expect(groupData(DISCUSSION_GROUP).lastScanned||'').toBe('');
    expect(String(groupData(DISCUSSION_GROUP).scanTriedAt||'')).not.toBe('');

    const next=await rescanPack(1);
    expect(next.groupIds).toEqual([OK_GROUP]);
    expect(next.total).toBe(1);
  });
});
