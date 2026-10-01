import {describe,expect,it} from 'vitest';
import {moscowDayKey} from '@/lib/telegram-accounts';
import {classifyVkError} from '@/lib/vk/client';
import {
  VK_SEARCH_METHOD,applyVkError,effectiveVkStatus,isVkAccountAvailable,leaseVkAccount,pickVkAccount,
  recordVkCalls,releaseVkAccount,vkUsageToday,type VkAccountData,type VkAccountRow,
} from '@/lib/vk/pool';

const NOW=Date.parse('2026-10-01T10:00:00Z');
const TODAY=moscowDayKey(new Date(NOW));
const iso=(ms:number)=>new Date(NOW+ms).toISOString();
const acc=(over:Partial<VkAccountData>={}):VkAccountData=>({
  vkUserId:1,name:'A',proxyId:'p1',status:'active',counters:{day:TODAY,calls:0,searchCalls:0},...over,
});
const row=(id:string,over:Partial<VkAccountData>={}):VkAccountRow=>({id,data:acc(over)});
const SEARCH={method:VK_SEARCH_METHOD,now:NOW};

describe('pickVkAccount (REQ-1b)',()=>{
  it('picks the active account least used today',()=>{
    const pool=[row('a',{counters:{day:TODAY,calls:9,searchCalls:9}}),row('b',{counters:{day:TODAY,calls:2,searchCalls:2}})];
    expect(pickVkAccount(pool,SEARCH)?.id).toBe('b');
  });

  it('reads yesterday\'s counters as zero',()=>{
    const pool=[row('a',{counters:{day:TODAY,calls:3,searchCalls:0}}),row('b',{counters:{day:'2026-09-30',calls:400,searchCalls:400}})];
    expect(pickVkAccount(pool,SEARCH)?.id).toBe('b');
  });

  it('skips error, no_proxy, cooling, leased, method-blocked and excluded accounts',()=>{
    const pool=[
      row('err',{status:'error'}),
      row('np',{status:'no_proxy',proxyId:''}),
      row('cool',{status:'cooldown',cooldownUntil:iso(60_000)}),
      row('lease',{leaseId:'x',leaseUntil:iso(60_000)}),
      row('blocked',{searchBlockedUntil:{[VK_SEARCH_METHOD]:iso(60_000)}}),
      row('excluded'),
    ];
    expect(pickVkAccount(pool,{...SEARCH,exclude:new Set(['excluded'])})).toBeNull();
  });

  it('a method block applies only to that method',()=>{
    const pool=[row('a',{searchBlockedUntil:{[VK_SEARCH_METHOD]:iso(60_000)}})];
    expect(pickVkAccount(pool,{method:'wall.get',now:NOW})?.id).toBe('a');
  });

  it('an expired cooldown or lease makes the account usable again',()=>{
    const data=acc({status:'cooldown',cooldownUntil:iso(-1),leaseId:'old',leaseUntil:iso(-1)});
    expect(effectiveVkStatus(data,NOW)).toBe('active');
    expect(isVkAccountAvailable(data,SEARCH)).toBe(true);
  });
});

describe('daily caps (REQ-10)',()=>{
  it('stops newsfeed.search at the default 500 a day but keeps other methods',()=>{
    const data=acc({counters:{day:TODAY,calls:500,searchCalls:500}});
    expect(isVkAccountAvailable(data,SEARCH)).toBe(false);
    expect(isVkAccountAvailable(data,{method:'wall.get',now:NOW})).toBe(true);
  });

  it('honours a configured cap; 0 means no cap',()=>{
    const data=acc({counters:{day:TODAY,calls:10,searchCalls:10}});
    expect(isVkAccountAvailable(data,{...SEARCH,caps:{search:10,calls:0}})).toBe(false);
    expect(isVkAccountAvailable(data,{...SEARCH,caps:{search:0,calls:0}})).toBe(true);
    expect(isVkAccountAvailable(data,{method:'wall.get',now:NOW,caps:{search:0,calls:10}})).toBe(false);
  });

  it('counts calls, search calls separately, and restarts at Moscow midnight',()=>{
    let data=recordVkCalls(acc(),{method:VK_SEARCH_METHOD,count:3,now:NOW});
    data=recordVkCalls(data,{method:'wall.get',count:2,now:NOW});
    expect(vkUsageToday(data,NOW)).toEqual({calls:5,searchCalls:3});
    const nextMoscowDay=Date.parse('2026-10-01T21:30:00Z'); // 00:30 MSK on 2 Oct
    const fresh=recordVkCalls(data,{method:VK_SEARCH_METHOD,now:nextMoscowDay});
    expect(fresh.counters).toEqual({day:'2026-10-02',calls:1,searchCalls:1});
  });
});

describe('lease (AM-9)',()=>{
  it('one live lease per account',()=>{
    const leased=leaseVkAccount(acc(),{leaseId:'run1',now:NOW});
    expect(leased?.leaseId).toBe('run1');
    expect(leaseVkAccount(leased!,{leaseId:'run2',now:NOW+1000})).toBeNull();
    expect(leaseVkAccount(leased!,{leaseId:'run1',now:NOW+1000})?.leaseId).toBe('run1');
  });

  it('an expired lease can be taken over',()=>{
    const stale=acc({leaseId:'dead',leaseUntil:iso(-1)});
    expect(leaseVkAccount(stale,{leaseId:'run2',now:NOW})?.leaseId).toBe('run2');
  });

  it('only the holder releases the lease',()=>{
    const leased=acc({leaseId:'run1',leaseUntil:iso(60_000)});
    expect(releaseVkAccount(leased,'other')).toBe(leased);
    const freed=releaseVkAccount(leased,'run1');
    expect(freed.leaseId).toBeUndefined();
    expect(freed.leaseUntil).toBeUndefined();
  });
});

describe('applyVkError (AM-8, REQ-2, REQ-9)',()=>{
  const apply=(code:number,method='wall.get')=>applyVkError(acc(),classifyVkError({code,msg:''},NOW),method);

  it('5 marks the account error with the reason',()=>{
    const next=apply(5);
    expect(next.status).toBe('error');
    expect(next.error).toContain('5');
    expect(isVkAccountAvailable(next,SEARCH)).toBe(false);
  });

  it('14 puts the account in cooldown for an hour, then it returns',()=>{
    const next=apply(14);
    expect(next).toMatchObject({status:'cooldown',cooldownUntil:iso(60*60_000)});
    expect(isVkAccountAvailable(next,SEARCH)).toBe(false);
    expect(isVkAccountAvailable(next,{...SEARCH,now:NOW+60*60_000+1})).toBe(true);
  });

  it('29 blocks only the failing method',()=>{
    const next=apply(29,VK_SEARCH_METHOD);
    expect(next.status).toBe('active');
    expect(isVkAccountAvailable(next,SEARCH)).toBe(false);
    expect(isVkAccountAvailable(next,{method:'wall.get',now:NOW})).toBe(true);
  });

  it('6 and item errors leave the account unchanged',()=>{
    const data=acc();
    expect(applyVkError(data,classifyVkError({code:6,msg:''},NOW),'wall.get')).toBe(data);
    expect(applyVkError(data,classifyVkError({code:203,msg:''},NOW),'wall.get')).toBe(data);
  });
});
