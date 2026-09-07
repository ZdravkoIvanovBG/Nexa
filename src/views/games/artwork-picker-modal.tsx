import { ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { useGames } from "@/lib/games/provider";
import * as api from "@/lib/games/api";
import type { ArtworkCandidate, ArtworkKind, GamePlatform } from "@/lib/games/types";

const KINDS: Array<{ key: ArtworkKind; label: string }> = [
  { key: "cover", label: "Cover" },
  { key: "hero", label: "Hero banner" },
  { key: "logo", label: "Logo" },
];

async function pickImageFile() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    multiple: false,
    directory: false,
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
}

export function ArtworkPickerModal({
  gameId,
  gameTitle,
  platform,
  externalId,
  onClose,
}: {
  gameId: string;
  gameTitle: string;
  platform: GamePlatform;
  externalId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { refresh } = useGames();
  const [kind, setKind] = useState<ArtworkKind>("cover");
  const [allCandidates, setAllCandidates] = useState<ArtworkCandidate[]>([]);
  const [searching, setSearching] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSearching(true);
    api
      .gamesArtworkSearch(gameTitle, platform, externalId, settings.steamgriddbApiKey || undefined)
      .then((list) => {
        if (!alive) return;
        setAllCandidates(list);
        setError(null);
      })
      .catch((e) => {
        // A rejected SteamGridDB key looks exactly like "this game has no
        // artwork" unless the reason is shown.
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameTitle, platform, externalId, settings.steamgriddbApiKey]);

  const candidates = useMemo(
    () => allCandidates.filter((c) => c.kind === kind),
    [allCandidates, kind],
  );

  const apply = async (url: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.gamesArtworkFetch(gameId, kind, url);
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    const picked = await pickImageFile();
    if (typeof picked !== "string") return;
    setBusy(true);
    setError(null);
    try {
      await api.gamesArtworkUpload(gameId, kind, picked);
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-tv-focus-scope
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-black/60 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-elevated p-7 ring-1 ring-edge-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold leading-tight text-ink">
            {t("Change Artwork")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-tv-modal-close
            aria-label={t("Close")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-canvas/40 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1 rounded-full bg-canvas/40 p-0.5 ring-1 ring-edge-soft/60">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              data-tv-initial-focus={k.key === "cover" ? true : undefined}
              onClick={() => setKind(k.key)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                kind === k.key
                  ? "bg-ink text-canvas"
                  : "text-ink-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {t(k.label)}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[120px] flex-1 overflow-y-auto">
          {searching ? (
            <div className="flex items-center justify-center py-10 text-ink-subtle">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-subtle">
              {settings.steamgriddbApiKey
                ? t("No online matches found. Upload your own image instead.")
                : t(
                    "No online matches found. Add a SteamGridDB API key in Settings › Games to search for artwork, or upload your own image.",
                  )}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {candidates.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => void apply(c.url)}
                  disabled={busy}
                  className="overflow-hidden rounded-lg ring-1 ring-edge-soft transition-transform hover:scale-[1.02] disabled:opacity-50"
                >
                  <img src={c.url} alt="" className="aspect-[2/3] w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-[12.5px] text-red-400">{error}</p>}

        <button
          type="button"
          onClick={() => void upload()}
          disabled={busy}
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-canvas text-[13.5px] font-semibold text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised disabled:opacity-50"
        >
          <ImagePlus size={15} />
          {t("Upload from file")}
        </button>
      </div>
    </div>
  );
}
