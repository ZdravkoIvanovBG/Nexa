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
 * SOURCES. yt-dlp (all platforms) and the macOS and Windows FFmpeg builds are
 * pinned to exact versions by SHA-256 (archive and extracted binary): a cached
 * binary that does not match is rejected and re-downloaded. Only the Linux
 * FFmpeg builds (CI artifacts, not released) are still "latest/rolling".
 * Pins: scripts/lib/sidecar-pins.mjs and the macOS entries below.
 * ----------------------------------------------------------------------------
 *
 * yt-dlp  (single self-contained binary, no archive), release 2026.10.26
 *   linux  x86_64 : github.com/yt-dlp/yt-dlp/releases/download/<version>/yt-dlp_linux
 *   linux  aarch64: github.com/yt-dlp/yt-dlp/releases/download/<version>/yt-dlp_linux_aarch64
 *   macOS  (both) : github.com/yt-dlp/yt-dlp/releases/download/<version>/yt-dlp_macos
 *                   (universal2; needs macOS 12+. For macOS 11 use yt-dlp_macos_legacy.)
 *   windows x86_64: github.com/yt-dlp/yt-dlp/releases/download/<version>/yt-dlp.exe
 *
 * ffmpeg + ffprobe  (extracted from an archive)
 *   linux  x86_64 : johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
 *   linux  aarch64: johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
 *   macOS  arm64  : ffmpeg.martin-riedl.de FFmpeg 9.0.2 static release builds,
 *   macOS  x86_64 : native per architecture, pinned by build id AND SHA-256
 *                   (archive and extracted binary). The publisher's .sha256
 *                   files matched these pins when they were set.
 *   windows x86_64: github.com/BtbN/FFmpeg-Builds month-end autobuild
 *                   (autobuild-2026-10-31-12-59, master N-128227-g4811625b5f,
 *                   win64-gpl static) -- the same binaries release.yml ships;
 *                   their Corresponding Source is in the third-party source
 *                   bundle (docs/third-party-source.md)
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
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadWithRetry, isValidBinary } from "./lib/download.mjs";
import { WIN64_FFMPEG, YTDLP_BASE, YTDLP_SHA256 } from "./lib/sidecar-pins.mjs";

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
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const mb = (p) => (statSync(p).size / 1048576).toFixed(0);

const JVS = "https://johnvansickle.com/ffmpeg/releases";
const RIEDL = "https://ffmpeg.martin-riedl.de/download/macos";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ytdlp = (asset) => ({
  kind: "raw",
  url: `${YTDLP_BASE}/${asset}`,
  memberSha256: YTDLP_SHA256[asset],
});

const SOURCES = {
  "yt-dlp": {
    "x86_64-unknown-linux-gnu": ytdlp("yt-dlp_linux"),
    "aarch64-unknown-linux-gnu": ytdlp("yt-dlp_linux_aarch64"),
    "x86_64-apple-darwin": ytdlp("yt-dlp_macos"),
    "aarch64-apple-darwin": ytdlp("yt-dlp_macos"),
    "x86_64-pc-windows-msvc": ytdlp("yt-dlp.exe"),
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
    "x86_64-apple-darwin": {
      kind: "zip",
      url: `${RIEDL}/amd64/1789931006_9.0.2/ffmpeg.zip`,
      sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
      member: "ffmpeg",
      memberSha256: "b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1",
    },
    "aarch64-apple-darwin": {
      kind: "zip",
      url: `${RIEDL}/arm64/1789931890_9.0.2/ffmpeg.zip`,
      sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
      member: "ffmpeg",
      memberSha256: "2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384",
    },
    "x86_64-pc-windows-msvc": {
      kind: "zip",
      url: WIN64_FFMPEG.url,
      sha256: WIN64_FFMPEG.sha256,
      member: "ffmpeg.exe",
      memberSha256: WIN64_FFMPEG.ffmpegSha256,
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
    "x86_64-apple-darwin": {
      kind: "zip",
      url: `${RIEDL}/amd64/1789931006_9.0.2/ffprobe.zip`,
      sha256: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
      member: "ffprobe",
      memberSha256: "b5df9964b0c2048318fafedcd4e3bbafbc561033cee77de8da1840685d8a9d0d",
    },
    "aarch64-apple-darwin": {
      kind: "zip",
      url: `${RIEDL}/arm64/1789931890_9.0.2/ffprobe.zip`,
      sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
      member: "ffprobe",
      memberSha256: "2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059",
    },
    "x86_64-pc-windows-msvc": {
      kind: "zip",
      url: WIN64_FFMPEG.url,
      sha256: WIN64_FFMPEG.sha256,
      member: "ffprobe.exe",
      memberSha256: WIN64_FFMPEG.ffprobeSha256,
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
// one archive on Windows and Linux -- only trigger one actual download
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
  if (spec.sha256 && !override) {
    const got = sha256(buf);
    if (got !== spec.sha256)
      throw new Error(`archive checksum mismatch (expected ${spec.sha256}, got ${got})`);
  }
  const { outDir } = extractArchive(url, buf, spec.kind);
  const found = findMember(outDir, spec.member);
  if (!found) throw new Error(`could not find ${spec.member} inside archive`);
  copyFileSync(found, dest);
  if (spec.memberSha256 && !override) {
    const got = sha256(readFileSync(dest));
    if (got !== spec.memberSha256) {
      unlinkSync(dest);
      throw new Error(
        `${spec.member} checksum mismatch (expected ${spec.memberSha256}, got ${got})`,
      );
    }
  }
}

function hint(name) {
  const lines = [
    `[binaries] fix: set ${ENVVAR[name]} to a mirror URL, or drop a working`,
    `[binaries]      ${name}-${triple}${EXE} into src-tauri/binaries/ by hand.`,
  ];
  if (name === "yt-dlp") lines.push(`[binaries]      source: ${YTDLP_BASE}`);
  else
    lines.push(
      "[binaries]      static builds: johnvansickle.com (linux), ffmpeg.martin-riedl.de (macOS), BtbN autobuild (windows)",
    );
  return lines.join("\n");
}

if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

let ok = true;
for (const name of ["yt-dlp", "ffmpeg", "ffprobe"]) {
  const dest = join(binDir, `${name}-${triple}${EXE}`);
  const pinned = SOURCES[name][triple]?.memberSha256;
  if (existsSync(dest) && pinned && !OVERRIDE[name] && sha256(readFileSync(dest)) !== pinned) {
    console.warn(
      `[binaries] ${name}-${triple}${EXE} does not match its pinned SHA-256; replacing it`,
    );
    unlinkSync(dest);
  }
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
      if (spec.memberSha256 && !OVERRIDE[name]) {
        const got = sha256(buf);
        if (got !== spec.memberSha256)
          throw new Error(`checksum mismatch (expected ${spec.memberSha256}, got ${got})`);
      }
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
