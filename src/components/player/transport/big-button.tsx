import { Tooltip } from "./tooltip";
import { usePlayerSize } from "@/views/player/player-size";

export function BigButton({
  children,
  onClick,
  ariaLabel,
  tooltip,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  ariaLabel: string;
  tooltip?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const { compact, tight } = usePlayerSize();
  const sizeClass = tight ? "h-9 w-9" : compact ? "h-10 w-10" : "h-12 w-12";
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full transition-[background-color,color,opacity] ${
        disabled
          ? "cursor-not-allowed text-white/30"
          : active
            ? "bg-white/22 text-white hover:bg-white/30"
            : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
  if (!tooltip) return btn;
  return <Tooltip label={tooltip}>{btn}</Tooltip>;
}
