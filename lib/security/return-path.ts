const PROBE_ORIGIN = "https://app.local";
const AUTH_PAGES = new Set([
  "/login",
  "/register",
  "/logout",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
]);

/**
 * Reduces an untrusted `return_to` to an on-site relative path.
 * Pure (no server imports) so client components can use it too.
 */
export function safeRelativeReturnPath(value: string): string {
  // Browsers treat "\" like "/" in special URLs, so "/\evil.com" means "//evil.com".
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  try {
    const url = new URL(value, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return "/";
    // Dot segments ("/.//x", "/%2e//x", "/a/..//x") normalise into a
    // protocol-relative path that a browser would resolve off-site.
    if (url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) return "/";
    if (AUTH_PAGES.has(url.pathname)) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
