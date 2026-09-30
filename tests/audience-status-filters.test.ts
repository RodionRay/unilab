import { describe, expect, it } from "vitest";
import {
  normalizeStatusFilters,
  statusFiltersLabel,
} from "@/lib/audience-invite";

describe("сбор аудитории · мультивыбор статусов", () => {
  it("пустой / all → все статусы", () => {
    expect(normalizeStatusFilters([])).toEqual([]);
    expect(normalizeStatusFilters(undefined, "all")).toEqual([]);
    expect(statusFiltersLabel([])).toBe("Все статусы");
  });

  it("несколько статусов сохраняются", () => {
    expect(normalizeStatusFilters(["online", "recently"])).toEqual([
      "online",
      "recently",
    ]);
    expect(statusFiltersLabel(["online", "recently"])).toContain("Онлайн");
    expect(statusFiltersLabel(["online", "recently"])).toContain("Недавно");
  });

  it("legacy statusFilter:string → массив", () => {
    expect(normalizeStatusFilters(undefined, "online")).toEqual(["online"]);
    expect(normalizeStatusFilters(["all"], "recently")).toEqual(["recently"]);
  });

  it("отбрасывает неизвестные значения", () => {
    expect(normalizeStatusFilters(["online", "nope", "last_week"])).toEqual([
      "online",
      "last_week",
    ]);
  });
});
