/**
 * Test harness: a fake `window.Telegram.WebApp` (the real SDK request is blocked) with spies, and a mocked
 * backend for /api/tma/** and /api/workspace built from the contract fixtures.
 */
import type { Page, Request, Route } from "@playwright/test";
import * as fx from "./data";

export type Scheme = "light" | "dark";

export type TelegramOptions = {
  initData?: string;
  scheme?: Scheme;
  version?: string;
  startParam?: string;
  confirmAnswer?: boolean;
};

/** Shape of the spy object the fake SDK exposes as `window.__tg`. */
export type TgSpy = {
  calls: string[];
  main: { text: string; visible: boolean; active: boolean; progress: boolean; color: string };
  back: { visible: boolean };
  confirms: string[];
  links: string[];
  closed: boolean;
};

export async function installTelegram(page: Page, opts: TelegramOptions = {}): Promise<void> {
  await page.route("https://telegram.org/js/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(
    ({ initData, scheme, version, startParam, confirmAnswer, themes }) => {
      const calls: string[] = [];
      const main = { text: "", visible: false, active: true, progress: false, color: "" };
      const back = { visible: false };
      const handlers: Record<string, Array<() => void>> = { main: [], back: [], themeChanged: [], viewportChanged: [] };
      const spy = { calls, main, back, confirms: [] as string[], links: [] as string[], closed: false };
      const MAIN_H = 58;
      let colorScheme = scheme as "light" | "dark";
      let themeParams: Record<string, string> = { ...themes[colorScheme] };

      // The real SDK keeps these CSS variables on <html>; emulate them (MainButton shrinks the stable viewport).
      const applyViewport = () => {
        const h = window.innerHeight - (main.visible ? MAIN_H : 0);
        const s = document.documentElement.style;
        s.setProperty("--tg-viewport-height", `${h}px`);
        s.setProperty("--tg-viewport-stable-height", `${h}px`);
        s.setProperty("--tg-safe-area-inset-bottom", "0px");
        const bar = document.getElementById("tg-main-button");
        const btn = document.getElementById("tg-main-button-inner");
        if (bar && btn) {
          bar.style.display = main.visible ? "block" : "none";
          bar.style.background = themeParams.bottom_bar_bg_color || themeParams.secondary_bg_color || "#f2f2f7";
          btn.textContent = main.progress ? "Отправляем…" : main.text;
          btn.style.background = main.color || themeParams.button_color || "#2481cc";
          btn.style.opacity = main.active ? "1" : "0.45";
        }
        handlers.viewportChanged.forEach((cb) => cb());
      };
      const ensureBar = () => {
        if (document.getElementById("tg-main-button") || !document.body) return;
        // Stand-in for Telegram's native bottom bar (outside the page in real Telegram), so screenshots show it.
        const wrap = document.createElement("div");
        wrap.id = "tg-main-button";
        wrap.setAttribute("aria-hidden", "true");
        wrap.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${MAIN_H}px;display:none;padding:6px 10px;box-sizing:border-box;z-index:2147483647;`;
        const btn = document.createElement("div");
        btn.id = "tg-main-button-inner";
        btn.style.cssText = "height:100%;border-radius:12px;display:flex;align-items:center;justify-content:center;font:600 17px -apple-system,system-ui,sans-serif;color:#1a1208;";
        wrap.appendChild(btn);
        wrap.addEventListener("click", () => {
          if (main.active) handlers.main.slice().forEach((cb) => cb());
        });
        document.body.appendChild(wrap);
        applyViewport();
      };
      document.addEventListener("DOMContentLoaded", ensureBar);

      const MainButton = {
        setParams(p: { text?: string; color?: string; is_active?: boolean; is_visible?: boolean }) {
          calls.push(`main.setParams:${JSON.stringify(p)}`);
          if (p.text !== undefined) main.text = p.text;
          if (p.color !== undefined) main.color = p.color;
          if (p.is_active !== undefined) main.active = p.is_active;
          if (p.is_visible !== undefined) main.visible = p.is_visible;
          applyViewport();
          return MainButton;
        },
        show() {
          calls.push("main.show");
          main.visible = true;
          ensureBar();
          applyViewport();
          return MainButton;
        },
        hide() {
          calls.push("main.hide");
          main.visible = false;
          applyViewport();
          return MainButton;
        },
        showProgress() {
          calls.push("main.showProgress");
          main.progress = true;
          applyViewport();
          return MainButton;
        },
        hideProgress() {
          main.progress = false;
          applyViewport();
          return MainButton;
        },
        onClick(cb: () => void) {
          handlers.main.push(cb);
          return MainButton;
        },
        offClick(cb: () => void) {
          handlers.main = handlers.main.filter((h) => h !== cb);
          return MainButton;
        },
      };
      const BackButton = {
        show() {
          calls.push("back.show");
          back.visible = true;
          return BackButton;
        },
        hide() {
          back.visible = false;
          return BackButton;
        },
        onClick(cb: () => void) {
          handlers.back.push(cb);
          return BackButton;
        },
        offClick(cb: () => void) {
          handlers.back = handlers.back.filter((h) => h !== cb);
          return BackButton;
        },
      };
      const cmp = (a: string, b: string) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const d = (pa[i] ?? 0) - (pb[i] ?? 0);
          if (d) return d;
        }
        return 0;
      };
      const WebApp = {
        initData,
        initDataUnsafe: { start_param: startParam || undefined, user: { first_name: "Родион" } },
        version,
        platform: "ios",
        get colorScheme() {
          return colorScheme;
        },
        get themeParams() {
          return themeParams;
        },
        isVersionAtLeast: (v: string) => cmp(version, v) >= 0,
        ready: () => calls.push("ready"),
        expand: () => calls.push("expand"),
        close: () => {
          calls.push("close");
          spy.closed = true;
        },
        disableVerticalSwipes: () => calls.push("disableVerticalSwipes"),
        setHeaderColor: (c: string) => calls.push(`setHeaderColor:${c}`),
        showConfirm: (message: string, cb: (ok: boolean) => void) => {
          spy.confirms.push(message);
          setTimeout(() => cb(confirmAnswer), 30);
        },
        openTelegramLink: (url: string) => spy.links.push(url),
        onEvent: (ev: string, cb: () => void) => (handlers[ev] ??= []).push(cb),
        offEvent: (ev: string, cb: () => void) => {
          handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== cb);
        },
        HapticFeedback: { notificationOccurred: (k: string) => calls.push(`haptic:${k}`) },
        MainButton,
        BackButton,
      };
      Object.assign(window, {
        Telegram: { WebApp },
        __tg: spy,
        __tgMainTap: () => {
          if (main.active) handlers.main.slice().forEach((cb) => cb());
        },
        __tgBackTap: () => handlers.back.slice().forEach((cb) => cb()),
        __tgSetScheme: (next: "light" | "dark") => {
          colorScheme = next;
          themeParams = { ...themes[next] };
          handlers.themeChanged.forEach((cb) => cb());
        },
      });
      window.addEventListener("resize", applyViewport);
      applyViewport();
    },
    {
      initData: opts.initData ?? fx.INIT_DATA,
      scheme: opts.scheme ?? "light",
      version: opts.version ?? "8.0",
      startParam: opts.startParam ?? "",
      confirmAnswer: opts.confirmAnswer ?? true,
      themes: fx.THEMES,
    },
  );
}

export async function tgSpy(page: Page): Promise<TgSpy> {
  return page.evaluate(() => (window as unknown as { __tg: TgSpy }).__tg);
}

export async function tapMainButton(page: Page, times = 1): Promise<void> {
  await page.evaluate((n) => {
    const tap = (window as unknown as { __tgMainTap(): void }).__tgMainTap;
    for (let i = 0; i < n; i++) tap();
  }, times);
}

export async function tapBackButton(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __tgBackTap(): void }).__tgBackTap());
}

export type ApiCall = { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null; auth: string };

export type ApiOptions = {
  /** Override the session answer (status + body). */
  session?: { status: number; body: unknown };
  /** Per-view override: return [status, body] or undefined to use fixtures. */
  feed?: (view: string, query: Record<string, string>) => { status: number; body: unknown } | undefined;
  /** Per-action override for POST /api/workspace. */
  action?: (action: string, body: Record<string, unknown>, nth: number) => { status: number; body: unknown } | undefined;
  /** Delay every response (ms) — used for loading screenshots and double-tap tests. */
  delayMs?: number;
};

function callOf(req: Request): ApiCall {
  const url = new URL(req.url());
  let body: Record<string, unknown> | null = null;
  try {
    body = req.postDataJSON() as Record<string, unknown>;
  } catch {
    body = null;
  }
  return {
    method: req.method(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    auth: req.headers()["authorization"] ?? "",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mocks the backend; returns the live list of API calls for assertions. */
export async function mockApi(page: Page, opts: ApiOptions = {}): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  const actionCount: Record<string, number> = {};
  const json = async (route: Route, status: number, body: unknown) => {
    if (opts.delayMs) await sleep(opts.delayMs);
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  };

  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const call = callOf(route.request());
      calls.push(call);
      if (call.path === "/api/tma/session") {
        const s = opts.session ?? { status: 200, body: fx.session };
        return json(route, s.status, s.body);
      }
      if (call.auth !== `Bearer ${fx.TOKEN}`) {
        return json(route, 401, { error: "Сессия истекла", code: "session_expired" });
      }
      if (call.path === "/api/tma/feed") {
        const view = call.query.view ?? "";
        const custom = opts.feed?.(view, call.query);
        if (custom) return json(route, custom.status, custom.body);
        if (view === "inbox") return json(route, 200, fx.inboxFor(call.query.filter ?? "all", call.query.cursor ?? null));
        if (view === "lead") {
          const lead = fx.leads[call.query.id ?? ""];
          return lead ? json(route, 200, lead) : json(route, 404, { error: "Лид не найден", code: "bad_request" });
        }
        if (view === "accounts") return json(route, 200, fx.accounts);
        if (view === "tasks") return json(route, 200, fx.tasks);
        if (view === "overview") return json(route, 200, fx.overview);
        return json(route, 400, { error: "bad view", code: "bad_request" });
      }
      if (call.path === "/api/workspace" && call.method === "POST") {
        const action = String(call.body?.action ?? "");
        actionCount[action] = (actionCount[action] ?? 0) + 1;
        const custom = opts.action?.(action, call.body ?? {}, actionCount[action]!);
        if (custom) return json(route, custom.status, custom.body);
        if (action === "draft") return json(route, 200, { ok: true, draft: fx.ANNA_DRAFT, model: "deepseek-chat" });
        return json(route, 200, { ok: true });
      }
      return json(route, 404, { error: "not mocked" });
    },
  );
  return calls;
}

export const tmaUrl = (hash = "") => `/tma/${fx.WS_KEY}${hash}`;
