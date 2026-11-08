/*
 * scripts/lib/sidecar-pins.mjs
 *
 * Exact versions of the yt-dlp and Windows FFmpeg sidecars (Tauri externalBin).
 * Used by scripts/fetch-binaries.mjs (download + verify) and by
 * scripts/verify-mpv-bundle.mjs (post-build check of the staged bundle).
 *
 * Pinned instead of "latest" so every release ships known binaries whose
 * Corresponding Source is identified (docs/third-party-source.md). To update,
 * change version/URL and every hash together, then rebuild the source bundle.
 */

export const YTDLP_VERSION = "2026.10.26";
export const YTDLP_BASE = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`;
// From the release's SHA2-256SUMS (matches GitHub's asset digests).
export const YTDLP_SHA256 = {
  "yt-dlp_linux": "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795",
  "yt-dlp_linux_aarch64": "e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483",
  "yt-dlp_macos": "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa",
  "yt-dlp.exe": "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d",
};

// BtbN FFmpeg-Builds master, win64-gpl static. A month-end autobuild: BtbN keeps
// those for about two years (daily ones only for about two weeks).
export const WIN64_FFMPEG = {
  url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-N-128227-g4811625b5f-win64-gpl.zip",
  sha256: "3a5cdb3b83dd1b62b29d946d3655a14d787e5e81d947ad68202a1a400095d2f8",
  ffmpegSha256: "63f7cad2da68519366eee578ee2bcebb09b2bde58b06a410ef4bbf4fc00e2d2c",
  ffprobeSha256: "0e55ac2608a4d6af40070d9b526693221a07ab2f13629ba1c2adbf2c775370c9",
};
