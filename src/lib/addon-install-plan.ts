// Pure addon-install rules: manifest URL parsing and which installed row an
// install replaces. Dependency-free so node --test can exercise it; the
// addon store re-exports parseAddonUrl and applies planAddonInstall.

export type AddonUrlParse = { kind: "ok"; url: string } | { kind: "error"; message: string };

/** Matches the user_addons.addon_url length constraint. */
export const MAX_ADDON_URL_LENGTH = 2000;

export function parseAddonUrl(input: string): AddonUrlParse {
  let raw = input.trim();
  if (!raw) return { kind: "error", message: "Paste a manifest URL or stremio:// link." };
  if (raw.startsWith("stremio://")) raw = "https://" + raw.slice("stremio://".length);
  raw = raw.replace(/\/#\/configure\/?$/, "");
  raw = raw.replace(/\/configure\/?$/, "");
  raw = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) {
    return { kind: "error", message: "URL must start with https:// or stremio://" };
  }
  if (!/manifest\.json(\?.*)?$/i.test(raw)) {
    raw = raw + "/manifest.json";
  }
  try {
    new URL(raw);
  } catch {
    return { kind: "error", message: "That doesn't look like a valid URL." };
  }
  // Mirrors the user_addons.addon_url check constraint. Comet and AIOStreams
  // bake a base64 config blob into the path; past ~2704 bytes the server's btree
  // index rejects the row, which would surface as a non-auth failure and retry
  // forever. Fail here, where the message can actually say what is wrong.
  if (raw.length > MAX_ADDON_URL_LENGTH) {
    return {
      kind: "error",
      message: `That manifest URL is too long (${raw.length} characters, limit ${MAX_ADDON_URL_LENGTH}). Reconfigure the addon with fewer options.`,
    };
  }
  return { kind: "ok", url: raw };
}

/** The fields of an installed row the plan reads. */
export type PlannableAddon = {
  id: string;
  transportUrl: string;
  installedAt?: number;
  enabled?: boolean;
  order?: number;
};

type OrderedRow = { transportUrl: string; enabled?: boolean; order?: number };

const byOrder = <T extends OrderedRow>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/**
 * Every installed row, disabled ones included, in display order. This is what
 * the Addons screens list: turning an addon off hides its catalogs and streams,
 * it does not uninstall it.
 */
export function managedAddonRows<T extends OrderedRow>(rows: readonly T[]): T[] {
  return byOrder(rows);
}

/** The enabled rows in display order: what catalogs, streams and subtitles query. */
export function enabledAddonRows<T extends OrderedRow>(rows: readonly T[]): T[] {
  return byOrder(rows.filter((a) => a.enabled !== false));
}

/**
 * Turns one installed row on or off. Only the row with that URL changes, and
 * its updatedAt moves so the change outranks an older copy when the cloud is
 * merged back in at the next launch. Returns null when nothing would change.
 */
export function withAddonEnabled<T extends OrderedRow & { updatedAt?: number }>(
  rows: readonly T[],
  transportUrl: string,
  enabled: boolean,
  now: number,
): T[] | null {
  let changed = false;
  const next = rows.map((a) => {
    if (a.transportUrl !== transportUrl || (a.enabled !== false) === enabled) return a;
    changed = true;
    return { ...a, enabled, updatedAt: now };
  });
  return changed ? next : null;
}

/** On a cloud merge, the local copy of an addon wins only when it changed later. */
export function localAddonIsNewer(
  mine: { updatedAt?: number },
  remote: { updatedAt?: number },
): boolean {
  return (mine.updatedAt ?? 0) > (remote.updatedAt ?? 0);
}

export type InstallPlanOptions = {
  /**
   * The installed row this install reconfigures (e.g. "Reconfigure" on that
   * addon). Replaced even when other rows share its manifest id.
   */
  replaceTransportUrl?: string;
  /** A different-id addon this one supersedes (the install modal's hostname match). */
  replaceId?: string;
};

export type InstallPlan<T extends PlannableAddon> = {
  /** Rows that stay installed, in their original order. */
  keep: T[];
  /** The row whose place, state and install date the new one takes over. */
  previous: T | undefined;
  /** True when an installed row was actually replaced. */
  replaced: boolean;
};

/**
 * Which installed rows an install of `url` (manifest id `id`) replaces.
 *
 * A new configuration of an installed addon replaces that installation
 * instead of being added beside it: the explicit target when given, else a row
 * with the same URL, else the first row (by order) with the same manifest id.
 * Only that one row (plus any row with the identical new URL, which cannot
 * coexist with it) is removed; other rows sharing the id, i.e. duplicates that
 * already existed, are left alone.
 */
export function planAddonInstall<T extends PlannableAddon>(
  before: readonly T[],
  url: string,
  id: string,
  options: InstallPlanOptions = {},
): InstallPlan<T> {
  const replaceId = options.replaceId && options.replaceId !== id ? options.replaceId : null;
  const explicit = options.replaceTransportUrl
    ? before.find((a) => a.transportUrl === options.replaceTransportUrl)
    : undefined;
  const sameUrl = before.find((a) => a.transportUrl === url);
  const byOldId = replaceId ? before.find((a) => a.id === replaceId) : undefined;
  const firstSameId = before
    .filter((a) => a.id === id)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))[0];
  const previous = explicit ?? sameUrl ?? byOldId ?? firstSameId;

  const removed = new Set<T>();
  if (previous) removed.add(previous);
  for (const a of before) {
    if (a.transportUrl === url) removed.add(a);
    // The hostname-match replacement supersedes every row of the old id.
    if (replaceId && a.id === replaceId) removed.add(a);
  }
  const keep = before.filter((a) => !removed.has(a));
  return { keep, previous, replaced: removed.size > 0 };
}
