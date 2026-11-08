// Generates components.json from the statically parsed FFmpeg-Builds stages
// (two commits, see parse-stages.mjs) plus the components mpv's own CI script
// builds directly. The mpv-side entries and their evidence are specific to the
// mpv 0.42.0 / BtbN 2026-10-31 binaries; update them together with the pins
// (docs/third-party-source.md, "Updating").
// usage: node gen-components.mjs <stages-c63bb308.json> <stages-5031c6f1.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [c63, s5031] = [2, 3].map((i) => JSON.parse(readFileSync(process.argv[i], "utf8")));
const MPV_IMAGE = "c63bb308a1de656b425c132a8102f8fd5389afc5";
const FFEXE_IMAGE = "5031c6f1082414e53688d39e521849905071070d";

// Stages FFmpeg-Builds never builds for win64 (gpl/lgpl): Linux-only, nonfree,
// or unconditionally disabled.
function enabledForWin64(s) {
  if (s.vars.SCRIPT_SKIP) return false;
  const en = (s.enabled ?? "").replace(/\s+/g, " ");
  if (/\[\[ \$TARGET != linux\* \]\] && return -1/.test(en)) return false;
  if (/\[\[ \$TARGET == linux\* \]\] \|\| return/.test(en)) return false;
  if (/\[\[ \$VARIANT == nonfree\* \]\] \|\| return -1/.test(en)) return false;
  if (/return -1$/.test(en.trim())) return false; // whisper: ends with an unconditional return -1
  return true;
}

const isSha = (r) => /^[0-9a-f]{40}$/.test(r);
const slug = (stage) =>
  stage
    .replace(/\.sh$/, "")
    .replace(/^[0-9]+-/, "")
    .replace(/\/[0-9]+-/, "-")
    .replace(/[^a-z0-9.-]+/gi, "-")
    .toLowerCase();

const SUBMODULES = {
  "25-openssl.sh": true,
  "50-libcurl/40-nghttp3.sh": ["lib/sfparse"],
  "50-libjxl/50-libjxl.sh": ["third_party/highway"],
  "50-libplacebo.sh": true,
  "50-librist/40-mbedtls.sh": true,
  "50-librsvg/10-glib.sh": true,
  "50-zimg.sh": true,
};
const EXTRAS = {
  "47-vulkan/50-shaderc.sh": ["shaderc-deps"],
  "50-libopus.sh": ["opus-model"],
  "50-librsvg/10-glib.sh": ["meson-wrap:proxy-libintl"],
  "50-librsvg/99-librsvg.sh": ["cargo-vendor"],
  "50-rav1e.sh": ["cargo-vendor"],
};
const EXCLUDE = { "50-amf.sh": ["Thirdparty"] };
// License texts that are not at the top of the source tree.
const NV_HEADER = { licenseHeaderOf: "include/ffnvcodec/nvEncodeAPI.h" };
const LICENSE_OVERRIDES = {
  avisynth: {
    licensePaths: ["distrib/gpl.txt", "distrib/docs/english/source/avisynthdoc/license.rst"],
  },
  ffnvcodec: NV_HEADER,
  "ffnvcodec-2": NV_HEADER,
  "ffnvcodec-3": NV_HEADER,
};

function git(url, rev, extra = {}) {
  return { type: "git", url, ...(isSha(rev) ? { commit: rev } : { tag: rev }), ...extra };
}

function fromStage(s, image) {
  const v = s.vars;
  const origin = `FFmpeg-Builds ${image.slice(0, 8)} scripts.d/${s.stage}`;
  const out = [];
  const base = slug(s.stage);
  if (v.SCRIPT_REV) {
    out.push({
      id: base,
      origin,
      source: { type: "svn", url: v.SCRIPT_REPO, revision: Number(v.SCRIPT_REV) },
    });
    return out;
  }
  const opts = {};
  if (SUBMODULES[s.stage]) opts.submodules = SUBMODULES[s.stage];
  if (EXCLUDE[s.stage]) opts.exclude = EXCLUDE[s.stage];
  if (v.SCRIPT_MIRROR) opts.mirrors = [v.SCRIPT_MIRROR];
  out.push({
    id: base,
    origin,
    source: git(v.SCRIPT_REPO, v.SCRIPT_COMMIT, opts),
    ...(EXTRAS[s.stage] ? { extras: EXTRAS[s.stage] } : {}),
  });
  for (const n of [2, 3]) {
    if (!v[`SCRIPT_REPO${n}`]) continue;
    const o = v[`SCRIPT_MIRROR${n}`] ? { mirrors: [v[`SCRIPT_MIRROR${n}`]] } : {};
    out.push({
      id: `${base}-${n}`,
      origin: `${origin} (SCRIPT_REPO${n})`,
      source: git(v[`SCRIPT_REPO${n}`], v[`SCRIPT_COMMIT${n}`], o),
    });
  }
  return out;
}

