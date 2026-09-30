import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("Docker image client-IP trust", () => {
  // `wrangler dev --local` passes a client-supplied CF-Connecting-IP straight through.
  it("trusts no client IP header by default", () => {
    expect(read("Dockerfile")).toMatch(/^ENV TRUSTED_IP_HEADER=none$/m);
    expect(read("docker-compose.yml")).toMatch(/^\s+TRUSTED_IP_HEADER: \$\{TRUSTED_IP_HEADER:-none\}$/m);
  });

  // Miniflare only sees .env files unless told to include process env; the image has no .env.
  it("hands container env to the app runtime", () => {
    expect(read("Dockerfile")).toMatch(/^ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true$/m);
  });
});
