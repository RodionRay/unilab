import {
  readEnv,
  safeRelativeReturnPath,
  sessionCookieOptions,
} from "@/lib/auth";
import { constantTimeEqual } from "@/lib/security/secret-compare";
import {
  createSignedNonce,
  readCookie,
  verifySignedNonce,
} from "@/lib/security/signed-nonce";

export type OAuthProvider = "google" | "yandex" | "vk";

const STATE_COOKIE = "unilab_oauth";
const TELEGRAM_STATE_COOKIE = "unilab_tg_state";
const TELEGRAM_STATE_TTL_SEC = 600;
/** Telegram Login payloads older than this are rejected as replays. */
export const TELEGRAM_AUTH_MAX_AGE_SEC = 300;
const TELEGRAM_CLOCK_SKEW_SEC = 60;
/** Our own query params on data-auth-url; Telegram does not sign them. */
const TELEGRAM_UNSIGNED_KEYS = new Set(["hash", "state", "return_to"]);

export function oauthEnabled(provider: OAuthProvider): boolean {
  const prefix =
    provider === "google"
      ? "GOOGLE"
      : provider === "yandex"
        ? "YANDEX"
        : "VK";
  return Boolean(readEnv(`${prefix}_CLIENT_ID`) && readEnv(`${prefix}_CLIENT_SECRET`));
}

export function telegramEnabled(): boolean {
  return Boolean(readEnv("TELEGRAM_BOT_TOKEN") && readEnv("TELEGRAM_BOT_USERNAME"));
}

export function authProviders() {
  return {
    google: oauthEnabled("google"),
    yandex: oauthEnabled("yandex"),
    vk: oauthEnabled("vk"),
    telegram: telegramEnabled(),
    telegramBot: readEnv("TELEGRAM_BOT_USERNAME") || "",
  };
}

function client(provider: OAuthProvider) {
  const prefix =
    provider === "google"
      ? "GOOGLE"
      : provider === "yandex"
        ? "YANDEX"
        : "VK";
  return {
    id: readEnv(`${prefix}_CLIENT_ID`) || "",
    secret: readEnv(`${prefix}_CLIENT_SECRET`) || "",
  };
}

export function oauthCallbackUrl(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/${provider}/callback`;
}

export function oauthAuthorizeUrl(
  origin: string,
  provider: OAuthProvider,
  state: string,
) {
  const { id } = client(provider);
  const redirect = oauthCallbackUrl(origin, provider);
  if (provider === "google") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", id);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    return u.toString();
  }
  if (provider === "yandex") {
    const u = new URL("https://oauth.yandex.ru/authorize");
    u.searchParams.set("client_id", id);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return u.toString();
  }
  const u = new URL("https://oauth.vk.com/authorize");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "email");
  u.searchParams.set("v", "5.199");
  u.searchParams.set("state", state);
  return u.toString();
}

export function oauthStateCookie(
  value: string,
  requestUrl: string,
  maxAge = 600,
) {
  return {
    name: STATE_COOKIE,
    value,
    options: {
      ...sessionCookieOptions(maxAge, requestUrl),
      sameSite: "lax" as const,
    },
  };
}

export function parseOAuthState(
  raw: string | undefined,
  expected: string | null,
): { provider: string; returnTo: string } | null {
  if (!raw || !expected) return null;
  try {
    const data = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { s?: string; p?: string; r?: string };
    if (data.s !== expected) return null;
    if (!data.p) return null;
    return {
      provider: data.p,
      returnTo: safeRelativeReturnPath(data.r || "/app"),
    };
  } catch {
    return null;
  }
}

export function makeOAuthState(provider: string, returnTo: string) {
  const s = crypto.randomUUID();
  const packed = Buffer.from(
    JSON.stringify({
      s,
      p: provider,
      r: safeRelativeReturnPath(returnTo),
    }),
    "utf8",
  ).toString("base64url");
  return { s, packed };
}

export type OAuthProfile = {
  providerUserId: string;
  email: string | null;
  /** True only when the provider asserts the email is verified (Google). */
  emailVerified: boolean;
  name: string;
};

export async function exchangeOAuthCode(
  origin: string,
  provider: OAuthProvider,
  code: string,
): Promise<OAuthProfile> {
  const { id, secret } = client(provider);
  const redirect = oauthCallbackUrl(origin, provider);
  if (provider === "google") {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Google не выдал токен");
    const meRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = (await meRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!me.sub) throw new Error("Google не вернул профиль");
    return {
      providerUserId: me.sub,
      email: me.email || null,
      emailVerified: me.email_verified === true,
      name: me.name || me.email || "Google",
    };
  }
  if (provider === "yandex") {
    const tokenRes = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Яндекс не выдал токен");
    const meRes = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${token.access_token}` },
    });
    const me = (await meRes.json()) as {
      id?: string;
      default_email?: string;
      display_name?: string;
      real_name?: string;
    };
    if (!me.id) throw new Error("Яндекс не вернул профиль");
    return {
      providerUserId: String(me.id),
      email: me.default_email || null,
      emailVerified: false,
      name: me.real_name || me.display_name || me.default_email || "Яндекс",
    };
  }
  const tokenUrl = new URL("https://oauth.vk.com/access_token");
  tokenUrl.searchParams.set("client_id", id);
  tokenUrl.searchParams.set("client_secret", secret);
  tokenUrl.searchParams.set("redirect_uri", redirect);
  tokenUrl.searchParams.set("code", code);
  const tokenRes = await fetch(tokenUrl);
  const token = (await tokenRes.json()) as {
    access_token?: string;
    user_id?: number;
    email?: string;
  };
  if (!token.access_token || !token.user_id)
    throw new Error("VK не выдал токен");
  const api = new URL("https://api.vk.com/method/users.get");
  api.searchParams.set("user_ids", String(token.user_id));
  api.searchParams.set("access_token", token.access_token);
  api.searchParams.set("v", "5.199");
  const meRes = await fetch(api);
  const me = (await meRes.json()) as {
    response?: { id: number; first_name?: string; last_name?: string }[];
  };
  const person = me.response?.[0];
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ");
  return {
    providerUserId: String(token.user_id),
    email: token.email || null,
    emailVerified: false,
    name: name || `VK ${token.user_id}`,
  };
}

