import { Database } from "lucide-react";
import type { GameProvider } from "@/lib/game-discovery/game-id";
import { gamesProviderChoice } from "@/lib/game-discovery/igdb-native";
import { useActiveGameProvider } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { Section, Segmented } from "../shared";

// Which provider Games uses on this device (see provider-choice.ts). IGDB is
// the default; RAWG stays available as a legacy option. The choice is
// device-local and kept out of Settings, cloud sync and backups; switching
// drops every cached Games result of the other provider. Nothing ever
// switches by itself, and saved games keep the provider they were saved from.

const OPTIONS: { value: GameProvider; label: string }[] = [
  { value: "igdb", label: "IGDB (recommended)" },
  { value: "rawg", label: "RAWG (legacy)" },
];

export function ProviderSection() {
  const t = useT();
  const provider = useActiveGameProvider();
  return (
    <Section
      title={t("Game data provider")}
      subtitle={t(
        "Where Games gets its game data on this device. Nexa never switches provider by itself, even when one is unavailable.",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-canvas text-ink-subtle ring-1 ring-edge-soft">
          <Database size={14} />
        </span>
        <Segmented
          value={provider}
          options={OPTIONS}
          onChange={(p) => gamesProviderChoice.set(p)}
        />
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        {provider === "igdb"
          ? t(
              "Games uses IGDB with the Twitch credentials above. Games you save are added to your Wishlist under their IGDB ids. Games you saved from RAWG stay exactly as they are and open from their saved details.",
            )
          : t(
              "Legacy: Games uses RAWG with the RAWG API key below. RAWG has been unreliable recently. Games you save are added under their RAWG ids, and games you saved from IGDB stay exactly as they are.",
            )}
      </p>
    </Section>
  );
}
