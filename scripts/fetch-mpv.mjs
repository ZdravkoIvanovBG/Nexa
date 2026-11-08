/*
 * fetch-mpv.mjs
 *
 * Puts the pinned official mpv 0.42.0 "full" mpv.exe in src-tauri/binaries/
 * as mpv-x86_64-pc-windows-msvc.exe (tauri.windows.conf.json bundles it as
 * mpv.exe for external playback, seek-bar thumbnails, Save clip and DVR).
 * The resource name is the same on ARM64; the contents follow HARBOR_MPV_ARCH.
 * See scripts/lib/mpv-pins.mjs and docs/mpv-binaries.md.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePinnedMpvFile } from "./lib/mpv-fetch.mjs";
import { mpvArch } from "./lib/mpv-pins.mjs";

if (process.platform !== "win32") {
  console.log("[mpv] not Windows, skipping bundled mpv.exe");
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  await ensurePinnedMpvFile({
    kind: "mpv",
    arch: mpvArch(),
    dest: join(root, "src-tauri", "binaries", "mpv-x86_64-pc-windows-msvc.exe"),
    licenseCopy: join(root, "src-tauri", "licenses", "mpv", "LICENSE.GPL"),
    label: "[mpv]",
  });
} catch (err) {
  console.error(err.message);
  console.error("[mpv] the pinned official mpv release could not be verified; nothing was written");
  process.exit(1);
}
