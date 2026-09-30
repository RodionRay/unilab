import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const base = publicSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/register", "/privacy", "/terms"],
        disallow: ["/app", "/api", "/login"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
