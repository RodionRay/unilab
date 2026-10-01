/**
 * Fixture data for the mini app e2e, typed against lib/tma/contract.ts. Times are relative to NOW
 * (the clock is pinned in the tests), Moscow time.
 */
import type { AccountsFeed, LeadFeed, OverviewFeed, SessionResponse, TasksFeed } from "../../lib/tma/contract";
import type { InboxPage, InboxRow } from "../../lib/tma/client";

export const WS_KEY = "sever_ws_Q7mN2pX4kL9a";
export const NOW = new Date("2026-10-01T14:20:00+03:00");
export const INIT_DATA =
  "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22%D0%A0%D0%BE%D0%B4%D0%B8%D0%BE%D0%BD%22%2C%22language_code%22%3A%22ru%22%7D&auth_date=1790853600&hash=4c3b2a19f0d8e7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2";
export const TOKEN = "tma.eyJzdWIiOiJ1LTEiLCJzY29wZSI6InRtYSJ9.sig";
export const BOT_LINK = "https://t.me/sever_leads_bot?start=link";

function at(dayOffset: number, hhmm: string): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - dayOffset);
  const [h, m] = hhmm.split(":").map(Number);
  // NOW is 14:20 MSK = 11:20 UTC; the clock string is MSK.
  d.setUTCHours((h ?? 0) - 3, m ?? 0, 0, 0);
  return d.toISOString();
}

export const session: SessionResponse = {
  token: TOKEN,
  expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  me: { name: "Родион", role: "owner", access: ["overview", "leads", "chats", "accounts", "mailing", "audience", "invite", "groups"] },
  workspace: { name: "Студия Север" },
};

export const LEAD_ANNA = "6f1c2a4e-8b3d-4c5e-9a7f-1b2c3d4e5f60";
export const LEAD_MARIA = "7a2d3b5f-9c4e-4d6f-8b1a-2c3d4e5f6071";
export const LEAD_OLEG = "8b3e4c6a-1d5f-4e7a-9c2b-3d4e5f607182";

const page1: InboxRow[] = [
  {
    id: LEAD_ANNA,
    name: "Анна Петрова",
    username: "anna_petrova_spb",
    temperature: "hot",
    preview: "Ищем подрядчика на таргет ВК и Telegram Ads, бюджет 200 тыс. в месяц, старт в октябре. Кто возьмётся — пишите в личку",
    at: at(0, "14:02"),
    unread: true,
    needsManager: false,
    conversation: false,
    source: "Маркетологи СПб",
    reason: "ищет подрядчика, бюджет 200 тыс., старт в октябре",
  },
  {
    id: "9c4f5d7b-2e6a-4f8b-8d3c-4e5f60718293",
    name: "Игорь Соколов",
    username: "sokolov_build",
    temperature: "hot",
    preview: "Нужен лендинг для строительной компании, сроки сжатые — до 15 октября. Посоветуйте студию с кейсами",
    at: at(0, "13:41"),
    unread: true,
    needsManager: false,
    conversation: false,
    source: "Веб-разработка | заказы",
    reason: "ищет студию, срок до 15 октября",
  },
  {
    id: LEAD_MARIA,
    name: "Мария Лебедева",
    username: "masha_lebedeva",
    temperature: "warm",
    preview: "А можно посмотреть кейсы по e-commerce? И сколько стоит ведение в месяц?",
    at: at(0, "12:58"),
    unread: true,
    needsManager: true,
    conversation: true,
    source: "Маркетологи СПб",
    reason: "",
  },
  {
    id: LEAD_OLEG,
    name: "Олег Кравец",
    username: "oleg_kravets",
    temperature: "hot",
    preview: "Ищу таргетолога в команду на проект, оплата сдельная, нужен опыт с Telegram Ads от года",
    at: at(0, "11:20"),
    unread: false,
    needsManager: false,
    conversation: false,
    source: "Таргет и трафик",
    reason: "ищет таргетолога, Telegram Ads",
  },
  {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Дмитрий Орлов",
    username: "d_orlov",
    temperature: "warm",
    preview: "Спасибо, посмотрю презентацию и вернусь к вам на следующей неделе",
    at: at(1, "18:34"),
    unread: false,
    needsManager: false,
    conversation: true,
    source: "SMM-чат Москва",
    reason: "",
  },
  {
    id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    name: "Екатерина Волкова",
    username: "katya_volkova",
    temperature: "warm",
    preview: "Кто делал рекламу для онлайн-школ? Интересует реальная стоимость заявки, а не обещания",
    at: at(1, "10:15"),
    unread: true,
    needsManager: false,
    conversation: false,
    source: "Инфобизнес изнутри",
    reason: "",
  },
  {
    id: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    name: "Наталья Смирнова",
    username: "nat_smirnova",
    temperature: "warm",
    preview: "Да, давайте созвонимся в четверг в 11:00, ссылку пришлю сама",
    at: at(2, "16:47"),
    unread: false,
    needsManager: false,
    conversation: true,
    source: "Маркетологи СПб",
    reason: "",
  },
  {
    id: "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80",
    name: "Алексей Николаев",
    username: "alex_nikolaev",
    temperature: "cold",
    preview: "Подскажите сервис для автопостинга сразу в несколько каналов",
    at: at(3, "09:05"),
    unread: false,
    needsManager: false,
    conversation: false,
    source: "SMM-чат Москва",
    reason: "",
  },
  {
    id: "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091",
    name: "Сергей Белов",
    username: "belov_sergey",
    temperature: "warm",
    preview: "Есть кто-то, кто настраивает Яндекс Директ под B2B? Ниша — промышленное оборудование",
    at: at(5, "12:30"),
    unread: false,
    needsManager: false,
    conversation: false,
    source: "Таргет и трафик",
    reason: "",
  },
  {
    id: "f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2",
    name: "Ирина Козлова",
    username: "irina_kozlova",
    temperature: "cold",
    preview: "Ищем SMM-менеджера на полный день, офис в Казани",
    at: at(6, "15:10"),
    unread: false,
    needsManager: false,
    conversation: false,
    source: "Работа в маркетинге",
    reason: "",
  },
];

