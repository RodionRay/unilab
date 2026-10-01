// Data-driven capture plan for the «Найти чаты с клиентами» dialog. Edit THIS file when the redesign
// renames controls; capture.mjs only interprets the steps.
//
// Step vocabulary (all selectors are by visible text / ARIA role, scoped to the dialog unless `page: true`):
//   { goto: "/path" }                                     navigate (relative to --url)
//   { click: { role, name, nth?, page? } }                click a role element; `name` string (substring) or RegExp
//   { clickText: "text" | RegExp, nth? }                   click by visible text
//   { fill: { placeholder, value } }                       fill an input found by placeholder (string or RegExp)
//   { check: { role: "checkbox", count, skip: [RegExp] } } check the first `count` unchecked checkboxes not matching `skip`
//   { scrollTo: "text" | RegExp }                          scroll the element with this text into view
//   { waitText: "text" | RegExp, timeout? }                wait until visible inside the dialog
//   { waitGone: "text" | RegExp, timeout? }                wait until no longer visible inside the dialog
//   { wait: ms }
//   any step + { maxWidth: n } / { minWidth: n }            run only when the viewport width is ≤ n / ≥ n
//   { stallTimers: { delay, ms } }                         make later setTimeout(fn, delay) calls wait `ms` instead
//                                                          (freezes the search debounce so `loading` is catchable)
// A state with `settle: false` is shot right after its last step (no idle wait) — used for `loading`.

/** How to reach a page with the dialog trigger, and the trigger itself. */
export const OPEN = [
  { goto: "/app?view=groups" },
  { click: { role: "button", name: "Поиск по темам", page: true } },
  { waitText: "Найти чаты с клиентами" },
];

/** Locates the dialog root. */
export const DIALOG = { role: "dialog", name: /Найти чаты с клиентами/ };

/** Text shown while results are being computed (used to wait for idle before a settled shot). */
export const BUSY_TEXT = /Ищем чаты…/;

// Redesign (2026-09-30): mode tabs «Каталог» / «Мои группы», market rail (desktop) or «Рынок: …» filter panel (<768),
// niche chips, list tabs «Можно вступить» / «Нужна ссылка», row checkboxes → bulk bar → AlertDialog confirm.
const MODE_CATALOG = { click: { role: "tab", name: /^Каталог/ } };
const MODE_DB = { click: { role: "tab", name: /^Мои группы/ } };
const FILTERS_TOGGLE = { click: { role: "button", name: /^Рынок:/ }, maxWidth: 767 };
const MARKET_MP = { click: { role: "button", name: /^Маркетплейсы/ } };
const TAB_TOPICS = { click: { role: "tab", name: /^Нужна ссылка/ } };
const SKIP_BOXES = [/Выбрать все/, /Скрыть добавленные/, /уже вступили/];
const SEARCH = /Название, @ссылка или тема/;
export const LONG_NAME_TEXT = /очень длинным названием/;
/** Market «Маркетплейсы» picked; on mobile the filter panel is opened, used, and closed again. */
const LOADED = { waitGone: /Ищем чаты…/ };
const IN_MP = [MODE_CATALOG, FILTERS_TOGGLE, MARKET_MP, LOADED, FILTERS_TOGGLE];
const BULK3 = [...IN_MP, { check: { role: "checkbox", count: 3, skip: SKIP_BOXES } }];

export const STATES = {
  all: { steps: [MODE_CATALOG] },
  db: { steps: [MODE_DB] },
  "market-mp": { steps: IN_MP },
  // Niche: chips at <768 (filter panel) and in a wide main column; «Ниша: …» select when the column is narrow (768–1023).
  niche: {
    steps: [
      MODE_CATALOG, FILTERS_TOGGLE, MARKET_MP, LOADED,
      { click: { role: "button", name: /^Wildberries$/ }, maxWidth: 767 },
      { click: { role: "button", name: /^Wildberries$/ }, minWidth: 1024 },
      { click: { role: "combobox", name: /Ниша/ }, minWidth: 768, maxWidth: 1023 },
      { click: { role: "option", name: /^Wildberries$/, page: true }, minWidth: 768, maxWidth: 1023 },
      FILTERS_TOGGLE,
    ],
  },
  topics: { steps: [...IN_MP, TAB_TOPICS, { check: { role: "checkbox", count: 2, skip: SKIP_BOXES } }] },
  "search-empty": { steps: [MODE_CATALOG, { fill: { placeholder: SEARCH, value: "zzzzqqq" } }, { wait: 400 }] },
  // Switching market clears the list → skeleton rows until the (stalled) search debounce fires.
  loading: {
    settle: false,
    steps: [
      MODE_CATALOG,
      FILTERS_TOGGLE,
      { wait: 400 },
      // Search debounce is 220 ms (app/app/page.tsx catalog search effect); adjust if it changes.
      { stallTimers: { delay: 220, ms: 15_000 } },
      MARKET_MP,
      FILTERS_TOGGLE,
      { wait: 150 },
    ],
  },
  "long-name": { steps: [MODE_DB, { scrollTo: LONG_NAME_TEXT }] },
  "bulk-selected": { steps: BULK3 },
  confirm: { steps: [...BULK3, { click: { role: "button", name: /^Вступить в 3 чата/ } }, { wait: 400 }] },
  "mobile-filters": { steps: [MODE_CATALOG, FILTERS_TOGGLE, MARKET_MP] },
  // «Скрыть добавленные» ON in Маркетплейсы (desktop: toolbar; <768: inside the filter panel).
  "hide-added": {
    steps: [MODE_CATALOG, FILTERS_TOGGLE, MARKET_MP, LOADED,
      { click: { role: "checkbox", name: /Скрыть добавленные/ } }, { wait: 300 }, FILTERS_TOGGLE],
  },
  // A catalog row the workspace already joined (seeded @mp_seller): «вступили» + «Скан лидов», not selectable.
  "joined-row": { steps: [...IN_MP, { scrollTo: /Чат селлеры WB/ }] },
  // Environment variants — capture them only with the stand in that state (see tools/stand.sh, seed.mjs):
  //   disconnected: `stand.sh worker-stop` first (telegramConnected=false); no-account: `seed.mjs --no-workable` first.
  disconnected: { steps: BULK3 },
  "disconnected-db": { steps: [MODE_DB] },
  // db-empty: `seed.mjs --no-groups` first (dialog opens in Каталог when there are no groups).
  "db-empty": { steps: [MODE_DB] },
  "no-account": { steps: IN_MP },
};

/** States that need a prepared stand; always capture them with an explicit --states list. */
export const ENV_STATES = ["disconnected", "disconnected-db", "no-account", "db-empty"];

/** viewport widths → heights */
export const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

/**
 * Themes. The app is dark-only today (app/globals.css `:root { color-scheme: dark }`, no light tokens/toggle),
 * so `light` only emulates prefers-color-scheme: light; it becomes meaningful once a light theme exists.
 * `init` runs before page scripts (e.g. set a localStorage theme key if one is introduced).
 */
export const THEMES = {
  dark: { colorScheme: "dark", widths: [390, 768, 1440], suffix: "" },
  light: { colorScheme: "light", widths: [1440], suffix: "-light" },
};
