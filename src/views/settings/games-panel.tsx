import { DevProviderSection } from "./games/dev-provider-section";
import { IgdbSection } from "./games/igdb-section";
import { RawgSection } from "./games/rawg-section";

// Settings → Games. One section per integration; launcher settings slot in here later.
export function GamesPanel() {
  // RAWG is the Games provider in production. Development builds can switch
  // Discovery to IGDB (Stage 4); the IGDB section manages device-local credentials.
  return (
    <>
      {import.meta.env.DEV && <DevProviderSection />}
      <RawgSection />
      <IgdbSection />
    </>
  );
}
