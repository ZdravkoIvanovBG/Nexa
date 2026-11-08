# Third-party Corresponding Source (Windows)

The Windows installer ships four programs under the GPL/LGPL version 3:

| File           | License (as built) | Upstream binary                                                                |
| -------------- | ------------------ | ------------------------------------------------------------------------------ |
| `libmpv-2.dll` | LGPL-3.0-or-later  | mpv `libmpv-v0.42.0-x86_64-w64-mingw32-lgpl.zip`                               |
| `mpv.exe`      | GPL-3.0-or-later   | mpv `mpv-v0.42.0-x86_64-w64-mingw32-full.zip`                                  |
| `ffmpeg.exe`   | GPL-3.0-or-later   | BtbN `autobuild-2026-10-31-12-59`, `ffmpeg-N-128227-g4811625b5f-win64-gpl.zip` |
| `ffprobe.exe`  | GPL-3.0-or-later   | same archive                                                                   |

Conveying them obliges Nexa to provide their complete Corresponding Source
(GPLv3 §6; LGPLv3 incorporates it for the library itself). Nexa uses GPLv3
§6(d): the source is offered from the same place as the installer — a release
asset on the GitHub release — at no charge. A written offer (§6(b)) is not
used.

`yt-dlp.exe` (Windows, 2026.10.26) is Unlicense; the PyInstaller bundle
contains only permissively licensed components (Python/PSF, OpenSSL 3, libffi,
SQLite, curl-impersonate with BoringSSL/nghttp2/ngtcp2/nghttp3/zstd/brotli,
pycryptodomex, websockets, certifi (MPL-2.0, shipped in source form), requests,
charset-normalizer). The GPL/LGPL entries in its `THIRD_PARTY_LICENSES.txt`
(GNU Readline, libintl, libidn2, libunistring) belong to the Linux builds and
are not in `yt-dlp.exe`. It needs its license notices (shipped in
`licenses\yt-dlp\`), not a source offer.

## The bundle

- Asset: `Nexa-0.10.0-third-party-source.tar` on the
  [`v0.10.0` release](https://github.com/ZdravkoIvanovBG/Nexa/releases/tag/v0.10.0),
  referenced by URL and SHA-256 in `src-tauri/licenses/THIRD-PARTY-NOTICES.txt`.
- Contents: one archive per component (124 components) with submodules and the
  extra checkouts each build's download step performs, vendored Rust crates,
  `MANIFEST.json` (pinned and resolved commits, file hashes), `SHA256SUMS`,
  `COMPONENT-LICENSES.txt`, the build records in `evidence/`, and a README.
- Built by `scripts/third-party-source/build-bundle.mjs` from
  `scripts/third-party-source/components.json`.

### How every revision was identified

| What                                                                         | Evidence                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build containers `win64-lgpl@sha256:d2290020…`, `win64-gpl@sha256:146dd9a9…` | Pulled by mpv CI jobs 126946096816 / 126946096969; pushed by BtbN/FFmpeg-Builds run 41885603216 (merge job log: `pushing sha256:… to …:latest`) at commit `c63bb308`.              |
| Every library in the containers                                              | Pinned by commit / tag / SVN revision in `scripts.d/` at `c63bb308` (parsed, not executed).                                                                                        |
| FFmpeg for mpv `baa68e68`                                                    | Build prints `FFmpeg version: git-2026-11-04-baa68e6`; GitHub push activity: master head 2026-11-04 23:44:56Z → 2026-11-05 01:49:39Z, spanning both builds.                        |
| LuaJIT `ea9eb7ed`                                                            | Build prints `LuaJIT 2.1.1793383622`; LuaJIT 2.1 versions are the commit timestamp (`ea9eb7ed` = 1793383622).                                                                      |
| libsixel `f0b705a3`, libarchive `2774b74c`, subrandr `a41311bb`              | Cloned at branch head; GitHub push activity shows each head unchanged for the whole build window.                                                                                  |
| uchardet `ae6302a0`, windows-rs `65c0c07b`, winmd `0f1eae3b`                 | Commits printed in the job logs.                                                                                                                                                   |
| cppwinrt 2.0.250303.1, mujs 1.3.8 + WrapDB 1.3.8-1                           | Fixed versions in the build script / log.                                                                                                                                          |
| subrandr crates                                                              | `Cargo.lock` at `a41311bb`; versions match the `Downloaded …` lines in the log.                                                                                                    |
| ffmpeg.exe / ffprobe.exe                                                     | Release `autobuild-2026-10-31-12-59` (FFmpeg `4811625b5f`) from BtbN scheduled run 41199749965 at FFmpeg-Builds `5031c6f1`; its pins equal `c63bb308` except SVT-AV1 (`f2c3fb78`). |

The container images themselves are deleted from ghcr.io (BtbN keeps only
`latest`), which is why the bundle carries every library source instead of
pointing at the images.

### What is intentionally not included

- The cross toolchain (GCC 16.2.0 via crosstool-ng, binutils, CMake, Meson,
  NASM, Rust): generally available build tools, excluded from Corresponding
  Source by GPLv3 §1. Their configuration is in the FFmpeg-Builds archives.
  libgcc/libstdc++ fall under the GCC Runtime Library Exception; the
  mingw-w64 runtime and winpthreads are included.
- The `cc` crate version that BtbN's rav1e build updates at build time
  (`cargo update cc`): a build-script helper, not linked into `ffmpeg.exe`.

### Not covered (do not distribute without extending the bundle)

- Windows ARM64 mpv/FFmpeg builds (pinned in `mpv-pins.mjs` but untested and
  not released).
- Sidecars fetched by the manual `tauri-build.yml` workflow and the Linux FFmpeg
  builds (CI artifacts only).

## Building the bundle

```sh
node scripts/third-party-source/build-bundle.mjs <out-dir> --evidence <evidence-dir>
```

Needs git, cargo and network access; downloads a few GB, takes 20–60 minutes,
and resumes where it stopped (`<out-dir>/state`; run only one instance per
`<out-dir>`). The result is `<out-dir>/bundle/`. Pack it with GNU tar, without
compression (the members are already gzip), from inside `<out-dir>`:

```sh
tar --owner=0 --group=0 --numeric-owner --sort=name \
    --transform 's,^bundle,Nexa-0.10.0-third-party-source,' \
    -cf Nexa-0.10.0-third-party-source.tar bundle
```

Copy `bundle/COMPONENT-LICENSES.txt` to `src-tauri/licenses/` and put the tar's
SHA-256 and size into `THIRD-PARTY-NOTICES.txt`.

The 0.10.0 bundle: 124 components (33 submodules, 3 vendored crate sets with
255/273/352 crates, 2 SVN exports), 1,132,759,040 bytes, SHA-256
`268c03af608b2578f7076c6872b3f95f7f89055e1e0914e3ebcc0b96d0563c64`. Every pinned
commit matched the resolved commit, and an extracted copy passed its own
`SHA256SUMS`.

## Publishing and keeping it available

1. After `release.yml` creates the draft, upload the tar to that draft
   (GitHub UI, or the REST "upload a release asset" endpoint) and check its
   SHA-256 against the notices.
2. Publish only when installer and source are both on the release.
3. Keep the asset for as long as any release that ships these binaries is
   downloadable or offered by the updater (GPLv3 §6(d): "for as long as needed
   to satisfy these requirements"). Never delete the `v0.10.0` release while
   that is the case. Later releases with the same binaries may link to the same
   asset; releases with different binaries need a new bundle.

## Updating

When mpv, the BtbN FFmpeg sidecar or their pins change:

1. Fetch the new build's CI logs (they need a signed-in GitHub account) and
   identify every source revision as above — never assume "latest".
2. Regenerate `components.json`: check out the build's FFmpeg-Builds commit(s),
   run `parse-stages.mjs <checkout> <stages.json>` (reads the stage scripts as
   text, never executes them), update the mpv-side entries and evidence in
   `gen-components.mjs`, and run it. Then rebuild the bundle and update
   `COMPONENT-LICENSES.txt` and the notices.
3. Attach the new bundle to the release that first ships the new binaries.
