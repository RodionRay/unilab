import {describe,expect,it} from 'vitest';
import {mergeKeywords} from '@/lib/ai-keywords';

describe('mergeKeywords',()=>{
  it('splits a comma-separated addition into separate terms instead of appending it as one block',()=>{
    const once=mergeKeywords('шабашка','вакансия, резюме');

    expect(mergeKeywords(once,'вакансия, резюме')).toBe('шабашка, вакансия, резюме');
  });

  it('drops duplicates already present in the base, case-insensitively with ё = е, first occurrence wins',()=>{
    expect(mergeKeywords('Таро, вакансия, таро, твёрдый, твердый, ВАКАНСИЯ',[])).toBe('Таро, вакансия, твёрдый');
  });

  it('skips an addition that differs from a base term only by case or ё',()=>{
    expect(mergeKeywords('Твёрдый',['твердый','новый'])).toBe('Твёрдый, новый');
  });
});
