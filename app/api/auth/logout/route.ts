import { NextResponse } from "next/server";
import {
  safeRelativeReturnPath,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function clearSession(req: Request, response: NextResponse): NextResponse {
  response.cookies.set(sessionCookieName(), "", {
    ...sessionCookieOptions(0, req.url),
    maxAge: 0,
  });
  return response;
}

/**
 * GET stays because the cabinet header logs out via a plain link
 * (app/app/page.tsx). The target is always an on-site relative path.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = safeRelativeReturnPath(
    url.searchParams.get("return_to") || "/",
  );
  return clearSession(
    req,
    NextResponse.redirect(new URL(returnTo, url.origin), 302),
  );
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  if (origin && origin !== url.origin) {
    return NextResponse.json(
      { error: "Недопустимый источник запроса" },
      { status: 403 },
    );
  }
  return clearSession(
    req,
    NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }),
  );
}
