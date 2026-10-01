import type { Metadata, Viewport } from "next";
import "@/components/tma/theme.css";

export const metadata: Metadata = {
  title: "UniLab",
  robots: { index: false, follow: false },
};

// viewport-fit=cover so Telegram's safe-area insets apply edge to edge; zoom stays enabled (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function TmaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Official SDK, parser-blocking on purpose: it must define window.Telegram.WebApp before the app bundle
          (module scripts run after parsing) — https://core.telegram.org/bots/webapps#initializing-mini-apps */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src="https://telegram.org/js/telegram-web-app.js" />
      {children}
    </>
  );
}
