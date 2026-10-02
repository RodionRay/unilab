import { describe, expect, it } from "vitest";
import { uniqueById } from "@/components/tma/inbox-pages";

describe("uniqueById (inbox load-more)", () => {
  it("keeps the first occurrence when a later page repeats a lead whose order changed", () => {
    const first = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
    const next = [{ id: "a", v: 2 }, { id: "c", v: 1 }];

    expect(uniqueById([...first, ...next])).toEqual([{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }]);
  });

  it("returns the same rows when there are no repeats", () => {
    const rows = [{ id: "a" }, { id: "b" }];

    expect(uniqueById(rows)).toEqual(rows);
  });
});