const page2: InboxRow[] = [
  {
    id: "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
    name: "Владимир Гусев",
    username: "v_gusev",
    temperature: "warm",
    preview: "Ищу подрядчика на контекстную рекламу для автосервиса в Екатеринбурге",
    at: at(8, "11:00"),
    unread: false,
    needsManager: false,
    conversation: false,
    source: "Реклама Урал",
    reason: "",
  },
  {
    id: "1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e",
    name: "Полина Зайцева",
    username: "polina_z",
    temperature: "cold",
    preview: "Кто-нибудь пробовал посевы в Telegram для косметики? Делитесь опытом",
    at: at(9, "19:22"),
    unread: false,
    needsManager: false,
    conversation: false,
    source: "Бьюти-маркетинг",
    reason: "",
  },
];

export const inboxAll: InboxPage = { view: "inbox", items: page1, nextCursor: "c2", counts: { hot: 3, unread: 4 } };
export const inboxAllPage2: InboxPage = { view: "inbox", items: page2, nextCursor: null, counts: { hot: 3, unread: 4 } };
export const inboxHot: InboxPage = {
  view: "inbox",
  items: page1.filter((i) => i.temperature === "hot" && !i.conversation),
  nextCursor: null,
  counts: { hot: 3, unread: 4 },
};
export const inboxEmpty: InboxPage = { view: "inbox", items: [], nextCursor: null, counts: { hot: 0, unread: 0 } };

export function inboxFor(filter: string, cursor: string | null): InboxPage {
  if (cursor === "c2") return inboxAllPage2;
  if (filter === "hot") return inboxHot;
  if (filter === "unread") return { ...inboxAll, items: page1.filter((i) => i.unread), nextCursor: null };
  if (filter === "conversations") return { ...inboxAll, items: page1.filter((i) => i.conversation), nextCursor: null };
  return inboxAll;
}

export const ANNA_DRAFT =
  "Анна, добрый день! Увидел ваш запрос в «Маркетологи СПб». Ведём таргет ВК и Telegram Ads для онлайн-проектов с бюджетами от 150 тыс. — покажу два похожих кейса и прикину стоимость заявки. Удобно, если пришлю короткий план?";

