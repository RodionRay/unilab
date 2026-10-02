import { TmaApp } from "@/components/tma/tma-app";
import { database } from "@/lib/server-store";
import { WS_KEY_RE } from "@/lib/tma/contract";
import { botLinkForKey } from "@/lib/tma/workspace";

/** Bot link for the outside-Telegram screen (REQ-S3); best effort — the screen has a text fallback. */
async function outsideBotLink(wsKey: string): Promise<string> {
  if (!WS_KEY_RE.test(wsKey)) return "";
  try {
    return await botLinkForKey(database(), wsKey);
  } catch (e) {
    console.error("[tma] bot_link:", String((e as Error)?.message || e).slice(0, 200));
    return "";
  }
}

export default async function TmaPage({ params }: { params: Promise<{ wsKey: string }> }) {
  const { wsKey } = await params;
  return <TmaApp wsKey={wsKey} botLink={await outsideBotLink(wsKey)} />;
}