const components = [];
const seen = new Map(); // url@rev -> component
function add(c, usedBy) {
  const key = `${c.source.url}@${c.source.commit ?? c.source.tag ?? c.source.revision}@${c.source.paths ?? ""}`;
  const prev = seen.get(key);
  if (prev) {
    for (const u of usedBy) if (!prev.usedBy.includes(u)) prev.usedBy.push(u);
    if (!prev.origins.includes(c.origin)) prev.origins.push(c.origin);
    return;
  }
  let id = c.id;
  while (components.some((x) => x.id === id)) id += "-b";
  const entry = { id, usedBy: [...usedBy], origins: [c.origin], source: c.source };
  if (c.extras) entry.extras = c.extras;
  if (c.note) entry.note = c.note;
  Object.assign(entry, LICENSE_OVERRIDES[id]);
  components.push(entry);
  seen.set(key, entry);
}

// --- Built directly by mpv's ci/build-mingw64-full.sh (v0.42.0) -------------
const MPV = ["libmpv-2.dll", "mpv.exe"];
const ev = "mpv CI run 41936479105, jobs 126946096816 (lgpl) / 126946096969 (gpl)";
add(
  {
    id: "mpv",
    origin: "mpv tag v0.42.0",
    source: git(
      "https://github.com/mpv-player/mpv.git",
      "b0841e8c4d156b8403dc1876c4cbd9011eb583f3",
    ),
  },
  MPV,
);
add(
  {
    id: "ffmpeg-for-mpv",
    origin: `${ev}: clone of FFmpeg master; build prints 'FFmpeg version: git-2026-11-04-baa68e6'; master head 23:44:56Z-01:49:39Z`,
    source: git("https://github.com/FFmpeg/FFmpeg.git", "baa68e68b34e2de912eb7e94342cebd2545f05ed"),
  },
  MPV,
);
add(
  {
    id: "luajit",
    origin: `${ev}: clone of branch v2.1; build prints 'LuaJIT 2.1.1793383622' (= commit time of ea9eb7ed)`,
    source: git("https://github.com/LuaJIT/LuaJIT.git", "ea9eb7edb5eac4a9d175d74523db34fac0fa5180"),
  },
  MPV,
);
add(
  {
    id: "libsixel",
    origin: `${ev}: clone of master; master head 2026-10-13T07:15:49Z-2026-11-05T11:18:34Z`,
    source: git(
      "https://github.com/saitoha/libsixel.git",
      "f0b705a365563c56f977afaca73997ca68669c62",
    ),
  },
  MPV,
);
add(
  {
    id: "libarchive",
    origin: `${ev}: clone of master; master head 2026-11-03T07:34:03Z-2026-11-05T15:48:49Z`,
    source: git(
      "https://github.com/libarchive/libarchive.git",
      "2774b74cb7269c9b5fa89e7d876b11d5a729c421",
    ),
  },
  MPV,
);
add(
  {
    id: "uchardet",
    origin: `${ev}: clone of tag v0.0.8; log 'switching to ae6302a0'`,
    source: git(
      "https://gitlab.freedesktop.org/uchardet/uchardet.git",
      "ae6302a016088ad07177f86d417b20010053632b",
    ),
  },
  MPV,
);
add(
  {
    id: "subrandr",
    origin: `${ev}: clone of master; master head 2026-11-03T15:24:27Z until after the build; crates per Cargo.lock (versions logged)`,
    source: git(
      "https://github.com/afishhh/subrandr.git",
      "a41311bb5e382abcc47ef141e2ea1098d22a8d58",
    ),
    extras: ["cargo-vendor"],
  },
  MPV,
);
add(
  {
    id: "mujs",
    origin: `${ev}: 'meson wrap install mujs' (1.3.8 revision 1)`,
    source: {
      type: "url",
      url: "https://github.com/ArtifexSoftware/mujs/archive/refs/tags/1.3.8.tar.gz",
      file: "mujs-1.3.8.tar.gz",
    },
  },
  MPV,
);
add(
  {
    id: "mujs-wrap-patch",
    origin: `${ev}: meson WrapDB patch for mujs 1.3.8-1`,
    source: {
      type: "url",
      url: "https://wrapdb.mesonbuild.com/v2/mujs_1.3.8-1/get_patch",
      file: "mujs_1.3.8-1_patch.zip",
    },
  },
  MPV,
);
add(
  {
    id: "cppwinrt",
    origin: `${ev}: header generator (build tool) cppwinrt 2.0.250303.1`,
    source: {
      type: "url",
      url: "https://github.com/microsoft/cppwinrt/archive/2.0.250303.1.tar.gz",
      file: "cppwinrt-2.0.250303.1.tar.gz",
    },
  },
  MPV,
);
add(
  {
    id: "winmd",
    origin: `${ev}: fetched by the cppwinrt CMake build ('HEAD is now at 0f1eae3')`,
    source: git(
      "https://github.com/microsoft/winmd.git",
      "0f1eae3bfa63fa2ba3c2912cbfe72a01db94cc5a",
    ),
  },
  MPV,
);
add(
  {
    id: "windows-rs-metadata",
    origin: `${ev}: tag 73, sparse crates/libs/bindgen/default (log 'switching to 65c0c07b')`,
    source: git(
      "https://github.com/microsoft/windows-rs.git",
      "65c0c07b5b88ac031cf56acddd9f892efee1634a",
      { paths: ["crates/libs/bindgen/default"], filter: "blob:none" },
    ),
  },
  MPV,
);
add(
  {
    id: "ffmpeg-builds-c63bb308",
    origin:
      "BtbN run 41885603216 pushed win64-lgpl@sha256:d2290020... and win64-gpl@sha256:146dd9a9... (build scripts, patches, toolchain config)",
    source: git("https://github.com/BtbN/FFmpeg-Builds.git", MPV_IMAGE),
  },
  MPV,
);

