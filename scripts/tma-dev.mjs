#!/usr/bin/env node
/**
 * Stand helper (spec tg-mini-app D4): points a test bot's menu button at the mini app behind an https tunnel.
 * Quick-tunnel hostnames change on every restart, so re-run this after each tunnel start.
 *
 *   node scripts/tma-dev.mjs --token <botToken> --url https://<tunnel>/tma/<wsKey> [--chat <tgUserId>]
 *   node scripts/tma-dev.mjs --reset [--chat <tgUserId>]
 *
 * --token  bot token; defaults to env TMA_DEV_BOT_TOKEN (prefer the env: argv is visible in `ps`)
 * --url    mini app URL, https only (Telegram opens nothing else)
 * --chat   one private chat (Telegram user id); without it the bot's default menu button is set
 * --reset  set Telegram's default menu button instead of the mini app (no --url needed)
 *
 * Prints the Bot API result; the token is never printed.
 */

const USAGE =
  "Usage: node scripts/tma-dev.mjs [--token <botToken>] --url https://<host>/tma/<wsKey> [--chat <tgUserId>] [--reset]";

function parseArgs(argv) {
  const out = { token: "", url: "", chat: "", reset: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") out.reset = true;
    else if (arg === "--token" || arg === "--url" || arg === "--chat") out[arg.slice(2)] = String(argv[++i] ?? "");
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

function fail(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

function redact(text, token) {
  return String(text).split(token).join("***").replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***");
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  fail(String(e.message));
}
const token = (args.token || process.env.TMA_DEV_BOT_TOKEN || "").trim();
if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) fail("Bot token missing or malformed (--token or env TMA_DEV_BOT_TOKEN).");
if (args.chat && !/^\d{1,20}$/.test(args.chat)) fail("--chat must be a Telegram user id (digits).");

let menuButton = { type: "default" };
if (!args.reset) {
  let url;
  try {
    url = new URL(args.url);
  } catch {
    fail("--url is required and must be an absolute URL.");
  }
  if (url.protocol !== "https:") fail("Refusing a non-https URL: Telegram opens mini apps over https only.");
  menuButton = { type: "web_app", text: "UniLab", web_app: { url: url.toString() } };
}

const payload = { menu_button: menuButton, ...(args.chat ? { chat_id: Number(args.chat) } : {}) };
try {
  const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  const scope = args.chat ? `chat ${args.chat}` : "default (all chats)";
  console.log(redact(JSON.stringify({ scope, menu_button: menuButton, ok: Boolean(data.ok), description: data.description ?? "" }, null, 2), token));
  process.exit(data.ok ? 0 : 2);
} catch (e) {
  console.error(redact(`setChatMenuButton failed: ${e?.message || e}`, token));
  process.exit(2);
}
