import { IgdbSection } from "./games/igdb-section";
import { RawgSection } from "./games/rawg-section";

// Settings → Games. One section per integration; launcher settings slot in here later.
export function GamesPanel() {
  // RAWG stays the active Games provider; the IGDB section only manages
  // device-local credentials for the upcoming IGDB provider.
  return (
    <>
      <RawgSection />
      <IgdbSection />
    </>
  );
}
