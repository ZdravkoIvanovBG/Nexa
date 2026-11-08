/*
 * scripts/lib/mpv-pins.mjs
 *
 * The exact mpv binaries Nexa ships on Windows: the official mpv v0.42.0
 * release builds (https://github.com/mpv-player/mpv/releases/tag/v0.42.0),
 * produced by mpv's CI run 41936479105 from commit
 * b0841e8c4d156b8403dc1876c4cbd9011eb583f3 and signed by the mpv maintainer
 * key DE53 7FA4 CD83 E657 227D 6461 D6CA 75F6 505F 42A5.
 *
 * Every value is pinned. Changing the mpv version means changing this file
 * (archive names AND both hashes), never resolving "latest". The x64 pair is
 * the one that passed manual acceptance in Nexa 0.10.0. See docs/mpv-binaries.md.
 */

export const MPV_VERSION = "0.42.0";
export const MPV_RELEASE_URL = `https://github.com/mpv-player/mpv/releases/download/v${MPV_VERSION}`;

/** Pinned archives per Windows architecture. sha256 = archive, memberSha256 = extracted file. */
export const MPV_PINS = {
  x64: {
    machine: 0x8664,
    libmpv: {
      archive: "libmpv-v0.42.0-x86_64-w64-mingw32-lgpl.zip",
      sha256: "8e5f77430efc53ef175804ba6618527e3af0448a0dcabf04d3cc72659d1a6fce",
      member: "libmpv-2.dll",
      memberSha256: "94fb87247732c59915cd59808bc582e843a71c22214b7b6c1e5563aa8149cef4",
    },
    mpv: {
      archive: "mpv-v0.42.0-x86_64-w64-mingw32-full.zip",
      sha256: "c7d4ff6a67dd33659f71d81efa56335fea2213c7522fd67235f3abf0d9ea1dbd",
      member: "mpv.exe",
      memberSha256: "dd3e3adb8987bf88fc26d5f7d9cf9b5b096980f86b63698c3b1e2f34c654fe3b",
    },
  },
  // Pinned for the manual Windows ARM64 workflow only. Not release-tested.
  arm64: {
    machine: 0xaa64,
    libmpv: {
      archive: "libmpv-v0.42.0-aarch64-w64-mingw32-lgpl.zip",
      sha256: "e5092a8ec0878127fcac2c33d15c566c569bd9dcf13cee4829ae91a2770abbcb",
      member: "libmpv-2.dll",
      memberSha256: "e2279bc2f05e1a7fb834159ba05527f1cf3d03f66646cbfde50bd1742515a28a",
    },
    mpv: {
      archive: "mpv-v0.42.0-aarch64-w64-mingw32-full.zip",
      sha256: "6ea73a506a9c4372b253494c84b1a58d7b2cd09bcd290e4521cddee1f74401c6",
      member: "mpv.exe",
      memberSha256: "286741f27def8a1371846bb863fc0f60710484474f7d4718db0de58c1bc2fd7f",
    },
  },
};

/** License files inside the archives, compared with the copies Nexa ships in src-tauri/licenses/mpv/. */
export const MPV_LICENSE_MEMBERS = {
  libmpv: {
    member: "LICENSE.LGPL",
    sha256: "72b672113d642cbb8ef5dcc76938db801983c56e50b1400ab930f1a64d6dc8d9",
  },
  mpv: {
    member: "LICENSE.GPL",
    sha256: "edaef632cbb643e4e7a221717a6c441a4c1a7c918e6e4d56debc3d8739b233f6",
  },
};

/** Target architecture: HARBOR_MPV_ARCH (x64|arm64) when set, else the running Node's. */
export function mpvArch() {
  const arch = process.env.HARBOR_MPV_ARCH ?? process.arch;
  if (!MPV_PINS[arch]) throw new Error(`no pinned mpv build for Windows architecture "${arch}"`);
  return arch;
}
