import {describe,expect,it} from 'vitest';
import {explainLeadDecision,hardReject,type LeadCoreSettings} from '@/lib/lead-core';
import {hasBuyerIntent} from '@/lib/lead-filter';
import {cleanStopLists,sanitizeMinusTerms} from '@/lib/lead-stopwords';

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

describe('BUYER_INTENT_RE handles Cyrillic after "кто пользуется"',()=>{
  it('matches Cyrillic product names',()=>{
    expect(hasBuyerIntent('кто пользуется мойсклад для автоматизации')).toBe(true);
    expect(hasBuyerIntent('Кто пользовался МойСклад с Ozon?')).toBe(true);
    expect(hasBuyerIntent('Подскажите кто пользуется для нескольких кабинетов учётом остатков?')).toBe(false);
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

  it('keeps genuine noise terms',()=>{
    expect(sanitizeMinusTerms(['казино','вакансия','ищу работу','Казино','ставки на спорт'],baseSettings))
      .toEqual(['казино','вакансия','ищу работу','ставки на спорт']);
  });
});

describe('cleanStopLists',()=>{
  it('removes polluted terms from both lists and reports them',()=>{
    const r=cleanStopLists({...baseSettings,minusKeywords:POLLUTED_MINUS,avoidTopics:POLLUTED_AVOID});
    expect(r.minusKeywords).toBe('вакансия, казино, накрутка');
    expect(r.avoidTopics).toBe('');
    expect(r.removed).toEqual(expect.arrayContaining(['остатков','озон','нал','бот','болтовня про товар']));
  });

  it('is idempotent',()=>{
    const once=cleanStopLists({...baseSettings,minusKeywords:POLLUTED_MINUS,avoidTopics:POLLUTED_AVOID});
    const twice=cleanStopLists({...baseSettings,...once});
    expect(twice.minusKeywords).toBe(once.minusKeywords);
    expect(twice.removed).toEqual([]);
  });
});
