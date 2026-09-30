import {describe,expect,it,vi} from 'vitest';
import {createCronLoop} from '../telegram-worker/src/worker-app.mjs';

const SECRET='z'.repeat(40);
const quiet={log:()=>{},warn:()=>{}};

function loop(fetchImpl:typeof fetch,extra:Partial<Parameters<typeof createCronLoop>[0]>={}){
  const scheduled:number[]=[];
  const l=createCronLoop({
    name:'tasks-tick',url:'http://127.0.0.1:5173/api/cron/tasks-tick',secret:SECRET,fetchMs:1_000,catchUpMs:500,
    fetchImpl,schedule:(_fn:()=>void,ms:number)=>{scheduled.push(ms)},log:quiet,...extra,
  });
  return {l,scheduled};
}

describe('worker cron loop for /api/cron/tasks-tick (REQ-I4)',()=>{
  it('posts with the Bearer secret and never runs two calls at once',async()=>{
    let open:()=>void=()=>{};
    const fetchImpl=vi.fn(async()=>{await new Promise<void>(r=>{open=r});return Response.json({ok:true})});
    const {l}=loop(fetchImpl as unknown as typeof fetch);

    const first=l.tick();
    expect(await l.tick()).toEqual({skipped:true,reason:'busy'});
    open();
    await first;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,{headers:Record<string,string>}];
    expect(url).toBe('http://127.0.0.1:5173/api/cron/tasks-tick');
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it('schedules a catch-up run when the app reports more:true or times out',async()=>{
    const more=loop((async()=>Response.json({ok:true,more:true})) as unknown as typeof fetch);
    await more.l.tick();
    expect(more.scheduled).toEqual([500]);

    const slow=loop((async()=>{throw Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'})}) as unknown as typeof fetch);
    await slow.l.tick();
    expect(slow.scheduled).toEqual([500]);
  });

  it('does not send the secret without CRON_SECRET or to a plain-http remote host',async()=>{
    const fetchImpl=vi.fn();
    expect(await loop(fetchImpl as unknown as typeof fetch,{secret:''}).l.tick()).toMatchObject({reason:'no_secret'});
    expect(await loop(fetchImpl as unknown as typeof fetch,{url:'http://app.example.com/api/cron/tasks-tick'}).l.tick()).toMatchObject({reason:'insecure_app_url'});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
