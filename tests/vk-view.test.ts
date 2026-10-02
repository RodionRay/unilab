import {describe,expect,it} from 'vitest';
import {moscowDayKey} from '@/lib/telegram-accounts';
import type {VkAccountData} from '@/lib/vk/pool';
import {
  failedChunkResults,leadPlatform,matchesLeadPlatform,matchesLeadSource,planVkImportChunks,remapChunkResults,
  safeVkHref,tallyVkImport,vkAccountView,vkPoolCanScan,
} from '@/lib/vk/view';

const NOW=Date.parse('2026-10-01T12:00:00Z');
const account=(over:Partial<VkAccountData>={}):VkAccountData=>({vkUserId:1,name:'Тест',proxyId:'p1',status:'active',...over});

describe('lead platform (REQ-11, D2)',()=>{
  it('reads a lead without platform as Telegram',()=>{
    expect(leadPlatform({})).toBe('telegram');
    expect(leadPlatform({platform:'telegram'})).toBe('telegram');
    expect(leadPlatform({platform:'vk'})).toBe('vk');
    expect(leadPlatform({platform:'VK'})).toBe('telegram');
  });

  it('filters by platform; all passes both',()=>{
    const tg={},vk={platform:'vk'};
    expect([tg,vk].filter(d=>matchesLeadPlatform(d,'all'))).toEqual([tg,vk]);
    expect([tg,vk].filter(d=>matchesLeadPlatform(d,'telegram'))).toEqual([tg]);
    expect([tg,vk].filter(d=>matchesLeadPlatform(d,'vk'))).toEqual([vk]);
  });

  it('source filter matches a Telegram group id or a VK source id',()=>{
    expect(matchesLeadSource({groupId:'g1'},'g1')).toBe(true);
    expect(matchesLeadSource({vkSourceId:'s1'},'s1')).toBe(true);
    expect(matchesLeadSource({groupId:'g1'},'s1')).toBe(false);
    expect(matchesLeadSource({},'all')).toBe(true);
    expect(matchesLeadSource({},'')).toBe(false);
  });
});

describe('safeVkHref (security: only https://vk.com/ links become an href)',()=>{
  it.each([
    'https://vk.com/wall-1001_501',
    'https://vk.com/wall-2002_77?reply=12',
    'https://vk.com/topic-2002_9?post=301',
  ])('keeps %s',(url)=>{
    expect(safeVkHref(url)).toBe(url);
  });

  it.each([
    ['javascript:alert(1)'],
    ['http://vk.com/wall1_1'],
    ['https://vk.com.evil.test/wall1_1'],
    ['https://evil.test/?https://vk.com/'],
    ['https://m.vk.com/wall1_1'],
    ['https://vk.com@evil.test/'],
    ['https://vk.com:8443/wall1_1'],
    ['https://vk.com/wall1_1\njavascript:alert(1)'],
    ['https://vk.com/ wall'],
    ['https://vk.com\\@evil.test'],
    ['HTTPS://VK.COM/wall1_1'],
    [''],
    [null],
    [undefined],
    [42],
  ])('rejects %j',(url)=>{
    expect(safeVkHref(url)).toBeNull();
  });

  it('rejects an oversized URL',()=>{
    expect(safeVkHref('https://vk.com/'+'a'.repeat(2100))).toBeNull();
  });
});

