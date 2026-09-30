/**
 * One-off cleanup of a polluted lead stop-list (no DB writes):
 *   npx tsx scripts/clean-lead-stopwords.ts path/to/settings.json > cleaned.json
 * Prints the settings JSON with cleaned minusKeywords/avoidTopics to stdout,
 * the removed terms to stderr. Apply the result through the settings UI/API yourself.
 */
import { readFileSync } from "node:fs";
import { cleanStopLists, type StopListSettings } from "@/lib/lead-stopwords";

function main(): void {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("usage: npx tsx scripts/clean-lead-stopwords.ts <settings.json>\n");
    process.exit(2);
  }
  const settings = JSON.parse(readFileSync(path, "utf8")) as StopListSettings &
    Record<string, unknown>;
  const { minusKeywords, avoidTopics, removed } = cleanStopLists(settings);
  process.stdout.write(`${JSON.stringify({ ...settings, minusKeywords, avoidTopics }, null, 2)}\n`);
  process.stderr.write(`removed ${removed.length}: ${removed.join(", ") || "—"}\n`);
}

main();
