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
