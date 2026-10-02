import {describe,expect,it} from 'vitest';
import {moscowDayKey} from '@/lib/telegram-accounts';
import {classifyVkError} from '@/lib/vk/client';
import type {VkAccountData} from '@/lib/vk/pool';
import {
  countVkStatuses,failedChunkResults,leadPlatform,matchesLeadPlatform,matchesLeadSource,planVkImportChunks,pluralRu,planVkAutoProxy,
  remapChunkResults,safeVkHref,tallyVkImport,vkAccountView,vkErrorView,vkImportHeadline,vkLinesToRetry,vkPoolCanScan,
  VK_BAD_LINE_TEXT,VK_GROUPS_LEDE,matchesVkAccountQuery,vkLeadsNote,sortVkAccountsForTriage,vkAccountsPage,vkSourceLeadsLine,vkUsageLine,
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

  it('cooldown says why and until when (Moscow clock); the raw code stays in detailRaw; an expired cooldown is active',()=>{
    const until=new Date(NOW+42*60_000).toISOString();
    expect(vkAccountView(account({status:'cooldown',cooldownUntil:until,error:'VK 9: Flood control'}),{now:NOW}))
      .toMatchObject({tone:'warning',label:'Пауза',detail:'VK ограничил частоту, пауза до 15:42 МСК',detailRaw:'VK 9: Flood control'});
    expect(vkAccountView(account({status:'cooldown',cooldownUntil:until}),{now:NOW}).detail).toBe('Пауза, ещё 42 мин');
    expect(vkAccountView(account({status:'cooldown',cooldownUntil:new Date(NOW-1).toISOString()}),{now:NOW}).status).toBe('active');
  });

  it('error and no_proxy read as an action, not a code',()=>{
    expect(vkAccountView(account({status:'error',error:'VK 5: Токен недействителен или истёк'}),{now:NOW}))
      .toMatchObject({tone:'danger',detail:'Токен недействителен: вставьте новый'});
    expect(vkAccountView(account({status:'no_proxy',proxyId:'',error:'Нет свободного активного прокси'}),{now:NOW,perProxyCap:3}))
      .toMatchObject({tone:'warning',label:'Нет прокси',detail:'Все прокси заняты (по 3 аккаунта). Добавьте прокси в разделе «Прокси»'});
  });

  it('active account with a blocked search method says so',()=>{
    const v=vkAccountView(account({searchBlockedUntil:{'newsfeed.search':new Date(NOW+3600_000).toISOString()}}),{now:NOW});
    expect(v.detail).toBe('Дневной лимит поиска исчерпан до 00:00 МСК');
  });

  it('pool can scan only with an active or cooling account that has a proxy',()=>{
    expect(vkPoolCanScan([],NOW)).toBe(false);
    expect(vkPoolCanScan([{data:account({status:'error'})},{data:account({status:'no_proxy',proxyId:''})}],NOW)).toBe(false);
    expect(vkPoolCanScan([{data:account({proxyId:''})}],NOW)).toBe(false);
    expect(vkPoolCanScan([{data:account({status:'cooldown',cooldownUntil:new Date(NOW+60_000).toISOString()})}],NOW)).toBe(true);
  });
});

