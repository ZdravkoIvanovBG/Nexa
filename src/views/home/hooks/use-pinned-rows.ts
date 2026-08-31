import { useEffect, useState } from "react";
import { usePinnedCatalogs } from "@/lib/pinned-catalogs";
import { buildPinnedCatalogRows, pinnedRowKey } from "@/lib/pinned-catalogs-rows";
import type { HomeRow } from "../home-types";

export function usePinnedRows(): HomeRow[] {
  const pinned = usePinnedCatalogs();
  const [catalogRows, setCatalogRows] = useState<HomeRow[]>([]);

  const catalogKey = pinned
    .filter((p) => p.source === "catalog")
    .map((p) => p.id)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    buildPinnedCatalogRows(pinned)
      .then((rows) => {
        if (!cancelled) setCatalogRows(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [catalogKey]);

  const catalogById = new Map<string, HomeRow>();
  for (const r of catalogRows) catalogById.set(r.key, r);
  const out: HomeRow[] = [];
  for (const desc of pinned) {
    if (desc.source !== "catalog") continue;
    const key = pinnedRowKey(desc.id);
    const row = catalogById.get(key);
    if (row) out.push(row);
  }
  return out;
}
