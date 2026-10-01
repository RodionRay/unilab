/**
 * Client-side bulk runner: one request per item, so a long batch never hits proxy/tunnel timeouts
 * (Cloudflare 524 at ~100 s) and a failed or dropped request costs one item, not the rest.
 */
export type StepResult={ok:boolean;error:string};
export type SequenceSummary={updated:number;failed:number;firstError:string};
export type SequenceOptions={
 pauseMs:number;
 onProgress?:(current:number,total:number)=>void;
 describeError?:(e:unknown)=>string;
};

const defaultDescribe=(e:unknown)=>e instanceof Error?e.message:String(e);

export async function runSequential(ids:readonly string[],step:(id:string)=>Promise<StepResult>,opts:SequenceOptions):Promise<SequenceSummary>{
 const describe=opts.describeError??defaultDescribe;
 let updated=0;
 let failed=0;
 let firstError='';
 for(const [i,id] of ids.entries()){
  opts.onProgress?.(i+1,ids.length);
  let result:StepResult;
  try{result=await step(id)}
  catch(e){result={ok:false,error:describe(e)}}
  if(result.ok)updated++;
  else{
   failed++;
   if(!firstError)firstError=result.error;
  }
  if(i<ids.length-1)await new Promise(r=>setTimeout(r,opts.pauseMs));
 }
 return {updated,failed,firstError};
}
