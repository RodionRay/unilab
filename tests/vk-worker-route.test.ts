import {describe,expect,it} from 'vitest';
import {ROUTES,timeoutForAction} from '../telegram-worker/src/worker-app.mjs';

describe('worker route /vk-call (spec vk-lead-source AM-6, AM-7)',()=>{
  it('maps /vk-call to the vk_call Python action',()=>{
    expect(ROUTES['/vk-call']).toBe('vk_call');
  });

  it('waits at least 60 s, above the 45 s Python deadline, so the batch answers itself',()=>{
    expect(timeoutForAction('vk_call')).toBeGreaterThanOrEqual(60_000);
  });
});
