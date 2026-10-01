import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {runSequential} from '@/lib/bulk-sequence';

const PAUSE_MS=1500;

/** Drives fake time until the run settles; returns the summary and fake ms spent. */
async function drive<T>(run:Promise<T>):Promise<{value:T;elapsed:number}>{
  const start=Date.now();
  let settled=false;
  const pending=run.finally(()=>{settled=true});
  while(!settled)await vi.advanceTimersByTimeAsync(100);
  return {value:await pending,elapsed:Date.now()-start};
}

describe('runSequential: по одному элементу за запрос',()=>{
  beforeEach(()=>{vi.useFakeTimers({toFake:['setTimeout','Date']})});
  afterEach(()=>{vi.useRealTimers()});

  it('идёт по порядку, пауза между элементами, но не после последнего',async()=>{
    const at:number[]=[];
    const step=vi.fn<(id:string)=>Promise<{ok:boolean;error:string}>>(async()=>{at.push(Date.now());return {ok:true,error:''}});

    const {value,elapsed}=await drive(runSequential(['a','b','c'],step,{pauseMs:PAUSE_MS}));

    expect(step.mock.calls.map(c=>c[0])).toEqual(['a','b','c']);
    expect(at[1]-at[0]).toBeGreaterThanOrEqual(PAUSE_MS);
    expect(at[2]-at[1]).toBeGreaterThanOrEqual(PAUSE_MS);
    expect(elapsed).toBeLessThan(PAUSE_MS*3);
    expect(value).toEqual({updated:3,failed:0,firstError:''});
  });

  it('сообщает прогресс «k из N» перед каждым элементом',async()=>{
    const progress:string[]=[];

    await drive(runSequential(['a','b'],async()=>({ok:true,error:''}),{pauseMs:PAUSE_MS,onProgress:(k,n)=>progress.push(`${k}/${n}`)}));

    expect(progress).toEqual(['1/2','2/2']);
  });

  it('ошибка шага и брошенное исключение считаются неудачей, цикл продолжается, первая причина сохранена',async()=>{
    const step=async(id:string)=>{
      if(id==='a')return {ok:false,error:'Нет сессии'};
      if(id==='b')throw new SyntaxError('Unexpected token < in JSON');
      return {ok:true,error:''};
    };

    const {value}=await drive(runSequential(['a','b','c'],step,{pauseMs:PAUSE_MS,describeError:()=>'Сервер не ответил'}));

    expect(value).toEqual({updated:1,failed:2,firstError:'Нет сессии'});
  });

  it('брошенное исключение даёт причину через describeError',async()=>{
    const {value}=await drive(runSequential(['a'],async()=>{throw new Error('524')},{pauseMs:PAUSE_MS,describeError:()=>'Сервер не ответил'}));

    expect(value).toEqual({updated:0,failed:1,firstError:'Сервер не ответил'});
  });

  it('пустой список — ничего не вызывает',async()=>{
    const step=vi.fn(async()=>({ok:true,error:''}));

    const {value}=await drive(runSequential([],step,{pauseMs:PAUSE_MS}));

    expect(step).not.toHaveBeenCalled();
    expect(value).toEqual({updated:0,failed:0,firstError:''});
  });
});
