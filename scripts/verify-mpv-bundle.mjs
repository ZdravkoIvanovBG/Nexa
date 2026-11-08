/*
 * verify-mpv-bundle.mjs <release-dir> [x64|arm64]
 *
 * After `tauri build`, checks the staged Windows bundle directory (the files
 * NSIS packs, e.g. src-tauri/target/x86_64-pc-windows-msvc/release) for the
 * exact pinned mpv files, the license texts, and that harbor.exe imports only
 * libmpv entry points the shipped libmpv-2.dll exports. Exits non-zero on any
 * mismatch. Read-only.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./lib/mpv-fetch.mjs";
import { MPV_LICENSE_MEMBERS, MPV_PINS, MPV_VERSION } from "./lib/mpv-pins.mjs";
import { inspectPe, nonSystemImports } from "./lib/pe.mjs";

const dir = process.argv[2];
const arch = process.argv[3] ?? "x64";
if (!dir || !MPV_PINS[arch]) {
  console.error("usage: node scripts/verify-mpv-bundle.mjs <release-dir> [x64|arm64]");
  process.exit(2);
}

const problems = [];
const check = (file, want) => {
  const p = join(dir, file);
  if (!existsSync(p)) {
    problems.push(`${file} is missing`);
    return null;
  }
  const buf = readFileSync(p);
  const got = sha256(buf);
  if (got !== want) problems.push(`${file} sha256 ${got} != pinned ${want}`);
  else console.log(`ok  ${file}  ${got}`);
  return buf;
};

const dll = check("libmpv-2.dll", MPV_PINS[arch].libmpv.memberSha256);
check("mpv.exe", MPV_PINS[arch].mpv.memberSha256);
check("licenses/mpv/LICENSE.LGPL", MPV_LICENSE_MEMBERS.libmpv.sha256);
check("licenses/mpv/LICENSE.GPL", MPV_LICENSE_MEMBERS.mpv.sha256);
for (const f of [
  "licenses/THIRD-PARTY-NOTICES.txt",
  "licenses/ffmpeg/COPYING.GPLv3",
  "licenses/ffmpeg/COPYING.LGPLv3",
  "licenses/mpv/Copyright",
]) {
  if (!existsSync(join(dir, f))) problems.push(`${f} is missing`);
}

const appPath = join(dir, "harbor.exe");
if (dll && existsSync(appPath)) {
  const app = inspectPe(readFileSync(appPath));
  const exported = new Set(inspectPe(dll).exports);
  const used = app.importFunctions["libmpv-2.dll"] ?? [];
  const missing = used.filter((f) => !exported.has(f));
  if (!used.length) problems.push("harbor.exe does not import libmpv-2.dll");
  if (missing.length)
    problems.push(`harbor.exe needs libmpv functions the DLL lacks: ${missing.join(", ")}`);
  const foreign = nonSystemImports([...app.imports, ...app.delayImports], ["libmpv-2.dll"]);
  if (foreign.length) problems.push(`harbor.exe imports unexpected DLLs: ${foreign.join(", ")}`);
  if (!missing.length && used.length)
    console.log(`ok  harbor.exe imports ${used.length} libmpv functions, all exported`);
} else if (!existsSync(appPath)) {
  problems.push("harbor.exe is missing");
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log(`bundle in ${dir} carries the pinned mpv ${MPV_VERSION} (${arch}) binaries`);
