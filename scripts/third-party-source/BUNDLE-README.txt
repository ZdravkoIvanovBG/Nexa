Nexa for Windows -- Corresponding Source of the bundled third-party programs
============================================================================

This archive is the complete Corresponding Source, as defined by the GNU
General Public License version 3 (section 1) and the GNU Lesser General Public
License version 3, for these third-party programs installed with Nexa on
Windows:

  libmpv-2.dll   mpv 0.42.0 libmpv, LGPL build (LGPL-3.0-or-later as built)
                 from libmpv-v0.42.0-x86_64-w64-mingw32-lgpl.zip
  mpv.exe        mpv 0.42.0 player, GPL build (GPL-3.0-or-later as built)
                 from mpv-v0.42.0-x86_64-w64-mingw32-full.zip
  ffmpeg.exe     FFmpeg N-128227-g4811625b5f, BtbN win64-gpl static build
  ffprobe.exe    (GPL-3.0-or-later as built), from
                 ffmpeg-N-128227-g4811625b5f-win64-gpl.zip,
                 release autobuild-2026-10-31-12-59 of
                 https://github.com/BtbN/FFmpeg-Builds

Nexa itself is MIT licensed; its source is at
https://github.com/ZdravkoIvanovBG/Nexa . The file hashes of the binaries above
are pinned in Nexa's scripts/lib/mpv-pins.mjs and scripts/fetch-binaries.mjs.


Layout
------

  README.txt               this file
  components.json          the pinned component list this bundle was built from
  MANIFEST.json            per component: upstream URL, pinned and resolved
                           commit (or SVN revision / download URL), submodule
                           and synced-dependency commits, files and SHA-256
  SHA256SUMS               SHA-256 of every file in this bundle
  COMPONENT-LICENSES.txt   the license files found at the top of each source tree
  sources/<id>.tar.gz      one archive per component; unpacks to <id>/ and
                           includes its git submodules and the dependency
                           checkouts its build's download step performs
  sources/<id>.cargo-vendor.tar.gz
                           Rust crates (exact Cargo.lock versions) for subrandr,
                           rav1e and librsvg
  sources/<id>.<file>      other inputs fetched by a build's download step
                           (opus model data, meson wrap archives, mujs tarball
                           and WrapDB patch, cppwinrt tarball)
  evidence/                the records used to identify every revision (below)


How the binaries were built
---------------------------

mpv.exe and libmpv-2.dll were built by mpv's own CI, run 41936479105 of
https://github.com/mpv-player/mpv (jobs "mingw64-full (win64, gpl)" and
"mingw64-full (win64, lgpl)"), at tag v0.42.0 (commit b0841e8c), with the
script ci/build-mingw64-full.sh (inside sources/mpv.tar.gz), in the containers

  ghcr.io/btbn/ffmpeg-builds/win64-lgpl@sha256:d2290020ecfd15e95366c828f236c7e3d8066fd6a92507d93b6b119bc3aed48a
  ghcr.io/btbn/ffmpeg-builds/win64-gpl@sha256:146dd9a98dbd12705cc0c2c56d0bb81f83f2f02f1828c83cc08242e64b810fbd

Those images were built and pushed by run 41885603216 of
https://github.com/BtbN/FFmpeg-Builds at commit c63bb308 (sources/
ffmpeg-builds-c63bb308.tar.gz: build scripts, patches and the toolchain
configuration). Every library in them is pinned to an exact revision in that
commit's scripts.d/; those sources are in this bundle. The images themselves
are no longer published.

The mpv build script additionally cloned, at the then-current revision:
FFmpeg (master), LuaJIT (v2.1), libsixel, libarchive and subrandr (master). The
revisions used were identified without guessing:
  - FFmpeg baa68e68: the build prints "FFmpeg version: git-2026-11-04-baa68e6",
    and GitHub's push record shows it was master from 2026-11-04 23:44:56Z
    until 2026-11-05 01:49:39Z, i.e. for the whole build;
  - LuaJIT ea9eb7ed: the build prints "LuaJIT 2.1.1793383622", and LuaJIT
    2.1 versions are the commit timestamp (1793383622 = 2026-10-30 18:07:02Z);
  - libsixel f0b705a3, libarchive 2774b74c, subrandr a41311bb: the branch
    head according to GitHub's push record for the entire build window.
uchardet (tag v0.0.8 = ae6302a0), windows-rs (tag 73 = 65c0c07b), winmd
(0f1eae3b), cppwinrt 2.0.250303.1 and mujs 1.3.8 + WrapDB patch 1.3.8-1 are
fixed versions recorded in the logs. The two job logs and the push records are
in evidence/.

ffmpeg.exe and ffprobe.exe were built by run 41199749965 of BtbN/FFmpeg-Builds
(commit 5031c6f1, sources/ffmpeg-builds-5031c6f1.tar.gz) from FFmpeg commit
4811625b5f (sources/ffmpeg-for-ffmpeg-exe.tar.gz). Its library pins are the
same as c63bb308 except SVT-AV1 (f2c3fb78, sources/svtav1-b.tar.gz).

The cross toolchain (GCC 16.2.0 built with crosstool-ng, binutils, CMake,
Meson, Rust, NASM, ...) consists of generally available build tools and is not
part of the Corresponding Source; its configuration is in the FFmpeg-Builds
archives (images/). The mingw-w64 runtime and winpthreads that end up in the
binaries are in sources/mingw.tar.gz; libgcc and libstdc++ are covered by the
GCC Runtime Library Exception. Rust's standard library is MIT/Apache-2.0.

Components marked in MANIFEST.json as used by both build images are included
for every binary even where a particular build did not link them (for example
mpv disables librsvg, rav1e and OpenAL in its FFmpeg); including them keeps the
set complete for all four binaries.


Rebuilding
----------

Build the FFmpeg-Builds image for win64-gpl or win64-lgpl from the matching
FFmpeg-Builds archive (see its README; the download step it would perform is
already done in sources/), then run mpv's ci/build-mingw64-full.sh inside it
with the FFmpeg, LuaJIT, libsixel, libarchive, uchardet, subrandr, cppwinrt,
windows-rs and mujs trees from this bundle in place of its git clones.
For ffmpeg.exe use FFmpeg-Builds 5031c6f1's build.sh with
sources/ffmpeg-for-ffmpeg-exe.tar.gz as the FFmpeg tree.


Licenses
--------

GPL-3.0 and LGPL-3.0 texts: sources/ffmpeg-for-mpv.tar.gz (COPYING.GPLv3,
COPYING.LGPLv3), also installed with Nexa under licenses\. Each component's own
license files are in its archive and collected in COMPONENT-LICENSES.txt.

Questions about this archive: https://github.com/ZdravkoIvanovBG/Nexa/issues
