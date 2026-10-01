import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {
  hasMessageQuota,
  isAccountUsable,
  isDayLimitedFor,
  moscowDayKey,
  withDayLimitCooldown,
} from '@/lib/telegram-accounts';
import {evaluateScanGate} from '@/lib/processes/scan-flow';
import {evaluateJoinGate} from '@/lib/processes/join-flow';

const today=moscowDayKey();
const future=()=>new Date(Date.now()+3_600_000).toISOString();
/** Messages spent for today, joins untouched. */
const dmSpent=()=>({status:'active',limits:{invite:40,message:1,chat:10},messagesToday:1,messagesDay:today});
/** Joins spent for today, the rest untouched. */
const joinsSpent=()=>({status:'active',limits:{invite:2,message:40,chat:10},joinsToday:2,joinsDay:today});

describe('day-limit cooldown blocks only its own kind',()=>{
  it('a per-kind day limit keeps the account usable; its own quota stays closed',()=>{
    const dm=withDayLimitCooldown(dmSpent(),'message');
    expect(isAccountUsable(dm)).toBe(true);
    expect(hasMessageQuota(dm)).toBe(false);
    expect(isDayLimitedFor(dm,'message')).toBe(true);
    expect(isDayLimitedFor(dm,'invite')).toBe(false);
  });

  it('a stored cooldown without a day-limit reason still blocks everything (legacy)',()=>{
    const legacy={status:'cooldown',cooldownUntil:future()};
    expect(isAccountUsable(legacy)).toBe(false);
    expect(isDayLimitedFor(legacy,'invite')).toBe(true);
    expect(isDayLimitedFor(legacy,'message')).toBe(true);
  });

  it('scan and join gates ignore a day limit of another kind',()=>{
    const dm=withDayLimitCooldown(dmSpent(),'message');
    expect(evaluateScanGate(dm)).toEqual({ok:true});
    expect(evaluateJoinGate({groupUrl:'https://t.me/g',accountId:'a',account:dm}).ok).toBe(true);
    const joins=withDayLimitCooldown(joinsSpent(),'invite');
    expect(evaluateJoinGate({groupUrl:'https://t.me/g',accountId:'a',account:joins})).toMatchObject({ok:false,reason:'cooldown'});
  });
});

const ACC='f3333333-3333-4333-8333-333333333333';
const GROUP='f4444444-4444-4444-8444-444444444444';

function row(id:string):Record<string,unknown>{
  const r=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(r.data);
}

describe('routes: a DM day limit does not stop joins',()=>{
  const calls:string[]=[];
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    calls.length=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      const path=new URL(String(url)).pathname;
      calls.push(path);
      return Response.json({ok:true,join:'joined',channelId:'1',accessHash:'2'});
    }));
    addRecord(ACC,'account',withDayLimitCooldown({...dmSpent(),name:'Acc',phone:'+79990000001'},'message'),
      await seal(JSON.stringify({kind:'tdata',zipBase64:'eA=='}),OWNER));
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});

  it('join_group joins from it and the join bump does not re-rest it for DMs',async()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...dmSpent(),name:'Acc'}),ACC);
    addRecord(GROUP,'group',{name:'G',url:'https://t.me/some_group',accountId:ACC,status:'new',membership:'none',joinWanted:true});

    const res=await POST(postRequest({action:'join_group',id:GROUP}));

    expect(res.status).toBe(200);
    expect(row(ACC)).toMatchObject({status:'active',joinsToday:1});
  });
});
