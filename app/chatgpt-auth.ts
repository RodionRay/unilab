/**
 * Legacy Sites gateway helpers — now backed by session auth.
 * Prefer importing from `@/lib/auth` in new code.
 */
export {
  getSessionUser as getChatGPTUser,
  requireUser as requireChatGPTUser,
  loginPath as chatGPTSignInPath,
  logoutPath as chatGPTSignOutPath,
  type SessionUser as ChatGPTUser,
} from "@/lib/auth";
