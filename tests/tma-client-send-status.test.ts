import { describe, expect, it } from "vitest";
import type { LeadMessage } from "@/lib/tma/contract";
import { SEND_UNKNOWN_AFTER_MS, describeSendFailure, displayStatus } from "@/components/tma/send-status";

const NOW = Date.parse("2026-10-01T11:20:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ours = (status: LeadMessage["status"], msAgo: number, text = "Добрый день"): LeadMessage => ({ from: "us", text, at: at(msAgo), status });

describe("displayStatus", () => {
  it("keeps sent/failed and a fresh pending as is", () => {
    expect(displayStatus(ours("sent", 1000), NOW, new Set())).toBe("sent");
    expect(displayStatus(ours("failed", 1000), NOW, new Set())).toBe("failed");
    expect(displayStatus(ours("pending", 5000), NOW, new Set())).toBe("pending");
  });
  it("a pending entry older than the send timeout is unknown, not a clock forever", () => {
    expect(displayStatus(ours("pending", SEND_UNKNOWN_AFTER_MS + 1), NOW, new Set())).toBe("unknown");
  });
  it("a pending entry whose text came back 504 in this session is unknown at once", () => {
    expect(displayStatus(ours("pending", 1000, "Пришлю кейсы"), NOW, new Set(["Пришлю кейсы"]))).toBe("unknown");
  });
  it("a server-side unknown status (future contract) is shown as unknown", () => {
    const m = { ...ours("pending", 0), status: "unknown" } as unknown as LeadMessage;
    expect(displayStatus(m, NOW, new Set())).toBe("unknown");
  });
});

describe("describeSendFailure", () => {
  it("504 = unknown outcome: check Telegram before sending again", () => {
    const f = describeSendFailure({ code: "http", status: 504, message: "Нет ответа Telegram-воркера" });
    expect(f.kind).toBe("unknown");
    expect(f.text).toContain("Статус неизвестен");
    expect(f.text).toContain("Telegram");
  });
  it("409 = the same text is held to avoid a duplicate: explains the wait instead of «send again»", () => {
    const f = describeSendFailure({ code: "http", status: 409, message: "Результат прошлой отправки этого сообщения неизвестен…" });
    expect(f.kind).toBe("blocked");
    expect(f.text).toContain("15 минут");
    expect(f.text).not.toMatch(/отправьте ещё раз/i);
  });
  it("network keeps the retry hint; other errors keep the server text", () => {
    expect(describeSendFailure({ code: "network", status: 0, message: "x" })).toMatchObject({ kind: "network" });
    expect(describeSendFailure({ code: "http", status: 503, message: "Не удалось отправить сообщение." })).toEqual({ kind: "other", text: "Не удалось отправить сообщение." });
  });
});
