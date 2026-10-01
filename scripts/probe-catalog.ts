/**
 * Probe every catalog @username through its public t.me page and list the dead ones
 * (non-existent, user or bot — nothing to join). No Telegram account is used.
 *
 *   npx tsx scripts/probe-catalog.ts [--concurrency 4] [--json]
 *
 * Exit code 0 always; «unknown» (network, rate limit) is reported separately and is never «dead».
 */
import { GROUP_CATALOG, isCatalogPlaceholderUrl } from "@/lib/group-catalog";
import { probeTmeUsername, probeableUsername, type TmeProbeResult } from "@/lib/tme-probe";

const MAX_CONCURRENCY = 4;

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? String(process.argv[i + 1] || "") : "";
}

async function main() {
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(arg("concurrency")) || MAX_CONCURRENCY));
  const usernames = [
    ...new Set(
      GROUP_CATALOG.filter((g) => g.url && !isCatalogPlaceholderUrl(g.url))
        .map((g) => probeableUsername(g.url))
        .filter((u): u is string => !!u),
    ),
  ];
  const results = new Map<string, TmeProbeResult>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < usernames.length) {
      const u = usernames[cursor++]!;
      results.set(u, await probeTmeUsername(u));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const by = (r: TmeProbeResult) => usernames.filter((u) => results.get(u) === r);
  const report = { total: usernames.length, live: by("live").length, dead: by("dead"), unknown: by("unknown") };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`probed ${report.total}: live ${report.live}, dead ${report.dead.length}, unknown ${report.unknown.length}\n`);
  for (const u of report.dead) process.stdout.write(`dead    @${u}\n`);
  for (const u of report.unknown) process.stdout.write(`unknown @${u}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
