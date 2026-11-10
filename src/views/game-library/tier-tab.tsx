import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { boardCandidates, tierBoard, type BoardTile } from "@/lib/game-library/rules";
import { snapshotSummary } from "@/lib/game-library/snapshot";
import { useGameLibrary } from "@/lib/game-library/store";
import type { GameLibraryData } from "@/lib/game-library/types";
import { ALL_TIERS, type Tier } from "@/lib/tracking-tiers";
import { useProfiles } from "@/lib/profiles";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useActionMenu } from "./action-menu";
import { BoardPicker } from "./board-picker";
import { TierListEmpty } from "./empty-states";
import { onTierRequest, requestTab, takeTierRequest } from "./tab";
import { dropTile, focusTile } from "./tier-actions";
import { BOARD_HINT_ID, GameTierRow, GameTierTile, tileMenu } from "./tier-row";
import { useBoardDrag, type BoardDrop } from "./use-board-drag";
import { announce, onAnnounce } from "./wishlist-actions";

const HIGHLIGHT_MS = 2200;

export function TierTab() {
  const t = useT();
  const { data, ready } = useGameLibrary();
  const { activeId } = useProfiles();
  const [message, setMessage] = useState("");
  useEffect(() => onAnnounce(setMessage), []);

  return (
    <section aria-label={t("Tier List")} className="flex flex-col gap-5">
      <p id={BOARD_HINT_ID} className="sr-only">
        {t(
          "Drag a game to rank it. With the keyboard, press Space to pick a game up, move it with the arrow keys, left and right within a tier and up and down between tiers, then press Space, Enter or Escape to put it down. Enter opens the game.",
        )}
      </p>
      <p aria-live="polite" className="sr-only">
        {message}
      </p>
      {!ready || !activeId ? (
        <BoardSkeleton />
      ) : (
        // Keyed by profile, so a drag or a picked-up tile never carries over.
        <TierContent key={activeId} data={data} />
      )}
    </section>
  );
}

function TierContent({ data }: { data: GameLibraryData }) {
  const t = useT();
  const { openGame } = useView();
  const board = useMemo(() => tierBoard(data), [data]);
  const candidates = useMemo(() => boardCandidates(data), [data]);
  const menu = useActionMenu();
  const [picker, setPicker] = useState(false);
  const [lifted, setLifted] = useState<string | null>(null);
  // A "Rank it" or "View in Tier List" made before the tab opened.
  const [highlight, setHighlight] = useState<string | null>(takeTierRequest);

  const onDrop = useCallback(
    ({ gameId, tier, slot }: BoardDrop) => {
      dropTile(gameId, tier, slot, t);
    },
    [t],
  );
  const drag = useBoardDrag(onDrop);

  useEffect(() => onTierRequest(setHighlight), []);

  // Brings the requested tile into view and focus, then lets the ring fade.
  useEffect(() => {
    if (!highlight) return;
    const scroll = window.setTimeout(() => {
      const handle = document.querySelector<HTMLElement>(
        `[data-tile-handle="${CSS.escape(highlight)}"]`,
      );
      handle?.scrollIntoView({ block: "center", behavior: "smooth" });
      handle?.focus({ preventScroll: true });
    }, 0);
    const fade = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(fade);
    };
  }, [highlight]);

  const lift = (tile: BoardTile, next: boolean) => {
    setLifted(next ? tile.record.gameId : null);
    announce(
      next
        ? t("Picked up {name}", { name: tile.record.name })
        : t("Put down {name}", { name: tile.record.name }),
    );
    if (next) focusTile(tile.record.gameId);
  };

  const total = ALL_TIERS.reduce((sum, tier) => sum + board[tier].length, 0);
  const ranked = total - board.unranked.length;

  if (total === 0) {
    return (
      <>
        <TierListEmpty
          onOpenPlaying={() => requestTab("playing")}
          onAddGames={candidates.length > 0 ? () => setPicker(true) : null}
        />
        {picker && <BoardPicker candidates={candidates} onClose={() => setPicker(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          <span className="font-semibold tabular-nums text-ink">
            {ranked === 1 ? t("1 game ranked") : t("{n} games ranked", { n: ranked })}
          </span>
          {board.unranked.length > 0 && (
            <span className="text-ink-subtle">
              {" · "}
              {t("{n} in Unranked", { n: board.unranked.length })}
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <span className="hidden text-[12px] text-ink-subtle md:inline">
            {t("Drag games into tiers, or use the ⋯ menu.")}
          </span>
          <button
            type="button"
            onClick={() => setPicker(true)}
            disabled={candidates.length === 0}
            title={
              candidates.length === 0
                ? t("Every game in your library is already on the board.")
                : undefined
            }
            className="flex h-10 items-center gap-2 rounded-full border border-edge px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus size={15} strokeWidth={2.3} />
            {t("Add games")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {ALL_TIERS.map((tier: Tier) => {
          const tiles = board[tier];
          return (
            <GameTierRow key={tier} tier={tier} tiles={tiles}>
              {tiles.map((tile, index) => {
                const { gameId } = tile.record;
                const openDetails = () => openGame(snapshotSummary(tile.record));
                const items = () => tileMenu(t, data, tile, tier, openDetails);
                return (
                  <GameTierTile
                    key={gameId}
                    tile={tile}
                    tier={tier}
                    index={index}
                    count={tiles.length}
                    lifted={lifted === gameId}
                    highlighted={highlight === gameId}
                    onLift={(next) => lift(tile, next)}
                    onPointerDown={(e) => drag.start(gameId, e)}
                    onClick={() => {
                      if (!drag.consumeClick()) openDetails();
                    }}
                    onMenu={(target) => {
                      if (target instanceof HTMLElement) menu.openFromButton(target, items());
                      else menu.openAtPointer(target, items());
                    }}
                  />
                );
              })}
            </GameTierRow>
          );
        })}
      </div>

      {picker && <BoardPicker candidates={candidates} onClose={() => setPicker(false)} />}
      {menu.element}
    </>
  );
}

function BoardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex h-[118px] animate-pulse overflow-hidden rounded-xl ring-1 ring-edge-soft"
          style={{ opacity: 1 - row * 0.25 }}
        >
          <span className="w-[76px] bg-white/[0.06]" />
          <span className="flex-1 bg-surface/40" />
        </div>
      ))}
    </div>
  );
}
