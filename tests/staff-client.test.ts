import { describe, expect, it } from "vitest";
import { readStaffResponse, type StaffCreateInviteResponse } from "@/lib/staff-client";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("readStaffResponse", () => {
  it("возвращает тело успешного ответа", async () => {
    const data = await readStaffResponse<StaffCreateInviteResponse>(
      jsonResponse({ ok: true, url: "https://x/invite/t" }, 200),
      "fallback",
    );
    expect(data.url).toBe("https://x/invite/t");
  });

  it("бросает текст ошибки сервера", async () => {
    await expect(
      readStaffResponse(jsonResponse({ error: "Сотрудник не найден" }, 404), "fallback"),
    ).rejects.toThrow("Сотрудник не найден");
  });

  it("бросает fallback, когда error нет или он не строка", async () => {
    await expect(readStaffResponse(jsonResponse({}, 500), "Не удалось")).rejects.toThrow("Не удалось");
    await expect(readStaffResponse(jsonResponse({ error: { code: 1 } }, 400), "Не удалось")).rejects.toThrow(
      "Не удалось",
    );
  });
});