export const leads: Record<string, LeadFeed> = {
  [LEAD_ANNA]: {
    view: "lead",
    lead: {
      id: LEAD_ANNA,
      name: "Анна Петрова",
      username: "anna_petrova_spb",
      temperature: "hot",
      source: "Маркетологи СПб",
      message: page1[0]!.preview,
      reason: "ищет подрядчика, называет бюджет 200 тыс. в месяц и срок старта — октябрь",
      draft: ANNA_DRAFT,
      messages: [],
      canReply: true,
    },
  },
  [LEAD_MARIA]: {
    view: "lead",
    lead: {
      id: LEAD_MARIA,
      name: "Мария Лебедева",
      username: "masha_lebedeva",
      temperature: "warm",
      source: "Маркетологи СПб",
      message: "Посоветуйте, кто ведёт рекламу интернет-магазинов одежды? Бюджет пока небольшой, хотим протестировать",
      reason: "ищет подрядчика на рекламу интернет-магазина",
      draft: "",
      messages: [
        {
          from: "us",
          text: "Мария, добрый день! Видел ваш вопрос в «Маркетологи СПб». Ведём рекламу трёх магазинов одежды, тест обычно стартует от 60 тыс. — рассказать подробнее?",
          at: at(1, "17:05"),
          status: "sent",
        },
        { from: "client", text: "Да, интересно. Какие площадки берёте?", at: at(1, "17:40"), status: "sent" },
        {
          from: "us",
          text: "ВК, Telegram Ads и посевы в профильных каналах. Могу прислать разбор одного запуска с цифрами.",
          at: at(1, "17:52"),
          status: "failed",
          error: "Аккаунт на отлежке — отправка недоступна",
        },
        {
          from: "us",
          text: "ВК, Telegram Ads и посевы в профильных каналах. Могу прислать разбор одного запуска с цифрами.",
          at: at(1, "18:10"),
          status: "sent",
        },
        { from: "client", text: "А можно посмотреть кейсы по e-commerce? И сколько стоит ведение в месяц?", at: at(0, "12:58"), status: "sent" },
      ],
      canReply: true,
    },
  },
  [LEAD_OLEG]: {
    view: "lead",
    lead: {
      id: LEAD_OLEG,
      name: "Олег Кравец",
      username: "oleg_kravets",
      temperature: "hot",
      source: "Таргет и трафик",
      message: page1[3]!.preview,
      reason: "ищет таргетолога с опытом в Telegram Ads",
      draft: "Олег, здравствуйте! Есть опыт с Telegram Ads с 2023 года, могу показать кабинеты.",
      messages: [],
      canReply: false,
      replyBlockedReason: "Дневной лимит сообщений на всех рабочих аккаунтах исчерпан — ответ после полуночи (МСК)",
    },
  },
};

export const accounts: AccountsFeed = {
  view: "accounts",
  items: [
    {
      id: "11111111-aaaa-4bbb-8ccc-000000000001",
      name: "Алина | Студия Север",
      phone: "+7 *** ** 12",
      username: "alina_sever",
      health: "ok",
      statusLabel: "Работает",
      caps: [
        { label: "Сообщения сегодня", used: 18, limit: 40 },
        { label: "Вступления в группы", used: 3, limit: 5 },
      ],
      reason: "",
      lastCheckedAt: at(0, "13:55"),
      checking: false,
    },
    {
      id: "11111111-aaaa-4bbb-8ccc-000000000002",
      name: "Ольга | маркетинг",
      phone: "+7 *** ** 83",
      username: "olga_mkt",
      health: "error",
      statusLabel: "Спамблок",
      caps: [{ label: "Сообщения сегодня", used: 0, limit: 40 }],
      reason: "Telegram ограничил сообщения незнакомым до 3 октября, 18:00 (ответ @SpamBot)",
      lastCheckedAt: at(0, "12:10"),
      checking: false,
    },
    {
      id: "11111111-aaaa-4bbb-8ccc-000000000003",
      name: "Никита Север",
      phone: "+7 *** ** 05",
      username: "nikita_sever",
      health: "paused",
      statusLabel: "Флуд-ожидание",
      caps: [{ label: "Вступления в группы", used: 5, limit: 5 }],
      reason: "Пауза 14 минут после серии вступлений — Telegram попросил подождать",
      lastCheckedAt: at(0, "14:05"),
      checking: false,
    },
    {
      id: "11111111-aaaa-4bbb-8ccc-000000000004",
      name: "Вера Север",
      phone: "+7 *** ** 61",
      username: "",
      health: "setup",
      statusLabel: "Нужна настройка",
      caps: [],
      reason: "Нет прокси — добавьте прокси в UniLab на компьютере",
      lastCheckedAt: "",
      checking: false,
    },
    {
      id: "11111111-aaaa-4bbb-8ccc-000000000005",
      name: "Максим | продажи",
      phone: "+7 *** ** 47",
      username: "max_sever_sales",
      health: "warming",
      statusLabel: "Прогрев, день 4 из 14",
      caps: [{ label: "Сообщения сегодня", used: 4, limit: 10 }],
      reason: "",
      lastCheckedAt: at(1, "20:30"),
      checking: false,
    },
    {
      id: "11111111-aaaa-4bbb-8ccc-000000000006",
      name: "Павел | Студия Север",
      phone: "+7 *** ** 90",
      username: "pavel_sever",
      health: "ok",
      statusLabel: "Работает",
      caps: [
        { label: "Сообщения сегодня", used: 32, limit: 40 },
        { label: "Вступления в группы", used: 1, limit: 5 },
      ],
      reason: "",
      lastCheckedAt: at(0, "13:58"),
      checking: false,
    },
  ],
};

