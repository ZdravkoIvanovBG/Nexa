// @ts-nocheck -- Node's test modules are not included in the application tsconfig.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { configBundleFiles, nsisBundleFiles } from "../scripts/lib/bundle-files.mjs";

// The shape of a Tauri-generated installer.nsi (trimmed).
const NSI = String.raw`
!define MAINBINARYNAME "harbor"
!define MAINBINARYSRCPATH "D:\a\Nexa\Nexa\src-tauri\target\x86_64-pc-windows-msvc\release\harbor.exe"
!define BUNDLEID "app.harbor"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${"$"}{WEBVIEW2BOOTSTRAPPERPATH}"
  File "${"$"}{MAINBINARYSRCPATH}"
    File /a "/oname=mpv.exe" "D:\a\Nexa\Nexa\src-tauri\binaries\mpv-x86_64-pc-windows-msvc.exe"
    File /a "/oname=libmpv-2.dll" "D:\a\Nexa\Nexa\src-tauri\libmpv\libmpv-2.dll"
    File /a "/oname=licenses\mpv\LICENSE.GPL" "D:\a\Nexa\Nexa\src-tauri\licenses\mpv\LICENSE.GPL"
    File /a "/oname=ffprobe.exe" "D:\a\Nexa\Nexa\src-tauri\binaries\ffprobe-x86_64-pc-windows-msvc.exe"
`;

test("the NSIS script gives exactly the installed files and their sources", () => {
  const files = nsisBundleFiles(NSI);
  assert.deepEqual([...files.keys()].sort(), [
    "ffprobe.exe",
    "harbor.exe",
    "libmpv-2.dll",
    "licenses/mpv/LICENSE.GPL",
    "mpv.exe",
  ]);
  assert.equal(
    files.get("harbor.exe"),
    String.raw`D:\a\Nexa\Nexa\src-tauri\target\x86_64-pc-windows-msvc\release\harbor.exe`,
  );
  assert.equal(
    files.get("licenses/mpv/LICENSE.GPL"),
    String.raw`D:\a\Nexa\Nexa\src-tauri\licenses\mpv\LICENSE.GPL`,
  );
  // The WebView2 bootstrapper is unpacked to $TEMP, not installed.
  assert.ok(![...files.keys()].some((k) => k.includes("Webview2")));
});

test("a file the script doesn't pack is simply absent (the verifier then fails)", () => {
  const files = nsisBundleFiles(NSI.replace(/^.*oname=ffprobe.*$/m, ""));
  assert.equal(files.has("ffprobe.exe"), false);
  assert.equal(nsisBundleFiles("").size, 0);
});

test("the bundle configuration resolves resources, globs and sidecars to source files", () => {
  const listed = {
    "/src/fonts": ["NotoSansJP-Bold.otf", "LICENSE-OFL-NotoSansJP.txt"],
    "/src/licenses/mpv": ["LICENSE.GPL"],
  };
  const files = configBundleFiles({
    srcTauri: "/src",
    resources: {
      "libmpv/libmpv-2.dll": "libmpv-2.dll",
      "fonts/*": "fonts/",
      "licenses/mpv/*": "licenses/mpv/",
    },
    externalBin: ["binaries/ffmpeg", "binaries/yt-dlp"],
    triple: "x86_64-pc-windows-msvc",
    listDir: (d) => listed[d.replace(/\\/g, "/")] ?? [],
  });
  const norm = (p) => p.replace(/\\/g, "/");
  assert.equal(norm(files.get("libmpv-2.dll")), "/src/libmpv/libmpv-2.dll");
  assert.equal(norm(files.get("fonts/NotoSansJP-Bold.otf")), "/src/fonts/NotoSansJP-Bold.otf");
  assert.equal(norm(files.get("licenses/mpv/LICENSE.GPL")), "/src/licenses/mpv/LICENSE.GPL");
  assert.equal(norm(files.get("ffmpeg.exe")), "/src/binaries/ffmpeg-x86_64-pc-windows-msvc.exe");
  assert.equal(norm(files.get("yt-dlp.exe")), "/src/binaries/yt-dlp-x86_64-pc-windows-msvc.exe");
  assert.throws(() =>
    configBundleFiles({ srcTauri: "/src", resources: ["a"], triple: "t", listDir: () => [] }),
  );
});

test("the workflows verify what ships, never tauri-build's copies next to the exe", () => {
  const read = (p) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
  assert.match(
    read(".github/workflows/release.yml"),
    /run: node scripts\/verify-mpv-bundle\.mjs src-tauri\/target\/x86_64-pc-windows-msvc\/release x64\r?\n/,
    "the release checks the installer it built (installer.nsi mode)",
  );
  assert.match(
    read(".github/workflows/app-build.yml"),
    /run: node scripts\/verify-mpv-bundle\.mjs src-tauri\/target\/release x64 --no-bundle\r?\n/,
  );
  const verifier = read("scripts/verify-mpv-bundle.mjs");
  assert.match(verifier, /join\(dir, "nsis", arch, "installer\.nsi"\)/);
  assert.match(verifier, /if \(!setups\.length\) problems\.push/);
  assert.doesNotMatch(
    verifier,
    /existsSync\(join\(dir, f\)\)/,
    "no checks against copies in the release dir",
  );
});
