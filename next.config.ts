import type { NextConfig } from "next";
import { securityHeaderRules } from "./lib/security/headers";

const nextConfig: NextConfig = {
  async headers() {
    // Every path gets SECURITY_HEADERS except /tma/* (Telegram Mini App), which may be framed by Telegram Web.
    return securityHeaderRules();
  },
};

export default nextConfig;