// --- ffmpeg.exe / ffprobe.exe: BtbN autobuild-2026-10-31-12-59 -------------
const FFX = ["ffmpeg.exe", "ffprobe.exe"];
add(
  {
    id: "ffmpeg-for-ffmpeg-exe",
    origin: "BtbN autobuild-2026-10-31-12-59, ffmpeg-N-128227-g4811625b5f-win64-gpl.zip",
    source: git("https://github.com/FFmpeg/FFmpeg.git", "4811625b5f4e5aed528aed9225d0ca868a8e6e96"),
  },
  FFX,
);
add(
  {
    id: "ffmpeg-builds-5031c6f1",
    origin: "BtbN scheduled run 41199749965 (published autobuild-2026-10-31-12-59)",
    source: git("https://github.com/BtbN/FFmpeg-Builds.git", FFEXE_IMAGE),
  },
  FFX,
);

// --- Image dependencies -------------------------------------------------------
for (const s of c63) if (enabledForWin64(s)) for (const c of fromStage(s, MPV_IMAGE)) add(c, MPV);
for (const s of s5031)
  if (enabledForWin64(s)) for (const c of fromStage(s, FFEXE_IMAGE)) add(c, FFX);

writeFileSync(process.argv[4], JSON.stringify({ schema: 1, components }, null, 2) + "\n");
console.log(`${components.length} components`);
for (const c of components)
  console.log(
    c.id.padEnd(28),
    c.source.type.padEnd(4),
    (c.source.commit ?? c.source.tag ?? c.source.revision ?? c.source.file ?? "")
      .toString()
      .slice(0, 14)
      .padEnd(15),
    c.usedBy.length === 4 ? "all" : c.usedBy.join(","),
  );
