import type { ReactNode } from "react";
import { CursorGlow } from "@/components/marketing/fx";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { AiAssistantWidget } from "@/components/product/ai-assistant-widget";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <main className="us-landing">
      <div className="us-aurora" aria-hidden>
        <span className="us-blob us-blob-a" />
        <span className="us-blob us-blob-b" />
        <span className="us-blob us-blob-c" />
      </div>
      <div className="us-dots" aria-hidden />
      <CursorGlow />
      <MarketingHeader />
      {children}
      <MarketingFooter />
      <AiAssistantWidget surface="site" />
    </main>
  );
}
