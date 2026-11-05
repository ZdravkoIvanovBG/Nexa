import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BackToTop } from "@/components/back-to-top";
import { ScrollRootContext } from "@/components/row";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import { useGamesGate, type GamesGate } from "@/lib/game-discovery/use-games-gate";
import { useSettings } from "@/lib/settings";
import { useScrollMemory } from "@/lib/view";
import { GamesConfigState } from "./games-state";
import { GamesAttribution } from "./rawg-attribution";

/**
 * Shared shell for every Games view: owns the scroll container, scroll memory,
 * the active provider's request gate and the attribution footer. When the gate
 * is closed it renders the configuration state and nothing that could issue a
 * request.
 */
export function GamesFrame({
  scrollKey,
  active,
  closed,
  children,
}: {
  scrollKey: string;
  active: boolean;
  /**
   * Shown above the configuration state while the gate is closed: saved data
   * only (a game's library snapshot), never anything that sends a request.
   */
  closed?: ReactNode;
  children: (gate: GamesGate) => ReactNode;
}) {
  const gate = useGamesGate();
  const { settings, update } = useSettings();
  const scrollRef = useRef<HTMLElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useScrollMemory(scrollKey, scrollRef, active);

  const scrollCb = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  // A key RAWG rejected mid-session loses its verification, so later sessions
  // don't retry a dead key. Only if the stored key is still the rejected one.
  const { rawgKeyVerifiedFor } = settings;
  const rawg = gate.rawg;
  useEffect(() => {
    if (gate.provider !== "rawg" || rawg.config !== "rejected") return;
    if (rawgKeyVerifiedFor !== rawg.fingerprint) return;
    if (!rawgSessionStatus.isRejected(rawg.fingerprint)) return;
    update({ rawgKeyVerifiedFor: "" });
  }, [gate.provider, rawg.config, rawg.fingerprint, rawgKeyVerifiedFor, update]);

  return (
    <main ref={scrollCb} className="relative h-full overflow-y-auto bg-canvas">
      <ScrollRootContext.Provider value={scrollEl}>
        {gate.ready ? (
          // Keyed by provider and scope: switching provider or credentials
          // remounts the page, so no view state from the old one carries over.
          <Fragment key={`${gate.provider}:${gate.scope}`}>{children(gate)}</Fragment>
        ) : (
          <>
            {closed}
            <div className={`px-5 pb-10 sm:px-8 lg:px-12 ${closed ? "pt-10" : "pt-28"}`}>
              <GamesConfigState state={gate.config === "ready" ? "unverified" : gate.config} />
            </div>
          </>
        )}
        <footer className="px-5 pb-24 pt-6 sm:px-8 lg:px-12">
          <GamesAttribution provider={gate.provider} />
        </footer>
        <BackToTop scrollRef={scrollRef} />
      </ScrollRootContext.Provider>
    </main>
  );
}
