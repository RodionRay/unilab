// Mock workspace data for the AI page redesign (lead core v2). Shapes follow
// app/api/workspace/route.ts::GET (records envelope) and app/app/page.tsx::defaults.
// Times are relative to load time so "N минут назад" labels stay fresh in screenshots.

export const SCENARIOS = ['full', 'no-project', 'no-groups', 'no-scans', 'ai-key-missing', 'error', 'staff-redacted'];

// Real GET `workspace` of a manager with AI + groups but without «Лиды» / «Переписки»
// (lib/security/workspace-authz.ts::canSeeLeadText is false for it).
export const STAFF_WORKSPACE = {
  isOwner: false,
  role: 'manager',
  access: { overview: true, notifications: false, leads: false, chats: false, groups: true, accounts: false, proxies: false, ai: true, settings: false, staff: false },
};

export const IDS = {
  settings: 'b0000000-0000-4000-8000-000000000001',
  projectFulfillment: 'a1000000-0000-4000-8000-000000000001',
  projectCards: 'a1000000-0000-4000-8000-000000000002',
  accountMain: 'd4000000-0000-4000-8000-000000000001',
  accountSecond: 'd4000000-0000-4000-8000-000000000002',
  proxy: 'e5000000-0000-4000-8000-000000000001',
  group: (n) => `f6000000-0000-4000-8000-00000000000${n}`,
  lead: (n) => `c3000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
};

const NOW = Date.now();
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const rec = (id, kind, data, createdMinAgo, hasSecret = false) => ({ id, kind, data, created: ago(createdMinAgo), hasSecret });

function settingsRecord() {
  return rec(IDS.settings, 'settings', {
    name: 'Uniseller',
    model: 'deepseek-chat',
    provider: 'deepseek',
    apiBase: 'https://api.deepseek.com',
    projectUrl: 'https://uniseller.io',
    audience: 'Селлеры Wildberries и Ozon с оборотом от 1 млн ₽ в месяц, которые ищут подрядчика на склад, упаковку или контент.',
    leadCriteria: 'Человек сам ищет фулфилмент, упаковку, хранение или оформление карточек и готов обсудить условия.',
    product: 'Фулфилмент для Wildberries и Ozon в Подольске: приёмка, маркировка «Честный знак», упаковка, отгрузка на склады маркетплейсов по FBO и FBS.',
    keywords: 'фулфилмент, фф, ищу склад, упаковка товара, маркировка, честный знак, поставка на wb, fbo, fbs',
    minusKeywords: 'вакансия, резюме, куплю аккаунт, продаю аккаунт, схема, серый, накрутка, казино, крипта',
    tone: 'Дружелюбно, по делу, без давления.',
    cta: 'Предложить расчёт стоимости под объём поставки.',
    pains: 'Срывы поставок, штрафы за маркировку, нет своего склада.',
    valueProps: 'Отгрузка за 24 часа, фиксированный тариф за единицу, фотоотчёт по каждой поставке.',
    avoidTopics: 'вакансии, накрутка, серые схемы',
    hotSignals: 'ищу фулфилмент, посоветуйте фф, нужен склад',
    productNotes: '',
    learnExamples: '',
    aiQualify: true,
    autoRescanEnabled: true,
    autoRescanMinutes: 30,
    lastAutoRescanAt: ago(18),
    lastMinusAdded: ['курсы по вб', 'наставник'],
    lastMinusAddedAt: ago(60 * 26),
    rescanLog: [],
    scanDepthDays: 7,
    profileName: 'Ирина, Uniseller',
    profileAbout: 'Фулфилмент и контент для селлеров WB и Ozon',
    profileContact: '@uniseller_irina',
    notifyEnabled: false,
    notifyBotToken: '',
    notifyChatId: '',
  }, 60 * 24 * 40, true);
}

function projectRecords() {
  return [
    rec(IDS.projectFulfillment, 'project', {
      name: 'Фулфилмент для WB',
      url: 'https://uniseller.io/fulfillment',
      product: 'Фулфилмент для Wildberries и Ozon в Подольске: приёмка, маркировка «Честный знак», упаковка, хранение и отгрузка на склады маркетплейсов по FBO и FBS. Тариф от 18 ₽ за единицу.',
      audience: 'Селлеры WB и Ozon с 300+ отгрузками в месяц, у которых нет своего склада или он не справляется в сезон.',
      leadCriteria: 'Автор сам ищет фулфилмент, склад, упаковку или маркировку и спрашивает про цены, сроки или рекомендации.',
      notLead: 'Сам предлагает услуги фулфилмента, ищет работу на складе, жалуется на штрафы без запроса подрядчика.',
      valueProps: 'Отгрузка на склад маркетплейса за 24 часа; фиксированный тариф без доплат за маркировку; фотоотчёт по каждой поставке.',
      tone: 'Коротко и по делу, на «вы», без давления и восклицательных знаков.',
      cta: 'Предложить расчёт стоимости под объём и категорию товара.',
      keywords: ['фулфилмент', 'ищу фф', 'посоветуйте фулфилмент', 'склад для вб', 'упаковка товара', 'маркировка честный знак', 'поставка на коледино', 'fbo', 'хранение товара'],
      stopWords: ['вакансия', 'резюме', 'требуются сотрудники', 'предлагаем услуги фулфилмента', 'наш фулфилмент', 'курсы по вб', 'наставник', 'продам аккаунт', 'выкупы', 'самовыкупы', 'накрутка отзывов', 'казино'],
      goodExamples: [
        'Ищу фулфилмент в Москве или области под WB, 2000 единиц в месяц, одежда. Кто работает — посоветуйте.',
        'Нужен склад с маркировкой «Честный знак», обувь, поставки на Коледино раз в неделю. Сколько стоит?',
        'Наш фф срывает отгрузки уже третий раз, ищем нового подрядчика срочно.',
      ],
      badExamples: [
        'Фулфилмент «Логистик Про» — принимаем товар 24/7, пишите в личку.',
        'Требуются упаковщики на склад в Подольске, график 2/2.',
      ],
      minScore: 50,
      scanDepthDays: 7,
      autoDraft: true,
      active: true,
      updatedAt: ago(60 * 5),
    }, 60 * 24 * 21),
    rec(IDS.projectCards, 'project', {
      name: 'Карточки товаров под ключ',
      url: 'https://uniseller.io/content',
      product: 'Оформление карточек для Wildberries и Ozon: инфографика, SEO-описание, фото на модели и rich-контент. Срок от 3 рабочих дней.',
      audience: 'Селлеры, которые запускают новые артикулы или видят низкую конверсию из показа в корзину.',
      leadCriteria: 'Автор ищет дизайнера карточек, инфографику, фотографа или спрашивает, почему карточка не продаёт.',
      notLead: 'Дизайнеры, которые сами предлагают услуги; вопросы про бесплатные шаблоны.',
      valueProps: 'Анализ топ-10 конкурентов перед дизайном; две правки бесплатно; SEO-описание по ключам из поиска маркетплейса.',
      tone: 'Дружелюбно, с конкретикой про конверсию, без жаргона.',
      cta: 'Предложить бесплатный разбор одной карточки.',
      keywords: ['инфографика', 'дизайнер карточек', 'карточка товара', 'rich-контент', 'фото для вб', 'низкая конверсия', 'seo описание'],
      stopWords: ['вакансия', 'ищу работу', 'портфолио дизайнера', 'беру заказы', 'бесплатный шаблон', 'курс по инфографике', 'обучение', 'наставник', 'выкупы', 'накрутка', 'продам кабинет', 'казино'],
      goodExamples: [
        'Посоветуйте дизайнера для инфографики, 15 карточек детской одежды на WB.',
        'CTR у карточки 1,2 %, в корзину почти не кладут. Кто может переделать фото и описание?',
        'Запускаем новый бренд косметики на Ozon, нужен rich-контент под ключ.',
      ],
      badExamples: [
        'Делаю инфографику для маркетплейсов от 500 ₽, портфолио в профиле.',
        'Где скачать бесплатные шаблоны карточек для Figma?',
      ],
      minScore: 50,
      scanDepthDays: 7,
      autoDraft: true,
      active: true,
      updatedAt: ago(60 * 30),
    }, 60 * 24 * 9),
  ];
}

function accountRecords() {
  const limits = { invite: 10, message: 10, chat: 10 };
  return [
    rec(IDS.accountMain, 'account', { name: 'Ирина Соколова', phone: '+7 916 482-17-35', proxyId: IDS.proxy, status: 'active', format: 'tdata', sessionMode: 'keep', limits, cooldownUntil: '', firstName: 'Ирина', lastName: 'Соколова', username: 'irina_sokolova_ff', about: 'Фулфилмент для WB и Ozon', hasPhoto: true, error: '', telegramOk: true }, 60 * 24 * 30, true),
    rec(IDS.accountSecond, 'account', { name: 'Артём Белов', phone: '+7 925 301-64-90', proxyId: IDS.proxy, status: 'active', format: 'tdata', sessionMode: 'keep', limits, cooldownUntil: '', firstName: 'Артём', lastName: 'Белов', username: 'artem_belov_content', about: 'Карточки товаров под ключ', hasPhoto: true, error: '', telegramOk: true }, 60 * 24 * 12, true),
  ];
}

function proxyRecord() {
  return rec(IDS.proxy, 'proxy', { name: 'Москва, мобильный', host: '185.112.44.19', port: '1080', protocol: 'socks5', username: 'uniseller', status: 'active', exitIp: '185.112.44.19', lastChecked: ago(40), checkError: '' }, 60 * 24 * 30, true);
}

const GROUPS = [
  { n: 1, name: 'Селлеры Wildberries | Чат', url: 'https://t.me/wb_sellers_chat', projectId: IDS.projectFulfillment, accountId: IDS.accountMain, total: 14, hot: 5, warm: 9 },
  { n: 2, name: 'Фулфилмент WB и Ozon — поиск подрядчиков', url: 'https://t.me/ff_market_search', projectId: IDS.projectFulfillment, accountId: IDS.accountMain, total: 9, hot: 4, warm: 5 },
  { n: 3, name: 'Ozon Селлеры Москва', url: 'https://t.me/ozon_sellers_msk', projectId: '', accountId: IDS.accountMain, total: 6, hot: 1, warm: 5 },
  { n: 4, name: 'Дизайн карточек для маркетплейсов', url: 'https://t.me/mp_cards_design', projectId: IDS.projectCards, accountId: IDS.accountSecond, total: 7, hot: 2, warm: 5 },
  { n: 5, name: 'Маркетплейсы: продвижение и контент', url: 'https://t.me/mp_promo_content', projectId: IDS.projectCards, accountId: IDS.accountSecond, total: 3, hot: 1, warm: 2 },
  { n: 6, name: 'Поставщики Садовод и WB', url: 'https://t.me/sadovod_wb_postavki', projectId: '', accountId: IDS.accountSecond, total: 0, hot: 0, warm: 0 },
];

function groupRecords() {
  return GROUPS.map((g) => rec(IDS.group(g.n), 'group', {
    name: g.name, url: g.url, accountId: g.accountId, projectId: g.projectId, status: 'active', error: '',
    membership: 'joined', joinedAt: ago(60 * 24 * (20 - g.n)), joinState: '', joinStateAt: '', joinStateError: '',
    leadsTotal: g.total, leadsHot: g.hot, leadsWarm: g.warm, leadsCold: 0, scanMatched: g.total, rating: g.total ? Math.min(5, 2 + g.hot) : 0,
    lastScanned: ago(18 + g.n * 3), scanLog: [{ at: ago(18 + g.n * 3), level: 'info', text: `Прочитано ${40 + g.n * 7} сообщений, новых лидов: ${g.n % 3}` }],
  }, 60 * 24 * (21 - g.n)));
}

const LEAD_BASE = { source: 'Telegram', status: 'new', draft: '', tgMsgId: '', reason: '', viewed: false, viewedAt: '', excludeFromTraining: false, senderId: '', senderUsername: '', senderAccessHash: '', messageKind: 'group', peerId: '', replyToMsgId: '', replies: [], conversationOpen: false, conversationAt: '', incomingLastText: '', needsManager: false, accountId: '' };

const LEADS = [
  { n: 1, g: 1, p: IDS.projectFulfillment, name: 'Марина Кузнецова', user: 'marina_kuz_wb', t: 'hot', score: 92, src: 'group', min: 35,
    msg: 'Ищу фулфилмент в Подмосковье под WB, одежда, около 2500 единиц в месяц. Нужна маркировка и отгрузка на Коледино. Кто работает — посоветуйте, пожалуйста.',
    reason: 'Прямо ищет фулфилмент, назван объём и склад отгрузки.', draftKind: 'group_reply',
    draft: 'Марина, добрый день. Мы в Подольске, отгружаем на Коледино каждый день, маркировка «Честный знак» входит в тариф. На 2500 единиц одежды выйдет около 21 ₽ за штуку. Пришлю расчёт под ваш ассортимент?' },
  { n: 2, g: 2, p: IDS.projectFulfillment, name: 'Дмитрий Орлов', user: 'd_orlov_shoes', t: 'hot', score: 88, src: 'discussion', min: 70,
    msg: 'Наш фф третий раз срывает поставку на Электросталь, ищем нового подрядчика срочно. Обувь, нужен «Честный знак».',
    reason: 'Срочно меняет подрядчика, есть боль со сроками.', draftKind: 'dm_first',
    draft: 'Дмитрий, понимаю, срыв поставки в сезон бьёт по выдаче. Можем принять партию завтра и отгрузить на Электросталь за 24 часа, маркировку обуви делаем сами. Удобно созвониться на 10 минут?' },
  { n: 3, g: 4, p: IDS.projectCards, name: 'Ольга Лебедева', user: 'olga_kids_brand', t: 'hot', score: 81, src: 'comment', min: 125,
    msg: 'Посоветуйте дизайнера для инфографики, 15 карточек детской одежды на WB. Бюджет обсуждаем.',
    reason: 'Ищет дизайнера карточек, назван объём.', draftKind: 'group_reply',
    draft: 'Ольга, здравствуйте. Делаем карточки детской одежды под ключ: инфографика, SEO-описание, две правки бесплатно. Могу бесплатно разобрать одну из ваших карточек и показать, что поменяем. Пришлёте ссылку?' },
  { n: 4, g: 3, p: '', name: 'Сергей Панов', user: 'panov_home_goods', t: 'warm', score: 64, src: 'group', min: 190,
    msg: 'Кто-нибудь работал с фулфилментом по FBS для Ozon? Товары для дома, небольшие объёмы, интересует цена хранения.',
    reason: 'Интересуется FBS-фулфилментом, но объём пока небольшой.',
    draft: 'Сергей, добрый день. Для небольших объёмов по FBS храним от 9 ₽ за единицу в месяц. Напишу условия подробнее, если подскажете категорию и примерное число артикулов.' },
  { n: 5, g: 1, p: IDS.projectFulfillment, name: 'Анна Морозова', user: 'anna_moroz_cosm', t: 'warm', score: 58, src: 'group', min: 260,
    msg: 'Сколько сейчас в среднем стоит упаковка и маркировка косметики на фулфилменте? Пока сами пакуем, думаем отдать.',
    reason: 'Сравнивает цены, планирует передать упаковку.' },
  { n: 6, g: 5, p: IDS.projectCards, name: 'Павел Громов', user: 'gromov_sport', t: 'warm', score: 55, src: 'discussion', min: 400,
    msg: 'CTR у карточки 1,2 %, в корзину почти не кладут. Стоит ли переделывать фото или дело в цене?',
    reason: 'Низкая конверсия карточки, возможен заказ редизайна.' },
  { n: 7, g: 2, p: IDS.projectFulfillment, name: 'Екатерина Волкова', user: 'katya_volkova_home', t: 'hot', score: 86, src: 'dm', min: 60 * 26,
    msg: 'Добрый день! Видела ваш ответ в чате про фулфилмент. Подскажите, сколько выйдет на 1200 единиц текстиля в месяц с отгрузкой на Казань?',
    reason: 'Сама написала в личку с конкретным объёмом.', viewed: true, conversationOpen: true, needsManager: true,
    incomingLastText: 'Отлично, а можно приехать посмотреть склад в четверг?',
    replies: [
      { text: 'Екатерина, здравствуйте. На 1200 единиц текстиля выйдет около 23 ₽ за единицу, отгрузка на Казань дважды в неделю.', mode: 'dm', at: ago(60 * 25), ok: true, error: '', messageId: '5521', link: '', chatId: '', from: 'us', status: 'sent', accountId: IDS.accountMain },
      { text: 'Отлично, а можно приехать посмотреть склад в четверг?', mode: 'dm', at: ago(60 * 3), ok: true, error: '', messageId: '5530', link: '', chatId: '', from: 'client' },
    ] },
  { n: 8, g: 3, p: '', name: 'Игорь Савельев', user: 'igor_sav_auto', t: 'warm', score: 52, src: 'comment', min: 60 * 30,
    msg: 'Подскажите, есть ли смысл в фулфилменте, если товар крупногабаритный — автоаксессуары, коробки до 15 кг?',
    reason: 'Сомневается, но рассматривает фулфилмент для КГТ.', viewed: true },
  { n: 9, g: 4, p: IDS.projectCards, name: 'Наталья Ершова', user: 'ershova_bijou', t: 'warm', score: 61, src: 'group', min: 60 * 40,
    msg: 'Запускаем бижутерию на Ozon, нужен rich-контент и фото на модели. Кто делал — поделитесь контактами.',
    reason: 'Запуск нового бренда, нужен контент под ключ.', viewed: true },
  { n: 10, g: 1, p: IDS.projectFulfillment, name: 'Роман Ткачёв', user: 'tkachev_tools', t: 'hot', score: 77, src: 'group', min: 60 * 50,
    msg: 'Ищем склад с приёмкой в выходные, инструменты, 800 коробов в месяц, FBO на WB и Ozon.',
    reason: 'Ищет склад с конкретным объёмом и маркетплейсами.', viewed: true, feedback: 'good' },
];

function leadRecords() {
  return LEADS.map((l) => rec(IDS.lead(l.n), 'lead', {
    ...LEAD_BASE,
    name: l.name, message: l.msg, temperature: l.t, reason: l.reason, groupId: IDS.group(l.g),
    ...(l.p ? { projectId: l.p } : {}),
    score: l.score, sourceKind: l.src, senderUsername: l.user, senderId: String(700000000 + l.n * 1371),
    tgMsgId: String(48000 + l.n * 17), messageKind: l.src === 'dm' ? 'dm' : 'group',
    source: GROUPS.find((g) => g.n === l.g).name,
    draft: l.draft || '', ...(l.draftKind ? { draftKind: l.draftKind } : {}),
    viewed: !!l.viewed, viewedAt: l.viewed ? ago(l.min - 5) : '',
    conversationOpen: !!l.conversationOpen, conversationAt: l.conversationOpen ? ago(60 * 3) : '',
    incomingLastText: l.incomingLastText || '', needsManager: !!l.needsManager,
    replies: l.replies || [], accountId: GROUPS.find((g) => g.n === l.g).accountId,
    ...(l.feedback ? { feedback: l.feedback } : {}),
  }, l.min));
}

// ---- Funnel: totals derived from parts, so the invariant holds by construction ----
const STEPS = ['skippedErrorApp', 'old', 'short', 'duplicate', 'stopword', 'judgeSkipped', 'judgeError', 'rejected', 'leads'];

export function buildCounts(parts) {
  const p = { skippedNotUser: 0, skippedOldWorker: 0, skippedError: 0, skippedErrorApp: 0, old: 0, short: 0, duplicate: 0, stopword: 0, judgeSkipped: 0, judgeError: 0, rejected: 0, leads: 0, ...parts };
  const returned = STEPS.reduce((s, k) => s + p[k], 0);
  const fetched = p.skippedNotUser + p.skippedOldWorker + p.skippedError + returned;
  return { fetched, skippedNotUser: p.skippedNotUser, skippedOldWorker: p.skippedOldWorker, skippedError: p.skippedError, returned, skippedErrorApp: p.skippedErrorApp, old: p.old, short: p.short, duplicate: p.duplicate, stopword: p.stopword, judged: p.rejected + p.leads, judgeSkipped: p.judgeSkipped, judgeError: p.judgeError, rejected: p.rejected, leads: p.leads };
}

export function assertFunnelInvariant(c) {
  const ok = c.fetched === c.skippedNotUser + c.skippedOldWorker + c.skippedError + c.returned
    && c.returned === c.skippedErrorApp + c.old + c.short + c.duplicate + c.stopword + c.judgeSkipped + c.judgeError + c.rejected + c.leads
    && c.judged === c.rejected + c.leads;
  if (!ok) throw new Error('funnel invariant broken: ' + JSON.stringify(c));
  return c;
}

const clip = (items) => items.slice(0, 3).map((s) => ({ ...s, text: s.text.slice(0, 200) }));

const SAMPLES = {
  [IDS.projectFulfillment]: {
    skippedNotUser: [{ text: 'Канал «WB Новости» переслал пост: изменения тарифов логистики с 1 октября.' }],
    old: [{ text: 'Кто знает хороший фулфилмент в Люберцах? Отпишитесь в личку.' }],
    short: [{ text: '+' }, { text: 'спасибо' }, { text: 'актуально?' }],
    duplicate: [{ text: 'Ищу фулфилмент в Подмосковье под WB, одежда, около 2500 единиц в месяц.' }],
    stopword: [
      { text: 'Требуются упаковщики на склад в Подольске, график 2/2, оплата еженедельно.', term: 'вакансия' },
      { text: 'Предлагаем услуги фулфилмента: приёмка 24/7, хранение от 5 ₽.', term: 'предлагаем услуги фулфилмента' },
      { text: 'Делаем самовыкупы для вывода карточки в топ, гарантия результата.', term: 'самовыкупы' },
    ],
    judgeError: [{ text: 'Подскажите по FBS: если товар хранится у фф, кто отвечает за брак при приёмке?', reason: 'DeepSeek не ответил за 20 секунд' }],
    rejected: [
      { text: 'Штрафы за маркировку замучили, третий раз за месяц. Это вообще законно?', reason: 'Жалоба на штрафы без запроса подрядчика.' },
      { text: 'Мы свой склад открыли, кому интересно — расскажу, как считали окупаемость.', reason: 'Автор сам владеет складом, не ищет услугу.' },
    ],
    leads: [
      { text: 'Ищу фулфилмент в Подмосковье под WB, одежда, около 2500 единиц в месяц. Нужна маркировка и отгрузка на Коледино.', reason: 'Прямо ищет фулфилмент, назван объём.' },
      { text: 'Наш фф третий раз срывает поставку на Электросталь, ищем нового подрядчика срочно.', reason: 'Срочно меняет подрядчика.' },
    ],
  },
  [IDS.projectCards]: {
    short: [{ text: 'ок' }, { text: 'в лс' }],
    stopword: [{ text: 'Делаю инфографику для маркетплейсов от 500 ₽, портфолио в профиле.', term: 'беру заказы' }],
    rejected: [{ text: 'Где скачать бесплатные шаблоны карточек для Figma?', reason: 'Ищет бесплатный шаблон, не услугу.' }],
    leads: [{ text: 'Посоветуйте дизайнера для инфографики, 15 карточек детской одежды на WB.', reason: 'Ищет дизайнера, назван объём.' }],
  },
};

const FUNNEL_PARTS = {
  [IDS.projectFulfillment]: {
    1: { skippedNotUser: 17, skippedError: 2, old: 48, short: 31, duplicate: 9, stopword: 23, judgeError: 1, rejected: 14, leads: 6 },
    7: { skippedNotUser: 88, skippedOldWorker: 4, skippedError: 9, old: 210, short: 196, duplicate: 57, stopword: 142, judgeError: 3, rejected: 61, leads: 27 },
  },
  [IDS.projectCards]: {
    1: { skippedNotUser: 6, old: 12, short: 11, duplicate: 2, stopword: 7, rejected: 5, leads: 2 },
    7: { skippedNotUser: 31, skippedOldWorker: 1, skippedError: 2, old: 64, short: 70, duplicate: 15, stopword: 41, rejected: 22, leads: 9 },
  },
};

function runsFor(days) {
  const n = days === 1 ? 6 : 20;
  const step = days === 1 ? 230 : 480;
  return Array.from({ length: n }, (_, i) => ago(18 + i * step));
}

function moveJudgedToSkipped(parts) {
  return { ...parts, judgeSkipped: (parts.judgeSkipped || 0) + (parts.judgeError || 0) + (parts.rejected || 0) + (parts.leads || 0), judgeError: 0, rejected: 0, leads: 0 };
}

const view = (projectId, days, parts, samples, runs) => ({ projectId, days, counts: assertFunnelInvariant(buildCounts(parts)), samples, runs });

/** Action `funnel` answer: `{ok, funnel, dm}` like lib/processes/lead-actions.ts::projectFunnel. */
export function funnelFor(scenario, projectId, days) {
  const empty = (id) => view(id, days, {}, {}, []);
  const table = FUNNEL_PARTS[projectId];
  if (scenario === 'no-scans' || scenario === 'no-groups' || !table) return { ok: true, funnel: empty(projectId), dm: empty('dm') };
  let parts = table[days];
  let samples = Object.fromEntries(Object.entries(SAMPLES[projectId] || {}).map(([k, v]) => [k, clip(v)]));
  const dmBase = { short: 1, leads: days === 1 ? 1 : 3, rejected: days === 1 ? 0 : 2 };
  let dmParts = dmBase;
  let dmSamples = { leads: clip([{ text: LEADS[6].msg, reason: LEADS[6].reason }]) };
  if (scenario === 'ai-key-missing') {
    parts = moveJudgedToSkipped(parts);
    dmParts = moveJudgedToSkipped(dmBase);
    delete samples.rejected; delete samples.leads; delete samples.judgeError;
    samples.judgeSkipped = clip((SAMPLES[projectId]?.leads || []).map(({ text }) => ({ text, reason: 'no_ai_key' })));
    dmSamples = { judgeSkipped: clip([{ text: LEADS[6].msg, reason: 'no_ai_key' }]) };
  }
  if (scenario === 'staff-redacted') { samples = {}; dmSamples = {}; }
  return { ok: true, funnel: view(projectId, days, parts, samples, runsFor(days)), dm: view('dm', days, dmParts, dmSamples, runsFor(days)) };
}

export function initialState(scenario) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario ${scenario}; use one of ${SCENARIOS.join(', ')}`);
  const settings = settingsRecord();
  const base = { telegramConnected: true, ai: { provider: 'deepseek', hasEnvKey: true } };
  if (scenario === 'ai-key-missing') {
    settings.hasSecret = false;
    return { ...base, ai: { provider: 'deepseek', hasEnvKey: false }, records: [settings, ...projectRecords(), ...groupRecords(), ...accountRecords(), proxyRecord(), ...leadRecords()] };
  }
  if (scenario === 'no-project') return { ...base, records: [settings] };
  if (scenario === 'no-groups') return { ...base, records: [settings, ...projectRecords(), ...accountRecords(), proxyRecord()] };
  if (scenario === 'staff-redacted') {
    // lib/security/workspace-authz.ts::visibleRecordsFor for STAFF_WORKSPACE: no leads, no proxies,
    // accounts reduced to picker fields, project examples blanked, settings with owner secrets blanked.
    const picker = ['name', 'username', 'firstName', 'lastName', 'status', 'cooldownUntil', 'limits', 'hasPhoto', 'joinsToday', 'joinsDay'];
    const accounts = accountRecords().map((a) => ({ ...a, data: Object.fromEntries(picker.filter((f) => f in a.data).map((f) => [f, a.data[f]])) }));
    const projects = projectRecords().map((p) => ({ ...p, data: { ...p.data, goodExamples: [], badExamples: [] } }));
    settings.data = { ...settings.data, notifyBotToken: '' };
    return { ...base, workspace: STAFF_WORKSPACE, records: [settings, ...projects, ...groupRecords(), ...accounts] };
  }
  if (scenario === 'no-scans') return { ...base, records: [settings, ...projectRecords(), ...groupRecords().map((g) => ({ ...g, data: { ...g.data, lastScanned: '', scanLog: [], leadsTotal: 0, leadsHot: 0, leadsWarm: 0, scanMatched: 0, rating: 0 } })), ...accountRecords(), proxyRecord()] };
  return { ...base, records: [settings, ...projectRecords(), ...groupRecords(), ...accountRecords(), proxyRecord(), ...leadRecords()] };
}
