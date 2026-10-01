const LOOPBACK_HOST = "127.0.0.1";

/**
 * Origin the cron routes call `/api/workspace` on with a freshly minted session cookie.
 * Never taken from the request Host header (it would let a caller point owners' session
 * cookies at any host): APP_URL when it is an http(s) URL, else loopback on the port the
 * request arrived on (`wrangler dev --ip 127.0.0.1`).
 */
export function selfOrigin(requestUrl: string, appUrl: string | undefined): string {
  const configured = parseHttpUrl(appUrl);
  if (configured) return configured.origin;
  const port = parseHttpUrl(requestUrl)?.port ?? "";
  return `http://${LOOPBACK_HOST}${port ? `:${port}` : ""}`;
}

function parseHttpUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
