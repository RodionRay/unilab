import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {distinctTopicHits,explainLeadDecision,hardReject,type LeadCoreSettings} from '@/lib/lead-core';
import {MAX_MINUS_TERMS,findMinusHit,hasBuyerIntent,looksLikeServiceAd,splitTerms} from '@/lib/lead-filter';
import {cleanStopLists,sanitizeMinusTerms,scanStopTerms} from '@/lib/lead-stopwords';

/** Synthetic Uniseller-like settings (no real account data). */
const baseSettings:LeadCoreSettings&{learnExamples:string}={
  keywords:'остатки, синхронизация, МойСклад, 1С, управление ценами, ответы на отзывы, несколько кабинетов, интеграция, ищу сервис, нужна crm, кто пользуется',
  minusKeywords:'вакансия, резюме, накрутка, матрица судьбы, таро, гадание, писать @, казино',
  avoidTopics:'',
  leadCriteria:'Явно ищет сервис или CRM для учёта остатков, синхронизации заказов, цен, отзывов, нескольких кабинетов маркетплейсов, интеграции с 1С или МойСклад',
  hotSignals:'ищу сервис, нужен сервис, кто пользуется, интеграция 1с, мойсклад, синхронизация остатков',
  product:'Uniseller — платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов, 1С/МойСклад',
  learnExamples:'ищу сервис для синхронизации остатков, нужна crm для кабинетов',
};

/** Stop-list polluted by auto-learning with the product's own vocabulary (bug reproduction). */
const POLLUTED_MINUS='вакансия, казино, накрутка, остатков, озон, ozon, wildberries, селлер, маркетплейсов, склад, яндекс, товар, подскажите, здравствуйте, нал, бот, синхронизации, кабинетов';
const POLLUTED_AVOID='озон, селлер, болтовня про товар, бот';

const TARGETS=[
  'ищу сервис для синхронизации остатков на wildberries и ozon',
  'нужна crm для нескольких кабинетов маркетплейсов',
  'кто пользуется мойсклад для автоматизации цен и отзывов',
  'Подскажите сервис для синхронизации остатков между WB и Ozon, у кого что работает?',
  'Нужна CRM для селлера, чтобы заказы с вб и озон падали в одно место',
  'Кто пользовался МойСклад с Ozon? Как настроить выгрузку остатков?',
];

describe('lead core: reference target messages',()=>{
  it.each(TARGETS)('passes with clean settings: %s',(msg)=>{
    const d=explainLeadDecision(msg,baseSettings);
    expect(d.rejectReason).toBe('');
    expect(d.pass).toBe(true);
    expect(d.score).toBeGreaterThanOrEqual(45);
  });

  it('polluted stop-list rejects the targets before cleanup (bug reproduction)',()=>{
    const polluted={...baseSettings,minusKeywords:POLLUTED_MINUS,avoidTopics:POLLUTED_AVOID};
    const rejected=TARGETS.filter((msg)=>hardReject(msg,polluted)!=='');
    expect(rejected.length).toBeGreaterThanOrEqual(5);
  });

  it.each(TARGETS)('polluted stop-list after cleanStopLists no longer rejects: %s',(msg)=>{
    const polluted={...baseSettings,minusKeywords:POLLUTED_MINUS,avoidTopics:POLLUTED_AVOID};
    const cleaned=cleanStopLists(polluted);
    const d=explainLeadDecision(msg,{...polluted,...cleaned});
    expect(d.rejectReason).toBe('');
    expect(d.pass).toBe(true);
  });
});

describe('hardReject: minus terms match at word start, not as substring',()=>{
  it('short minus "нал" does not kill "канал" / "анализ"',()=>{
    const s={...baseSettings,minusKeywords:'нал'};
    expect(hardReject('Подскажите канал про анализ продаж на маркетплейсах',s)).toBe('');
  });

  it('minus "бот" does not kill "работа", but kills "бот"/"ботов"',()=>{
    const s={...baseSettings,minusKeywords:'бот'};
    expect(hardReject('У кого что работает для синхронизации остатков?',s)).toBe('');
    expect(hardReject('Продаю ботов для рассылок недорого, пишите в личку',s)).toContain('бот');
  });

  it('genuine spam minus still rejects',()=>{
    expect(hardReject('Лучшее казино онлайн, заходи и выигрывай каждый день',baseSettings)).toContain('казино');
    expect(hardReject('Играю в Казино каждый вечер, ищу сервис для ставок',baseSettings)).toContain('казино');
  });

  it('multi-word minus phrase matches as phrase at word start',()=>{
    const s={...baseSettings,minusKeywords:'курсы инфобиз'};
    expect(hardReject('Продаю Курсы   инфобиз со скидкой, всё по шагам',s)).toContain('курсы инфобиз');
    expect(hardReject('Курсы валют и инфобиз новости сегодня обсуждаем',s)).toBe('');
    expect(hardReject('Ресурсы инфобиз-тематики обсуждаем в соседнем чате',s)).toBe('');
  });
});

