import {describe,expect,it,vi} from 'vitest';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);

import {sourceStateSets} from '@/lib/processes/vk-scan';

describe('sourceStateSets (json_set paths of a VK source update)',()=>{
  it('builds one placeholder pair per letter-only key',()=>{
    expect(sourceStateSets(['cursor','lastScanAt'])).toBe("'$.cursor',json(?),'$.lastScanAt',json(?)");
  });

  it.each(["a',data,'x","a.b","a b","scan_log","$","",'k1'])('rejects the key %j that is not letters only',(key)=>{
    expect(()=>sourceStateSets(['cursor',key])).toThrow(/key/);
  });
});
