import {describe,expect,it,vi} from 'vitest';
import {testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/tma/actor',()=>({resolveTmaActor:async()=>({ownerId:'owner-1',userId:'owner-1',isOwner:true})}));
vi.mock('@/lib/tma/feed',()=>({buildFeed:async()=>{throw new Error('D1 down')}}));

import {GET} from '@/app/api/tma/feed/route';
import {TmaApiError,createTmaClient} from '@/lib/tma/client';

describe('GET /api/tma/feed · сбой чтения',()=>{
 it('503 с кодом unavailable (не bad_request), без деталей сбоя',async()=>{
  testDb();
  vi.spyOn(console,'error').mockImplementation(()=>{});

  const res=await GET(new Request('http://crm.test/api/tma/feed?view=overview',{headers:{authorization:'Bearer tma.a.b'}}));
  const body=await res.json() as {code:string;error:string};

  expect(res.status).toBe(503);
  expect(body.code).toBe('unavailable');
  expect(body.error).not.toContain('D1');
 });

 it('клиент узнаёт unavailable и по коду, и по статусу 503 без тела',async()=>{
  const replies=[
   Response.json({token:'tma.x',expiresAt:Math.floor(Date.now()/1000)+3600,me:{name:'A',role:'owner',access:[]},workspace:{name:'W'}}),
   Response.json({error:'Не удалось загрузить данные. Повторите попытку.',code:'unavailable'},{status:503}),
   new Response('upstream',{status:503}),
  ];
  const client=createTmaClient({wsKey:'k',initData:'x',fetchImpl:(async()=>replies.shift()!) as typeof fetch});
  await client.openSession();

  const coded=await client.feed('overview').catch((e:unknown)=>e);
  const bare=await client.feed('overview').catch((e:unknown)=>e);

  expect(coded).toBeInstanceOf(TmaApiError);
  expect((coded as TmaApiError).code).toBe('unavailable');
  expect((bare as TmaApiError).code).toBe('unavailable');
 });
});