describe('"кто пользуется X": buyer only for a Latin tool name, Cyrillic stays a soft ask',()=>{
  it('Latin tool name is buyer intent, Cyrillic object is not',()=>{
    expect(hasBuyerIntent('Кто пользуется MPstats, какой тариф брать?')).toBe(true);
    expect(hasBuyerIntent('кто пользуется мойсклад для автоматизации')).toBe(false);
    expect(hasBuyerIntent('Коллеги, кто пользуется ипотекой сейчас, как ставки?')).toBe(false);
    expect(hasBuyerIntent('Подскажите кто пользуется для нескольких кабинетов учётом остатков?')).toBe(false);
  });

  it.each([
    'Коллеги, кто пользуется ипотекой сейчас, как ставки?',
    'Кто пользовался доставкой СДЭК в регионы?',
    'Кто пользуется Сбером для эквайринга?',
    'Кто пользуется телеграм ботом для учёта финансов?',
    'Подскажите хорошего стоматолога в центре, кто пользовался?',
    'Кто пользуется каршерингом в Москве, какой лучше?',
    'Подскажите, кто пользуется фитнес-браслетом для сна?',
  ])('off-topic ask is not a lead: %s',(msg)=>{
    const d=explainLeadDecision(msg,baseSettings);
    expect(d.pass).toBe(false);
    expect(d.score).toBeLessThan(45);
  });
});

describe('scoreLead: soft ask',()=>{
  it('soft ask with >=2 settings hits reaches warm',()=>{
    const s:LeadCoreSettings={keywords:'выгрузка остатков',hotSignals:'интеграция мойсклад',leadCriteria:'',product:''};
    const d=explainLeadDecision('Подскажите, как у вас выгрузка остатков и интеграция мойсклад устроена?',s);
    expect(d.softAsk).toBe(true);
    expect(d.buyer).toBe(false);
    expect(d.score).toBeGreaterThanOrEqual(45);
    expect(d.temperature).toBe('warm');
  });

  it('soft ask with no settings fit stays capped below warm',()=>{
    const d=explainLeadDecision('Подскажите, где купить хорошие кроссовки для бега в Москве?',baseSettings);
    expect(d.softAsk).toBe(true);
    expect(d.pass).toBe(false);
    expect(d.score).toBeLessThanOrEqual(30);
  });

  it('overlapping hits count once (склад inside мойсклад)',()=>{
    const s:LeadCoreSettings={keywords:'мойсклад',hotSignals:'склад',leadCriteria:'',product:''};
    const d=explainLeadDecision('Подскажите, как у вас мойсклад работает с маркировкой?',s);
    expect(d.softAsk).toBe(true);
    expect(d.pass).toBe(false);
    expect(distinctTopicHits(['склад','мойсклад','кто пользуется','Мойсклад'])).toEqual(['мойсклад']);
  });

  it('chat without any ask stays below warm even with many hits',()=>{
    const d=explainLeadDecision('У нас остатки МойСклад синхронизация кабинетов интеграция 1С всё сломалось опять',baseSettings);
    expect(d.softAsk).toBe(false);
    expect(d.buyer).toBe(false);
    expect(d.pass).toBe(false);
  });
});

describe('sanitizeMinusTerms',()=>{
  it('drops short, generic, marketplace and product-overlapping candidates',()=>{
    const out=sanitizeMinusTerms([
      'нал','бот','wb','подскажите','здравствуйте','кто пользуется','озон','Ozon','wildberries','яндекс маркет',
      'маркетплейсов','селлеры','товаров','остатков','синхронизации','склад','мойсклад','кабинетов','отзывы',
    ],baseSettings);
    expect(out).toEqual([]);
  });

  it('drops phrases without a content word',()=>{
    expect(sanitizeMinusTerms(['кто знает','нужна помощь','ребят','почему','кто делает','кто разбирается','кто-нибудь','всем привет'],baseSettings)).toEqual([]);
  });

  it('keeps phrases that only partly touch marketplace/product words',()=>{
    expect(sanitizeMinusTerms(['услуги маркетолога','яндекс директ','товарный кредит'],baseSettings))
      .toEqual(['услуги маркетолога','яндекс директ','товарный кредит']);
  });

  it('keeps genuine noise terms',()=>{
    expect(sanitizeMinusTerms(['казино','вакансия','ищу работу','Казино','ставки на спорт'],baseSettings))
      .toEqual(['казино','вакансия','ищу работу','ставки на спорт']);
  });
});

