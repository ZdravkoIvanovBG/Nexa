import { useEffect, useRef, useState } from "react";
import type { Meta } from "./cinemeta";
import type { GridSpec } from "./view";

const PAGE_CAP = 40;

/**
 * Infinite-scroll paging for a `GridSpec`: watches a sentinel, pulls the next
 * page when it comes into view, drops ids already loaded, and stops on an empty
 * batch or the page cap. `transform` runs over the whole accumulated list after
 * every append, so callers can keep the grid sorted as pages arrive.
 */
export function useGridPaging(spec: GridSpec, opts?: { transform?: (items: Meta[]) => Meta[] }) {
  const transform = opts?.transform;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [metas, setMetas] = useState<Meta[]>(() =>
    transform ? transform(spec.initial ?? []) : (spec.initial ?? []),
  );
  const [page, setPage] = useState(spec.initial?.length ? 1 : 0);
  const [done, setDone] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (done) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        const next = page + 1;
        spec
          .fetcher(next)
          .then((batch) => {
            setPage(next);
            if (batch.length === 0 || next >= PAGE_CAP) {
              setDone(true);
              return;
            }
            const seen = new Set(metas.map((m) => m.id));
            const fresh = batch.filter((m) => !seen.has(m.id));
            if (fresh.length === 0) setDone(true);
            else
              setMetas((prev) => {
                const merged = [...prev, ...fresh];
                return transform ? transform(merged) : merged;
              });
          })
          .catch(() => setDone(true))
          .finally(() => {
            loadingRef.current = false;
          });
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [spec, page, done, metas, transform]);

  return { metas, done, sentinelRef };
}
