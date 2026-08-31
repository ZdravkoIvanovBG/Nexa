import type { SimklIds, SimklTarget } from "./types";

export type IdResolution =
  | { ok: true; target: SimklTarget }
  | { ok: false; reason: "unrecognized" };

export function simklTargetIds(target: SimklTarget): SimklIds {
  if (target.kind === "episode") return target.show.ids;
  return target.ids;
}

export async function resolveSimklTarget(
  harborId: string,
  type: "movie" | "series",
): Promise<SimklTarget | null> {
  const resolution = stremioIdToSimklTarget(harborId);
  let tgt: SimklTarget | null = resolution.ok ? resolution.target : null;
  if (!tgt) return null;
  if (type === "series" && tgt.kind === "movie") tgt = { kind: "show", ids: tgt.ids };
  if (type === "movie" && tgt.kind === "show") tgt = { kind: "movie", ids: tgt.ids };
  return tgt;
}

export function stremioIdToSimklTarget(
  metaId: string,
  episode?: { season: number; episode: number },
): IdResolution {
  if (!metaId) return { ok: false, reason: "unrecognized" };

  if (metaId.startsWith("mal:")) {
    const n = Number(metaId.split(":")[1]);
    if (!Number.isFinite(n) || episode) return { ok: false, reason: "unrecognized" };
    return { ok: true, target: { kind: "show", ids: { mal: n } } };
  }

  if (metaId.startsWith("tt")) {
    const parts = metaId.split(":");
    const imdb = parts[0];
    if (!/^tt\d+$/.test(imdb)) return { ok: false, reason: "unrecognized" };

    if (parts.length >= 3) {
      const season = Number(parts[1]);
      const number = Number(parts[2]);
      if (!Number.isFinite(season) || !Number.isFinite(number)) {
        return { ok: false, reason: "unrecognized" };
      }
      return {
        ok: true,
        target: { kind: "episode", show: { ids: { imdb } }, season, number },
      };
    }

    if (episode) {
      return {
        ok: true,
        target: {
          kind: "episode",
          show: { ids: { imdb } },
          season: episode.season,
          number: episode.episode,
        },
      };
    }

    return { ok: true, target: { kind: "movie", ids: { imdb } } };
  }

  if (metaId.startsWith("tmdb:")) {
    const parts = metaId.split(":");
    const kind = parts[1];
    const id = Number(parts[2]);
    if (!Number.isFinite(id)) return { ok: false, reason: "unrecognized" };

    if (kind === "movie") {
      return { ok: true, target: { kind: "movie", ids: { tmdb: id } } };
    }
    if (kind === "tv") {
      if (parts.length >= 5) {
        const season = Number(parts[3]);
        const number = Number(parts[4]);
        if (Number.isFinite(season) && Number.isFinite(number)) {
          return {
            ok: true,
            target: { kind: "episode", show: { ids: { tmdb: id } }, season, number },
          };
        }
      }
      if (episode) {
        return {
          ok: true,
          target: {
            kind: "episode",
            show: { ids: { tmdb: id } },
            season: episode.season,
            number: episode.episode,
          },
        };
      }
      return { ok: true, target: { kind: "show", ids: { tmdb: id } } };
    }
    return { ok: false, reason: "unrecognized" };
  }

  return { ok: false, reason: "unrecognized" };
}