function stateSecret(): string {
  const secret = readEnv("SESSION_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET не настроен (минимум 32 символа)");
  }
  return secret;
}

/**
 * Issued when the login page loads the Telegram widget: the nonce is put into
 * data-auth-url, the signed token into an httpOnly cookie. The callback only
 * accepts a payload that comes back with the matching pair (login CSRF guard).
 */
export async function makeTelegramState(requestUrl: string) {
  const { nonce, token } = await createSignedNonce(
    stateSecret(),
    TELEGRAM_STATE_TTL_SEC,
  );
  return {
    nonce,
    cookie: {
      name: TELEGRAM_STATE_COOKIE,
      value: token,
      options: sessionCookieOptions(TELEGRAM_STATE_TTL_SEC, requestUrl),
    },
  };
}

export async function telegramStateValid(
  req: Request,
  state: string | null | undefined,
): Promise<boolean> {
  return verifySignedNonce(
    readCookie(req, TELEGRAM_STATE_COOKIE),
    state,
    stateSecret(),
  );
}

export function telegramStateCookieCleared(requestUrl: string) {
  return {
    name: TELEGRAM_STATE_COOKIE,
    value: "",
    options: { ...sessionCookieOptions(0, requestUrl), maxAge: 0 },
  };
}

export async function verifyTelegramAuth(
  data: Record<string, string>,
): Promise<{ id: string; name: string }> {
  const token = readEnv("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram Login не настроен");
  const hash = data.hash;
  if (!hash || !data.id) throw new Error("Нет подписи Telegram");
  const check = Object.keys(data)
    .filter((k) => !TELEGRAM_UNSIGNED_KEYS.has(k))
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const secretKey = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(check),
  );
  const hex = Buffer.from(mac).toString("hex");
  if (!(await constantTimeEqual(hex, hash.toLowerCase()))) {
    throw new Error("Неверная подпись Telegram");
  }
  const authDate = Number(data.auth_date || 0);
  const ageSec = Date.now() / 1000 - authDate;
  if (!authDate || ageSec > TELEGRAM_AUTH_MAX_AGE_SEC || ageSec < -TELEGRAM_CLOCK_SKEW_SEC) {
    throw new Error("Сессия Telegram устарела");
  }
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ") ||
    data.username ||
    "Telegram";
  return { id: data.id, name };
}