describe('cleanStopLists',()=>{
  it('removes polluted terms from both lists and reports them',()=>{
    const r=cleanStopLists({...baseSettings,minusKeywords:POLLUTED_MINUS,avoidTopics:POLLUTED_AVOID});
    expect(r.minusKeywords).toBe('вакансия, казино, накрутка');
    expect(r.avoidTopics).toBe('болтовня про товар');
    expect(r.removed).toEqual(expect.arrayContaining(['остатков','озон','нал','бот','селлер']));
  });

  it('is idempotent',()=>{
    const once=cleanStopLists({...baseSettings,minusKeywords:POLLUTED_MINUS,avoidTopics:POLLUTED_AVOID});
    const twice=cleanStopLists({...baseSettings,...once});
    expect(twice.minusKeywords).toBe(once.minusKeywords);
    expect(twice.removed).toEqual([]);
  });
});

describe('scanStopTerms: one ordered list for core and worker',()=>{
  const many=Array.from({length:150},(_,i)=>`мусор${String.fromCharCode(1072+(i%26))}${i}`);
  const settings={...baseSettings,minusKeywords:['остатков','казино',...many].join(', '),avoidTopics:'бот, ставки на спорт'};

  it('sanitizes at read time, keeps minus-first order, caps at MAX_MINUS_TERMS',()=>{
    const list=scanStopTerms(settings);
    expect(list).toHaveLength(MAX_MINUS_TERMS);
    expect(list[0]).toBe('казино');
    expect(list).not.toContain('остатков');
    expect(list).not.toContain('ставки на спорт');
  });

  it('core sees exactly the list the worker gets and drops the same messages',()=>{
    const list=scanStopTerms(settings);
    const core:LeadCoreSettings={...baseSettings,minusKeywords:list.join(', '),avoidTopics:''};
    expect(splitTerms(core.minusKeywords||'')).toEqual(list.map((t)=>t.toLowerCase()));
    const msgs=[
      'Лучшее казино онлайн, заходи и выигрывай каждый день',
      `Сообщение про ${many[118]} и прочее длинное`,
      `Сообщение про ${many[140]} и прочее длинное`,
      'Ищу сервис для синхронизации остатков на wildberries и ozon',
    ];
    for(const m of msgs){
      expect(hardReject(m,core)!=='').toBe(findMinusHit(m.toLowerCase(),list)!=='');
    }
    expect(findMinusHit(msgs[1] as string,list)).not.toBe('');
    expect(findMinusHit(msgs[2] as string,list)).toBe('');
  });
});

type MinusCase={text:string;terms:string[];hit:string|null};
const FIXTURE=JSON.parse(readFileSync(path.resolve(__dirname,'fixtures/minus-match.json'),'utf8')) as {cases:MinusCase[]};

describe('findMinusHit: shared TS/Python fixture',()=>{
  it.each(FIXTURE.cases.map((c)=>[c.text.slice(0,40),c] as const))('%s',(_,c)=>{
    expect(findMinusHit(c.text,c.terms)).toBe(c.hit??'');
  });
});

describe('service-ad markers match at word start',()=>{
  it('"таро" inside "старой" is not an ad, a real таро offer is',()=>{
    expect(looksLikeServiceAd('Кто пользовался старой версией МойСклад?')).toBe(false);
    expect(looksLikeServiceAd('Расклад на Таро недорого, пишите')).toBe(true);
    expect(looksLikeServiceAd('Занимаюсь разбором матрицы судьбы')).toBe(true);
  });
});

describe('request without a product / niche / marketplace anchor is not a lead',()=>{
  it.each([
    'подскажите сервис доставки цветов',
    'Подскажите сервис доставки цветов по Москве, чтобы к утру привезли',
    'Посоветуйте сервис для записи к парикмахеру, кто что знает?',
  ])('generic service request is rejected: %s',(msg)=>{
    const d=explainLeadDecision(msg,baseSettings);
    expect(d.buyer).toBe(true);
    expect(d.pass).toBe(false);
    expect(d.score).toBeLessThan(45);
  });

  it.each([
    'Подскажите сервис для работы с WB, чтобы не сидеть в кабинете руками',
    'Кто пользуется MPstats подскажите какой тариф лучше брать?',
  ])('request anchored by marketplace or a named tool still passes: %s',(msg)=>{
    const d=explainLeadDecision(msg,baseSettings);
    expect(d.pass).toBe(true);
  });
});

describe('SPAM_RE: loan words only, at Cyrillic word boundaries',()=>{
  it.each([
    'Займусь этим вопросом завтра, подскажите сервис для остатков WB',
    'Сколько займёт синхронизация остатков МойСклад с Ozon?',
    'Это займет пару дней, ищу сервис для синхронизации остатков',
    'Занимаюсь селлингом на WB, нужна crm для нескольких кабинетов',
  ])('verb forms are not spam: %s',(msg)=>{
    expect(looksLikeServiceAd(msg)).toBe(false);
  });

  it.each([
    'Займ на карту без отказа за 5 минут',
    'Выдаём займы селлерам под оборот',
    'Нет денег? Оформи микрозайм онлайн',
    'Помощь в получении займа для бизнеса',
    'Сравнили 10 микрозаймов для ИП',
  ])('loan offers are spam: %s',(msg)=>{
    expect(looksLikeServiceAd(msg)).toBe(true);
  });
});
