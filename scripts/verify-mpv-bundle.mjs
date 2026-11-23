/*
 * verify-mpv-bundle.mjs <release-dir> [x64|arm64] [--no-bundle]
 *
 * After `tauri build`, checks the files the Windows bundle installs: the exact
 * pinned mpv files, the pinned ffmpeg/ffprobe/yt-dlp sidecars (x64), the
 * license texts and notices, and that harbor.exe imports only libmpv entry
 * points the shipped libmpv-2.dll exports. Exits non-zero on any mismatch.
 * Read-only.
 *
 * Which file ships at each path comes from (scripts/lib/bundle-files.mjs):
 *   default      the bundler's <release-dir>/nsis/<arch>/installer.nsi, i.e.
 *                exactly what makensis packed; the setup .exe must exist too.
 *   --no-bundle  the Tauri bundle configuration (for `tauri build --no-bundle`),
 *                i.e. what the bundler would pack.
 * Neither relies on tauri-build's copies next to the executable, which newer
 * Cargo build-dir layouts put elsewhere. harbor.exe is <release-dir>/harbor.exe
 * in both modes (the NSIS script must name that same file).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configBundleFiles, nsisBundleFiles } from "./lib/bundle-files.mjs";
import { sha256 } from "./lib/mpv-fetch.mjs";
import { MPV_LICENSE_MEMBERS, MPV_PINS, MPV_VERSION } from "./lib/mpv-pins.mjs";
import { inspectPe, nonSystemImports } from "./lib/pe.mjs";
import { WIN64_FFMPEG, YTDLP_SHA256 } from "./lib/sidecar-pins.mjs";

const args = process.argv.slice(2);
const noBundle = args.includes("--no-bundle");
const [dir, arch = "x64"] = args.filter((a) => !a.startsWith("--"));
if (!dir || !MPV_PINS[arch]) {
  console.error(
    "usage: node scripts/verify-mpv-bundle.mjs <release-dir> [x64|arm64] [--no-bundle]",
  );
  process.exit(2);
}
const TRIPLE = { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" }[arch];
const srcTauri = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");

const problems = [];
let files;
let source;
if (noBundle) {
  const base = JSON.parse(readFileSync(join(srcTauri, "tauri.conf.json"), "utf8"));
  const win = JSON.parse(readFileSync(join(srcTauri, "tauri.windows.conf.json"), "utf8"));
  // Tauri merges the platform file into the base config (JSON merge patch).
  const resources = { ...(base.bundle?.resources ?? {}), ...(win.bundle?.resources ?? {}) };
  const externalBin = win.bundle?.externalBin ?? base.bundle?.externalBin ?? [];
  files = configBundleFiles({
    srcTauri,
    resources,
    externalBin,
    triple: TRIPLE,
    listDir: (d) =>
      existsSync(d) ? readdirSync(d).filter((n) => statSync(join(d, n)).isFile()) : [],
  });
  files.set("harbor.exe", join(dir, "harbor.exe"));
  source = "the Tauri bundle configuration (--no-bundle)";
} else {
  const nsi = join(dir, "nsis", arch, "installer.nsi");
  if (!existsSync(nsi)) {
    console.error(`FAIL ${nsi} is missing (build the NSIS bundle, or pass --no-bundle)`);
    process.exit(1);
  }
  files = nsisBundleFiles(readFileSync(nsi, "utf8"));
  const setupDir = join(dir, "bundle", "nsis");
  const setups = existsSync(setupDir)
    ? readdirSync(setupDir).filter((n) => n.endsWith("-setup.exe"))
    : [];
  if (!setups.length) problems.push(`no *-setup.exe in ${setupDir}`);
  const packedMain = files.get("harbor.exe");
  if (!packedMain) problems.push("installer.nsi does not pack harbor.exe");
  else if (resolve(packedMain) !== resolve(dir, "harbor.exe"))
    problems.push(`installer.nsi packs ${packedMain}, not ${join(dir, "harbor.exe")}`);
  source = `${nsi} (${setups.join(", ") || "no installer"})`;
}

/** Reads the file installed at `path`, or records why it can't. */
const read = (path) => {
  const src = files.get(path);
  if (!src) {
    problems.push(`${path} is not in the bundle`);
    return null;
  }
  if (!existsSync(src)) {
    problems.push(`${path} is missing (${src})`);
    return null;
  }
  return readFileSync(src);
};
const check = (path, want) => {
  const buf = read(path);
  if (!buf) return null;
  const got = sha256(buf);
  if (got !== want) problems.push(`${path} sha256 ${got} != pinned ${want}`);
  else console.log(`ok  ${path}  ${got}`);
  return buf;
};

const dll = check("libmpv-2.dll", MPV_PINS[arch].libmpv.memberSha256);
check("mpv.exe", MPV_PINS[arch].mpv.memberSha256);
check("licenses/mpv/LICENSE.LGPL", MPV_LICENSE_MEMBERS.libmpv.sha256);
check("licenses/mpv/LICENSE.GPL", MPV_LICENSE_MEMBERS.mpv.sha256);
if (arch === "x64") {
  // Sidecars are pinned for the released x64 build only.
  check("ffmpeg.exe", WIN64_FFMPEG.ffmpegSha256);
  check("ffprobe.exe", WIN64_FFMPEG.ffprobeSha256);
  check("yt-dlp.exe", YTDLP_SHA256["yt-dlp.exe"]);
}
for (const f of [
  "licenses/THIRD-PARTY-NOTICES.txt",
  "licenses/COMPONENT-LICENSES.txt",
  "licenses/ffmpeg/COPYING.GPLv3",
  "licenses/ffmpeg/COPYING.LGPLv3",
  "licenses/mpv/Copyright",
  "licenses/yt-dlp/LICENSE",
  "licenses/yt-dlp/THIRD_PARTY_LICENSES.txt",
]) {
  if (read(f)) console.log(`ok  ${f}`);
}

const app = read("harbor.exe");
if (dll && app) {
  const pe = inspectPe(app);
  const exported = new Set(inspectPe(dll).exports);
  const used = pe.importFunctions["libmpv-2.dll"] ?? [];
  const missing = used.filter((f) => !exported.has(f));
  if (!used.length) problems.push("harbor.exe does not import libmpv-2.dll");
  if (missing.length)
    problems.push(`harbor.exe needs libmpv functions the DLL lacks: ${missing.join(", ")}`);
  const foreign = nonSystemImports([...pe.imports, ...pe.delayImports], ["libmpv-2.dll"]);
  if (foreign.length) problems.push(`harbor.exe imports unexpected DLLs: ${foreign.join(", ")}`);
  if (!missing.length && used.length)
    console.log(`ok  harbor.exe imports ${used.length} libmpv functions, all exported`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log(
  `bundle from ${source} carries the pinned mpv ${MPV_VERSION} (${arch}) binaries${arch === "x64" ? ", sidecars" : ""} and notices`,
);
