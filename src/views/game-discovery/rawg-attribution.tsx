import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";

// RAWG's terms require an active hyperlink to RAWG on every page that shows its data.
export function RawgAttribution({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <p className={`text-[12px] leading-relaxed text-ink-subtle ${className}`}>
      {t("Game data and images provided by")}{" "}
      <button
        onClick={() => openUrl("https://rawg.io/")}
        className="inline-flex items-center gap-1 font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        RAWG <ExternalLink size={11} />
      </button>
    </p>
  );
}
