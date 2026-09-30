import { safeRelativeReturnPath as safeOnSitePath } from "@/lib/security/return-path";

const SIGN_IN_PATH = "/login";
const SIGN_OUT_PATH = "/logout";
const REGISTER_PATH = "/register";

export function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === REGISTER_PATH
  );
}

export function safeRelativeReturnPath(value: string): string {
  const safe = safeOnSitePath(value);
  if (safe === "/") return "/";
  // safeOnSitePath maps auth pages to "/app"; this module's contract is "/".
  const { pathname } = new URL(value, "https://app.local");
  return isReservedAuthPath(pathname) ? "/" : safe;
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}
