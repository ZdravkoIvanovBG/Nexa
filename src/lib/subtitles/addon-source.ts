import type { Addon } from "@/lib/addons";
import { installedAddonsResolved } from "@/lib/addon-store";
import { dlog } from "@/lib/debug";
import { SUBTITLE_PROVIDER_TIMEOUT_MS, withSubtitleTimeout } from "./autoload";

function hasSubtitleResource(a: Addon): boolean {
  const resources = a.manifest?.resources ?? [];
  const hasSubtitles = resources.some((r) =>
    typeof r === "string" ? r === "subtitles" : r.name === "subtitles",
  );

  if (!hasSubtitles) {
    dlog(
      `[addon-source] ${a.manifest.name} does NOT have subtitle resource. Resources: ${JSON.stringify(resources.map((r) => (typeof r === "string" ? r : r.name)))}`,
    );
  }

  return hasSubtitles;
}

export async function gatherSubtitleAddons(): Promise<Addon[]> {
  dlog(`[addon-source] === GATHERING SUBTITLE ADDONS ===`);

  const merged = await withSubtitleTimeout(
    installedAddonsResolved(),
    SUBTITLE_PROVIDER_TIMEOUT_MS,
    [] as Addon[],
  );
  dlog(`[addon-source] Total merged addons (before subtitle filter): ${merged.length}`);

  // Check each addon for subtitle resource
  const withSubtitles = merged.filter(hasSubtitleResource);
  dlog(`[addon-source] === RESULT: ${withSubtitles.length} addons with subtitle resource ===`);
  if (withSubtitles.length > 0) {
    dlog(
      `[addon-source] Subtitle addon names: ${withSubtitles.map((a) => a.manifest.name).join(", ")}`,
    );
  }

  return withSubtitles;
}
