/*
 * fetch-binaries.mjs
 *
 * Downloads the Tauri "externalBin" sidecars (yt-dlp, ffmpeg, ffprobe) for the
 * CURRENT OS + arch and writes them to src-tauri/binaries/<name>-<triple>[.exe],
 * which is exactly the path tauri.conf.json externalBin resolves to at build time.
 *
 * Why this script exists:
 *   src-tauri/binaries/* is gitignored (see .gitignore), so a fresh clone ships
 *   NONE of these binaries. Without them `tauri build` dies with
 *   "resource path binaries/yt-dlp-<triple> doesn't exist". Run this once (via
 *   `pnpm run setup`) before building.
 *
 * ----------------------------------------------------------------------------
 * SOURCES - PLEASE VERIFY THESE URLS. They are "latest/rolling" upstream builds,
 * so they are intentionally NOT checksum pinned (unlike fetch-libmpv/fetch-fonts,
 * which pin a fixed asset). They also could NOT be test-downloaded in the
 * environment that wrote this script. VERIFY EACH ONE AT RUNTIME.
 * ----------------------------------------------------------------------------
 *
 * yt-dlp  (single self-contained binary, no archive)
 *   linux  x86_64 : github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
 *   linux  aarch64: github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64
 *   macOS  (both) : github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
 *                   (universal2; needs macOS 12+. For macOS 11 use yt-dlp_macos_legacy.)
 *   windows x86_64: github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
 *
 * ffmpeg + ffprobe  (extracted from an archive)
 *   linux  x86_64 : johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
 *   linux  aarch64: johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
 *   macOS  (both) : evermeet.cx/ffmpeg/getrelease/ffmpeg/zip  and  .../ffprobe/zip
 *                   (evermeet ships x86_64; on Apple Silicon it runs under Rosetta.
 *                   For a native arm64 static build use osxexperts.net instead.)
 *   windows x86_64: gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
 *                   (falls back to github.com/BtbN/FFmpeg-Builds latest win64-gpl zip
 *                   if gyan.dev fails after retries -- same asset release.yml ships)
 *
 * Extraction tools (documented external dependency):
 *   .tar.xz -> `tar -xJf`  (linux; GNU tar + xz-utils)
 *   .zip    -> macOS: `unzip`   windows: PowerShell Expand-Archive   (both built in)
 *
 * Env overrides (mirrors / air-gapped): HARBOR_YTDLP_URL, HARBOR_FFMPEG_URL,
 * HARBOR_FFPROBE_URL replace the resolved URL for the current platform (and
 * disable the BtbN fallback -- an explicit override means "use exactly this").
 * Or just drop the finished binary into src-tauri/binaries/<name>-<triple>[.exe]
 * by hand.
 *
 * Downloads retry transient failures (network errors, 408/429/5xx) with
 * backoff -- see scripts/lib/download.mjs. Files are validated (present,
 * large enough, real executable header) before being trusted, whether just
 * downloaded or already on disk from a previous run / restored CI cache.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadWithRetry, isValidBinary } from "./lib/download.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "binaries");

function targetTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

const EXE = process.platform === "win32" ? ".exe" : "";
const triple = targetTriple();
const mb = (p) => (statSync(p).size / 1048576).toFixed(0);

const YTDLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const JVS = "https://johnvansickle.com/ffmpeg/releases";
const EVERMEET = "https://evermeet.cx/ffmpeg/getrelease";
const GYAN = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const BTBN =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SOURCES = {
  "yt-dlp": {
    "x86_64-unknown-linux-gnu": { kind: "raw", url: `${YTDLP}/yt-dlp_linux` },
    "aarch64-unknown-linux-gnu": { kind: "raw", url: `${YTDLP}/yt-dlp_linux_aarch64` },
    "x86_64-apple-darwin": { kind: "raw", url: `${YTDLP}/yt-dlp_macos` },
    "aarch64-apple-darwin": { kind: "raw", url: `${YTDLP}/yt-dlp_macos` },
    "x86_64-pc-windows-msvc": { kind: "raw", url: `${YTDLP}/yt-dlp.exe` },
  },
  ffmpeg: {
    "x86_64-unknown-linux-gnu": {
      kind: "tar.xz",
      url: `${JVS}/ffmpeg-release-amd64-static.tar.xz`,
      member: "ffmpeg",
    },
    "aarch64-unknown-linux-gnu": {
      kind: "tar.xz",
      url: `${JVS}/ffmpeg-release-arm64-static.tar.xz`,
      member: "ffmpeg",
    },
    "x86_64-apple-darwin": { kind: "zip", url: `${EVERMEET}/ffmpeg/zip`, member: "ffmpeg" },
    "aarch64-apple-darwin": { kind: "zip", url: `${EVERMEET}/ffmpeg/zip`, member: "ffmpeg" },
    "x86_64-pc-windows-msvc": {
      kind: "zip",
      url: GYAN,
      fallbackUrl: BTBN,
      member: "ffmpeg.exe",
    },
  },
  ffprobe: {
    "x86_64-unknown-linux-gnu": {
      kind: "tar.xz",
      url: `${JVS}/ffmpeg-release-amd64-static.tar.xz`,
      member: "ffprobe",
    },
    "aarch64-unknown-linux-gnu": {
      kind: "tar.xz",
      url: `${JVS}/ffmpeg-release-arm64-static.tar.xz`,
      member: "ffprobe",
    },
    "x86_64-apple-darwin": { kind: "zip", url: `${EVERMEET}/ffprobe/zip`, member: "ffprobe" },
    "aarch64-apple-darwin": { kind: "zip", url: `${EVERMEET}/ffprobe/zip`, member: "ffprobe" },
    "x86_64-pc-windows-msvc": {
      kind: "zip",
      url: GYAN,
      fallbackUrl: BTBN,
      member: "ffprobe.exe",
    },
  },
};

const OVERRIDE = {
  "yt-dlp": process.env.HARBOR_YTDLP_URL,
  ffmpeg: process.env.HARBOR_FFMPEG_URL,
  ffprobe: process.env.HARBOR_FFPROBE_URL,
};

const ENVVAR = {
  "yt-dlp": "HARBOR_YTDLP_URL",
  ffmpeg: "HARBOR_FFMPEG_URL",
  ffprobe: "HARBOR_FFPROBE_URL",
};

// Memoized by resolved URL (not by name), so ffmpeg and ffprobe -- which share
// the same GYAN/BtbN archive on Windows -- only trigger one actual download
// and one extraction, even though each is fetched via a separate loop iteration.
// A failed download is cached too (as a rejected promise), so a dead primary is
// never retried a second time just because two sidecars reference it.
const dlCache = new Map();
function download(url) {
  if (!dlCache.has(url)) {
    dlCache.set(
      url,
      downloadWithRetry(url, { label: "[binaries]", headers: { "user-agent": UA, accept: "*/*" } }),
    );
  }
  return dlCache.get(url);
}

