import {describe,expect,it} from 'vitest';
import {canonicalVkGroupUrl,parseVkGroupUrl} from '@/lib/vk/url';

describe('parseVkGroupUrl (REQ-4)',()=>{
  it.each([
    ['https://vk.com/club123','id',123],
    ['vk.com/public456','id',456],
    ['https://m.vk.com/event789?from=feed','id',789],
    ['http://www.vk.ru/club5/','id',5],
  ])('%s → numeric id',(input,kind,groupId)=>{
    expect(parseVkGroupUrl(input)).toEqual({kind,groupId});
  });

  it.each([
    ['https://vk.com/Biz_Test','biz_test'],
    ['m.vk.com/niche.test','niche.test'],
    ['vk.com/clubnews','clubnews'],
  ])('%s → screen name to resolve',(input,screenName)=>{
    expect(parseVkGroupUrl(input)).toEqual({kind:'screen_name',screenName});
  });

  it.each([
    '',
    'https://vk.com/id700100',
    'https://vk.com/feed',
    'https://vk.com/wall-1_2/extra',
    'https://evil.com/club1',
    'https://vk.com.evil.com/club1',
    'ftp://vk.com/club1',
    'https://user:pw@vk.com/club1',
    'https://vk.com/',
    'https://vk.com/club0',
  ])('rejects %s',(input)=>{
    expect(parseVkGroupUrl(input)).toBeNull();
  });
});

describe('canonicalVkGroupUrl',()=>{
  it('is the club<id> link',()=>{
    expect(canonicalVkGroupUrl(22000)).toBe('https://vk.com/club22000');
  });

  it('rejects non-positive ids',()=>{
    expect(()=>canonicalVkGroupUrl(-1)).toThrow(RangeError);
  });
});
