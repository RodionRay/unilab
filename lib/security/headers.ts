/**
 * Baseline response headers for every route. No script/style CSP: only
 * frame-ancestors, which cannot break rendering (the app embeds the Telegram
 * widget, it is never embedded itself). HSTS is ignored by browsers over
 * plain http, so sending it everywhere only takes effect on https.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/**
 * Telegram Mini App pages (`/tma/<wsKey>`) are the one place we are embedded:
 * web.telegram.org (WebK `/k`, WebA `/a`) renders a Mini App inside an iframe on
 * its own origin, so `X-Frame-Options` must go and `frame-ancestors` must name
 * the Telegram web origins. The native apps (iOS, Android, Desktop/macOS) open
 * Mini Apps in a top-level embedded WebView, not in an iframe, so they need no
 * extra origin. Sources: https://core.telegram.org/bots/webapps (Mini Apps run
 * in Telegram Web via an iframe + postMessage bridge, see `window.parent`
 * postEvent in https://telegram.org/js/telegram-web-app.js),
 * https://github.com/morethanwords/tweb, https://github.com/Ajaxy/telegram-tt.
 */
export const TMA_FRAME_ANCESTORS = "frame-ancestors https://web.telegram.org https://*.telegram.org";

export const TMA_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  ...SECURITY_HEADERS.filter((h) => h.key !== "X-Frame-Options" && h.key !== "Content-Security-Policy"),
  { key: "Content-Security-Policy", value: TMA_FRAME_ANCESTORS },
];

/**
 * Header rules for next.config. Next (and vinext) apply EVERY matching entry,
 * so the global rules must not match `/tma` or `/tma/...` — otherwise the
 * Mini App would still get `X-Frame-Options: DENY`. "Every path except /tma"
 * is spelled as several flat patterns because vinext compiles header sources
 * with a ReDoS guard (config-matchers.js::safeRegExp) that rejects a single
 * alternation of `.*` branches and does not support lookahead groups.
 */
export const NOT_TMA_PATH_SOURCES = [
  "/",
  "/:p([^t].*)",
  "/:p(t[^m].*)",
  "/:p(tm[^a].*)",
  "/:p(tma[^/].*)",
  "/t",
  "/tm",
] as const;
export const TMA_PATH_SOURCES = ["/tma", "/tma/:path*"] as const;

export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

export function securityHeaderRules(): HeaderRule[] {
  return [
    ...NOT_TMA_PATH_SOURCES.map((source) => ({ source, headers: [...SECURITY_HEADERS] })),
    ...TMA_PATH_SOURCES.map((source) => ({ source, headers: [...TMA_SECURITY_HEADERS] })),
  ];
}
