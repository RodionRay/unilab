/** Pseudo-market of the catalog dialog: the workspace's own groups instead of the built-in catalog. */
export const CATALOG_MARKET_DB = "db";
/** Pseudo-market of the catalog dialog: the whole built-in catalog, no niche narrowing. */
export const CATALOG_MARKET_ALL = "all";

/**
 * Market the catalog dialog opens on: the caller's choice, else the workspace groups when there are any,
 * else the whole catalog (no AI narrowing to «Маркетплейсы»).
 */
export function initialCatalogMarket(preferredMarket: string | undefined, hasWorkspaceGroups: boolean): string {
  if (preferredMarket) return preferredMarket;
  return hasWorkspaceGroups ? CATALOG_MARKET_DB : CATALOG_MARKET_ALL;
}
