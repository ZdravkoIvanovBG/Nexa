/*
 * fetch-libmpv.mjs
 *
 * Puts the pinned official mpv 0.42.0 LGPL libmpv-2.dll (embedded player) in
 * src-tauri/libmpv/. See scripts/lib/mpv-pins.mjs for the exact archives and
 * hashes, and docs/mpv-binaries.md for provenance and licensing.
 *
 * Besides the hash pins it checks that every mpv_* entry point of the
 * committed import library (src-tauri/libmpv/libmpv.def -> mpv.lib) is
 * exported by the DLL, so the link-time API and the shipped DLL agree.
 *
 * Env: HARBOR_MPV_ARCH=x64|arm64 picks the architecture (default: this Node's);
 * HARBOR_MPV_RELEASE_URL points at a mirror of the same release assets (the
 * hashes are still enforced); HARBOR_LIBMPV_FORCE runs it on non-Windows hosts.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePinnedMpvFile, libmpvApi } from "./lib/mpv-fetch.mjs";
import { mpvArch } from "./lib/mpv-pins.mjs";

if (process.platform !== "win32" && !process.env.HARBOR_LIBMPV_FORCE) {
  console.log("[libmpv] not Windows, skipping (mac and linux link system libmpv)");
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libmpvDir = join(root, "src-tauri", "libmpv");
const api = libmpvApi(join(libmpvDir, "libmpv.def"));

try {
  await ensurePinnedMpvFile({
    kind: "libmpv",
    arch: mpvArch(),
    dest: join(libmpvDir, "libmpv-2.dll"),
    licenseCopy: join(root, "src-tauri", "licenses", "mpv", "LICENSE.LGPL"),
    label: "[libmpv]",
    verify: (_buf, pe) => {
      const exported = new Set(pe.exports);
      const missing = api.filter((name) => !exported.has(name));
      if (missing.length) {
        throw new Error(`[libmpv] libmpv-2.dll lacks mpv API entry points: ${missing.join(", ")}`);
      }
    },
  });
} catch (err) {
  console.error(err.message);
  console.error(
    "[libmpv] the pinned official mpv release could not be verified; nothing was written",
  );
  process.exit(1);
}