// Memoized by archive URL: extract each downloaded archive at most once, even
// when both ffmpeg and ffprobe are pulled from it.
const extractCache = new Map();
function extractArchive(url, buf, kind) {
  if (extractCache.has(url)) return extractCache.get(url);
  const tmp = mkdtempSync(join(tmpdir(), "harbor-bin-"));
  const archive = join(tmp, kind === "tar.xz" ? "archive.tar.xz" : "archive.zip");
  writeFileSync(archive, buf);
  const outDir = join(tmp, "out");
  mkdirSync(outDir, { recursive: true });
  if (kind === "tar.xz") {
    execFileSync("tar", ["-xJf", archive, "-C", outDir], { stdio: "inherit" });
  } else if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${outDir}" -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("unzip", ["-oq", archive, "-d", outDir], { stdio: "inherit" });
  }
  extractCache.set(url, { tmp, outDir });
  return { tmp, outDir };
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function findMember(dir, name) {
  let best = null;
  let bestSize = -1;
  for (const p of walk(dir, [])) {
    if (basename(p) !== name) continue;
    const size = statSync(p).size;
    if (size > bestSize) {
      best = p;
      bestSize = size;
    }
  }
  return best;
}

/** Download (with primary/fallback) and extract `member` from `spec`'s archive into `dest`. */
async function acquireArchiveMember(name, spec, dest) {
  const override = OVERRIDE[name];
  let url = override ?? spec.url;
  let buf;
  try {
    buf = await download(url);
  } catch (err) {
    if (override || !spec.fallbackUrl) throw err;
    console.warn(`[binaries] primary source failed for ${name} (${err.message}); trying fallback`);
    url = spec.fallbackUrl;
    buf = await download(url);
  }
  const { outDir } = extractArchive(url, buf, spec.kind);
  const found = findMember(outDir, spec.member);
  if (!found) throw new Error(`could not find ${spec.member} inside archive`);
  copyFileSync(found, dest);
}

function hint(name) {
  const lines = [
    `[binaries] fix: set ${ENVVAR[name]} to a mirror URL, or drop a working`,
    `[binaries]      ${name}-${triple}${EXE} into src-tauri/binaries/ by hand.`,
  ];
  if (name === "yt-dlp")
    lines.push("[binaries]      source: github.com/yt-dlp/yt-dlp/releases/latest");
  else
    lines.push(
      "[binaries]      static builds: johnvansickle.com (linux), evermeet.cx / osxexperts.net (macOS), gyan.dev or BtbN (windows)",
    );
  return lines.join("\n");
}

if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

let ok = true;
for (const name of ["yt-dlp", "ffmpeg", "ffprobe"]) {
  const dest = join(binDir, `${name}-${triple}${EXE}`);
  if (existsSync(dest)) {
    if (isValidBinary(dest)) {
      console.log(`[binaries] ${name}-${triple}${EXE} already present (${mb(dest)} MB)`);
      continue;
    }
    console.warn(`[binaries] ${name}-${triple}${EXE} present but invalid; re-downloading`);
    unlinkSync(dest);
  }
  const spec = SOURCES[name][triple];
  if (!spec) {
    console.error(`[binaries] no known source for ${name} on ${triple}`);
    console.error(hint(name));
    ok = false;
    continue;
  }
  try {
    if (spec.kind === "raw") {
      const buf = await download(OVERRIDE[name] ?? spec.url);
      writeFileSync(dest, buf);
    } else {
      await acquireArchiveMember(name, spec, dest);
    }
    if (process.platform !== "win32") chmodSync(dest, 0o755);
    if (!isValidBinary(dest)) {
      unlinkSync(dest);
      throw new Error("downloaded file failed validation (too small or not a native binary)");
    }
    console.log(`[binaries] wrote ${name}-${triple}${EXE} (${mb(dest)} MB)`);
  } catch (err) {
    console.error(`[binaries] ${name} failed: ${err.message}`);
    console.error(hint(name));
    ok = false;
  }
}

for (const { tmp } of extractCache.values()) {
  rmSync(tmp, { recursive: true, force: true });
}

if (!ok) {
  console.error("[binaries] one or more sidecars are missing; see messages above");
  process.exit(1);
}
console.log(`[binaries] all sidecars ready for ${triple}`);