describe('vkErrorView (panel fix 3: Russian actionable text, raw code only in the title)',()=>{
  const until=new Date(NOW+30*60_000).toISOString();
  it.each([
    ['VK 5: Токен недействителен или истёк',5,'Токен недействителен: вставьте новый'],
    ['Токен не принят: VK 5 User authorization failed: invalid access_token (4).',5,'Токен недействителен: вставьте новый'],
    ['VK 17: Требуется проверка аккаунта (validation required)',17,'Аккаунт заблокирован или требует проверки. Войдите в VK и пройдите проверку'],
    ['VK 18: Страница удалена или заблокирована',18,'Аккаунт заблокирован или требует проверки. Войдите в VK и пройдите проверку'],
    ['VK 29: Дневной лимит метода',29,'Дневной лимит поиска исчерпан до 00:00 МСК'],
    ['VK -5: Прокси недоступен',-5,'Прокси не отвечает, выберите другой'],
    ['Сообщество закрыто или стена недоступна (VK 15 Access denied)',15,'Сообщество закрыто: аккаунт не видит стену. Вступите в него с VK-аккаунта или удалите источник'],
    ['Нет доступа к сообществу',203,'Сообщество закрыто: аккаунт не видит стену. Вступите в него с VK-аккаунта или удалите источник'],
    ['Не удалось проверить: VK -2 Временная ошибка VK',-2,'VK не ответил вовремя, повторим при следующем обходе'],
  ])('%s',(raw,code,text)=>{
    expect(vkErrorView(raw)).toEqual({text,code,raw});
  });

  it('flood and captcha name the Moscow time the pause ends',()=>{
    expect(vkErrorView('VK 9: Flood control',{until}).text).toBe('VK ограничил частоту, пауза до 15:30 МСК');
    expect(vkErrorView('VK 14: Captcha',{until}).text).toBe('VK запросил капчу, пауза до 15:30 МСК');
    expect(vkErrorView('VK 9: Flood control').text).toBe('VK ограничил частоту, аккаунт на паузе');
  });

  it('every reason the server classifier writes without a code maps back to its code',()=>{
    for(const code of [5,9,14,15,17,18,29,30,203,212,-5]){
      expect(vkErrorView(classifyVkError({code,msg:''}).reason).code).toBe(code);
    }
  });

  it('no keywords, no proxy, no scanning account and unknown errors',()=>{
    expect(vkErrorView('Добавьте ключевые слова в настройках').text).toBe('Нет ключевых слов. Добавьте их в настройках AI');
    expect(vkErrorView('Нет ключевых слов').text).toBe('Нет ключевых слов. Добавьте их в настройках AI');
    expect(vkErrorView('Нет свободного активного прокси',{perProxyCap:5}).text).toBe('Все прокси заняты (по 5 аккаунтов). Добавьте прокси в разделе «Прокси»');
    expect(vkErrorView('Нет активного VK-аккаунта с прокси').text).toBe('Нет VK-аккаунта, который может сканировать. Привяжите прокси в «Аккаунтах»');
    expect(vkErrorView('Сервер вернул пустой ответ')).toMatchObject({code:null,text:'Сервер вернул пустой ответ'});
    expect(vkErrorView('')).toEqual({text:'',code:null,raw:''});
    expect(vkErrorView(undefined).text).toBe('');
  });
});

describe('import result helpers (panel fixes 4, 6, 7)',()=>{
  const results=[
    {line:1,status:'invalid' as const,reason:'r'},
    {line:3,status:'added' as const},
    {line:4,status:'no_proxy' as const},
    {line:5,status:'duplicate' as const},
    {line:6,status:'invalid' as const,reason:'r'},
  ];

  it('headline counts lines with Russian plurals',()=>{
    expect(vkImportHeadline(results)).toBe('Проверено 5 строк: добавлено 1, без прокси 1, дубликатов 1, ошибок 2');
    expect(vkImportHeadline([{line:1,status:'added'}])).toBe('Проверена 1 строка: добавлено 1, дубликатов 0, ошибок 0');
    expect(vkImportHeadline([{line:1,status:'added'},{line:2,status:'duplicate'}])).toBe('Проверены 2 строки: добавлено 1, дубликатов 1, ошибок 0');
  });

  it('keeps only the failed lines, in paste order, trimmed',()=>{
    expect(vkLinesToRetry('bad1\n\nok\n proxy \ndup\n bad2 ',results)).toBe('bad1\nbad2');
    expect(vkLinesToRetry('ok',[{line:1,status:'added'}])).toBe('');
  });

  it('pluralRu covers 1 / 2–4 / 5–20 / 21',()=>{
    const f=['аккаунт','аккаунта','аккаунтов'] as const;
    expect([1,2,5,11,14,21,22,25,111].map(n=>pluralRu(n,f))).toEqual(['аккаунт','аккаунта','аккаунтов','аккаунтов','аккаунтов','аккаунт','аккаунта','аккаунтов','аккаунтов']);
  });

  it('counts accounts per status for the filter chips',()=>{
    const v=(status:VkAccountData['status'])=>({view:{status}});
    expect(countVkStatuses([v('active'),v('active'),v('error'),v('no_proxy')])).toEqual({all:4,active:2,cooldown:0,error:1,no_proxy:1});
  });
});

describe('planVkAutoProxy (bulk proxy binding, cap per proxy)',()=>{
  const acc=(id:string,proxyId='')=>({id,data:{proxyId}});
  it('fills the least-loaded active proxy up to the cap, keeps a working binding, reports no room as null',()=>{
    const accounts=[acc('a','p1'),acc('b','p1'),acc('c'),acc('d','dead'),acc('e'),acc('f')];
    const plan=planVkAutoProxy(['a','c','d','e','f'],accounts,['p1','p2'],2);
    expect(Object.fromEntries(plan)).toEqual({a:'p1',c:'p2',d:'p2',e:null,f:null});
  });
});

