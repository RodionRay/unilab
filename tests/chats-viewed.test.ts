import { describe, expect, it } from "vitest";

/** Чистая логика: открытие чата → viewed + сброс needsManager. */
export function markChatOpened(data: {
  viewed?: boolean;
  viewedAt?: string;
  needsManager?: boolean;
}): { viewed: boolean; viewedAt: string; needsManager: false } {
  return {
    viewed: true,
    viewedAt: data.viewedAt || "2026-09-19T00:00:00.000Z",
    needsManager: false,
  };
}

describe("переписки · при просмотре → просмотренные", () => {
  it("новый ответ: viewed=false,needsManager → после открытия viewed и без менеджера", () => {
    const before = { viewed: false, needsManager: true, viewedAt: "" };
    const after = markChatOpened(before);
    expect(after.viewed).toBe(true);
    expect(after.needsManager).toBe(false);
    expect(after.viewedAt).toBeTruthy();
  });

  it("повторное открытие уже просмотренного без needsManager — no-op полей", () => {
    const before = { viewed: true, needsManager: false, viewedAt: "2026-09-18T10:00:00.000Z" };
    const after = markChatOpened(before);
    expect(after.viewed).toBe(true);
    expect(after.viewedAt).toBe("2026-09-18T10:00:00.000Z");
    expect(after.needsManager).toBe(false);
  });

  it("просмотренный + новый needsManager снова очищается", () => {
    const after = markChatOpened({
      viewed: true,
      needsManager: true,
      viewedAt: "2026-09-18T10:00:00.000Z",
    });
    expect(after.viewed).toBe(true);
    expect(after.needsManager).toBe(false);
    expect(after.viewedAt).toBe("2026-09-18T10:00:00.000Z");
  });
});
