import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BackToTop } from "@/components/back-to-top";
import { ScrollRootContext } from "@/components/row";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import { useRawgGate, type RawgGateState } from "@/lib/game-discovery/use-rawg";
import { useSettings } from "@/lib/settings";
import { useScrollMemory } from "@/lib/view";
import { GamesConfigState } from "./games-state";
import { RawgAttribution } from "./rawg-attribution";

/**
 * Shared shell for every Games view: owns the scroll container, scroll memory,
 * the RAWG request gate and the attribution footer RAWG's terms require. When
 * the gate is closed it renders the configuration state and nothing that could
 * issue a request.
 */
export function GamesFrame({
  scrollKey,
  active,
  children,
}: {
  scrollKey: string;
  active: boolean;
  children: (gate: RawgGateState) => ReactNode;
}) {
  const gate = useRawgGate();
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
  useEffect(() => {
    if (gate.config !== "rejected") return;
    if (rawgKeyVerifiedFor !== gate.fingerprint) return;
    if (!rawgSessionStatus.isRejected(gate.fingerprint)) return;
    update({ rawgKeyVerifiedFor: "" });
  }, [gate.config, gate.fingerprint, rawgKeyVerifiedFor, update]);

  return (
    <main ref={scrollCb} className="relative h-full overflow-y-auto bg-canvas">
      <ScrollRootContext.Provider value={scrollEl}>
        {gate.ready ? (
          children(gate)
        ) : (
          <div className="px-5 pb-10 pt-28 sm:px-8 lg:px-12">
            <GamesConfigState state={gate.config === "ready" ? "unverified" : gate.config} />
          </div>
        )}
        <footer className="px-5 pb-24 pt-6 sm:px-8 lg:px-12">
          <RawgAttribution />
        </footer>
        <BackToTop scrollRef={scrollRef} />
      </ScrollRootContext.Provider>
    </main>
  );
}
