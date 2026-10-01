import { describe, expect, it } from "vitest";
import {
  canSeeLeadText,
  diffProjectPatch,
  funnelRows,
  isRowExpandable,
  newProjectData,
  patchForViewer,
  showRedactedSamplesNote,
  type FunnelCounts,
  type ProjectData,
} from "@/components/product/ai/model";

const counts = (over: Partial<FunnelCounts> = {}): FunnelCounts => ({
  fetched: 0, skippedNotUser: 0, skippedOldWorker: 0, skippedError: 0, returned: 0, old: 0, short: 0,
  duplicate: 0, stopword: 0, judged: 0, judgeSkipped: 0, judgeError: 0, rejected: 0, leads: 0, ...over,
});

const project = (over: Partial<ProjectData> = {}): ProjectData => ({
  ...newProjectData("Фулфилмент", ""),
  goodExamples: ["Ищу фулфилмент под WB"],
  badExamples: ["Сами фулфилмент, ищем клиентов"],
  updatedAt: "",
  ...over,
});

describe("canSeeLeadText mirrors lib/security/workspace-authz.ts::canSeeLeadText", () => {
  it("owner, admin and a missing workspace envelope see lead texts", () => {
    expect(canSeeLeadText({ isOwner: true, role: "owner", access: {} })).toBe(true);
    expect(canSeeLeadText({ isOwner: false, role: "admin", access: {} })).toBe(true);
    expect(canSeeLeadText(null)).toBe(true);
  });

  it("a member sees them only with «Лиды» or «Переписки»", () => {
    expect(canSeeLeadText({ isOwner: false, role: "manager", access: { leads: true } })).toBe(true);
    expect(canSeeLeadText({ isOwner: false, role: "operator", access: { chats: true } })).toBe(true);
    expect(canSeeLeadText({ isOwner: false, role: "manager", access: { ai: true, settings: true } })).toBe(false);
    expect(canSeeLeadText({ isOwner: false, role: "viewer", access: { ai: true, leads: false } })).toBe(false);
  });
});

describe("patchForViewer never sends blanked examples back", () => {
  it("drops goodExamples/badExamples for a viewer without lead access", () => {
    const base = project({ goodExamples: [], badExamples: [] });
    const edited = { ...base, product: "Склад в Подольске", goodExamples: ["x"], badExamples: ["y"] };
    const patch = patchForViewer(diffProjectPatch(base, edited), false);
    expect(patch).toEqual({ product: "Склад в Подольске" });
  });

  it("keeps examples for a viewer with lead access", () => {
    const base = project();
    const edited = { ...base, goodExamples: [...base.goodExamples, "Нужен склад"] };
    expect(patchForViewer(diffProjectPatch(base, edited), true)).toEqual({ goodExamples: edited.goodExamples });
  });
});

describe("funnel rows with redacted samples", () => {
  const c = counts({ fetched: 100, short: 40, rejected: 55, leads: 5 });
  const rows = funnelRows(c);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it("a step opens only when it has samples", () => {
    expect(isRowExpandable(row("short"), {})).toBe(false);
    expect(isRowExpandable(row("short"), { short: [{ text: "+" }] })).toBe(true);
    expect(isRowExpandable(row("fetched"), { short: [{ text: "+" }] })).toBe(false);
    expect(isRowExpandable(row("stopword"), { stopword: [{ text: "вакансия" }] })).toBe(false);
  });

  it("the access note shows only for a redacted viewer with counts", () => {
    expect(showRedactedSamplesNote(c, false)).toBe(true);
    expect(showRedactedSamplesNote(c, true)).toBe(false);
    expect(showRedactedSamplesNote(counts({ fetched: 0 }), false)).toBe(false);
  });
});
