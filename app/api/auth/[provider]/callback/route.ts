import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  exchangeOAuthCode,
  oauthEnabled,
  parseOAuthState,
  type OAuthProvider,
} from "@/lib/oauth";
import { OAuthEmailTakenError, upsertOAuthUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const PROVIDERS = new Set<OAuthProvider>(["google", "yandex", "vk"]);
const STATE_COOKIE = "unilab_oauth";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`/login?error=${code}`, url.origin));
  if (!PROVIDERS.has(provider as OAuthProvider) || !oauthEnabled(provider as OAuthProvider)) {
    return fail("oauth");
  }
  const err = url.searchParams.get("error");
  if (err) return fail("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("oauth");

  const jar = await cookies();
  const packed = jar.get(STATE_COOKIE)?.value;
  const parsed = parseOAuthState(packed, state);
  if (!parsed || parsed.provider !== provider) return fail("state");

  try {
    const profile = await exchangeOAuthCode(
      url.origin,
      provider as OAuthProvider,
      code,
    );
    const user = await upsertOAuthUser({
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
    });
    const token = await createSessionToken({
      userId: user.id,
      email: user.email || "",
      displayName: user.name,
    });
    const res = NextResponse.redirect(new URL(parsed.returnTo, url.origin));
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(undefined, req.url));
    res.cookies.set(STATE_COOKIE, "", { ...sessionCookieOptions(0, req.url), maxAge: 0 });
    return res;
  } catch (e) {
    return fail(e instanceof OAuthEmailTakenError ? "exists" : "oauth");
  }
}
