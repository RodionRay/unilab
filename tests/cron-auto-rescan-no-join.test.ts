import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

vi.mock('@/lib/users',()=>({listUserIdsForCron:async()=>[{userId:'owner-1',email:'owner@example.com',name:'Owner'}]}));

import {POST} from '@/app/api/cron/auto-rescan/route';

const SECRET='c'.repeat(40);
const JOINED='11111111-1111-4111-8111-111111111111';
const NEEDS_JOIN='22222222-2222-4222-8222-222222222222';

type Posted={action:string;[k:string]:unknown};

describe('cron auto-rescan не вступает в группы (REQ-6)',()=>{
  const posted:Posted[]=[];
  beforeEach(()=>{
    posted.length=0;
    vi.stubEnv('CRON_SECRET',SECRET);
    vi.stubEnv('SESSION_SECRET','s'.repeat(40));
    vi.stubEnv('ADMIN_EMAIL','');
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:{method?:string;body?:string})=>{
      if(init?.method!=='POST')return Response.json({records:[{kind:'settings',data:{autoRescanEnabled:true}}]});
      const body=JSON.parse(String(init.body||'{}')) as Posted;
      posted.push(body);
      if(body.action==='rescan_groups'){
        // Старый контракт отдавал rejoinItems — крон не должен по ним вступать.
        return Response.json({ok:true,groupIds:[JOINED,NEEDS_JOIN],total:2,needJoin:1,unavailable:[],rejoinItems:[{id:NEEDS_JOIN,name:'N'}]});
      }
      if(body.action==='scan_group'&&body.id===NEEDS_JOIN){
        return Response.json({error:'Сначала вступите в группу',needJoin:true,rejoinItem:{id:NEEDS_JOIN,name:'N'}},{status:409});
      }
      if(body.action==='scan_group')return Response.json({ok:true,added:2});
      return Response.json({ok:true});
    }));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('сканирует вступившие группы, группу без членства пропускает и пишет в журнал',async()=>{
    const res=await POST(new Request('https://app.test/api/cron/auto-rescan',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));
    const body=await res.json() as {scanned:number;added:number};

    expect(res.status).toBe(200);
    expect(posted.some(p=>p.action==='join_group')).toBe(false);
    expect(body.scanned).toBe(1);
    expect(body.added).toBe(2);
    const mark=posted.find(p=>p.action==='mark_auto_rescan');
    expect(String(mark?.summary)).toMatch(/нужно вступить/);
  });
});
