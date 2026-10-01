import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  VK_CALL_PATH,VK_CODE_NETWORK,VK_CODE_PROXY,classifyVkError,groupIdFromResolve,groupsFromGetById,
  runVkBatch,shouldFailOver,vkMethods,type VkCall,
} from '@/lib/vk/client';
import {moscowNextMidnightIso} from '@/lib/telegram-accounts';

const fixture=(name:string)=>JSON.parse(readFileSync(path.resolve(__dirname,'fixtures/vk',name),'utf8'));
const NOW=Date.parse('2026-10-01T10:00:00Z');
const PROXY={host:'203.0.113.5',port:1080,protocol:'socks5' as const};
const CALLS:VkCall[]=[vkMethods.usersGet(),vkMethods.wallGet({groupId:22000})];

describe('vkMethods builders',()=>{
  it('newsfeed.search asks for extended authors and caps count at 200',()=>{
    const call=vkMethods.newsfeedSearch({q:'ищу crm',startTime:100,endTime:200,startFrom:'4/-1_2',count:999});
    expect(call).toEqual({method:'newsfeed.search',params:{q:'ищу crm',extended:1,count:200,start_time:100,end_time:200,start_from:'4/-1_2'}});
  });

  it('omits unset newsfeed cursor params',()=>{
    expect(vkMethods.newsfeedSearch({q:'x'}).params).toEqual({q:'x',extended:1,count:200});
  });

  it('wall.get reads the community wall by negative owner id',()=>{
    expect(vkMethods.wallGet({groupId:22000,count:50}).params).toMatchObject({owner_id:-22000,count:50,extended:1});
  });

  it('board and comment readers cap pages at 100',()=>{
    expect(vkMethods.wallGetComments({ownerId:-1,postId:2,count:500}).params.count).toBe(100);
    expect(vkMethods.boardGetComments({groupId:1,topicId:2}).params).toMatchObject({group_id:1,topic_id:2,count:100});
    expect(vkMethods.boardGetTopics({groupId:1}).params).toMatchObject({group_id:1,count:100});
  });
});

describe('response narrowing (fixtures, synthetic until S0)',()=>{
  it('groups.getById accepts the 5.199 {groups} object and the legacy array',()=>{
    const groups=groupsFromGetById(fixture('groups.getById.json').response);
    expect(groups.map((g)=>g.id)).toEqual([22000]);
    expect(groupsFromGetById([{id:5,name:'x'}]).map((g)=>g.id)).toEqual([5]);
    expect(groupsFromGetById(null)).toEqual([]);
  });

  it('utils.resolveScreenName yields a community id only for communities',()=>{
    const f=fixture('utils.resolveScreenName.json');
    expect(groupIdFromResolve(f.group.response)).toBe(22000);
    expect(groupIdFromResolve(f.user.response)).toBeNull();
    expect(groupIdFromResolve(f.missing.response)).toBeNull();
  });
});

describe('runVkBatch',()=>{
  it('posts token, proxy and calls to /vk-call with a timeout above the worker deadline',async()=>{
    const post=vi.fn(async()=>({ok:true,results:[{ok:true,response:[{id:1}]},{ok:false,error:{code:15,msg:'Access denied'}}]}));
    const out=await runVkBatch(post,{token:'tok',proxy:PROXY,calls:CALLS});
    expect(post).toHaveBeenCalledWith(VK_CALL_PATH,{token:'tok',proxy:PROXY,calls:CALLS},expect.any(Number));
    expect((post.mock.calls[0] as unknown[])[2]).toBeGreaterThanOrEqual(60_000);
    expect(out).toEqual([{ok:true,response:[{id:1}]},{ok:false,error:{code:15,msg:'Access denied'}}]);
  });

  it('fails every call with a network code when the worker throws',async()=>{
    const out=await runVkBatch(async()=>{throw new Error('ECONNREFUSED');},{token:'t',proxy:null,calls:CALLS});
    expect(out.map((r)=>!r.ok&&r.error.code)).toEqual([VK_CODE_NETWORK,VK_CODE_NETWORK]);
  });

  it('maps a worker proxy refusal to the proxy code',async()=>{
    const out=await runVkBatch(async()=>({ok:false,status:'proxy_error',error:'Недопустимый адрес прокси'}),{token:'t',proxy:PROXY,calls:CALLS});
    expect(out.every((r)=>!r.ok&&r.error.code===VK_CODE_PROXY)).toBe(true);
  });

  it('treats a result count mismatch as a failed batch',async()=>{
    const out=await runVkBatch(async()=>({ok:true,results:[{ok:true,response:1}]}),{token:'t',proxy:null,calls:CALLS});
    expect(out).toHaveLength(2);
    expect(out.every((r)=>!r.ok)).toBe(true);
  });

  it('refuses empty and oversized batches before calling the worker',async()=>{
    const post=vi.fn();
    await expect(runVkBatch(post,{token:'t',proxy:null,calls:[]})).rejects.toThrow(RangeError);
    await expect(runVkBatch(post,{token:'t',proxy:null,calls:Array(26).fill(vkMethods.usersGet())})).rejects.toThrow(RangeError);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('classifyVkError (AM-8)',()=>{
  const errors=fixture('errors.json');
  const cls=(name:string)=>{
    const e=errors[name].error;
    return classifyVkError({code:e.error_code,msg:e.error_msg},NOW);
  };

  it('6 → retry on the same token',()=>{
    expect(cls('too_many_rps').kind).toBe('retry');
  });

  it('9 → account cooldown for 30 minutes',()=>{
    expect(cls('flood')).toMatchObject({kind:'cooldown',until:new Date(NOW+30*60_000).toISOString()});
  });

  it('14 → account cooldown for 60 minutes, no captcha solving',()=>{
    expect(cls('captcha')).toMatchObject({kind:'cooldown',until:new Date(NOW+60*60_000).toISOString()});
  });

  it('29 → method blocked until the next Moscow midnight',()=>{
    expect(cls('rate_limit')).toMatchObject({kind:'method_blocked',until:moscowNextMidnightIso(NOW)});
  });

  it.each([5,17,18])('%i → account error',(code)=>{
    expect(classifyVkError({code,msg:''},NOW).kind).toBe('account_error');
  });

  it.each([15,30,203,212])('%i → skip the item, no failover',(code)=>{
    const c=classifyVkError({code,msg:''},NOW);
    expect(c.kind).toBe('skip_item');
    expect(shouldFailOver(c)).toBe(false);
  });

  it('transport failures retry; a refused proxy rests the account',()=>{
    expect(classifyVkError({code:-1,msg:'deadline'},NOW).kind).toBe('retry');
    expect(classifyVkError({code:VK_CODE_NETWORK,msg:''},NOW).kind).toBe('retry');
    expect(classifyVkError({code:VK_CODE_PROXY,msg:''},NOW).kind).toBe('cooldown');
  });

  it.each([5,6,9,14,29])('REQ-1b: error %i fails over to the next account',(code)=>{
    expect(shouldFailOver(classifyVkError({code,msg:''},NOW))).toBe(true);
  });
});