export const TASK_MAILING = "22222222-bbbb-4ccc-8ddd-000000000001";
export const tasks: TasksFeed = {
  view: "tasks",
  items: [
    {
      id: TASK_MAILING,
      kind: "mailing",
      name: "Осенняя рассылка — онлайн-школы",
      status: "running",
      progress: { done: 120, total: 400 },
      error: "",
      updatedAt: at(0, "14:12"),
      actions: ["pause_mailing"],
    },
    {
      id: "22222222-bbbb-4ccc-8ddd-000000000002",
      kind: "audience",
      name: "Сбор: участники «Маркетологи СПб»",
      status: "running",
      progress: { done: 1840, total: 3000 },
      error: "",
      updatedAt: at(0, "14:15"),
      actions: ["pause_audience"],
    },
    {
      id: "22222222-bbbb-4ccc-8ddd-000000000003",
      kind: "auto_rescan",
      name: "Автообход 38 групп",
      status: "running",
      progress: { done: 12, total: 38 },
      error: "",
      updatedAt: at(0, "14:00"),
      actions: [],
    },
    {
      id: "22222222-bbbb-4ccc-8ddd-000000000004",
      kind: "invite",
      name: "Инвайт в канал «Кейсы Севера»",
      status: "paused",
      progress: { done: 64, total: 200 },
      error: "",
      updatedAt: at(1, "19:40"),
      actions: ["start_invite"],
    },
    {
      id: "22222222-bbbb-4ccc-8ddd-000000000005",
      kind: "mailing",
      name: "Повторное касание — сентябрь",
      status: "error",
      progress: { done: 52, total: 180 },
      error: "Все аккаунты рассылки исчерпали дневной лимит — продолжим после полуночи (МСК)",
      updatedAt: at(0, "11:47"),
      actions: ["start_mailing"],
    },
    {
      id: "22222222-bbbb-4ccc-8ddd-000000000006",
      kind: "invite",
      name: "Инвайт на вебинар 24 сентября",
      status: "completed",
      progress: { done: 200, total: 200 },
      error: "",
      updatedAt: at(7, "21:00"),
      actions: [],
    },
  ],
};

export const overview: OverviewFeed = {
  view: "overview",
  today: { newLeads: 24, hotLeads: 6, replies: 9, sent: 132, invites: 18 },
  accounts: { total: 6, ok: 2, problems: 3 },
  tasks: { running: 3, paused: 1, error: 1 },
};

export const THEMES = {
  light: {
    bg_color: "#ffffff",
    text_color: "#000000",
    hint_color: "#8e8e93",
    link_color: "#007aff",
    button_color: "#007aff",
    button_text_color: "#ffffff",
    secondary_bg_color: "#efeff4",
    header_bg_color: "#f8f8f8",
    bottom_bar_bg_color: "#f2f2f7",
    accent_text_color: "#007aff",
    section_bg_color: "#ffffff",
    section_header_text_color: "#6d6d72",
    section_separator_color: "#c8c7cc",
    subtitle_text_color: "#8e8e93",
    destructive_text_color: "#ff3b30",
  },
  dark: {
    bg_color: "#000000",
    text_color: "#ffffff",
    hint_color: "#98989e",
    link_color: "#3e88f7",
    button_color: "#3e88f7",
    button_text_color: "#ffffff",
    secondary_bg_color: "#1c1c1d",
    header_bg_color: "#1a1a1a",
    bottom_bar_bg_color: "#1d1d1d",
    accent_text_color: "#3e88f7",
    section_bg_color: "#2c2c2e",
    section_header_text_color: "#8d8e93",
    section_separator_color: "#3d3d40",
    subtitle_text_color: "#98989e",
    destructive_text_color: "#eb5545",
  },
} as const;
