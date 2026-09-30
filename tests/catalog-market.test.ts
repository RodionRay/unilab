import { describe, expect, it } from "vitest";
import { initialCatalogMarket } from "@/lib/catalog-market";

describe("initialCatalogMarket", () => {
  it("без выбора открывает группы кабинета, если они есть", () => {
    expect(initialCatalogMarket(undefined, true)).toBe("db");
  });

  it("без выбора и без групп открывает весь каталог", () => {
    expect(initialCatalogMarket(undefined, false)).toBe("all");
  });

  it("явный выбор важнее групп кабинета", () => {
    expect(initialCatalogMarket("all", true)).toBe("all");
    expect(initialCatalogMarket("marketplaces", false)).toBe("marketplaces");
  });
});
