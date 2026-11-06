import { ExternalLink } from "lucide-react";
import type { GameProvider } from "@/lib/game-discovery/game-id";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";

const SOURCES: Record<GameProvider, { name: string; url: string }> = {
  rawg: { name: "RAWG", url: "https://rawg.io/" },
  igdb: { name: "IGDB.com", url: "https://www.igdb.com/" },
};

// RAWG's terms require an active hyperlink to RAWG on every page that shows its
// data; IGDB data is credited the same way. IGDB's FAQ asks for fair attribution
// "to IGDB.com" that is "visible to your users and located in a static location",
// which this footer is: it sits on every Games and Game Library page. It also
// makes the active provider plain.
export function GamesAttribution({
  provider,
  className = "",
}: {
  provider: GameProvider;
  className?: string;
}) {
  const t = useT();
  const source = SOURCES[provider];
  return (
    <p className={`text-[12px] leading-relaxed text-ink-subtle ${className}`}>
      {t("Game data and images provided by")}{" "}
      <button
        onClick={() => openUrl(source.url)}
        className="inline-flex items-center gap-1 font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        {source.name} <ExternalLink size={11} />
      </button>
    </p>
  );
}

export function RawgAttribution({ className = "" }: { className?: string }) {
  return <GamesAttribution provider="rawg" className={className} />;
}
