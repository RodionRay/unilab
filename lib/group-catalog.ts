/** Каталог тематических Telegram-групп/каналов для поиска целевых источников. */

export type GroupNiche =
  | "marketplaces"
  | "wildberries"
  | "ozon"
  | "yandex_market"
  | "megamarket"
  | "avito"
  | "vk_market"
  | "aliexpress"
  | "ecommerce"
  | "dropshipping"
  | "inventory"
  | "1c"
  | "logistics"
  | "fulfillment"
  | "reviews"
  | "pricing"
  | "analytics"
  | "saas"
  | "crm"
  | "freelance"
  | "marketing"
  | "smm"
  | "startup"
  | "business"
  | "b2b"
  | "fintech"
  | "education"
  | "healthcare"
  | "beauty"
  | "fashion"
  | "food"
  | "auto"
  | "realestate"
  | "hr"
  | "legal"
  | "accounting"
  | "design"
  | "content"
  | "bots"
  | "leadgen"
  | "certificates"
  | "china"
  | "networking"
  | "blogs";

export const GROUP_NICHE_LABELS: Record<GroupNiche, string> = {
  marketplaces: "Маркетплейсы",
  wildberries: "Wildberries",
  ozon: "Ozon",
  yandex_market: "Яндекс Маркет",
  megamarket: "Мегамаркет",
  avito: "Авито",
  vk_market: "VK Маркет",
  aliexpress: "AliExpress",
  ecommerce: "E-commerce",
  dropshipping: "Дропшиппинг",
  inventory: "Остатки / склады",
  "1c": "1С / МойСклад",
  logistics: "Логистика",
  fulfillment: "Фулфилмент",
  reviews: "Отзывы",
  pricing: "Цены",
  analytics: "Аналитика",
  saas: "SaaS / сервисы",
  crm: "CRM",
  freelance: "Фриланс / подряд",
  marketing: "Маркетинг / реклама",
  smm: "SMM",
  startup: "Стартапы",
  business: "Бизнес",
  b2b: "B2B / продажи",
  fintech: "Финтех / оплаты",
  education: "Образование",
  healthcare: "Здоровье / med",
  beauty: "Beauty",
  fashion: "Fashion",
  food: "Food / HoReCa",
  auto: "Авто",
  realestate: "Недвижимость",
  hr: "HR / вакансии",
  legal: "Юристы",
  accounting: "Бухгалтерия",
  design: "Дизайн",
  content: "Контент",
  bots: "Боты / Telegram",
  leadgen: "Лидогенерация",
  certificates: "Сертификация",
  china: "Китай / поставки",
  networking: "Нетворкинг",
  blogs: "Блоги (TGStat)",
};

export type CatalogGroup = {
  id: string;
  name: string;
  /** Реальная публичная ссылка. Если пусто — шаблон: ссылку вставляет оператор. */
  url: string;
  verified: boolean;
  niches: GroupNiche[];
  description: string;
  audience: string;
  searchHint: string;
};

function g(
  id: string,
  name: string,
  url: string,
  niches: GroupNiche[],
  description: string,
  audience: string,
  verified = true,
): CatalogGroup {
  return {
    id,
    name,
    url,
    verified: verified && !!url,
    niches,
    description,
    audience,
    searchHint: url || `Поиск в Telegram: ${name}`,
  };
}

/**
 * Каталог публичных чатов + темы для ручного поиска.
 * verified+url — можно вступать сразу; без url — оператор вставляет инвайт.
 */
