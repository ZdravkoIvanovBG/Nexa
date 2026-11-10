import { Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GameRecord } from "@/lib/game-library/types";
import { useT } from "@/lib/i18n";
import { GameArt } from "./game-art";
import { addTile } from "./tier-actions";
import { StatusChip, yearOf } from "./wishlist-parts";

// "Add games": saved games that aren't on the board yet, finished ones first.
// Adding puts a game at the end of Unranked; it leaves this list, so several
// can be added in a row.

export function BoardPicker({
  candidates,
  onClose,
}: {
  candidates: GameRecord[];
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    searchRef.current?.focus();
    return () => {
      if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) {
        returnTo.current.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? candidates.filter((r) => r.name.toLocaleLowerCase().includes(q)) : candidates;
  }, [candidates, query]);

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[230] flex items-center justify-center bg-canvas/80 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-picker-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-in flex max-h-[min(86vh,760px)] w-[min(94vw,600px)] flex-col overflow-hidden rounded-2xl border border-edge-soft bg-elevated shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      >
        <header className="flex flex-col gap-3 border-b border-edge-soft p-5">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2
                id="board-picker-title"
                className="font-display text-[22px] font-medium leading-tight text-ink"
              >
                {t("Add games to your Tier List")}
              </h2>
              <p className="text-[12.5px] text-ink-muted">
                {t("Games you add wait in Unranked until you place them.")}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("Close")}
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-white/[0.07] hover:text-ink"
            >
              <X size={18} strokeWidth={2.2} />
            </button>
          </div>
          <label className="flex h-10 items-center gap-2 rounded-full bg-canvas/50 px-3.5 ring-1 ring-edge-soft">
            <Search size={15} strokeWidth={2.2} className="shrink-0 text-ink-subtle" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search your games")}
              aria-label={t("Search your games")}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-subtle/70"
            />
          </label>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {shown.length === 0 ? (
            <p className="px-3 py-10 text-center text-[13px] text-ink-muted">
              {candidates.length === 0
                ? t("Every game in your library is already on the board.")
                : t("No saved games match “{query}”.", { query: query.trim() })}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((record) => {
                const year = yearOf(record);
                return (
                  <li
                    key={record.gameId}
                    className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <GameArt
                      image={record.image}
                      seed={record.gameId}
                      name={record.name}
                      shape="landscape"
                      className="w-[88px] shrink-0"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {record.name}
                      </span>
                      <span className="flex items-center gap-1.5 text-[12px] text-ink-subtle">
                        {record.status ? (
                          <StatusChip status={record.status} />
                        ) : (
                          <span>{t("Not started")}</span>
                        )}
                        {year && <span className="tabular-nums">{year}</span>}
                        {record.tier === "hidden" && <span>· {t("Removed earlier")}</span>}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => addTile(record.gameId, record.name, t)}
                      aria-label={t("Add {name} to the Tier List", { name: record.name })}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-3.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent/25"
                    >
                      <Plus size={14} strokeWidth={2.4} />
                      {t("Add")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="flex justify-end border-t border-edge-soft px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90"
          >
            {t("Done")}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
