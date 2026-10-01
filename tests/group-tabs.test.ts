import { describe, expect, it } from "vitest";
import { groupStatusLabel, groupTab } from "@/lib/group-tabs";

const rel = (band: "auto" | "review" | "skip", score: number) => ({ v: 3, sig: "x", score, band, reasons: ["r"], members: 0, at: "" });
const group = (extra: Record<string, unknown>) => ({
  name: "Группа",
  url: "https://t.me/some_chat_test",
  accountId: "acc12345-aaaa",
  membership: "none",
  status: "setup",
  joinedAt: "",
  ...extra,
});

describe("groups page tabs", () => {
  it("a skipped-band group with an account error is in «Ошибка», not «Не вступать»", () => {
    const g = group({ joinRelevance: rel("skip", 20), joinAccountError: "Слот не видит @x", joinAccountErrorId: "acc12345-aaaa" });
    expect(groupTab(g)).toBe("error");
  });

  it("«Не вступать» holds only skip / skipped gates", () => {
    expect(groupTab(group({ joinRelevance: rel("skip", 20) }))).toBe("skip");
    expect(groupTab(group({ joinDecision: "skipped", joinRelevance: rel("auto", 90) }))).toBe("skip");
    expect(groupTab(group({ joinRelevance: rel("review", 40) }))).toBe("review");
  });

  it("a dead link and an error status go to «Ошибка»", () => {
    expect(groupTab(group({ joinDead: true, status: "error", joinRelevance: rel("skip", 10) }))).toBe("error");
    expect(groupTab(group({ status: "error", error: "Группа приватная", joinRelevance: rel("skip", 10) }))).toBe("error");
  });

  it("a rejoin without an account waits in «Ждут» (owner assigns an account there)", () => {
    expect(groupTab(group({ accountId: "", joinRejoin: true, leadsTotal: 3 }))).toBe("need");
    expect(groupTab(group({ accountId: "", joinRelevance: rel("auto", 80) }))).toBe("need");
  });

  it("members are «Вступили» / «Заявка»; a catalog placeholder has no join tab", () => {
    expect(groupTab(group({ membership: "joined", joinedAt: "2026-09-01T00:00:00Z", joinAccountError: "x" }))).toBe("joined");
    expect(groupTab(group({ membership: "pending" }))).toBe("pending");
    expect(groupTab(group({ url: "", joinRelevance: rel("auto", 80) }))).toBeNull();
  });
});

describe("groups page status label", () => {
  it("an account error beats the gate label and the plain error", () => {
    const g = group({ status: "error", joinRelevance: rel("skip", 20), joinAccountError: "FloodWait 300" });
    expect(groupStatusLabel(g)).toEqual({ label: "Ошибка аккаунта", tone: "danger" });
  });

  it("an error status beats the gate label", () => {
    expect(groupStatusLabel(group({ status: "error", joinRelevance: rel("skip", 20) }))).toEqual({ label: "Ошибка", tone: "danger" });
  });

  it("members first, then gate labels", () => {
    expect(groupStatusLabel(group({ membership: "joined", joinAccountError: "x" })).label).toBe("Вступили");
    expect(groupStatusLabel(group({ joinRelevance: rel("skip", 20) }))).toEqual({ label: "Не вступать", tone: "neutral" });
    expect(groupStatusLabel(group({ joinDead: true, status: "error" }))).toEqual({ label: "Ссылка мертва", tone: "danger" });
  });
});
