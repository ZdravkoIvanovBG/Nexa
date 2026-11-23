/*
 * scripts/lib/bundle-files.mjs
 *
 * Which file a Windows bundle installs at each path, so verify-mpv-bundle can
 * check the exact files that ship. Two sources, both independent of where
 * Cargo or tauri-build leave intermediate copies (Rust 1.100's build-dir
 * layout moved tauri-build's resource copies away from the built executable):
 *   - nsisBundleFiles: the bundler's generated installer.nsi, i.e. exactly the
 *     files makensis packed into the installer.
 *   - configBundleFiles: the Tauri bundle configuration (resources and
 *     externalBin), i.e. the files the bundler would pack, for builds made
 *     with --no-bundle.
 * Both return Map<installPath, sourcePath>; install paths use "/" separators.
 */

import { basename, join } from "node:path";

/** Unquotes an NSIS string argument. */
function arg(s) {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** Files packed by a Tauri-generated installer.nsi (main binary included). */
export function nsisBundleFiles(nsiText) {
  const files = new Map();
  const defines = new Map();
  for (const m of nsiText.matchAll(/^\s*!define\s+(\w+)\s+"([^"]*)"\s*$/gm))
    defines.set(m[1], m[2]);
  const main = defines.get("MAINBINARYSRCPATH");
  const mainName = defines.get("MAINBINARYNAME");
  if (main && mainName) files.set(`${mainName}.exe`, main);
  // File [/a] "/oname=<install path>" "<source>"; $-prefixed targets (e.g. the
  // WebView2 bootstrapper unpacked to $TEMP) are not installed files.
  for (const m of nsiText.matchAll(/^\s*File\s+(?:\/a\s+)?("\/oname=[^"]+")\s+("[^"]+")\s*$/gm)) {
    const dest = arg(m[1]).slice("/oname=".length);
    if (dest.startsWith("$")) continue;
    files.set(dest.replace(/\\/g, "/"), arg(m[2]));
  }
  return files;
}

/**
 * Files the bundler packs for a Tauri config: the `bundle.resources` map
 * (exact files, or "dir/*" globs of the files directly in dir) and
 * `bundle.externalBin` sidecars (`<path>-<target triple>.exe` installed as
 * `<name>.exe`). `listDir(dir)` returns the file names in a directory.
 */
export function configBundleFiles({ srcTauri, resources, externalBin, triple, listDir }) {
  const files = new Map();
  if (Array.isArray(resources))
    throw new Error("bundle.resources as a list is not supported here; use a map");
  for (const [src, dest] of Object.entries(resources ?? {})) {
    if (src.endsWith("/*")) {
      const dir = src.slice(0, -2);
      const base = dest.replace(/\/+$/, "");
      for (const name of listDir(join(srcTauri, dir)))
        files.set(`${base}/${name}`, join(srcTauri, dir, name));
    } else {
      files.set(dest, join(srcTauri, src));
    }
  }
  for (const bin of externalBin ?? []) {
    files.set(`${basename(bin)}.exe`, join(srcTauri, `${bin}-${triple}.exe`));
  }
  return files;
}
