import { describe, expect, it } from "vitest";
import {
  MAX_LEAD_TOMBSTONES,
  addLeadTombstone,
  evaluateScanGate,
  keepServerOwnedFields,
} from "@/lib/processes/scan-flow";
import { withDayLimitCooldown, withSpamblockStatus } from "@/lib/telegram-accounts";

describe("скан · gate", () => {
  it("пропускает active", () => {
    expect(evaluateScanGate({ status: "active" })).toEqual({ ok: true });
  });

  it("блокирует отлёжку / spam / freeze / hard-dead", () => {
    // Отлёжка без вида лимита блокирует; дневной лимит вступлений скан не останавливает
    const cool = { status: "cooldown", cooldownUntil: new Date(Date.now() + 3600_000).toISOString() };
    expect(evaluateScanGate(cool).reason).toBe("cooldown");
    expect(evaluateScanGate(withDayLimitCooldown({ status: "active" }, "invite"))).toEqual({ ok: true });
    expect(evaluateScanGate(withSpamblockStatus({ status: "active" })).reason).toBe(
      "cooldown",
    );
    expect(evaluateScanGate({ status: "frozen" }).reason).toBe("cooldown");
    expect(evaluateScanGate({ status: "disconnected" }).reason).toBe("hard_dead");
    expect(evaluateScanGate(null).reason).toBe("missing");
  });
});

describe("скан · tombstones и серверные поля (REQ-L6, REQ-L10)", () => {
  it("tombstone без дублей и с потолком", () => {
    expect(addLeadTombstone(["1"], "1")).toEqual(["1"]);
    expect(addLeadTombstone(undefined, "2")).toEqual(["2"]);
    const full = Array.from({ length: MAX_LEAD_TOMBSTONES }, (_, i) => String(i));
    const next = addLeadTombstone(full, "new");
    expect(next).toHaveLength(MAX_LEAD_TOMBSTONES);
    expect(next.at(-1)).toBe("new");
  });

  it("save лида берёт клиентские поля, но не серверные", () => {
    const merged = keepServerOwnedFields(
      "lead",
      { replies: [{ text: "a" }], coreScore: 70, status: "new" },
      { replies: [], status: "working", draft: "x" },
    );
    expect(merged).toEqual({ replies: [{ text: "a" }], coreScore: 70, status: "working", draft: "x" });
    expect(keepServerOwnedFields("account", { status: "a" }, { status: "b" })).toEqual({ status: "b" });
  });

  it("save лида не даёт клиенту задать серверное поле, которого нет в сохранённом лиде", () => {
    const merged = keepServerOwnedFields(
      "lead",
      { status: "new" },
      { status: "working", senderId: "666", peerId: "777", mailingTaskId: "x", accountId: "acc" },
    );
    expect(merged).toEqual({ status: "working" });
  });

  it("lead core v2 (REQ-24): проект, оценка судьи, источник и вид авто-черновика лида, проект группы — серверные", () => {
    const lead = keepServerOwnedFields(
      "lead",
      { projectId: "p1", score: 85, reason: "ищет сервис", sourceKind: "dm", draftKind: "dm_first", status: "new" },
      { projectId: "p2", score: 1, reason: "x", sourceKind: "group", draftKind: "dm_continue", status: "working", draft: "текст" },
    );
    expect(lead).toEqual({ projectId: "p1", score: 85, reason: "ищет сервис", sourceKind: "dm", draftKind: "dm_first", status: "working", draft: "текст" });
    expect(keepServerOwnedFields("lead", { status: "new" }, { status: "new", draftKind: "dm_first" })).toEqual({ status: "new" });
    expect(keepServerOwnedFields("group", { projectId: "p1" }, { projectId: "p2", name: "G" })).toEqual({ projectId: "p1", name: "G" });
    expect(keepServerOwnedFields("settings", { inboxPollCursor: 3, dmAiRejected: { sig: "s" } }, { name: "N" })).toEqual({ name: "N", inboxPollCursor: 3, dmAiRejected: { sig: "s" } });
  });
});
