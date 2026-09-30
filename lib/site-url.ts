export function publicSiteUrl(): string {
  const fromEnv =
    process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv?.startsWith("http")) return fromEnv.replace(/\/$/, "");
  return "https://uniseller.io";
}
