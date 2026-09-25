import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { DEFAULT_PLAYER_SIZE, tiersFor, type PlayerSize } from "@/lib/player/size-tiers";

export { tiersFor, type PlayerSize };

const PlayerSizeContext = createContext<PlayerSize>(DEFAULT_PLAYER_SIZE);

export function usePlayerSize(): PlayerSize {
  return useContext(PlayerSizeContext);
}

/**
 * Measures the player stage once and shares the result with every overlay, so
 * the transport, the Up Next tab and the HUD pills all agree on how much room
 * they have instead of each guessing with hardcoded offsets.
 */
export function PlayerSizeProvider({
  stageRef,
  value,
  children,
}: {
  stageRef?: RefObject<HTMLElement | null>;
  /** Supply the tiers directly instead of measuring (used by the layout editor preview). */
  value?: PlayerSize;
  children: ReactNode;
}) {
  const [size, setSize] = useState<PlayerSize>(DEFAULT_PLAYER_SIZE);

  useEffect(() => {
    const el = stageRef?.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === r.width && prev.height === r.height ? prev : tiersFor(r.width, r.height),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef]);

  return <PlayerSizeContext.Provider value={value ?? size}>{children}</PlayerSizeContext.Provider>;
}

/**
 * Publishes the height of a transport bar as `--harbor-transport-h` on the
 * player stage, so floating HUD elements (Up Next card, skip pill, warnings)
 * can sit above the controls without hardcoding an offset that drifts whenever
 * the control sizes change.
 */
export function useTransportHeightVar(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const stage = el.closest<HTMLElement>("[data-harbor-player]");
    if (!stage) return;
    const apply = () => {
      stage.style.setProperty("--harbor-transport-h", `${Math.round(el.offsetHeight)}px`);
    };
    apply();
    if (typeof ResizeObserver === "undefined")
      return () => stage.style.removeProperty("--harbor-transport-h");
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      stage.style.removeProperty("--harbor-transport-h");
    };
  }, [ref, enabled]);
}

/**
 * Bottom offsets for floating HUD elements, expressed against the transport bar
 * height published by `useTransportHeightVar` instead of a hardcoded number
 * that drifts whenever the control sizes change. The fallback (11rem = 176px)
 * matches the old `bottom-44`.
 */
/** Sits directly above the controls. */
export const HUD_ABOVE_CONTROLS = "bottom-[calc(var(--harbor-transport-h,11rem)+0.5rem)]";
/** Sits one button-row higher, clearing anything using HUD_ABOVE_CONTROLS. */
export const HUD_ABOVE_CONTROLS_STACKED = "bottom-[calc(var(--harbor-transport-h,11rem)+3.5rem)]";
/** Resting position for a HUD element that slides up into the stacked slot. */
export const HUD_ABOVE_CONTROLS_STACKED_HIDDEN =
  "bottom-[calc(var(--harbor-transport-h,11rem)+3rem)]";