describe('planVkImportChunks (AM-10: ≤20 lines per request)',()=>{
  it('skips blank lines and keeps the paste line numbers',()=>{
    expect(planVkImportChunks('a\n\n  b  \r\n\nc')).toEqual([{text:'a\nb\nc',lines:[1,3,5]}]);
  });

  it('splits 45 lines into 20 + 20 + 5',()=>{
    const text=Array.from({length:45},(_,i)=>`t${i+1}`).join('\n');
    const chunks=planVkImportChunks(text);
    expect(chunks.map(c=>c.lines.length)).toEqual([20,20,5]);
    expect(chunks[1].lines[0]).toBe(21);
    expect(chunks[2].text.split('\n')).toEqual(['t41','t42','t43','t44','t45']);
  });

  it('returns no chunk for an empty paste',()=>{
    expect(planVkImportChunks(' \n\n')).toEqual([]);
  });

  it('maps server lines (per chunk) back to the paste',()=>{
    const [chunk]=planVkImportChunks('\nx\n\ny');
    expect(remapChunkResults(chunk,[{line:1,status:'added'},{line:2,status:'invalid',reason:'r'}]))
      .toEqual([{line:2,status:'added'},{line:4,status:'invalid',reason:'r'}]);
  });

  it('marks every line of a failed request invalid with its reason',()=>{
    const [chunk]=planVkImportChunks('x\ny');
    expect(failedChunkResults(chunk,'Сеть')).toEqual([
      {line:1,status:'invalid',reason:'Сеть'},
      {line:2,status:'invalid',reason:'Сеть'},
    ]);
  });

  it('tallies results by status',()=>{
    expect(tallyVkImport([{line:1,status:'added'},{line:2,status:'added'},{line:3,status:'no_proxy'},{line:4,status:'duplicate'}]))
      .toEqual({added:2,duplicate:1,invalid:0,no_proxy:1});
  });
});

describe('vkAccountView (REQ-12 status, reason, usage)',()=>{
  const day=moscowDayKey(new Date(NOW));

  it('active account: today usage and the search cap from settings',()=>{
    const v=vkAccountView(account({counters:{day,calls:214,searchCalls:38}}),{now:NOW,searchCap:300});
    expect(v).toMatchObject({status:'active',tone:'success',label:'Активен',detail:'',calls:214,searchCalls:38,searchCap:300});
  });

  it('yesterday counters read as zero and the cap defaults to 500',()=>{
    const v=vkAccountView(account({counters:{day:'2000-01-01',calls:9,searchCalls:9}}),{now:NOW});
    expect(v).toMatchObject({calls:0,searchCalls:0,searchCap:500});
  });

  it('cooldown shows time left and the reason; an expired cooldown is active',()=>{
    const until=new Date(NOW+42*60_000).toISOString();
    expect(vkAccountView(account({status:'cooldown',cooldownUntil:until,error:'VK 9'}),{now:NOW}))
      .toMatchObject({tone:'warning',label:'Пауза',detail:'ещё 42 мин · VK 9'});
    expect(vkAccountView(account({status:'cooldown',cooldownUntil:new Date(NOW-1).toISOString()}),{now:NOW}).status).toBe('active');
  });

  it('error and no_proxy carry the stored reason',()=>{
    expect(vkAccountView(account({status:'error',error:'Токен не принят'}),{now:NOW})).toMatchObject({tone:'danger',detail:'Токен не принят'});
    expect(vkAccountView(account({status:'no_proxy',proxyId:'',error:'Нет прокси'}),{now:NOW})).toMatchObject({tone:'warning',label:'Нет прокси'});
  });

  it('active account with a blocked search method says so',()=>{
    const v=vkAccountView(account({searchBlockedUntil:{'newsfeed.search':new Date(NOW+3600_000).toISOString()}}),{now:NOW});
    expect(v.detail).toBe('Поиск закрыт VK до полуночи МСК');
  });

  it('pool can scan only with an active or cooling account that has a proxy',()=>{
    expect(vkPoolCanScan([],NOW)).toBe(false);
    expect(vkPoolCanScan([{data:account({status:'error'})},{data:account({status:'no_proxy',proxyId:''})}],NOW)).toBe(false);
    expect(vkPoolCanScan([{data:account({proxyId:''})}],NOW)).toBe(false);
    expect(vkPoolCanScan([{data:account({status:'cooldown',cooldownUntil:new Date(NOW+60_000).toISOString()})}],NOW)).toBe(true);
  });
});
