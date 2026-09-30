import type { Metadata } from "next";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/components/marketing/content";
import { publicSiteUrl } from "@/lib/site-url";

const site = publicSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: {
    default: `UniLab — ${SITE_TAGLINE}`,
    template: "%s · UniLab",
  },
  description: SITE_DESCRIPTION,
  applicationName: "UniLab",
  keywords: [
    "UniLab",
    "тёплые заявки",
    "Telegram лиды",
    "заявки из Telegram",
    "лидогенерация",
  ],
  authors: [{ name: "UniLab" }],
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: site,
    siteName: "UniLab",
    title: `UniLab — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: `UniLab — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
