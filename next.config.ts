import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security/headers";

const nextConfig: NextConfig = {
  async headers() {
    // vinext's "/:path*" does not match the bare root, so "/" is listed too.
    return ["/", "/:path*"].map((source) => ({
      source,
      headers: [...SECURITY_HEADERS],
    }));
  },
};

export default nextConfig;
