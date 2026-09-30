const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;
const DEFAULT_TRUSTED_HEADER = "cf-connecting-ip";

/**
 * Header that the edge in front of the app sets and overwrites with the real
 * client IP. `TRUSTED_IP_HEADER` names it (default `cf-connecting-ip`);
 * empty or `none` means no such edge exists, so no header is trusted.
 * Without an overwriting proxy the header is client-controlled.
 */
function trustedIpHeader(): string | null {
  const configured = process.env.TRUSTED_IP_HEADER;
  if (configured === undefined) return DEFAULT_TRUSTED_HEADER;
  const name = configured.trim().toLowerCase();
  return name === "" || name === "none" ? null : name;
}

/**
 * Client IP from the trusted proxy header, or null when unknown.
 * `x-forwarded-for` is never read implicitly: it is client-controlled.
 */
export function trustedClientIp(req: Request): string | null {
  const header = trustedIpHeader();
  if (!header) return null;
  const ip = req.headers.get(header)?.trim() || "";
  return IP_PATTERN.test(ip) ? ip : null;
}
