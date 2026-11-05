import { FlaskConical } from "lucide-react";
import type { GameProvider } from "@/lib/game-discovery/game-id";
import { devGamesProvider } from "@/lib/game-discovery/igdb-native";
import { useActiveGameProvider } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { Section, Segmented } from "../shared";

// Development builds only (IGDB Stage 4): which provider Games Discovery uses
// on this device. Production builds never render this and always use RAWG.
// The choice is device-local and kept out of Settings, cloud sync and backups;
// switching drops every cached Games result of the other provider.

const OPTIONS: { value: GameProvider; label: string }[] = [
  { value: "rawg", label: "RAWG" },
  { value: "igdb", label: "IGDB" },
];

export function DevProviderSection() {
  const t = useT();
  const provider = useActiveGameProvider();
  if (!devGamesProvider.switchable) return null;
  return (
    <Section
      title={t("Games data provider (development)")}
      subtitle={t(
        "Development builds only. Chooses where Games Discovery gets its data on this device. Production builds always use RAWG.",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-canvas text-ink-subtle ring-1 ring-edge-soft">
          <FlaskConical size={14} />
        </span>
        <Segmented value={provider} options={OPTIONS} onChange={(p) => devGamesProvider.set(p)} />
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        {provider === "igdb"
          ? t(
              "Games uses IGDB with the credentials saved below. RAWG lists aren't mixed in. Games you save from IGDB are added to your Wishlist under their IGDB ids, and your saved RAWG games are unchanged.",
            )
          : t("Games uses RAWG, exactly as in production builds.")}
      </p>
    </Section>
  );
}
