# mpv binaries on Windows

Nexa for Windows ships two prebuilt mpv files, both from the **official mpv
v0.42.0 release** — never a rolling or third-party build:

| File in the install folder | Used for                                                                            | Upstream archive                             | Archive SHA-256                                                    | File SHA-256                                                       |
| -------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `libmpv-2.dll`             | embedded player                                                                     | `libmpv-v0.42.0-x86_64-w64-mingw32-lgpl.zip` | `8e5f77430efc53ef175804ba6618527e3af0448a0dcabf04d3cc72659d1a6fce` | `94fb87247732c59915cd59808bc582e843a71c22214b7b6c1e5563aa8149cef4` |
| `mpv.exe`                  | external player, seek-bar thumbnails, Save clip (x264/AAC), DVR (`--stream-record`) | `mpv-v0.42.0-x86_64-w64-mingw32-full.zip`    | `c7d4ff6a67dd33659f71d81efa56335fea2213c7522fd67235f3abf0d9ea1dbd` | `dd3e3adb8987bf88fc26d5f7d9cf9b5b096980f86b63698c3b1e2f34c654fe3b` |

This exact pair passed manual acceptance for Nexa 0.10.0 (movies, TV episodes,
embedded and external playback, NVIDIA hardware decoding, track switching, HDR,
SVP, repeated open/close).

The pins live in [`scripts/lib/mpv-pins.mjs`](../scripts/lib/mpv-pins.mjs); the
ARM64 pair there (`*-aarch64-w64-mingw32-*`) is used only by the manual Tauri
Build workflow and has not been release-tested.

## How the build gets them

`pnpm run setup` (and the CI workflows) run `scripts/fetch-libmpv.mjs` and
`scripts/fetch-mpv.mjs`, which:

1. accept a file already on disk (local or restored CI cache) **only if its
   SHA-256 equals the pin** — anything else is rejected and replaced;
2. download the pinned archive from
   `https://github.com/mpv-player/mpv/releases/download/v0.42.0/`
   (`HARBOR_MPV_RELEASE_URL` may point at a mirror; the hashes still apply);
3. verify the archive SHA-256, extract the one member, verify its SHA-256;
4. check the PE machine type and that every imported DLL is part of Windows;
5. for `libmpv-2.dll`, check that every `mpv_*` entry point in
   `src-tauri/libmpv/libmpv.def` is exported (`mpv.lib` is generated from that
   file and stays unchanged; `harbor.exe` imports 13 of them);
6. check that `src-tauri/licenses/mpv/LICENSE.LGPL` / `LICENSE.GPL` are byte for
   byte the license files inside the archive.

Nothing is executed and no newer mpv is ever resolved. The large binaries are
gitignored and never committed.

## Provenance

- Release: <https://github.com/mpv-player/mpv/releases/tag/v0.42.0>, assets
  signed (`.asc`) by Kacper Michajłow, primary key
  `DE53 7FA4 CD83 E657 227D 6461 D6CA 75F6 505F 42A5` (signing subkey
  `D83F 25E4 4BD6 B948 724A B75F 6580 1323 38AB D4E2`). GitHub's published
  asset digests match the pins above.
- Built by mpv's CI, run
  [41936479105](https://github.com/mpv-player/mpv/actions/runs/41936479105),
  from commit `b0841e8c4d156b8403dc1876c4cbd9011eb583f3` (tag `v0.42.0`), jobs
  `mingw64-full (win64, lgpl)` and `mingw64-full (win64, gpl)`
  (2026-11-04 23:53 – 2026-11-05 00:08 UTC), using
  `ci/build-mingw64-full.sh` inside `ghcr.io/btbn/ffmpeg-builds/win64-{lgpl,gpl}:latest`.
- FFmpeg inside both: `git-2026-11-04-baa68e6` =
  `baa68e68b34e2de912eb7e94342cebd2545f05ed`.
- The `latest` FFmpeg-Builds images at that time were produced by
  BtbN/FFmpeg-Builds run 41885603216 (finished 2026-11-04 19:08 UTC) at commit
  `c63bb308a1de656b425c132a8102f8fd5389afc5`.
- Versions reported by the binaries: mpv v0.42.0, libplacebo v7.387.0,
  FFmpeg libavformat 63.18.100.

## Licensing

| File           | Effective license | Why                                                                                            |
| -------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `libmpv-2.dll` | LGPL-3.0-or-later | mpv `-Dgpl=false` (LGPLv2.1+) + FFmpeg `--enable-version3` (reports "LGPL version 3 or later") |
| `mpv.exe`      | GPL-3.0-or-later  | FFmpeg `--enable-gpl --enable-version3` with x264/x265 (reports "GPL version 3 or later")      |

Neither build uses `--enable-nonfree`. Nexa (MIT) links libmpv dynamically and
runs `mpv.exe` as a separate process, so Nexa's own license is unaffected.

Shipped with the installer (from `src-tauri/licenses/`, bundled by
`tauri.windows.conf.json` into `licenses\` in the install folder):

- `THIRD-PARTY-NOTICES.txt` — components, licenses, where to download the source;
- `COMPONENT-LICENSES.txt` — the license files of every component built into
  the mpv and FFmpeg binaries (generated with the source bundle);
- `mpv/LICENSE.LGPL`, `mpv/LICENSE.GPL` — the archives' own license files;
- `mpv/Copyright` — mpv's licensing notes at `v0.42.0`;
- `ffmpeg/COPYING.{GPLv2,GPLv3,LGPLv2.1,LGPLv3}`, `ffmpeg/LICENSE.txt` (FFmpeg's `LICENSE.md`) — from
  FFmpeg commit `baa68e68`. The GPLv3/LGPLv3 texts are needed because the
  official archives only include the v2/v2.1 texts;
- `yt-dlp/LICENSE`, `yt-dlp/THIRD_PARTY_LICENSES.txt` — yt-dlp's license and
  the third-party license file embedded in the shipped `yt-dlp.exe`.

### Corresponding source

Nexa provides the complete Corresponding Source of `libmpv-2.dll`, `mpv.exe`,
`ffmpeg.exe` and `ffprobe.exe` itself, as a release asset next to the installer
(GPLv3 §6(d)). Every revision in it was identified from build records, without
guessing. How it was established, how it is built, and how it must be kept
available: [third-party-source.md](third-party-source.md).

## Updating mpv

1. Pick an official mpv release; download the Windows archives and their
   `.asc` signatures; verify the signatures and GitHub's digests.
2. Update every value in `scripts/lib/mpv-pins.mjs` (archive names, archive
   hashes, file hashes) and the license hashes if the license files changed.
3. Run `node scripts/fetch-libmpv.mjs && node scripts/fetch-mpv.mjs` from a clean
   checkout, build, and repeat the manual playback acceptance.
4. Update this document, `src-tauri/licenses/`, and the provenance section.
5. Identify the new build's sources and rebuild the source bundle before
   releasing (see [third-party-source.md](third-party-source.md), "Updating").
