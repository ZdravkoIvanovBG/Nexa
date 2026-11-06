import { useActiveGameProvider } from "@/lib/game-discovery/use-games-gate";
import { useSettings } from "@/lib/settings";
import { GamesToggleSection } from "./games/games-toggle-section";
import { IgdbSection } from "./games/igdb-section";
import { LibrarySyncSection } from "./games/library-sync-section";
import { ProviderSection } from "./games/provider-section";
import { RawgSection } from "./games/rawg-section";

// Settings → Games. IGDB is the provider unless this device has chosen RAWG
// legacy (see lib/game-discovery/provider-choice.ts). The RAWG key section is
// shown only while RAWG is chosen or a key is still stored, so it can always
// be removed. Launcher settings slot in here later.
export function GamesPanel() {
  const provider = useActiveGameProvider();
  const { settings } = useSettings();
  const showRawg = provider === "rawg" || settings.rawgApiKey.trim() !== "";
  return (
    <>
      <IgdbSection />
      <GamesToggleSection />
      <LibrarySyncSection />
      <ProviderSection />
      {showRawg && <RawgSection />}
    </>
  );
}