describe('import line format errors read in Russian (panel r2 fix 7)',()=>{
  it.each([
    'Ожидается token или login:password:token',
    'Последняя часть строки не похожа на токен VK (vk1.a.… или 85+ символов)',
    'Токен не похож на токен VK',
  ])('%s',(raw)=>{
    expect(vkErrorView(raw)).toEqual({text:VK_BAD_LINE_TEXT,code:null,raw});
  });

  it('names the accepted shapes without English field names',()=>{
    expect(VK_BAD_LINE_TEXT).toBe('Не похоже на аккаунт VK: нужен токен (vk1.a…) или логин:пароль:токен');
  });
});

describe('VK copy without em-dashes or dot-separated meta strings (panel r2 fix 6)',()=>{
  it('every mapped error text is free of em-dashes and middle dots',()=>{
    const raws=['VK 5: x','VK 9: x','VK 14: x','VK 17: x','VK 29: x','VK -5: x','VK 15: x','VK -2: x',
      'Нет ключевых слов','Нет свободного активного прокси','Нет активного VK-аккаунта с прокси','Токен не похож на токен VK'];
    for(const raw of raws)expect(vkErrorView(raw).text).not.toMatch(/[—·]/);
  });

  it('usage line labels each counter',()=>{
    expect(vkUsageLine({calls:0,searchCalls:0,searchCap:500})).toBe('Вызовов: 0, поисков: 0 из 500');
    expect(vkUsageLine({calls:480,searchCalls:12,searchCap:0})).toBe('Вызовов: 480, поисков: 12, без лимита');
  });

  it('source leads line is a plain phrase with plurals',()=>{
    expect(vkSourceLeadsLine(2,1)).toBe('2 лида, из них 1 горячий');
    expect(vkSourceLeadsLine(5,3)).toBe('5 лидов, из них 3 горячих');
    expect(vkSourceLeadsLine(1,0)).toBe('1 лид');
    expect(vkSourceLeadsLine(0,0)).toBe('0 лидов');
  });
});

describe('VK accounts list at 50–200 rows (panel r2 fix 11)',()=>{
  const row=(id:string,status:VkAccountData['status'])=>({id,view:{status}});

  it('page search matches name, VK id and proxy label, case-insensitive; empty query passes',()=>{
    const data={name:'Мария Тестова',vkUserId:1001};
    expect(matchesVkAccountQuery(data,'203.0.113.12:1080','мария')).toBe(true);
    expect(matchesVkAccountQuery(data,'203.0.113.12:1080','id1001')).toBe(true);
    expect(matchesVkAccountQuery(data,'203.0.113.12:1080','1001')).toBe(true);
    expect(matchesVkAccountQuery(data,'203.0.113.12:1080','113.12')).toBe(true);
    expect(matchesVkAccountQuery(data,'203.0.113.12:1080','ольга')).toBe(false);
    expect(matchesVkAccountQuery({name:'',vkUserId:0},'','  ')).toBe(true);
    expect(matchesVkAccountQuery({name:'',vkUserId:0},'','id')).toBe(false);
  });

  it('sorts error, then no proxy, then cooldown, then active, keeping order inside a status',()=>{
    const rows=[row('a1','active'),row('c1','cooldown'),row('e1','error'),row('n1','no_proxy'),row('a2','active'),row('e2','error')];
    expect(sortVkAccountsForTriage(rows).map(r=>r.id)).toEqual(['e1','e2','n1','c1','a1','a2']);
    expect(rows[0]?.id).toBe('a1');
  });

  it('shows 50 per page and counts the rest',()=>{
    const rows=Array.from({length:120},(_,i)=>i);
    expect(vkAccountsPage(rows,1)).toMatchObject({rest:70});
    expect(vkAccountsPage(rows,1).shown).toHaveLength(50);
    expect(vkAccountsPage(rows,2).shown).toHaveLength(100);
    expect(vkAccountsPage(rows,3)).toMatchObject({rest:0});
    expect(vkAccountsPage(rows,3).shown).toHaveLength(120);
    expect(vkAccountsPage([1,2],0).shown).toEqual([1,2]);
  });
});

describe('platform-aware copy in a VK workspace (panel r2 fixes 5, 8)',()=>{
  it('the leads note with the VK filter speaks about VK only',()=>{
    const vk=vkLeadsNote('vk',30);
    expect(vk).toContain('Источники VK');
    expect(vk).toContain('30 мин на источник');
    expect(vk).not.toMatch(/Telegram|групп/);
  });

  it('the leads note for all platforms names both, and none of the notes uses an em-dash',()=>{
    expect(vkLeadsNote('all',15)).toMatch(/группы Telegram и источники VK/);
    expect(vkLeadsNote('telegram',15)).not.toMatch(/VK/);
    for(const f of ['all','vk','telegram'] as const)expect(vkLeadsNote(f,15)).not.toMatch(/—/);
  });

  it('the groups lede mentions VK communities',()=>{
    expect(VK_GROUPS_LEDE).toContain('сообществ VK');
  });
});
