/**
 * Tier vocabulary for the ranking board. Kept in its own leaf module so the
 * cloud row mappers can validate a tier without importing the tracking store
 * (which would close an import cycle back through the cloud mirror).
 */
export const TIERS = ["S", "A", "B", "C", "D", "F"] as const;
export type RankedTier = (typeof TIERS)[number];
export type Tier = RankedTier | "unranked";

export const ALL_TIERS: readonly Tier[] = [...TIERS, "unranked"];

export function normalizeTier(value: unknown): Tier {
  if (typeof value !== "string") return "unranked";
  return (TIERS as readonly string[]).includes(value) ? (value as RankedTier) : "unranked";
}
