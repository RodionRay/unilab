#!/usr/bin/env -S npx tsx
/**
 * Goal evidence of lead core v2 (docs/project/specs/lead-core-v2.md, Verification plan row "Goal"):
 * replays the labelled fixture through the real group judge and prints recall / precision.
 *
 *   npx tsx --env-file=<path to .env with AI_API_KEY> scripts/eval-lead-judge.mts [--old-core <lead-core.ts>]
 *
 * `--old-core` takes a scratch copy of the removed `lib/lead-core.ts` (with its `lead-filter` import made
 * relative) and reports how many fixture messages the old regex core would have passed.
 * Writes `artifacts/lead-eval/<date>.json` (untracked). Exit 0 = targets met, 1 = below target,
 * 2 = HUMAN_NEEDED (no AI key) or bad input.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { aiChatJson, envAiApiKey, resolveAiConfig, type JsonLlm } from "@/lib/ai-client";
import { judgeMessages } from "@/lib/leads/judge";
import { defaultProjectFromSettings, type ProjectData } from "@/lib/leads/projects";
import type { ScanMessage } from "@/lib/leads/types";

const FIXTURE_DIR = "tests/fixtures/lead-eval";
const OUT_DIR = "artifacts/lead-eval";
const TARGET_RECALL = 0.8;
const TARGET_PRECISION = 0.7;

type Label = "lead" | "not_lead";
type FixtureItem = { id: string; label: Label; source: "real" | "synthetic"; category: string; text: string };
type Confusion = { tp: number; fp: number; fn: number; tn: number };
type OldCore = { explainLeadDecision: (message: string, settings: Record<string, unknown>) => { pass: boolean; score: number; summary: string } };
type Row = FixtureItem & { predicted: boolean; isLead: boolean | null; score: number | null; reason: string; oldPass?: boolean };

function argValue(name: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : "";
}

function loadFixture(dir: string): { items: FixtureItem[]; settings: Record<string, unknown> } {
  const items = JSON.parse(readFileSync(join(dir, "messages.json"), "utf8")) as FixtureItem[];
  const settings = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as Record<string, unknown>;
  const ids = new Set(items.map((m) => m.id));
  if (ids.size !== items.length) throw new Error("fixture ids are not unique");
  if (items.some((m) => m.label !== "lead" && m.label !== "not_lead")) throw new Error("fixture label must be lead|not_lead");
  return { items, settings };
}

function toScanMessage(item: FixtureItem): ScanMessage {
  return {
    tgMsgId: item.id,
    message: item.text,
    name: "<author>",
    date: new Date().toISOString(),
    senderId: "",
    senderUsername: "",
    senderAccessHash: "",
    messageKind: "group",
    peerId: "",
    replyToMsgId: "",
  };
}

function confusion(rows: readonly { label: Label; predicted: boolean }[]): Confusion {
  const c: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of rows) {
    const key = r.label === "lead" ? (r.predicted ? "tp" : "fn") : r.predicted ? "fp" : "tn";
    c[key]++;
  }
  return c;
}

const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);
const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;

function metrics(c: Confusion) {
  return { ...c, recall: ratio(c.tp, c.tp + c.fn), precision: ratio(c.tp, c.tp + c.fp) };
}

function printMatrix(title: string, m: ReturnType<typeof metrics>): void {
  console.log(`\n${title}`);
  console.log("                 predicted lead | predicted not");
  console.log(`  label lead     ${String(m.tp).padStart(14)} | ${m.fn}`);
  console.log(`  label not_lead ${String(m.fp).padStart(14)} | ${m.tn}`);
  console.log(`  recall ${pct(m.recall)} · precision ${pct(m.precision)}`);
}

async function judgeFixture(project: ProjectData, items: readonly FixtureItem[], apiKey: string): Promise<Row[]> {
  const llm: JsonLlm = (schema, prompt) => aiChatJson(schema, { ...prompt, apiKey });
  const result = await judgeMessages(project, items.map(toScanMessage), llm);
  if (result.unjudged.length) console.error(`unjudged ${result.unjudged.length}: ${result.error || result.unjudged[0]?.reason}`);
  const verdicts = new Map(result.judged.map((j) => [j.message.tgMsgId, j.verdict]));
  return items.map((item) => {
    const v = verdicts.get(item.id);
    const predicted = !!v && v.isLead && v.score >= project.minScore;
    return { ...item, predicted, isLead: v?.isLead ?? null, score: v?.score ?? null, reason: v?.reason ?? "unjudged" };
  });
}

async function applyOldCore(path: string, rows: Row[], settings: Record<string, unknown>) {
  const core = (await import(pathToFileURL(resolve(path)).href)) as OldCore;
  for (const row of rows) row.oldPass = core.explainLeadDecision(row.text, settings).pass;
  return metrics(confusion(rows.map((r) => ({ label: r.label, predicted: !!r.oldPass }))));
}

async function main(): Promise<number> {
  const apiKey = envAiApiKey();
  if (!apiKey) {
    console.error("HUMAN_NEEDED: AI_API_KEY is not set (run with --env-file pointing at the stand .env)");
    return 2;
  }
  const { items, settings } = loadFixture(argValue("--fixture") || FIXTURE_DIR);
  const project = defaultProjectFromSettings(settings, Date.now());
  const rows = await judgeFixture(project, items, apiKey);
  const judge = metrics(confusion(rows));
  printMatrix(`New judge (${resolveAiConfig().model}, minScore ${project.minScore}, ${items.length} messages)`, judge);
  const oldCorePath = argValue("--old-core");
  const oldCore = oldCorePath ? await applyOldCore(oldCorePath, rows, settings) : null;
  if (oldCore) printMatrix("Old regex core (passesLeadCore)", oldCore);

  for (const r of rows.filter((x) => x.predicted !== (x.label === "lead"))) {
    const kind = r.label === "lead" ? "MISS" : "FALSE";
    console.log(`  ${kind} #${r.id} [${r.source}/${r.category}] score ${r.score ?? "-"} · ${r.reason}`);
  }
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${date}.json`);
  const report = { date, model: resolveAiConfig().model, minScore: project.minScore, judge, oldCore, rows };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nartefact: ${out}`);
  return judge.recall >= TARGET_RECALL && judge.precision >= TARGET_PRECISION ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  },
);
