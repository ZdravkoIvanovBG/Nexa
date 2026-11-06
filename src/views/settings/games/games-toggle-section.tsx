import { canToggleGames, gamesToggleAllowed } from "@/lib/game-discovery/gates";
import { rawgSessionStatus } from "@/lib/game-discovery/status";
import { useGamesGate } from "@/lib/game-discovery/use-games-gate";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { ExtLink, Section, ToggleRow } from "../shared";

// The Games on/off preference (synced with Settings, off by default). Turning
// it on needs the *active* provider ready: verified IGDB credentials on this
// device, or a verified RAWG key while RAWG legacy is chosen. Turning it off is
// always allowed and keeps credentials, keys and saved games.
export function GamesToggleSection() {
  const t = useT();
  const { settings, update } = useSettings();
  const games = useGamesGate();
  const igdbActive = games.provider === "igdb";

  const toggleLocked = igdbActive
    ? !gamesToggleAllowed(settings.gamesEnabled, games.ready)
    : !canToggleGames(
        {
          gamesEnabled: settings.gamesEnabled,
          rawgApiKey: settings.rawgApiKey,
          rawgKeyVerifiedFor: settings.rawgKeyVerifiedFor,
        },
        rawgSessionStatus.isRejected,
      );

  return (
    <Section title={t("Games")}>
      <ToggleRow
        label={t("Enable Games")}
        sub={t(
          "Adds Games to the sidebar and a Game Library to My Library. Turning it off hides them and keeps your credentials and saved games.",
        )}
        value={settings.gamesEnabled}
        onChange={(v) => update({ gamesEnabled: v })}
        lockReason={
          toggleLocked
            ? igdbActive
              ? t("Verify your IGDB credentials first")
              : t("Verify a RAWG API key first")
            : undefined
        }
      />
      <p className="text-[12px] leading-relaxed text-ink-subtle">
        {t("Game data and images are provided by")}{" "}
        {igdbActive ? (
          <ExtLink href="https://www.igdb.com/">IGDB.com</ExtLink>
        ) : (
          <ExtLink href="https://rawg.io/">RAWG</ExtLink>
        )}
        .
      </p>
    </Section>
  );
}
