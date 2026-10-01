import { describe, expect, it } from "vitest";
import {
  canSeeGroups,
  canSeeLeadText,
  deleteBlockedReason,
  DEFAULT_PROJECT_DELETE_REASON,
  diffProjectPatch,
  funnelHeadline,
  funnelRows,
  headlineKind,
  isWorkspaceOwner,
  leadsLabel,
  oldStepLabel,
  shortAgoRu,
  type ProjectRecord,
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

describe("canSeeGroups mirrors KIND_ACCESS.group", () => {
  it("only owner, admin or «Группы и каналы» get group records", () => {
    expect(canSeeGroups({ isOwner: true, role: "owner", access: {} })).toBe(true);
    expect(canSeeGroups({ isOwner: false, role: "admin", access: {} })).toBe(true);
    expect(canSeeGroups({ isOwner: false, role: "manager", access: { groups: true } })).toBe(true);
    expect(canSeeGroups({ isOwner: false, role: "manager", access: { ai: true } })).toBe(false);
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

describe("funnel headline never calls unchecked messages «no leads»", () => {
  it("leads found: counts the leads with the right plural", () => {
    const c = counts({ fetched: 797, leads: 27, rejected: 770 });
    expect(headlineKind(c)).toBe("leads");
    expect(funnelHeadline(c, 7)).toBe("Из 797 сообщений за 7 дней AI нашёл 27 лидов");
  });

  it("no leads but skipped messages: says how many wait and why", () => {
    const c = counts({ fetched: 797, judgeSkipped: 91, rejected: 706 });
    expect(headlineKind(c)).toBe("unchecked");
    expect(funnelHeadline(c, 7, true)).toBe("Из 797 сообщений 91 ещё не проверено — AI не подключён");
    expect(funnelHeadline(c, 7, true)).not.toContain("не нашлось");
    expect(funnelHeadline(counts({ fetched: 10, judgeSkipped: 3 }), 1, false)).toBe(
      "Из 10 сообщений 3 ещё не проверены — AI проверит их при следующей проверке чатов",
    );
  });

  it("every message judged and none is a lead: «лидов не нашлось»", () => {
    const c = counts({ fetched: 40, rejected: 40 });
    expect(headlineKind(c)).toBe("none");
    expect(funnelHeadline(c, 1)).toBe("Из 40 сообщений за 24 часа лидов не нашлось");
  });

  it("nothing fetched: empty", () => {
    expect(headlineKind(counts())).toBe("empty");
  });
});

describe("leadsLabel plural", () => {
  it.each([
    [1, "1 лид"], [3, "3 лида"], [5, "5 лидов"], [11, "11 лидов"], [21, "21 лид"], [22, "22 лида"], [112, "112 лидов"], [0, "0 лидов"],
  ])("%i → %s", (count, label) => {
    expect(leadsLabel(count)).toBe(label);
  });
});

describe("funnel step labels", () => {
  it("names the old step by the project depth, default 7", () => {
    expect(oldStepLabel()).toBe("Старше 7 дней");
    expect(oldStepLabel(1)).toBe("Старше 1 дня");
    expect(oldStepLabel(14)).toBe("Старше 14 дней");
    const labels = funnelRows(counts({ fetched: 1 }), 3).map((r) => r.label);
    expect(labels).toContain("Старше 3 дней");
    expect(labels).toContain("Короткие (меньше 12 символов)");
    expect(labels).toContain("Повторы");
  });
});

describe("default project delete guard", () => {
  const rec = (id: string, created: string): ProjectRecord => ({ id, created, data: project({ name: id }) });
  const projects = [rec("main", "2026-01-01"), rec("second", "2026-02-01")];

  it("blocks the oldest (default) project with the reason", () => {
    expect(deleteBlockedReason("main", projects)).toBe(DEFAULT_PROJECT_DELETE_REASON);
  });

  it("allows any other project", () => {
    expect(deleteBlockedReason("second", projects)).toBe("");
    expect(deleteBlockedReason("", [])).toBe("");
  });
});

describe("shortAgoRu one-line age", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it.each([
    ["2026-10-01T11:59:40Z", "только что"],
    ["2026-10-01T11:25:00Z", "35 мин назад"],
    ["2026-10-01T09:00:00Z", "3 ч назад"],
    ["2026-09-29T12:00:00Z", "2 дня назад"],
    ["not a date", ""],
  ])("%s → %s", (iso, label) => {
    expect(shortAgoRu(iso, now)).toBe(label);
  });
});

describe("isWorkspaceOwner", () => {
  it("only the owner (or an older server without the envelope) sees the server-key detail", () => {
    expect(isWorkspaceOwner(null)).toBe(true);
    expect(isWorkspaceOwner({ isOwner: true, role: "owner", access: {} })).toBe(true);
    expect(isWorkspaceOwner({ isOwner: false, role: "admin", access: {} })).toBe(false);
    expect(isWorkspaceOwner({ isOwner: false, role: "member", access: { leads: true } })).toBe(false);
  });
});
