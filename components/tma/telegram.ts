/**
 * Minimal typed surface of the official SDK (https://telegram.org/js/telegram-web-app.js)
 * that the mini app uses. Every call is gated by the Bot API version that introduced it
 * (https://core.telegram.org/bots/webapps): BackButton/MainButton/HapticFeedback 6.1,
 * showConfirm 6.2, disableVerticalSwipes 7.7.
 */
export type TgThemeParams = Partial<
  Record<
    | "bg_color"
    | "text_color"
    | "hint_color"
    | "link_color"
    | "button_color"
    | "button_text_color"
    | "secondary_bg_color"
    | "header_bg_color"
    | "bottom_bar_bg_color"
    | "accent_text_color"
    | "section_bg_color"
    | "section_header_text_color"
    | "section_separator_color"
    | "subtitle_text_color"
    | "destructive_text_color",
    string
  >
>;

type TgButtonParams = {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
};

export type TgMainButton = {
  setParams(params: TgButtonParams): TgMainButton;
  show(): TgMainButton;
  hide(): TgMainButton;
  showProgress(leaveActive?: boolean): TgMainButton;
  hideProgress(): TgMainButton;
  onClick(cb: () => void): TgMainButton;
  offClick(cb: () => void): TgMainButton;
};

export type TgBackButton = {
  show(): TgBackButton;
  hide(): TgBackButton;
  onClick(cb: () => void): TgBackButton;
  offClick(cb: () => void): TgBackButton;
};

export type TgWebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { first_name?: string } };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: TgThemeParams;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  openTelegramLink(url: string): void;
  onEvent(event: "themeChanged" | "viewportChanged", cb: () => void): void;
  offEvent(event: "themeChanged" | "viewportChanged", cb: () => void): void;
  MainButton: TgMainButton;
  BackButton: TgBackButton;
  HapticFeedback?: { notificationOccurred(kind: "error" | "success" | "warning"): void };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function getWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function atLeast(app: TgWebApp | null, version: string): boolean {
  if (!app) return false;
  try {
    return app.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

export function haptic(app: TgWebApp | null, kind: "success" | "error"): void {
  if (atLeast(app, "6.1")) app?.HapticFeedback?.notificationOccurred(kind);
}

/**
 * Asks for confirmation through Telegram's native dialog (6.2+); outside it falls back to
 * window.confirm so the action is never silently skipped.
 */
export function confirmAction(app: TgWebApp | null, message: string): Promise<boolean> {
  if (app && atLeast(app, "6.2")) {
    return new Promise((resolve) => app.showConfirm(message, (ok) => resolve(ok)));
  }
  return Promise.resolve(typeof window !== "undefined" && window.confirm(message));
}

/** UniLab accent (owner D5, app/globals.css::--spike-primary) for the native MainButton. */
export const MAIN_BUTTON_COLOR = "#ffa92c";
export const MAIN_BUTTON_TEXT_COLOR = "#1a1208";
