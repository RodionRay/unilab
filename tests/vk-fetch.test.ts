import {describe,expect,it} from 'vitest';
import {VK_BOARD_TOPICS_PER_RUN,fetchVkGroup,type VkRunCalls} from '@/lib/vk/fetch';
import type {VkCall,VkResult} from '@/lib/vk/client';
import type {VkSourceCursor} from '@/lib/vk/records';

const GROUP=22000;
const DEPTH=500;

/** board.getTopics answers newest-updated first (order=1), like VK. */
function boardRun(updated:readonly number[]){
  const read:number[]=[];
  const run:VkRunCalls=async(calls:readonly VkCall[])=>calls.map((c):VkResult=>{
    if(c.method==='wall.get')return {ok:true,response:{count:0,items:[]}};
    if(c.method==='board.getTopics'){
      const items=[...updated].sort((a,b)=>b-a).map(u=>({id:u,title:`t${u}`,created:u,updated:u}));
      return {ok:true,response:{count:items.length,items}};
    }
    if(c.method==='board.getComments'){
      read.push(Number(c.params.topic_id));
      return {ok:true,response:{count:0,items:[]}};
    }
    return {ok:false,error:{code:100,msg:'unexpected'}};
  });
  return {run,read};
}

describe('fetchVkGroup board cursor (REQ-4)',()=>{
  it('reads every fresh topic across runs when more than the per-run cap were updated',async()=>{
    const updated=[1001,1002,1003,1004,1005,1006,1007];
    const {run,read}=boardRun(updated);
    let cursor:VkSourceCursor={boardSince:1000};

    for(let i=0;i<3;i++)cursor=(await fetchVkGroup(run,{groupId:GROUP,cursor,depthCutoffSec:DEPTH})).cursor;

    expect(updated.length).toBeGreaterThan(VK_BOARD_TOPICS_PER_RUN);
    expect([...new Set(read)].sort()).toEqual(updated);
    expect(cursor.boardSince).toBe(1007);
  });

  it('reads at most the per-run cap of topics in one run and keeps the rest for the next',async()=>{
    const {run,read}=boardRun([1001,1002,1003,1004,1005,1006,1007]);

    const out=await fetchVkGroup(run,{groupId:GROUP,cursor:{boardSince:1000},depthCutoffSec:DEPTH});

    expect(read).toHaveLength(VK_BOARD_TOPICS_PER_RUN);
    expect(read.sort()).toEqual([1001,1002,1003,1004,1005]);
    expect(out.cursor.boardSince).toBe(1005);
  });
});
