import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

vi.mock('@/lib/users',()=>({listUserIdsForCron:async()=>[]}));

import {POST} from '@/app/api/cron/auto-rescan/route';
import {interleaveScans} from '@/lib/processes/scan-queue';

const SECRET='c'.repeat(40);

describe('interleaveScans (AM-12)',()=>{
  it('alternates Telegram groups and VK sources, the longer list finishing last',()=>{
    expect(interleaveScans(['g1','g2'],['v1','v2','v3'])).toEqual([
      {kind:'group',id:'g1'},{kind:'vk',id:'v1'},{kind:'group',id:'g2'},{kind:'vk',id:'v2'},{kind:'vk',id:'v3'},
    ]);
    expect(interleaveScans([],[])).toEqual([]);
  });
});

describe('cron auto-rescan with VK sources (REQ-8)',()=>{
  const actions:string[]=[];
  beforeEach(()=>{
    vi.stubEnv('CRON_SECRET',SECRET);
    vi.stubEnv('SESSION_SECRET','s'.repeat(40));
    vi.stubEnv('ADMIN_EMAIL','admin@example.com');
    vi.stubEnv('APP_URL','http://127.0.0.1:5173');
    actions.length=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
      if(!init?.method||init.method==='GET')return Response.json({records:[{kind:'settings',data:{}}]});
      const body=JSON.parse(String(init.body)) as {action:string;id?:string};
      actions.push(body.id?`${body.action}:${body.id}`:body.action);
      if(body.action==='rescan_groups')return Response.json({ok:true,groupIds:['g1','g2'],vkSourceIds:['v1','v2','v3'],total:2,vkTotal:4});
      if(body.action==='scan_group')return Response.json({ok:true,added:1});
      if(body.action==='scan_vk_source')return Response.json({ok:true,added:body.id==='v2'?0:2,skipped:body.id==='v2'});
      return Response.json({ok:true});
    }));
  });
  afterEach(()=>{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('scans due VK sources between Telegram groups and counts their leads',async()=>{
    const res=await POST(new Request('https://app.test/api/cron/auto-rescan',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));
    const body=await res.json() as {added:number;ticks:{scanned:number;skipped:number;vkScanned:number;due:number;more:boolean}[]};

    expect(actions.filter(a=>a.startsWith('scan_'))).toEqual([
      'scan_group:g1','scan_vk_source:v1','scan_group:g2','scan_vk_source:v2','scan_vk_source:v3',
    ]);
    expect(body.added).toBe(2*1+2*2);
    expect(body.ticks[0]).toMatchObject({scanned:4,skipped:1,vkScanned:2,due:6,more:true});
  });

  it('gives a VK scan the Telegram scan timeout (150 s), AI qualification included',async()=>{
    const timeouts:number[]=[];
    const timeoutOf=new Map<AbortSignal,number>();
    const real=AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const s=real(ms);timeoutOf.set(s,ms);return s});
    const inner=vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async(url,init)=>{
      const body=init?.body?JSON.parse(String(init.body)) as {action:string}:{action:''};
      if(body.action==='scan_vk_source')timeouts.push(timeoutOf.get(init!.signal as AbortSignal)??0);
      return inner(url,init);
    });

    await POST(new Request('https://app.test/api/cron/auto-rescan',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));

    expect(timeouts[0]).toBe(150_000);
  });

  it('a VK scan that times out skips the other VK sources but not the Telegram groups',async()=>{
    const inner=vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async(url,init)=>{
      const body=init?.body?JSON.parse(String(init.body)) as {action:string;id?:string}:{action:''};
      if(body.action==='scan_vk_source'&&body.id==='v1'){
        actions.push(`scan_vk_source:${body.id}`);
        throw new DOMException('The operation was aborted due to timeout','TimeoutError');
      }
      return inner(url,init);
    });

    const res=await POST(new Request('https://app.test/api/cron/auto-rescan',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));
    const body=await res.json() as {ticks:{scanned:number;more:boolean;errors:string[]}[]};

    expect(actions.filter(a=>a.startsWith('scan_'))).toEqual(['scan_group:g1','scan_vk_source:v1','scan_group:g2']);
    expect(body.ticks[0]).toMatchObject({scanned:2,more:true});
    expect(body.ticks[0]!.errors.join(' ')).toContain('vk timeout:v1');
  });
});