export const GROUP_CATALOG: CatalogGroup[] = [
  // ——— Wildberries (публичные) ———
  g("wb-sellers", "WILDBERRIES seller", "https://t.me/wildberries_sllr", ["marketplaces", "wildberries", "ecommerce"], "Чат селлеров WB: карточки, поставки, комиссии.", "Селлеры WB"),
  g("wb-mplaces", "Поставщики Wildberries", "https://t.me/mplaces_wildberries", ["marketplaces", "wildberries", "ecommerce", "logistics"], "Крупный чат поставщиков и менеджеров WB.", "Селлеры WB"),
  g("wb-network", "Wildberries | Чат поставщиков", "https://t.me/wbnetwork", ["marketplaces", "wildberries", "ecommerce"], "Взаимопомощь поставщиков Wildberries.", "Селлеры WB"),
  g("wb-support-chat", "Чат поддержки поставщиков WB", "https://t.me/sellers_wildberries", ["marketplaces", "wildberries", "analytics"], "Поддержка поставщиков WB, аналитика, продажи.", "Селлеры WB"),
  g("wb-aidd", "Wildberries ЧАТ поставщиков", "https://t.me/wildberries_aidd", ["marketplaces", "wildberries", "ecommerce"], "Крупное сообщество поставщиков WB.", "Селлеры WB"),
  g("wb-helper", "WbHelper — помощь поставщикам", "https://t.me/WbHelper", ["marketplaces", "wildberries", "business"], "Вопросы по работе с WB.", "Селлеры WB"),
  g("wb-official-chat", "WB Official Chat", "https://t.me/wbofficialchat", ["marketplaces", "wildberries"], "Официальный/партнёрский чат WB.", "Партнёры WB"),
  g("wb-content", "Контент WB", "https://t.me/contentwbchat", ["marketplaces", "wildberries", "marketing", "content"], "Контент и карточки для WB.", "Контент / селлеры"),
  g("wb-sklad", "Склады WB", "https://t.me/wbofficialSKLAD", ["marketplaces", "wildberries", "logistics", "inventory", "fulfillment"], "Склады и поставки WB.", "Логистика"),
  g("wb-fbs", "Wildberries FBS", "https://t.me/wildberriesfbs", ["marketplaces", "wildberries", "logistics", "fulfillment"], "FBS-поставки и процессы.", "FBS-селлеры"),
  g("wb-search", "WB Search / видимость", "https://t.me/wbsearch", ["marketplaces", "wildberries", "analytics"], "Поиск и выдача на WB.", "Аналитика"),
  g("wb-mpchat", "Wildberries Поставщики | Чат Селлеров", "https://t.me/marketplace_wbchat", ["marketplaces", "wildberries", "ecommerce"], "Крупный чат взаимопомощи поставщиков WB.", "Селлеры WB"),
  g("wb-help", "WB Help", "https://t.me/wb_help", ["marketplaces", "wildberries"], "Помощь по Wildberries.", "Селлеры WB"),

  // ——— Ozon ———
  g("ozon-sellers", "OZON чат поставщиков", "https://t.me/ozon_mplace", ["marketplaces", "ozon", "ecommerce"], "Селлеры Ozon: FBO/FBS, акции, карточки.", "Селлеры Ozon"),
  g("ozon-mpgroup", "Ozon | Чат поставщиков", "https://t.me/mpgroup_ozon", ["marketplaces", "ozon", "ecommerce"], "Поддержка поставщиков Ozon, обмен опытом.", "Селлеры Ozon"),
  g("ozon-sllr", "OZON seller", "https://t.me/ozon_sllr", ["marketplaces", "ozon", "ecommerce"], "Сообщество селлеров Ozon.", "Селлеры Ozon"),
  g("ozon-business", "Ozon Business", "https://t.me/ozonbusiness", ["marketplaces", "ozon", "business"], "Бизнес-канал/чат Ozon.", "Селлеры Ozon"),

  // ——— Яндекс Маркет / Мегамаркет ———
  g("ym-sellers", "Чат продавцов Яндекс Маркета 2.0", "https://t.me/chat_marketplace_ym2", ["marketplaces", "yandex_market", "ecommerce"], "Крупный чат продавцов Яндекс Маркета.", "Селлеры ЯМ"),
  g("you-marketplaces", "Поставщики МП | объявления", "https://t.me/youmarketplaces", ["marketplaces", "yandex_market", "megamarket", "ecommerce"], "WB / Ozon / ЯМ / Мегамаркет.", "Мультиселлеры"),

  // ——— Мульти-МП ———
  g("mp-multi", "Чат селлеры WB / Ozon / YM", "https://t.me/mp_seller", ["marketplaces", "ecommerce", "analytics", "inventory", "pricing", "yandex_market"], "Общий чат мультиселлеров.", "Мультиселлеры"),
  g("mp-sellers-chat", "Чат продавцов WB / Ozon", "https://t.me/sellers_chat", ["marketplaces", "ecommerce", "wildberries", "ozon"], "Советы и опыт продавцов МП.", "Селлеры МП"),
  g("mp-wb-ozon", "Wildberries & Ozon | Чат поставщиков", "https://t.me/sellery_chat_ozon_wb", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Совместный чат поставщиков WB и Ozon.", "Мультиселлеры"),
  g("wb-ozon-chats", "Wildberries&Ozon | Чат Селлеров", "https://t.me/wildberriesozon_chats", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Крупный чат взаимопомощи селлеров.", "Мультиселлеры"),
  g("wboz-sellers", "Чат поставщиков | WB | OZON", "https://t.me/wbozsellers", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Поставщики WB и Ozon.", "Мультиселлеры"),
  g("wb-ozon-mp", "Общий чат поставщиков WB и Ozon", "https://t.me/wb_ozon_mp", ["marketplaces", "wildberries", "ozon"], "Общий чат поставщиков.", "Мультиселлеры"),
  g("wb-ozon-docs", "Сертификация и документы МП", "https://t.me/wb_ozonchat", ["marketplaces", "wildberries", "ozon", "certificates", "legal"], "Сертификаты, декларации, документы.", "Селлеры / юристы"),
  g("marketplace-chati", "Маркетплейсы. ЧАТ", "https://t.me/MarketplaceChati", ["1c", "ecommerce", "inventory", "marketplaces"], "Процессы, учёт, продвижение на МП.", "Селлеры / интеграторы"),

  // ——— Учёт ———
  g("moysklad-mp", "МойСклад | Блог", "https://t.me/moysklad", ["1c", "inventory", "marketplaces", "ecommerce", "saas"], "Учёт, e-commerce, маркетплейсы.", "Селлеры с учётом"),

  // ——— Доп. маркетплейсы / селлеры (проверенные публичные) ———
  g("wb-supply", "Wildberries | Чат поставщиков", "https://t.me/wb_supply", ["marketplaces", "wildberries", "ecommerce"], "Крупный чат поставщиков и продавцов WB.", "Селлеры WB"),
  g("wb-top-seller", "WB OZON Селлеры", "https://t.me/top_seller_wb_ozon", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Чат селлеров МП РФ.", "Мультиселлеры"),
  g("mp-marketplace-chat", "Маркетплейсы Чат поставщиков", "https://t.me/marketplace_mpchat", ["marketplaces", "ecommerce", "wildberries", "ozon"], "Сообщество поставщиков всех МП.", "Селлеры МП"),
  g("mp-helper", "Чат поставщиков маркетплейсов", "https://t.me/mplacechat_helper", ["marketplaces", "wildberries", "ecommerce"], "Взаимопомощь поставщиков WB/МП.", "Селлеры WB"),
  g("mp-wb-ozon-yam", "Чат поставщиков WB/Ozon/ЯМ", "https://t.me/wb_ozon_yamarket_chat", ["marketplaces", "wildberries", "ozon", "yandex_market", "ecommerce"], "WB, Ozon и Яндекс Маркет.", "Мультиселлеры"),
  g("mp-group-marketplace", "MP GROUP | чат МП", "https://t.me/mpgroup_marketplace", ["marketplaces", "ecommerce", "wildberries", "ozon", "yandex_market", "aliexpress"], "WB, Ozon, ЯМ, Lamoda, AliExpress.", "Селлеры МП"),
  g("ozon-sellers-2", "Ozon Чат поставщиков", "https://t.me/ozon_sellers_chat", ["marketplaces", "ozon", "ecommerce"], "Обсуждение работы с Ozon.", "Селлеры Ozon"),
  g("ozon-partner", "Ozon ЧАТ поставщиков", "https://t.me/ozon_partner", ["marketplaces", "ozon", "ecommerce"], "Чат поставщиков Ozon.", "Селлеры Ozon"),
  g("ym-sellers-2", "Яндекс.Маркет — для продавцов", "https://t.me/yandex_market_sellers", ["marketplaces", "yandex_market", "ecommerce"], "Продавцы Яндекс Маркета.", "Селлеры ЯМ"),

  // ——— Фулфилмент / логистика ———
  g("ff-full-logistic", "Фулл Логистик | Фулфилмент", "https://t.me/fulllogistic_chat", ["fulfillment", "logistics", "marketplaces", "wildberries", "ozon"], "Фулфилмент и доставка на МП.", "Fulfillment"),
  g("logistics-mp", "Logistics Marketplace", "https://t.me/logistics_marketplace", ["logistics", "fulfillment", "marketplaces", "ecommerce"], "Логистика под маркетплейсы.", "Логистика"),

  // ——— Китай / импорт ———
  g("china-mpgroup", "Доставка из Китая | MP Group", "https://t.me/mpgroup_china", ["china", "marketplaces", "logistics", "ecommerce", "wildberries", "ozon"], "Китай → РФ для WB/Ozon.", "Импортёры"),
  g("china-tovar", "Товары для МП / карго Китай", "https://t.me/tovar_kitay_market", ["china", "dropshipping", "ecommerce", "logistics", "marketplaces"], "Карго, товары для МП.", "Импорт / дроп"),
  g("china-cargo", "Карго Китай | 1688 / Taobao", "https://t.me/cargobai_long", ["china", "logistics", "ecommerce", "marketplaces", "wildberries", "ozon"], "Поиск товара, карго, 1688.", "Логистика ВЭД"),

  // ——— Аналитика / контент ———
  g("mpstats-chat", "MPSTATS Chat", "https://t.me/mpstatsio", ["analytics", "marketplaces", "pricing", "saas"], "Аналитика и управление продажами на МП.", "Аналитики"),
  g("shopstat-chat", "ShopStat Chat", "https://t.me/shopstat_chat", ["analytics", "marketplaces", "saas", "pricing"], "Аналитика магазинов и МП.", "Аналитики"),
  g("infograph-wb", "Инфографика товара WB/Ozon", "https://t.me/infograph_wb_ozon", ["content", "design", "marketplaces", "wildberries", "ozon"], "Инфографика карточек МП.", "Контент"),

  // ——— CRM / SaaS ———
  g("amocrm-official", "amoCRM канал", "https://t.me/amocrm", ["crm", "saas", "b2b", "business", "leadgen"], "Официальный канал amoCRM: продажи и CRM.", "B2B / CRM"),
  g("amocrm-chat", "amoCRM Chat", "https://t.me/amocrm_chat", ["crm", "saas", "b2b", "business"], "Обсуждение amoCRM и внедрений.", "B2B / CRM"),
  g("bitrix24-biz", "CRM Битрикс24 | Бизнес", "https://t.me/business_bitrix24", ["crm", "saas", "b2b", "business"], "Внедрение и автоматизация Битрикс24.", "B2B"),

  // ——— Бизнес / нетворкинг / стартапы ———
  g("biznes-chat-1", "Бизнес-чат №1", "https://t.me/biznes_chat", ["business", "networking", "b2b", "leadgen"], "Идеи, партнёры, поставщики, нетворкинг.", "Предприниматели"),
  g("biz-predprinimateli", "Подслушано Бизнес | Предприниматели", "https://t.me/predprinimateli_biznes", ["business", "networking", "freelance", "leadgen", "blogs"], "Бизнес, фриланс, заказчики.", "Бизнес"),
  g("biz-bezproblem", "Бизнес и фриланс", "https://t.me/bizbezproblem", ["business", "freelance", "leadgen", "networking"], "Поиск клиентов бизнесу и фрилансу.", "Бизнес / фриланс"),
  g("startup-founder", "IT Founder / проекты", "https://t.me/startup_founder", ["startup", "saas", "networking", "freelance"], "Идеи, команда, проекты.", "Стартапы"),
  g("moscow-biz-chat", "Предприниматели | Чат о бизнесе", "https://t.me/moscow_biz", ["business", "networking", "b2b", "leadgen"], "Чат предпринимателей: запросы услуг и партнёров.", "Предприниматели"),

  // ——— Фриланс ———
  g("freelance-tg", "Фриланс чат Telegram", "https://t.me/freelance_in_telegram", ["freelance", "design", "marketing", "content", "business"], "Заказчики и исполнители.", "Фриланс"),
  g("freelance-work", "Работа онлайн | чат", "https://t.me/work_online_today", ["freelance", "business", "design", "content", "hr"], "Удалёнка и заказы.", "Фриланс"),
  g("free-chat-fl", "Фриланс | FREE CHAT", "https://t.me/free_chat_for_freelance", ["freelance", "design", "marketing", "bots"], "Поиск проектов и подрядчиков.", "Фриланс"),
  g("habr-freelance", "Хабр Фриланс", "https://t.me/freelansim_ru", ["freelance", "saas", "b2b", "design"], "IT/digital заказы и подряд.", "IT / фриланс"),

  // ——— Вертикали ———
  g("beauty-biz", "Beauty Business Chat", "https://t.me/beauty_business_chat", ["beauty", "business", "crm", "marketing"], "Beauty-бизнес и услуги.", "Beauty"),
  g("vk-ads-chat", "VK реклама", "https://t.me/vk_ads_chat", ["vk_market", "marketing", "smm", "leadgen"], "Реклама ВКонтакте.", "SMM / Ads"),
  g("vk-ads-official", "VK Реклама (канал)", "https://t.me/vk_ads", ["vk_market", "marketing", "smm", "leadgen"], "Официальный канал VK Реклама.", "SMM / Ads"),

  // ——— TGStat: Блоги + бизнес/маркетинг (публичные, проверены t.me) ———
  // Категория «Блоги» на tgstat.ru/ratings/channels/blogs — плюс смежные business/marketing для лидгена.
  g("tgstat-blog-lebedev", "Артемий Лебедев", "https://t.me/temalebedev", ["blogs", "design", "business", "content"], "Блог предпринимателя/дизайна (TGStat Блоги).", "Блоги / дизайн"),
  g("tgstat-biz-mosbusy", "Москоубизнес", "https://t.me/mosbusy", ["blogs", "business", "networking", "leadgen"], "Крупный бизнес-блог Москвы (TGStat).", "Бизнес-блоги"),
  g("tgstat-biz-whatbiz", "Чё по бизнесу?", "https://t.me/whatbiz", ["blogs", "business", "startup", "leadgen"], "Бизнес-блог: кейсы и обсуждения.", "Бизнес-блоги"),
  g("tgstat-biz-lifeonline", "Life Онлайн", "https://t.me/lifeonline", ["blogs", "business", "marketing"], "Онлайн-бизнес и медиа (TGStat).", "Бизнес-блоги"),
  g("tgstat-biz-rb-ru", "Russian Business", "https://t.me/rb_ru", ["blogs", "business", "b2b", "startup"], "Russian Business — новости и кейсы.", "Бизнес-блоги"),
  g("tgstat-biz-retailrus", "Русский ритейл и бизнес", "https://t.me/retailrus", ["blogs", "business", "ecommerce", "marketplaces"], "Ритейл и e-com в РФ.", "Ритейл / e-com"),
  g("tgstat-biz-hour25", "25-й час | Бизнес и Финансы", "https://t.me/hour25business", ["blogs", "business", "fintech"], "Бизнес и финансы.", "Бизнес-блоги"),
  g("tgstat-startup-day", "Стартап дня. Александр Горный", "https://t.me/startupoftheday", ["blogs", "startup", "saas", "networking"], "Стартапы и продукт.", "Стартапы"),
  g("tgstat-forbes-ru", "Forbes Russia", "https://t.me/forbesrussia", ["blogs", "business", "b2b"], "Forbes Russia — бизнес-аудитория.", "Бизнес-медиа"),
  g("tgstat-sostav", "Sostav", "https://t.me/sostav", ["blogs", "marketing", "smm", "leadgen"], "Маркетинг и реклама (Sostav).", "Маркетинг"),
  g("tgstat-setters", "SETTERS Media", "https://t.me/setters", ["blogs", "marketing", "smm", "content"], "Digital/агентства, контент.", "Маркетинг"),
  g("tgstat-yandex-biz", "Яндекс для предпринимателей", "https://t.me/yandexbusiness", ["blogs", "business", "marketing", "saas"], "Яндекс: сервисы для бизнеса.", "Бизнес / ads"),
  g("tgstat-sber-biz", "СберБизнес", "https://t.me/sberbusiness", ["blogs", "business", "fintech", "b2b"], "СберБизнес — предприниматели.", "Финтех / SMB"),
  g("tgstat-modulbank", "Модульбанк", "https://t.me/modulbank", ["blogs", "business", "fintech", "accounting"], "Банк для бизнеса.", "Финтех"),
  g("tgstat-kontur", "Контур", "https://t.me/kontur", ["blogs", "business", "accounting", "legal", "saas"], "Контур: учёт, ЭДО, сервисы.", "SaaS / учёт"),
  g("tgstat-rbc-trends", "РБК Тренды", "https://t.me/rbc_trends", ["blogs", "business", "startup", "marketing"], "Тренды бизнеса и технологий.", "Бизнес-медиа"),
  g("tgstat-telegain", "Telega.in | реклама в Telegram", "https://t.me/telegain", ["blogs", "marketing", "bots", "leadgen", "smm"], "Нативная реклама в Telegram.", "Telegram ads"),
  g("tgstat-tgstat", "TGStat.ru", "https://t.me/tgstat", ["blogs", "bots", "analytics", "marketing"], "Аналитика Telegram-каналов и чатов.", "Telegram / аналитика"),
  g("tgstat-gopractice", "GoPractice!", "https://t.me/gopractice", ["blogs", "saas", "startup", "education"], "Продукт и growth.", "Product"),
  g("tgstat-pmclub", "pmclub — учим управлять", "https://t.me/pmclub", ["blogs", "saas", "startup", "education"], "Product management.", "Product"),
  g("tgstat-skillfactory", "IT-школа Skillfactory", "https://t.me/skillfactory", ["blogs", "education", "saas", "marketing"], "EdTech / IT-обучение.", "EdTech"),
  g("tgstat-netology", "Нетология", "https://t.me/netology_ru", ["blogs", "education", "marketing", "saas"], "Онлайн-образование.", "EdTech"),
  g("tgstat-geekbrains", "GeekBrains", "https://t.me/geekbrains_ru", ["blogs", "education", "saas"], "IT-обучение.", "EdTech"),
  g("tgstat-htmlacademy", "HTML Academy", "https://t.me/htmlacademy", ["blogs", "education", "freelance", "design"], "Веб-разработка / обучение.", "EdTech"),
  g("tgstat-hexlet", "Хекслет", "https://t.me/hexlet_ru", ["blogs", "education", "saas", "freelance"], "Программирование.", "EdTech"),
  g("tgstat-unisender", "Unisender", "https://t.me/unisender", ["blogs", "marketing", "saas", "leadgen"], "Email-маркетинг и рассылки.", "Маркетинг / SaaS"),
  g("tgstat-retailcrm", "RetailCRM", "https://t.me/retailcrm", ["blogs", "crm", "ecommerce", "saas", "marketing"], "CRM для e-com.", "CRM / e-com"),
  g("tgstat-carrotquest", "Carrot quest", "https://t.me/carrotquest", ["blogs", "saas", "marketing", "bots", "crm"], "Conversational marketing.", "SaaS / чаты"),
  g("tgstat-usedesk", "Юздеск", "https://t.me/usedesk", ["blogs", "saas", "crm", "bots"], "Helpdesk / поддержка.", "SaaS"),
  g("tgstat-helpdeskeddy", "HelpDeskEddy блог", "https://t.me/helpdeskeddy", ["blogs", "saas", "crm", "bots"], "Helpdesk-блог.", "SaaS"),
  g("tgstat-n8n-ru", "n8n russian", "https://t.me/n8n_ru", ["blogs", "saas", "bots", "business"], "Автоматизация n8n (чат).", "No-code / ops"),
  g("tgstat-copywriting-club", "Copywriting Club", "https://t.me/copywritingclub", ["blogs", "content", "marketing", "freelance"], "Копирайтинг и тексты.", "Контент"),
  g("tgstat-avito", "Авито", "https://t.me/avito", ["blogs", "avito", "business", "ecommerce", "leadgen"], "Официальный канал Авито.", "Авито / услуги"),
  g("tgstat-ozon-official", "OZON", "https://t.me/ozonru", ["blogs", "ozon", "marketplaces", "ecommerce"], "Официальный OZON.", "Маркетплейсы"),
  g("tgstat-tjournal", "TJ", "https://t.me/tjournal", ["blogs", "content", "marketing", "startup"], "Медиа / digital-аудитория.", "Медиа"),

  // ——— Темы / базы для ручного поиска (без обязательной ссылки) ———
  g("topic-crm-amocrm", "AmoCRM / CRM внедрение", "", ["crm", "saas", "b2b", "business"], "Ищут CRM, внедрение, интеграции.", "B2B / интеграторы", false),
  g("topic-bitrix", "Битрикс24 чаты", "", ["crm", "saas", "b2b", "business"], "Битрикс24, порталы, автоматизация.", "B2B", false),
  g("topic-megaplan", "Мегаплан / CRM", "", ["crm", "saas", "b2b"], "CRM и задачи для SMB.", "B2B", false),
  g("topic-retailcrm", "RetailCRM / e-com CRM", "https://t.me/retailcrm", ["crm", "ecommerce", "saas", "blogs"], "CRM для интернет-магазинов.", "E-com"),
  g("topic-saas-ru", "SaaS Russia / продукты", "", ["saas", "startup", "business", "b2b"], "Обсуждение SaaS и подписок.", "Основатели / продажи", false),
  g("topic-product-hunt-ru", "Product / indie hackers RU", "https://t.me/gopractice", ["saas", "startup", "blogs"], "Продуктовые обсуждения, запуск.", "Основатели"),
  g("topic-freelance-dev", "Фриланс разработка", "https://t.me/freelansim_ru", ["freelance", "saas", "business"], "Подрядчики, заказы на разработку.", "Агентства / фриланс"),
  g("topic-freelance-design", "Фриланс дизайн / SMM", "", ["freelance", "marketing", "design", "smm"], "Дизайн, SMM, контент.", "Агентства", false),
  g("topic-freelance-copy", "Копирайтинг / тексты", "https://t.me/copywritingclub", ["freelance", "content", "marketing", "blogs"], "Тексты, лендинги, карточки.", "Контент"),
  g("topic-marketing-perf", "Performance / контекст", "https://t.me/sostav", ["marketing", "business", "leadgen", "blogs"], "Реклама, трафик, агентства.", "Маркетинг"),
  g("topic-marketing-seo", "SEO / продвижение", "", ["marketing", "ecommerce", "content"], "SEO, контент-маркетинг.", "Маркетинг", false),
  g("topic-smm", "SMM / соцсети", "https://t.me/setters", ["smm", "marketing", "content", "blogs"], "Ведение соцсетей, таргет.", "SMM"),
  g("topic-startup-ru", "Стартапы RU", "https://t.me/startupoftheday", ["startup", "saas", "business", "networking", "blogs"], "Пилоты, B2B-продажи, продукт.", "Стартапы"),
  g("topic-b2b-sales", "B2B продажи", "https://t.me/whatbiz", ["b2b", "business", "crm", "saas", "leadgen", "blogs"], "Лиды, отделы продаж, CRM.", "Отделы продаж"),
  g("topic-ecommerce-ops", "Операции e-commerce", "", ["ecommerce", "inventory", "logistics", "fulfillment"], "Склады, фулфилмент, процессы.", "Операторы", false),
  g("topic-unit-econ", "Юнит-экономика МП", "", ["analytics", "pricing", "marketplaces"], "Маржа, ДРР, юнит-экономика.", "Аналитики / селлеры", false),
  g("topic-reviews-bot", "Отзывы и репутация", "", ["reviews", "marketplaces", "saas"], "Автоответы, рейтинг, сервисы отзывов.", "Поддержка / SaaS", false),
  g("topic-1c-integr", "1С интеграции с МП", "", ["1c", "marketplaces", "inventory", "saas"], "1С ↔ WB/Ozon/ЯМ.", "Интеграторы", false),
  g("topic-moysklad-chat", "МойСклад чаты пользователей", "", ["1c", "inventory", "ecommerce", "saas"], "Учёт и интеграции МойСклад.", "Селлеры", false),
  g("topic-proxy-farm", "Прокси и антидетект (осторожно)", "", ["business"], "Инфра для аккаунтов — шум, фильтровать стоп-словами.", "Операторы", false),
  g("topic-hr-exclude", "Вакансии / HR (стоп)", "", ["hr", "business"], "Вакансии — обычно не целевые лиды.", "HR", false),
  g("topic-megamarket", "Мегамаркет селлеры", "", ["megamarket", "marketplaces", "ecommerce"], "Продавцы Мегамаркета / СберМегаМаркет.", "Селлеры ММ", false),
  g("topic-avito", "Авито бизнес / услуги", "https://t.me/avito", ["avito", "business", "ecommerce", "freelance", "leadgen", "blogs"], "Услуги, подряд, локальный B2B.", "Услуги"),
  g("topic-vk-market", "VK Маркет / VK Ads", "https://t.me/vk_ads", ["vk_market", "marketplaces", "marketing", "smm", "blogs"], "Продажи и реклама ВКонтакте.", "Селлеры / SMM"),
  g("topic-aliexpress", "AliExpress / глобал", "", ["aliexpress", "marketplaces", "china", "ecommerce"], "Поставки и продажи Ali.", "Импорт / селлеры", false),
  g("topic-china-supply", "Поставщики Китай / 1688", "", ["china", "ecommerce", "logistics", "dropshipping"], "Поиск фабрик, выкуп, логистика.", "Импортёры", false),
  g("topic-dropshipping", "Дропшиппинг RU", "", ["dropshipping", "ecommerce", "marketplaces", "china"], "Дроп, витрины, поставщики.", "Дропшипперы", false),
  g("topic-fulfillment", "Фулфилмент / 3PL", "", ["fulfillment", "logistics", "inventory", "ecommerce"], "Склады под ключ, FBS/FBO.", "Операторы", false),
  g("topic-no-code", "No-code / автоматизация", "https://t.me/n8n_ru", ["saas", "crm", "business", "bots", "blogs"], "Make, n8n, Albato, интеграции.", "Интеграторы"),
  g("topic-support-outsource", "Аутсорс поддержки", "https://t.me/usedesk", ["freelance", "saas", "business", "bots", "blogs"], "Ищут операторов, чат-боты, helpdesk.", "Аутсорс"),
  g("topic-legal-ip", "ИП / юрсопровождение", "", ["legal", "business", "certificates"], "Регистрация, договоры, налоги.", "Юристы", false),
  g("topic-accounting", "Бухгалтерия для бизнеса", "https://t.me/kontur", ["accounting", "business", "1c", "blogs"], "Учёт, отчётность, аутсорс бухгалтерии.", "Бухгалтерия"),
  g("topic-telegram-bots", "Telegram-боты / чат-боты", "https://t.me/telegain", ["bots", "saas", "marketing", "business", "leadgen", "blogs"], "Боты, воронки, автоматизация диалогов.", "Разработка / SaaS"),
  g("topic-leadgen", "Лидогенерация / тёплые лиды", "https://t.me/carrotquest", ["leadgen", "marketing", "business", "saas", "b2b", "blogs"], "Заявки, прогрев, лидген-сервисы.", "Маркетинг"),
  g("topic-fintech", "Финтех / эквайринг / рассрочка", "https://t.me/modulbank", ["fintech", "ecommerce", "saas", "business", "blogs"], "Оплаты, BNPL, кассы.", "Финтех"),
  g("topic-education", "Онлайн-школы / EdTech", "https://t.me/netology_ru", ["education", "marketing", "saas", "business", "blogs"], "Курсы, LMS, трафик на обучение.", "EdTech"),
  g("topic-healthcare", "MedTech / клиники", "", ["healthcare", "saas", "business", "crm"], "Запись, CRM клиник, telemed.", "Med", false),
  g("topic-beauty", "Beauty / салоны", "", ["beauty", "business", "crm", "marketing"], "Салоны, мастера, запись.", "Beauty", false),
  g("topic-fashion", "Fashion / одежда МП", "", ["fashion", "marketplaces", "ecommerce", "wildberries", "ozon"], "Одежда, бренд, карточки.", "Fashion-селлеры", false),
  g("topic-food", "Food / доставка / HoReCa", "", ["food", "business", "logistics", "saas"], "Рестораны, доставка, агрегаторы.", "HoReCa", false),
  g("topic-auto", "Авто бизнес / дилеры", "", ["auto", "business", "crm", "marketing"], "Автосалоны, сервисы, лиды.", "Авто", false),
  g("topic-realestate", "Недвижимость / риелторы", "", ["realestate", "business", "crm", "leadgen"], "Объекты, лиды, CRM.", "Недвижимость", false),
  g("topic-design", "Дизайн / брендинг", "", ["design", "freelance", "marketing", "content"], "Фирстиль, упаковка, карточки.", "Дизайн", false),
  g("topic-content", "Контент / UGC / инфографика", "", ["content", "marketplaces", "marketing", "design"], "Инфографика МП, UGC, видео.", "Контент", false),
  g("topic-certificates", "Сертификация / декларации", "", ["certificates", "legal", "marketplaces", "china"], "Документы для МП и импорта.", "Сертификация", false),
  g("topic-analytics-mp", "Аналитика МП / MPStats / Moneyplace", "", ["analytics", "marketplaces", "pricing", "saas"], "Сервисы аналитики и ниш.", "Аналитики", false),
  g("topic-pricing-reprice", "Репрайсеры / динамические цены", "", ["pricing", "marketplaces", "saas", "analytics"], "Автоцены, конкуренты.", "Селлеры / SaaS", false),
  g("topic-inventory-sync", "Синхронизация остатков", "", ["inventory", "1c", "marketplaces", "saas"], "Остатки между площадками.", "Интеграторы", false),
  g("topic-networking-biz", "Бизнес-клубы / нетворкинг", "", ["networking", "business", "b2b", "startup"], "Знакомства, питчи, партнёрства.", "Основатели", false),
  g("topic-agency", "Digital-агентства", "", ["marketing", "freelance", "smm", "business", "leadgen"], "Агентства ищут подряд / клиентов.", "Агентства", false),
  g("topic-it-outsource", "IT-аутсорс / заказчики", "", ["freelance", "saas", "b2b", "business"], "Заказы на разработку и поддержку.", "IT", false),
  g("topic-helpdesk", "Helpdesk / омниканал", "https://t.me/usedesk", ["saas", "crm", "bots", "business", "blogs"], "Поддержка, чаты, тикеты.", "SaaS"),
  g("topic-email-crm", "Email / рассылки / CDP", "https://t.me/unisender", ["marketing", "saas", "crm", "leadgen", "blogs"], "Рассылки, сегменты, CRM-маркетинг.", "Маркетинг"),
  g("topic-call-center", "Колл-центр / телефония", "", ["business", "crm", "saas", "b2b"], "Ищут телефонию, скрипты, операторов.", "Продажи", false),
  g("topic-wholesale", "Опт / дистрибуция", "", ["business", "ecommerce", "china", "b2b"], "Оптовые поставки, дистрибьюторы.", "B2B", false),
  g("topic-brand", "Бренд / DTC", "", ["ecommerce", "marketing", "fashion", "beauty", "business"], "Свой бренд, DTC, маркетплейсы.", "Бренды", false),

  // ——— Рынки поиска клиентов (темы без обязательной ссылки) ———
  g("topic-clients-b2b", "Ищу клиентов B2B / подряд", "", ["b2b", "leadgen", "business", "freelance"], "«Ищу подрядчика», «нужен сервис», B2B-запросы.", "Продажи услуг", false),
  g("topic-clients-local", "Локальный бизнес / услуги города", "", ["business", "avito", "leadgen", "marketing"], "Клиенты на услуги в городе: ремонт, красота, авто.", "Локальные услуги", false),
  g("topic-clients-agency", "Заказчики агентств", "", ["marketing", "smm", "leadgen", "freelance", "business"], "Ищут SMM, performance, дизайн-студию.", "Агентства", false),
  g("topic-clients-it", "Заказчики IT / digital", "", ["freelance", "saas", "b2b", "bots", "business"], "«Нужен разработчик», «сделать бота», «CRM».", "IT / digital", false),
  g("topic-clients-edu", "Родители / курсы / репетиторы", "", ["education", "marketing", "leadgen"], "Запросы на обучение и курсы.", "EdTech", false),
  g("topic-clients-fit", "Фитнес / спорт / wellness", "", ["healthcare", "beauty", "business", "marketing"], "Залы, тренеры, wellness-услуги.", "Wellness", false),
  g("topic-clients-travel", "Туризм / визы / переезд", "", ["business", "legal", "leadgen"], "Визы, туры, релокация.", "Travel", false),
  g("topic-clients-photo", "Фото / видео / ивенты", "", ["design", "content", "freelance", "marketing"], "Съёмки, монтаж, мероприятия.", "Креатив", false),
  g("topic-clients-builders", "Стройка / ремонт / подряд", "", ["business", "realestate", "freelance", "leadgen"], "Ремонт квартир, стройматериалы, бригады.", "Стройка", false),
  g("topic-clients-lawyers", "Юрпомощь / банкротство / долги", "", ["legal", "business", "leadgen"], "Юристы, банкротство физлиц, договоры.", "Юристы", false),
  g("topic-clients-tax", "Налоги / бухгалтерия / ИП", "", ["accounting", "legal", "business", "1c"], "Бухгалтерия, налоги, открытие ИП/ООО.", "Бухгалтерия", false),
  g("topic-clients-invest", "Инвестиции / трейдинг (осторожно)", "", ["fintech", "business"], "Много шума — фильтровать стоп-словами.", "Финтех", false),
  g("topic-clients-crypto", "Крипта / web3 (осторожно)", "", ["fintech", "startup"], "Высокий шум и скам.", "Финтех", false),
  g("topic-clients-mothers", "Мамы / детские товары / услуги", "", ["business", "ecommerce", "marketing", "leadgen"], "Детские услуги, товары, няни.", "Family", false),
  g("topic-clients-pets", "Питомцы / вет / зоотовы", "", ["business", "ecommerce", "healthcare"], "Ветклиники, зоотовары, груминг.", "Pets", false),
  g("topic-clients-hr-recruit", "Рекрутинг / подбор (B2B)", "", ["hr", "b2b", "saas", "business"], "Ищут рекрутера / ATS — не путать с вакансиями.", "HR tech", false),
  g("topic-clients-pr", "PR / медиа / блогеры", "", ["marketing", "smm", "content", "leadgen"], "PR, посевы, инфлюенсеры.", "PR", false),
  g("topic-clients-print", "Полиграфия / мерч / упаковка", "", ["design", "ecommerce", "business", "china"], "Печать, мерч, упаковка для брендов.", "Производство", false),
  g("topic-clients-logistics-b2b", "Грузоперевозки / логистика B2B", "", ["logistics", "fulfillment", "business", "b2b"], "Перевозки, таможня, склады.", "Логистика", false),
  g("topic-clients-cafe", "Кафе / рестораны / поставщики", "", ["food", "business", "logistics"], "HoReCa ищет поставщиков и сервисы.", "HoReCa", false),
  g("topic-clients-doctors", "Врачи / клиники / пациенты", "", ["healthcare", "crm", "marketing", "leadgen"], "Запись, реклама клиник, сервисы.", "Med", false),
  g("topic-clients-schools", "Школы / детсады / кружки", "", ["education", "business", "leadgen"], "Образовательные услуги.", "Образование", false),
  g("topic-clients-events", "Ивенты / свадьбы / праздники", "", ["business", "design", "marketing", "leadgen"], "Организация мероприятий.", "Ивенты", false),
  g("topic-clients-cleaning", "Клининг / клининг B2B", "", ["business", "leadgen", "avito"], "Уборка квартир и офисов.", "Услуги", false),
  g("topic-clients-security", "Охрана / видеонаблюдение", "", ["business", "saas", "b2b"], "Системы безопасности.", "B2B", false),
  g("topic-clients-software", "Софт для бизнеса / лицензии", "", ["saas", "crm", "1c", "business"], "Ищут софт, лицензии, внедрение.", "SaaS", false),
  g("topic-clients-ads", "Реклама / трафик / лиды «куплю»", "", ["marketing", "leadgen", "smm", "business"], "Покупают трафик и заявки.", "Маркетинг", false),
  g("topic-fl-ru", "FL.ru / биржа фриланса (чат)", "", ["freelance", "design", "content", "business"], "Биржи и чаты заказчиков.", "Фриланс", false),
  g("topic-kwork", "Kwork / заказы", "", ["freelance", "design", "marketing", "bots"], "Заказы на услуги.", "Фриланс", false),
  g("topic-habr-freelance", "Хабр Фриланс / IT-заказы", "https://t.me/freelansim_ru", ["freelance", "saas", "b2b"], "IT-подряд и заказчики.", "IT"),
  g("topic-vc-ru", "VC.ru / предприниматели", "https://t.me/startupoftheday", ["startup", "business", "saas", "networking", "b2b", "blogs"], "Стартапы и малый бизнес ищут сервисы.", "Стартапы"),
  g("topic-entrepreneurs", "Предприниматели RU чаты", "https://t.me/moscow_biz", ["business", "networking", "b2b", "leadgen"], "Общение предпринимателей, запросы услуг.", "Бизнес"),
  g("topic-moscow-biz", "Бизнес Москва / регионы", "https://t.me/mosbusy", ["business", "networking", "leadgen", "avito", "blogs"], "Городские бизнес-чаты.", "Локальный B2B"),
  g("topic-women-biz", "Женский бизнес / community", "", ["business", "networking", "marketing", "beauty"], "Комьюнити и запросы услуг.", "Community", false),
  g("topic-export", "Экспорт / ВЭД", "", ["china", "logistics", "business", "legal", "b2b"], "ВЭД, таможня, экспортёры.", "ВЭД", false),
  g("topic-farmers", "Фермеры / агро", "", ["food", "business", "logistics", "ecommerce"], "Агробизнес и сбыт.", "Агро", false),
  g("topic-handmade", "Handmade / крафт / маркеты", "", ["ecommerce", "marketplaces", "design", "marketing"], "Хендмейд-продавцы ищут продвижение.", "E-com", false),
  g("topic-podcast", "Подкасты / медиа", "", ["content", "marketing", "smm"], "Медиа ищут гостей, продюсеров, сервисы.", "Медиа", false),
  g("topic-gaming", "Геймдев / студии", "", ["freelance", "startup", "design", "saas"], "Студии ищут подряд и тулы.", "Геймдев", false),
  g("topic-mobile-apps", "Мобильные приложения / заказы", "", ["freelance", "saas", "bots", "business"], "Заказ приложений и поддержка.", "Mobile", false),
  // ——— TGStat dump: Блоги / Бизнес / Маркетинг (все проверенные t.me) ———
  g("tgstat-blogs-a4omg", "Влад Бумага A4", "https://t.me/A4omg", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (445 069 subscribers).", "Блоги"),
  g("tgstat-blogs-aidaprodom", "Лёгкий быт с Аидой Prodom", "https://t.me/aidaprodom", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (312 608 subscribers).", "Блоги"),
  g("tgstat-blogs-alexasuka", "СИТУАЦИЯ СЮР", "https://t.me/alexasuka", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (421 736 subscribers).", "Блоги"),
  g("tgstat-blogs-alisherhateu", "MORGENSHTERN", "https://t.me/alisherhateu", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (641 913 subscribers).", "Блоги"),
  g("tgstat-blogs-anarabdullaevtwitch", "Анар Абдуллаев | anarabdullaev twitch", "https://t.me/anarabdullaevtwitch", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (589 447 subscribers).", "Блоги"),
  g("tgstat-blogs-anyaischukkkk", "Аня Ищук", "https://t.me/anyaischukkkk", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (601 035 subscribers).", "Блоги"),
  g("tgstat-blogs-artem_wolff", "AW", "https://t.me/artem_wolff", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (302 372 subscribers).", "Блоги"),
  g("tgstat-blogs-aslanshukasha", "Аслан Шукаша👷🏻", "https://t.me/aslanshukasha", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (294 161 subscribers).", "Блоги"),
  g("tgstat-blogs-barrashikliza", "барашик лизок @barrashik", "https://t.me/barrashikliza", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (369 691 subscribers).", "Блоги"),
  g("tgstat-blogs-batek_official", "BATEK_OFFICIAL", "https://t.me/batek_official", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (400 808 subscribers).", "Блоги"),
  g("tgstat-blogs-bigpencil", "Бустер 🍄", "https://t.me/bigpencil", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 204 770 subscribers).", "Блоги"),
  g("tgstat-blogs-bloodysx", "Кровавая барыня", "https://t.me/bloodysx", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 159 272 subscribers).", "Блоги"),
  g("tgstat-blogs-bonyaviktorya", "Виктория Боня", "https://t.me/bonyaviktorya", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (609 217 subscribers).", "Блоги"),
  g("tgstat-blogs-borodylia0803", "Ксения Бородина", "https://t.me/borodylia0803", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (914 760 subscribers).", "Блоги"),
  g("tgstat-blogs-br1anm7ps", "здесь живет броен", "https://t.me/br1anm7ps", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 089 332 subscribers).", "Блоги"),
  g("tgstat-blogs-bulkin_live", "В гостях у Булыча", "https://t.me/bulkin_live", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (912 408 subscribers).", "Блоги"),
  g("tgstat-blogs-byzovahouse", "Бузова", "https://t.me/byzovahouse", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (410 740 subscribers).", "Блоги"),
  g("tgstat-blogs-camon_edward", "EDWARD BIL", "https://t.me/camon_edward", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (351 096 subscribers).", "Блоги"),
  g("tgstat-blogs-dance_adrenalin", "AdrenalinHouse", "https://t.me/dance_adrenalin", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (326 736 subscribers).", "Блоги"),
  g("tgstat-blogs-danila_gorilla", "ДАНИЛА ГОРИЛЛА 🦍", "https://t.me/danila_gorilla", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (643 738 subscribers).", "Блоги"),
  g("tgstat-blogs-deepinstv", "дипинс 🤢", "https://t.me/deepinstv", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (502 270 subscribers).", "Блоги"),
  g("tgstat-blogs-dikiidanik", "Даник и Тайная комната", "https://t.me/dikiidanik", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (403 867 subscribers).", "Блоги"),
  g("tgstat-blogs-dknasasal", "Данила Кашен", "https://t.me/DKNASASAL", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (391 592 subscribers).", "Блоги"),
  g("tgstat-blogs-dmlixxx", "Ликс", "https://t.me/dmlixxx", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (364 167 subscribers).", "Блоги"),
  g("tgstat-blogs-domergrief", "ЗОВУТ ДОМЕР", "https://t.me/DomerGrief", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (684 463 subscribers).", "Блоги"),
  g("tgstat-blogs-drakestudio", "дрейк", "https://t.me/drakestudio", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (341 233 subscribers).", "Блоги"),
  g("tgstat-blogs-dur0va", "Девушка Дурова", "https://t.me/dur0va", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (384 078 subscribers).", "Блоги"),
  g("tgstat-blogs-edisonfamilia", "EDISON FAMILY", "https://t.me/edisonfamilia", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (777 569 subscribers).", "Блоги"),
  g("tgstat-blogs-egorikvtg", "ЕГОР ШКРЕД", "https://t.me/egorikvtg", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (704 412 subscribers).", "Блоги"),
  g("tgstat-blogs-ekaterina_mizulina", "Екатерина Мизулина", "https://t.me/ekaterina_mizulina", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (935 972 subscribers).", "Блоги"),
  g("tgstat-blogs-elenaraytman", "Elena Raytman", "https://t.me/elenaraytman", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (849 976 subscribers).", "Блоги"),
  g("tgstat-blogs-evelone192gg", "EVELONE 1️⃣9️⃣2️⃣", "https://t.me/evelone192gg", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 107 816 subscribers).", "Блоги"),
  g("tgstat-blogs-exilemusic13", "Exile", "https://t.me/exilemusic13", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 445 794 subscribers).", "Блоги"),
  g("tgstat-blogs-galich_onok", "IdaGalich", "https://t.me/GALICH_onok", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (286 616 subscribers).", "Блоги"),
  g("tgstat-blogs-gordeylive", "ГОРДЕЙ", "https://t.me/GORDEYLIVE", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (671 675 subscribers).", "Блоги"),
  g("tgstat-blogs-gosprek", "Госпожа Рекомендует", "https://t.me/GOSPREK", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (303 911 subscribers).", "Блоги"),
  g("tgstat-blogs-hardgabar", "ГАБАР", "https://t.me/hardgabar", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (346 576 subscribers).", "Блоги"),
  g("tgstat-blogs-hedonism_daily", "Hedonist Daily", "https://t.me/hedonism_daily", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (304 449 subscribers).", "Блоги"),
  g("tgstat-blogs-hladenko", "короче, Гладенко", "https://t.me/hladenko", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (410 788 subscribers).", "Блоги"),
  g("tgstat-blogs-ikakprosto", "СТАС БОМБИТ", "https://t.me/ikakprosto", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (326 595 subscribers).", "Блоги"),
  g("tgstat-blogs-ilovesex666", "CMH", "https://t.me/ilovesex666", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (288 081 subscribers).", "Блоги"),
  g("tgstat-blogs-imnotbozhena", "НЕБОЖЕНА", "https://t.me/imnotbozhena", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (504 326 subscribers).", "Блоги"),
  g("tgstat-blogs-imnotmaplestar", "Maplestar", "https://t.me/imnotmaplestar", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (341 306 subscribers).", "Блоги"),
  g("tgstat-blogs-instasamkacore", "INSTASAMKA", "https://t.me/instasamkacore", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (436 922 subscribers).", "Блоги"),
  g("tgstat-blogs-irena_ponaroshku", "Ирена Понарошку", "https://t.me/irena_ponaroshku", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (282 365 subscribers).", "Блоги"),
  g("tgstat-blogs-juliamenshovajulia", "ЮЛИЯ МЕНЬШОВА", "https://t.me/JuliaMenshovaJulia", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (359 331 subscribers).", "Блоги"),
  g("tgstat-blogs-karnava1l", "🎀Karna.val🎀", "https://t.me/karnava1l", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (286 183 subscribers).", "Блоги"),
  g("tgstat-blogs-koreshzy", "Кореш", "https://t.me/koreshzy", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (829 674 subscribers).", "Блоги"),
  g("tgstat-blogs-ksbchk", "СОБЧАК", "https://t.me/ksbchk", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (372 646 subscribers).", "Блоги"),
  g("tgstat-blogs-kuplinov_telegram", "Kuplinov ► Play", "https://t.me/Kuplinov_Telegram", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (914 139 subscribers).", "Блоги"),
  g("tgstat-blogs-litvintm", "ЛИТВИН", "https://t.me/litvintm", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 569 932 subscribers).", "Блоги"),
  g("tgstat-blogs-losenok95", "Лосёнкина", "https://t.me/losenok95", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (389 028 subscribers).", "Блоги"),
  g("tgstat-blogs-luka_ebkov", "Лука Ебков", "https://t.me/luka_ebkov", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (431 261 subscribers).", "Блоги"),
  g("tgstat-blogs-marmok_yt", "Marmok_yt", "https://t.me/marmok_yt", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (477 620 subscribers).", "Блоги"),
  g("tgstat-blogs-maslennikovliga", "Дима Масленников", "https://t.me/maslennikovliga", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (2 142 720 subscribers).", "Блоги"),
  g("tgstat-blogs-mazellovvv", "mzlff", "https://t.me/mazellovvv", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (421 586 subscribers).", "Блоги"),
  g("tgstat-blogs-meels_kel", "Милс Кел (Play)", "https://t.me/meels_kel", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (326 449 subscribers).", "Блоги"),
  g("tgstat-blogs-minaevlife", "Сергей Минаев", "https://t.me/minaevlife", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (318 711 subscribers).", "Блоги"),
  g("tgstat-blogs-mister_kokoshka2", "Андрей Кокошка", "https://t.me/mister_kokoshka2", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (484 893 subscribers).", "Блоги"),
  g("tgstat-blogs-moscowtinderr", "москоутиндер", "https://t.me/moscowtinderr", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (741 281 subscribers).", "Блоги"),
  g("tgstat-blogs-mosptichka", "Московская птичка", "https://t.me/mosptichka", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (455 702 subscribers).", "Блоги"),
  g("tgstat-blogs-mskaramelka01", "кристюшкина😋", "https://t.me/mskaramelka01", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (292 347 subscribers).", "Блоги"),
  g("tgstat-blogs-nebudetgg", "Логово Внизу", "https://t.me/nebudetgg", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (494 692 subscribers).", "Блоги"),
  g("tgstat-blogs-nerds", "nerds", "https://t.me/nerds", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (415 498 subscribers).", "Блоги"),
  g("tgstat-blogs-nevzorovtv", "НЕВЗОРОВ", "https://t.me/nevzorovtv", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 019 380 subscribers).", "Блоги"),
  g("tgstat-blogs-nowkies", "ты nowkie?", "https://t.me/nowkies", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (402 105 subscribers).", "Блоги"),
  g("tgstat-blogs-oieiei", "ФРАМЕ ТАМЕР", "https://t.me/oieiei", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (685 820 subscribers).", "Блоги"),
  g("tgstat-blogs-onastasiz", "О!настосис", "https://t.me/onastasiz", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (682 955 subscribers).", "Блоги"),
  g("tgstat-blogs-paradeevich", "ПАРАДЕЕВИЧ", "https://t.me/paradeevich", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 059 086 subscribers).", "Блоги"),
  g("tgstat-blogs-paramonova_as", "записки анечки", "https://t.me/paramonova_as", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (450 762 subscribers).", "Блоги"),
  g("tgstat-blogs-partizanets", "Погребижская. Без сахара.", "https://t.me/partizanets", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (437 773 subscribers).", "Блоги"),
  g("tgstat-blogs-petrovchanka_lera", "@petrovchanka_lera", "https://t.me/petrovchanka_lera", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (400 712 subscribers).", "Блоги"),
  g("tgstat-blogs-pinchulli", "Ирина Пинчук", "https://t.me/pinchulli", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (343 609 subscribers).", "Блоги"),
  g("tgstat-blogs-polunintrade7", "ПОЛУНИН", "https://t.me/polunintrade7", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (524 738 subscribers).", "Блоги"),
  g("tgstat-blogs-ravshannstream", "Равшан Джульпаев", "https://t.me/RavshanNstream", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (356 730 subscribers).", "Блоги"),
  g("tgstat-blogs-rutkismary", "rutkismary", "https://t.me/rutkismary", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (333 442 subscribers).", "Блоги"),
  g("tgstat-blogs-sammyfam", "Samoylovaoxana", "https://t.me/sammyfam", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (684 295 subscribers).", "Блоги"),
  g("tgstat-blogs-sasavot", "SASAVOT 26+", "https://t.me/sasavot", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (336 658 subscribers).", "Блоги"),
  g("tgstat-blogs-sashatyman", "Туман", "https://t.me/sashatyman", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (331 508 subscribers).", "Блоги"),
  g("tgstat-blogs-savastikchanel", "АРИ НА МАТЬ", "https://t.me/savastikchanel", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (498 709 subscribers).", "Блоги"),
  g("tgstat-blogs-shadowkekw", "секретный тг шадоукека", "https://t.me/shadowkekw", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (617 887 subscribers).", "Блоги"),
  g("tgstat-blogs-shulginchik_nik", "НИКИТА ШУЛЬГИН", "https://t.me/shulginchik_nik", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (304 574 subscribers).", "Блоги"),
  g("tgstat-blogs-slovopatsana", "СЛОВО ПАЦАНА", "https://t.me/slovopatsana", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (306 948 subscribers).", "Блоги"),
  g("tgstat-blogs-strelets_molodec", "Стрелец-Молодец", "https://t.me/strelets_molodec", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (355 370 subscribers).", "Блоги"),
  g("tgstat-blogs-strimrs", "СТРИМЕРСКИЙ", "https://t.me/strimrs", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (407 658 subscribers).", "Блоги"),
  g("tgstat-blogs-subo8686", "С любовью,SUBO💛", "https://t.me/subo8686", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (345 339 subscribers).", "Блоги"),
  g("tgstat-blogs-sultanhamzaev", "ХАМЗАЕВ", "https://t.me/sultanhamzaev", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (296 379 subscribers).", "Блоги"),
  g("tgstat-blogs-supestas1", "СУПЕР СТАС (тут любят еду )", "https://t.me/supestas1", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (407 562 subscribers).", "Блоги"),
  g("tgstat-blogs-t2xtwitch", "T2x2", "https://t.me/t2xtwitch", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (333 678 subscribers).", "Блоги"),
  g("tgstat-blogs-thebadcomedian", "[BadComedian]", "https://t.me/TheBadComedian", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (603 535 subscribers).", "Блоги"),
  g("tgstat-blogs-tikandelaki", "Тина Канделаки", "https://t.me/tikandelaki", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (307 327 subscribers).", "Блоги"),
  g("tgstat-blogs-topapopa", "Utopia Show", "https://t.me/topapopa", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (368 456 subscribers).", "Блоги"),
  g("tgstat-blogs-vladglenttg", "Глент 🚀", "https://t.me/vladglenttg", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (576 437 subscribers).", "Блоги"),
  g("tgstat-blogs-windy31room", "Винди31🤝", "https://t.me/windy31room", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (542 139 subscribers).", "Блоги"),
  g("tgstat-blogs-yurydud", "Дудь", "https://t.me/yurydud", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (864 066 subscribers).", "Блоги"),
  g("tgstat-blogs-zhidkovskiy_talk", "Жидковские посиделки", "https://t.me/zhidkovskiy_talk", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (575 478 subscribers).", "Блоги"),
  g("tgstat-blogs-zubarefff", "Александр Зубарев", "https://t.me/zubarefff", ["blogs", "content", "networking"], "Канал из TGStat «Блоги» (1 329 173 subscribers).", "Блоги"),
  g("tgstat-business-adultbiz_real", "PROБизнес | 💼 Взрослый бизнес без иллюзий", "https://t.me/adultbiz_real", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (160 074 subscribers).", "Бизнес"),
  g("tgstat-business-aironzak", "Арон Закрия", "https://t.me/aironzak", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (121 165 subscribers).", "Бизнес"),
  g("tgstat-business-arsoilazs", "ARS_oil", "https://t.me/arsoilazs", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (81 726 subscribers).", "Бизнес"),
  g("tgstat-business-avito_b2b", "Авито для бизнеса", "https://t.me/avito_b2b", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (130 971 subscribers).", "Бизнес"),
  g("tgstat-business-bikontora", "Бизнес Контора — канал про бизнес", "https://t.me/bikontora", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (62 560 subscribers).", "Бизнес"),
  g("tgstat-business-biznesbezglyanca", "Бизнес без глянца", "https://t.me/biznesbezglyanca", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (258 757 subscribers).", "Бизнес"),
  g("tgstat-business-bloggers_artists_celebrities", "👑 БЛОГЕРЫ Стримеры Мемы", "https://t.me/bloggers_artists_celebrities", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (79 803 subscribers).", "Бизнес"),
  g("tgstat-business-brainsstorming", "Business Storm", "https://t.me/brainsstorming", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (62 858 subscribers).", "Бизнес"),
  g("tgstat-business-b_retail", "Беспощадный ритейл", "https://t.me/b_retail", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (140 861 subscribers).", "Бизнес"),
  g("tgstat-business-btochka", "Бизнес — и Точка", "https://t.me/btochka", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (73 760 subscribers).", "Бизнес"),
  g("tgstat-business-buisness_ideal", "Бизнес Идеи | Стартапы", "https://t.me/buisness_ideal", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (440 890 subscribers).", "Бизнес"),
  g("tgstat-business-businesadvisor", "Business Advisor", "https://t.me/BusinesAdvisor", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (163 474 subscribers).", "Бизнес"),
  g("tgstat-business-businesprojects", "Бизнес Проект", "https://t.me/BusinesProjects", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (170 785 subscribers).", "Бизнес"),
  g("tgstat-business-businessatmosphere", "Бизнес Атмосфера", "https://t.me/BusinessAtmosphere", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (123 309 subscribers).", "Бизнес"),
  g("tgstat-business-business_cases", "Денежные кейсы", "https://t.me/business_cases", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (159 995 subscribers).", "Бизнес"),
  g("tgstat-business-business_dna_russia", "Бизнес ДНК России", "https://t.me/Business_DNA_Russia", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (304 796 subscribers).", "Бизнес"),
  g("tgstat-business-businesses_upgrade", "Апгрейд | Бизнес", "https://t.me/Businesses_Upgrade", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (110 131 subscribers).", "Бизнес"),
  g("tgstat-business-business_marketing_finance", "📊 Marketing FINANCE Business", "https://t.me/business_marketing_finance", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (68 841 subscribers).", "Бизнес"),
  g("tgstat-business-business_podcast", "Бизнес Подкасты", "https://t.me/business_podcast", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (172 502 subscribers).", "Бизнес"),
  g("tgstat-business-business_university", "Бизнес Кийосаки", "https://t.me/Business_University", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (173 148 subscribers).", "Бизнес"),
  g("tgstat-business-bussideas", "5 бизнес идей", "https://t.me/bussideas", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (223 565 subscribers).", "Бизнес"),
  g("tgstat-business-busspod", "5 бизнес подкастов", "https://t.me/Busspod", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (175 956 subscribers).", "Бизнес"),
  g("tgstat-business-bznachit", "Б — значит бизнес", "https://t.me/bznachit", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 927 subscribers).", "Бизнес"),
  g("tgstat-business-commerc", "Коммерс", "https://t.me/commerc", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (142 192 subscribers).", "Бизнес"),
  g("tgstat-business-delo_govorim", "DELO говорим", "https://t.me/DELO_govorim", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (68 552 subscribers).", "Бизнес"),
  g("tgstat-business-dengivezde", "Деньги есть везде", "https://t.me/dengivezde", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (177 001 subscribers).", "Бизнес"),
  g("tgstat-business-disruptors_official", "Дизраптор", "https://t.me/disruptors_official", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (73 108 subscribers).", "Бизнес"),
  g("tgstat-business-ec_retail", "Ритейл Медиа", "https://t.me/ec_retail", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (69 626 subscribers).", "Бизнес"),
  g("tgstat-business-fabula_community", "Fabula AI • Нейросеть для селлеров", "https://t.me/fabula_community", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (125 010 subscribers).", "Бизнес"),
  g("tgstat-business-finance_instinct", "Финансовый инстинкт", "https://t.me/Finance_Instinct", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (120 438 subscribers).", "Бизнес"),
  g("tgstat-business-financovich", "Финансович | Бизнес блог", "https://t.me/financovich", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (139 042 subscribers).", "Бизнес"),
  g("tgstat-business-finapla", "Финансы на Плаву — бизнес и тренды", "https://t.me/finapla", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 642 subscribers).", "Бизнес"),
  g("tgstat-business-founder_startup", "Фаундер | Бизнес и стартапы", "https://t.me/Founder_Startup", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (148 132 subscribers).", "Бизнес"),
  g("tgstat-business-from_ceo", "CEO печатает…", "https://t.me/from_CEO", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (168 789 subscribers).", "Бизнес"),
  g("tgstat-business-gain_business", "Миллионы | Бизнес блог", "https://t.me/gain_business", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (176 225 subscribers).", "Бизнес"),
  g("tgstat-business-gdemoneyzina", "Где деньги, Зин?", "https://t.me/gdemoneyzina", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 156 subscribers).", "Бизнес"),
  g("tgstat-business-great_life_union1", "GREAT LIFE UNION │БИЗНЕС", "https://t.me/great_life_union1", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 001 subscribers).", "Бизнес"),
  g("tgstat-business-hour_25", "25-й час • Бизнес и Финансы", "https://t.me/Hour_25", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (268 574 subscribers).", "Бизнес"),
  g("tgstat-business-imceobeach", "I’m CEO, beach", "https://t.me/imceobeach", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (65 614 subscribers).", "Бизнес"),
  g("tgstat-business-kommerc", "Е-коммерс", "https://t.me/kommerc", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (237 986 subscribers).", "Бизнес"),
  g("tgstat-business-kutergin_on_fire", "Кутергин в огне 🔥", "https://t.me/kutergin_on_fire", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 684 subscribers).", "Бизнес"),
  g("tgstat-business-kyrillic", "kyrillic", "https://t.me/kyrillic", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 013 subscribers).", "Бизнес"),
  g("tgstat-business-malkinawb", "Дана Малкина WB", "https://t.me/malkinawb", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (90 874 subscribers).", "Бизнес"),
  g("tgstat-business-master_businessa", "Мастер Бизнеса", "https://t.me/master_businessa", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (129 279 subscribers).", "Бизнес"),
  g("tgstat-business-millionairesengine", "Двигатель миллионеров | Бизнес", "https://t.me/millionairesengine", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (61 599 subscribers).", "Бизнес"),
  g("tgstat-business-millionaire_thinks", "Мышление Миллионера", "https://t.me/millionaire_thinks", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (94 448 subscribers).", "Бизнес"),
  g("tgstat-business-misli_bogatich", "Мысли богатых | бизнес блог", "https://t.me/misli_bogatich", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (174 625 subscribers).", "Бизнес"),
  g("tgstat-business-mosbiznes", "Москва, Бизнес и Технологии", "https://t.me/mosbiznes", ["blogs", "business", "leadgen", "networking"], "Канал из TGStat «Бизнес и стартапы» (81 293 subscribers).", "Бизнес"),
  g("tgstat-marketing-aaaredmarketing", "Красный маркетинг Гиязова", "https://t.me/aaaredmarketing", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (276 703 subscribers).", "Маркетинг"),
  g("tgstat-marketing-arinaalexx", "Арина Алекс. REELS и продажи", "https://t.me/ArinaAlexx", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (115 901 subscribers).", "Маркетинг"),
  g("tgstat-marketing-bardachko", "коллеги, не сутультесь", "https://t.me/bardachko", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (564 834 subscribers).", "Маркетинг"),
  g("tgstat-marketing-boomers_tv", "бумеры смотрят телек", "https://t.me/boomers_TV", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (160 106 subscribers).", "Маркетинг"),
  g("tgstat-marketing-bossy_marketing", "BOSSY MARKETING / Маркетинг, реклама и SMM для тех, кто хочет быть заметным", "https://t.me/bossy_marketing", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (200 774 subscribers).", "Маркетинг"),
  g("tgstat-marketing-brand_horse", "Бренды на коне", "https://t.me/brand_horse", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (137 325 subscribers).", "Маркетинг"),
  g("tgstat-marketing-business_trends", "бизнестрендс", "https://t.me/business_trends", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (958 945 subscribers).", "Маркетинг"),
  g("tgstat-marketing-ca11_you", "мы вам перезвоним", "https://t.me/ca11_you", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (141 490 subscribers).", "Маркетинг"),
  g("tgstat-marketing-capitalcult", "Культ Капитала", "https://t.me/CapitalCult", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (88 780 subscribers).", "Маркетинг"),
  g("tgstat-marketing-ceotxt_1", "CEO.txt", "https://t.me/ceotxt_1", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (388 782 subscribers).", "Маркетинг"),
  g("tgstat-marketing-cl1ck_gr", "Кликабельно, но больнно", "https://t.me/cl1ck_gr", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (137 995 subscribers).", "Маркетинг"),
  g("tgstat-marketing-collegi", "Передали коллегам", "https://t.me/collegi", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (137 736 subscribers).", "Маркетинг"),
  g("tgstat-marketing-costperlead", "Маркетинг нефильтрованный", "https://t.me/costperlead", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (109 908 subscribers).", "Маркетинг"),
  g("tgstat-marketing-cpa_lenta", "CPALENTA | Арбитраж трафика", "https://t.me/cpa_lenta", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (122 074 subscribers).", "Маркетинг"),
  g("tgstat-marketing-creative", "Креатив со звездочкой", "https://t.me/creative", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (134 253 subscribers).", "Маркетинг"),
  g("tgstat-marketing-creative_brief", "Креативный бриф", "https://t.me/creative_brief", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (125 485 subscribers).", "Маркетинг"),
  g("tgstat-marketing-creativeee", "гура́", "https://t.me/creativeee", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (61 475 subscribers).", "Маркетинг"),
  g("tgstat-marketing-creoch", "Креатив на сдачу", "https://t.me/creoch", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (90 017 subscribers).", "Маркетинг"),
  g("tgstat-marketing-cubemark", "Куб маркетинга", "https://t.me/cubemark", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (60 476 subscribers).", "Маркетинг"),
  g("tgstat-marketing-dbeskromny", "Бескромный", "https://t.me/dbeskromny", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (152 795 subscribers).", "Маркетинг"),
  g("tgstat-marketing-dnative", "DNative — блог Ткачука про SMM", "https://t.me/dnative", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (81 435 subscribers).", "Маркетинг"),
  g("tgstat-marketing-doffamarketologa", "Дофамин Маркетолога", "https://t.me/doffamarketologa", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (92 804 subscribers).", "Маркетинг"),
  g("tgstat-marketing-drinkablewater", "вода питьевая", "https://t.me/drinkablewater", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (245 140 subscribers).", "Маркетинг"),
  g("tgstat-marketing-dubrovskaya_angelina", "Дубровская 👊🏿", "https://t.me/dubrovskaya_angelina", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (81 944 subscribers).", "Маркетинг"),
  g("tgstat-marketing-familybots", "Семейка ботов", "https://t.me/FamilyBots", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (709 737 subscribers).", "Маркетинг"),
  g("tgstat-marketing-glvrdru", "Максим Ильяхов (Главред)", "https://t.me/glvrdru", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (69 558 subscribers).", "Маркетинг"),
  g("tgstat-marketing-godketing", "Боги маркетинга", "https://t.me/Godketing", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (113 149 subscribers).", "Маркетинг"),
  g("tgstat-marketing-guerrillamarketing", "Партизанский Маркетинг", "https://t.me/GuerrillaMarketing", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (104 691 subscribers).", "Маркетинг"),
  g("tgstat-marketing-impr3ss", "первое впечатление", "https://t.me/impr3ss", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (71 417 subscribers).", "Маркетинг"),
  g("tgstat-marketing-influencebureau", "Бюро Влияния", "https://t.me/InfluenceBureau", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (88 644 subscribers).", "Маркетинг"),
  g("tgstat-marketing-klientvsprav", "Клиент всегда прав", "https://t.me/klientvsprav", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (1 063 667 subscribers).", "Маркетинг"),
  g("tgstat-marketing-kollegi", "о чём говорят коллеги", "https://t.me/kollegi", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (208 446 subscribers).", "Маркетинг"),
  g("tgstat-marketing-kreator", "Креáтор", "https://t.me/kreator", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (508 613 subscribers).", "Маркетинг"),
  g("tgstat-marketing-kreolenta", "Креативная Лента", "https://t.me/kreolenta", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (64 061 subscribers).", "Маркетинг"),
  g("tgstat-marketing-latrends", "Ля Тренд!", "https://t.me/latrends", ["blogs", "marketing", "leadgen", "smm"], "Канал из TGStat «Маркетинг» (396 556 subscribers).", "Маркетинг"),
];

/** Рынки: где искать клиентов (группы ниш для UI). niches=[] = показать весь каталог. */
export const MARKET_SECTIONS: {id: string; title: string; hint: string; niches: GroupNiche[]}[] = [
  {id: "db", title: "В базе", hint: "Группы вашего кабинета — сбор лидов", niches: []},
  {id: "all", title: "Все чаты", hint: "Полная база каталога со ссылками", niches: []},
  {id: "blogs", title: "Блоги TGStat", hint: "Каналы из категории «Блоги» и бизнес-медиа", niches: ["blogs", "business", "marketing", "content", "startup"]},
  {id: "mp", title: "Маркетплейсы", hint: "Селлеры WB/Ozon/ЯМ ищут сервисы", niches: ["marketplaces", "wildberries", "ozon", "yandex_market", "megamarket", "ecommerce", "analytics", "pricing", "inventory", "reviews", "fulfillment", "certificates"]},
  {id: "saas", title: "SaaS / CRM / B2B", hint: "Внедрение, подписки, продажи B2B", niches: ["saas", "crm", "b2b", "business", "bots", "1c", "fintech"]},
  {id: "services", title: "Услуги и фриланс", hint: "Подряд, агентства, заказчики", niches: ["freelance", "marketing", "smm", "design", "content", "leadgen", "bots"]},
  {id: "local", title: "Локальный бизнес", hint: "Городские услуги и Авито", niches: ["avito", "beauty", "food", "auto", "realestate", "healthcare", "education"]},
  {id: "trade", title: "Торговля и логистика", hint: "Импорт, дроп, склады", niches: ["china", "dropshipping", "logistics", "fulfillment", "aliexpress", "vk_market"]},
  {id: "growth", title: "Стартапы и рост", hint: "Пилоты, нетворкинг, PR", niches: ["startup", "networking", "marketing", "leadgen", "saas"]},
];

/** Число verified-ссылок в рынке (для UI). id=db считает вызывающая сторона. */
export function marketVerifiedCount(marketId: string): number {
  if (marketId === "db") return 0;
  const section = MARKET_SECTIONS.find((m) => m.id === marketId);
  if (!section) return 0;
  if (!section.niches.length) {
    return GROUP_CATALOG.filter((g) => g.verified && g.url).length;
  }
  const set = new Set(section.niches);
  return GROUP_CATALOG.filter(
    (g) => g.verified && g.url && g.niches.some((n) => set.has(n)),
  ).length;
}


const NICHE_ALIASES: Record<string, GroupNiche[]> = {
  маркетплейс: ["marketplaces"],
  маркетплейсы: ["marketplaces"],
  marketplace: ["marketplaces"],
  wildberries: ["wildberries", "marketplaces"],
  wb: ["wildberries", "marketplaces"],
  вайлдберриз: ["wildberries", "marketplaces"],
  вайлдберрис: ["wildberries", "marketplaces"],
  ozon: ["ozon", "marketplaces"],
  озон: ["ozon", "marketplaces"],
  "яндекс маркет": ["yandex_market", "marketplaces"],
  ям: ["yandex_market", "marketplaces"],
  мегамаркет: ["megamarket", "marketplaces"],
  megamarket: ["megamarket", "marketplaces"],
  авито: ["avito", "leadgen", "business"],
  avito: ["avito", "leadgen", "business"],
  "vk маркет": ["vk_market", "marketplaces"],
  вконтакте: ["vk_market", "smm", "marketing"],
  aliexpress: ["aliexpress", "china", "marketplaces"],
  алиэкспресс: ["aliexpress", "china", "marketplaces"],
  китай: ["china", "logistics", "dropshipping"],
  1688: ["china", "dropshipping"],
  дроп: ["dropshipping", "ecommerce", "china"],
  dropshipping: ["dropshipping", "ecommerce"],
  остатк: ["inventory", "marketplaces"],
  склад: ["inventory", "logistics", "fulfillment"],
  фулфилмент: ["fulfillment", "logistics", "inventory"],
  fulfillment: ["fulfillment", "logistics"],
  мойсклад: ["1c", "inventory", "saas"],
  "1с": ["1c"],
  "1c": ["1c"],
  логистик: ["logistics", "fulfillment"],
  отзыв: ["reviews"],
  цен: ["pricing"],
  репрайс: ["pricing", "analytics", "saas"],
  аналитик: ["analytics"],
  mpstats: ["analytics", "marketplaces", "saas"],
  moneyplace: ["analytics", "marketplaces", "saas"],
  интеграц: ["1c", "inventory", "marketplaces", "crm", "saas"],
  селлер: ["marketplaces", "ecommerce"],
  seller: ["marketplaces", "ecommerce"],
  автоматиз: ["marketplaces", "inventory", "pricing", "saas", "bots"],
  crm: ["crm", "saas", "b2b", "business"],
  амо: ["crm", "saas"],
  amocrm: ["crm", "saas"],
  битрикс: ["crm", "saas"],
  bitrix: ["crm", "saas"],
  retailcrm: ["crm", "ecommerce", "saas"],
  saas: ["saas", "startup", "business", "b2b"],
  сервис: ["saas", "business"],
  фриланс: ["freelance"],
  подряд: ["freelance", "business", "b2b"],
  агентств: ["marketing", "freelance", "business", "smm", "leadgen"],
  маркетинг: ["marketing", "leadgen"],
  реклам: ["marketing", "leadgen"],
  performance: ["marketing", "leadgen"],
  seo: ["marketing", "content"],
  smm: ["smm", "marketing", "content"],
  таргет: ["smm", "marketing", "leadgen"],
  стартап: ["startup", "saas", "networking"],
  b2b: ["b2b", "business", "crm", "saas"],
  продаж: ["b2b", "business", "crm", "leadgen"],
  лид: ["leadgen", "business", "crm", "saas", "b2b"],
  лидоген: ["leadgen", "marketing", "saas"],
  бот: ["bots", "saas", "marketing"],
  telegram: ["bots", "saas"],
  "чат-бот": ["bots", "saas"],
  финтех: ["fintech", "saas"],
  эквайринг: ["fintech", "ecommerce"],
  рассрочк: ["fintech", "ecommerce"],
  обучен: ["education", "marketing"],
  курс: ["education", "marketing"],
  edtech: ["education", "saas"],
  клиник: ["healthcare", "crm", "saas"],
  med: ["healthcare", "saas"],
  beauty: ["beauty", "business"],
  салон: ["beauty", "crm"],
  fashion: ["fashion", "marketplaces", "ecommerce"],
  одежд: ["fashion", "marketplaces"],
  ресторан: ["food", "business"],
  доставк: ["food", "logistics"],
  horeca: ["food", "business"],
  авто: ["auto", "crm", "business"],
  недвижимост: ["realestate", "crm", "leadgen"],
  риелтор: ["realestate", "leadgen"],
  ваканси: ["hr"],
  резюме: ["hr"],
  юрист: ["legal", "certificates"],
  сертификац: ["certificates", "legal", "marketplaces"],
  бухгалтер: ["accounting", "1c", "business"],
  дизайн: ["design", "freelance", "content"],
  инфографик: ["content", "design", "marketplaces"],
  контент: ["content", "marketing", "smm"],
  ugc: ["content", "marketing"],
  нетворкинг: ["networking", "business", "startup"],
  бренд: ["business", "ecommerce", "marketing", "fashion", "beauty"],
  dtc: ["ecommerce", "marketing", "business"],
  опт: ["b2b", "business", "china", "ecommerce"],
  helpdesk: ["saas", "crm", "bots"],
  омниканал: ["saas", "crm", "bots"],
  телефони: ["crm", "saas", "b2b"],
  колл: ["crm", "b2b", "business"],
  блог: ["blogs", "content", "business"],
  блоги: ["blogs", "content", "business", "marketing"],
  tgstat: ["blogs", "bots", "analytics", "marketing"],
  медиа: ["blogs", "content", "marketing"],
};

/** Id тем без verified-ссылки + старые фейки. */
export function catalogPlaceholderUsernames(): Set<string> {
  const set = new Set<string>([
    "mp_automation",
    "wb_sellers",
    "ozon_sellers",
    "ym_sellers",
    "mp_multi",
    "moysklad_mp",
    "1c_ecommerce",
    "fbo_logistics",
    "reviews_mp",
    "pricing_mp",
  ]);
  for (const item of GROUP_CATALOG) {
    if (!item.verified || !item.url) set.add(item.id.replace(/-/g, "_").toLowerCase());
  }
  return set;
}

export function extractTelegramUsername(url: string): string | null {
  const u = (url || "").trim();
  if (!u) return null;
  if (/(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)/i.test(u)) return null;
  if (u.startsWith("@")) return u.slice(1).toLowerCase();
  const m = u.match(/(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{5,32})\b/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Ссылка-заглушка каталога — в Telegram такой группы нет. */
export function isCatalogPlaceholderUrl(url: string): boolean {
  const name = extractTelegramUsername(url);
  if (!name) return false;
  const real = new Set(
    GROUP_CATALOG.filter((item) => item.verified && item.url)
      .map((item) => extractTelegramUsername(item.url))
      .filter(Boolean) as string[],
  );
  if (real.has(name)) return false;
  return catalogPlaceholderUsernames().has(name);
}

export function nichesFromProjectText(...parts: (string | undefined)[]): GroupNiche[] {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const found = new Set<GroupNiche>();
  for (const [alias, niches] of Object.entries(NICHE_ALIASES)) {
    if (text.includes(alias)) niches.forEach((n) => found.add(n));
  }
  if (!found.size && /продаж|товар|кабинет|fbo|fbs|услуг|клиент|заявк/.test(text)) {
    found.add("business");
    found.add("saas");
    found.add("leadgen");
    found.add("b2b");
  }
  return [...found];
}

export type CatalogHit = CatalogGroup & {
  score: number;
  /** Совпадает с нишами продукта / выбранными фильтрами */
  matched: boolean;
  overlap: number;
};

export function searchGroupCatalog(opts: {
  query?: string;
  niches?: GroupNiche[];
  projectText?: string;
  /** Подмешивать ниши из projectText (по умолчанию true, если niches пустые). */
  mergeProject?: boolean;
  /** Если true — в выдаче только matched (при наличии ниш). */
  onlyMatched?: boolean;
}): CatalogHit[] {
  const q = (opts.query || "").trim().toLowerCase();
  const fromProject = nichesFromProjectText(opts.projectText);
  const mergeProject = opts.mergeProject ?? !(opts.niches && opts.niches.length);
  const niches = new Set([
    ...(opts.niches || []),
    ...(mergeProject ? fromProject : []),
  ]);
  const preferNiches = niches.size > 0;

  let hits = GROUP_CATALOG.map((item) => {
    const overlap = preferNiches ? item.niches.filter((n) => niches.has(n)).length : 0;
    let score = 0;
    if (preferNiches) {
      if (!overlap) score -= 8;
      else score += overlap * 5;
    }
    if (q) {
      const hay = `${item.name} ${item.description} ${item.audience} ${item.searchHint} ${item.niches.join(" ")} ${item.niches.map((n) => GROUP_NICHE_LABELS[n]).join(" ")}`.toLowerCase();
      if (hay.includes(q)) score += 6;
      else if (q.split(/\s+/).some((w) => w.length > 2 && hay.includes(w))) score += 3;
      else score -= 3;
    }
    if (item.verified && item.url) score += 2;
    if (niches.has("marketplaces") && item.niches.includes("marketplaces")) score += 1;
    const matched = preferNiches ? overlap > 0 : !q || score > 0;
    return { ...item, score, matched, overlap };
  });

  if (opts.onlyMatched && preferNiches) {
    hits = hits.filter((h) => h.matched);
  }

  return hits
    .filter((h) => (opts.onlyMatched ? h.matched : h.score >= -10))
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      return b.score - a.score || a.name.localeCompare(b.name, "ru");
    });
}

export function catalogStats() {
  const verified = GROUP_CATALOG.filter((item) => item.verified && item.url).length;
  const topics = GROUP_CATALOG.length - verified;
  const urls = new Set(
    GROUP_CATALOG.filter((item) => item.url).map((item) => extractTelegramUsername(item.url) || item.url),
  );
  return {
    total: GROUP_CATALOG.length,
    verified,
    topics,
    uniqueUrls: urls.size,
    niches: Object.keys(GROUP_NICHE_LABELS).length,
  };
}
