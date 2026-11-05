import { LayoutGrid, LayoutList, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { providerFeatures } from "@/lib/game-discovery/provider";
import { useActiveGameProvider } from "@/lib/game-discovery/use-active-provider";
import { wishlistView } from "@/lib/game-library/rules";
import { useGameLibrary } from "@/lib/game-library/store";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { WishlistEmpty } from "./empty-states";
import { onAnnounce } from "./wishlist-actions";
import { WishlistGallery } from "./wishlist-gallery";
import { WishlistList } from "./wishlist-list";
import { HANDLE_HINT_ID } from "./wishlist-parts";

type WishlistMode = "list" | "gallery";

// Both are this device's own view of the queue, so neither is synced.
const MODE_KEY = "harbor.gamelibrary.wishlist.view";
const EXPANDED_KEY = "harbor.gamelibrary.wishlist.expanded";
const MAX_EXPANDED = 100;

function readMode(): WishlistMode {
  try {
    return localStorage.getItem(MODE_KEY) === "gallery" ? "gallery" : "list";
  } catch {
    return "list";
  }
}

function readExpanded(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/** Opens Discovery search, the one place games are found. It may need RAWG. */
export function useOpenGameSearch(): () => void {
  const { openGameBrowse } = useView();
  return useCallback(
    () => openGameBrowse({ title: "Search games", filter: {}, focusSearch: true }),
    [openGameBrowse],
  );
}

export function WishlistTab({ active }: { active: boolean }) {
  const t = useT();
  const { data, ready } = useGameLibrary();
  const items = useMemo(() => wishlistView(data), [data]);
  const [mode, setMode] = useState<WishlistMode>(readMode);
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const openSearch = useOpenGameSearch();
  // The same card shape as Discovery: landscape on RAWG, 3:4 covers on IGDB.
  const shape = providerFeatures(useActiveGameProvider()).cards;

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {}
  }, [mode]);

  useEffect(() => onAnnounce(setMessage), []);

  const toggle = useCallback((entryId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next].slice(-MAX_EXPANDED)));
      } catch {}
      return next;
    });
  }, []);

  const games = items.filter((i) => i.kind === "game").length;
  const collections = items.length - games;

  return (
    <section aria-label={t("Wishlist")} className="flex flex-col gap-5">
      <p id={HANDLE_HINT_ID} className="sr-only">
        {t(
          "Drag to reorder, or use the up and down arrow keys. Home and End move to the top or bottom.",
        )}
      </p>
      <p aria-live="polite" className="sr-only">
        {message}
      </p>

      {!ready ? (
        <WishlistSkeleton />
      ) : items.length === 0 ? (
        <WishlistEmpty onSearch={openSearch} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">
              <span className="font-semibold tabular-nums text-ink">
                {items.length === 1
                  ? t("1 entry in your queue")
                  : t("{n} entries in your queue", { n: items.length })}
              </span>
              {collections > 0 && (
                <span className="text-ink-subtle">
                  {" · "}
                  {games === 1 ? t("1 game") : t("{n} games", { n: games })}
                  {", "}
                  {collections === 1 ? t("1 collection") : t("{n} collections", { n: collections })}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label={t("Wishlist view")}
                className="inline-flex items-center gap-1 rounded-full bg-elevated/50 p-1"
              >
                {(
                  [
                    { value: "list", label: t("List"), Icon: LayoutList },
                    { value: "gallery", label: t("Gallery"), Icon: LayoutGrid },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                    className={`flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
                      mode === value ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    <Icon size={14} strokeWidth={2.2} />
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={openSearch}
                className="flex h-10 items-center gap-2 rounded-full border border-edge px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised"
              >
                <Search size={14} strokeWidth={2.2} />
                {t("Find games")}
              </button>
            </div>
          </div>

          {mode === "list" ? (
            <WishlistList items={items} expanded={expanded} onToggle={toggle} shape={shape} />
          ) : (
            <WishlistGallery
              items={items}
              // The sheet is in a portal, so it would stay on screen over other pages.
              sheetId={active ? sheetId : null}
              onOpenSheet={setSheetId}
              shape={shape}
            />
          )}
        </>
      )}
    </section>
  );
}

function WishlistSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2.5">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex h-[100px] animate-pulse items-center gap-4 rounded-2xl bg-surface/50 p-3 ring-1 ring-edge-soft"
          style={{ opacity: 1 - row * 0.25 }}
        >
          <span className="ms-12 h-[76px] w-[136px] rounded-lg bg-white/[0.06]" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-1/3 rounded-full bg-white/[0.07]" />
            <span className="h-2.5 w-1/5 rounded-full bg-white/[0.05]" />
          </span>
        </div>
      ))}
    </div>
  );
}
