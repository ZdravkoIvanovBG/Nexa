/*
 * scripts/lib/mpv-fetch.mjs
 *
 * Shared acquisition for fetch-libmpv.mjs and fetch-mpv.mjs. A file already on
 * disk is trusted only if its SHA-256 equals the pin; anything else is
 * rejected and replaced. Downloads verify the archive hash, extract the one
 * member, verify its hash, then check the PE machine type and that every DLL
 * it imports is part of Windows. Never resolves a "latest" build.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { downloadWithRetry } from "./download.mjs";
import { MPV_LICENSE_MEMBERS, MPV_PINS, MPV_RELEASE_URL, MPV_VERSION } from "./mpv-pins.mjs";
import { inspectPe, nonSystemImports } from "./pe.mjs";
import { extractZipMember, listZip } from "./zip.mjs";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Ensures `dest` holds the pinned `kind` ("libmpv" | "mpv") for `arch`.
 * `verify(buf, pe)` runs extra checks on the extracted file before it is written.
 * Returns the file's bytes.
 */
export async function ensurePinnedMpvFile({
  kind,
  arch,
  dest,
  label,
  verify = () => {},
  licenseCopy,
}) {
  const spec = MPV_PINS[arch][kind];
  const machine = MPV_PINS[arch].machine;
  const lic = MPV_LICENSE_MEMBERS[kind];
  // The license text Nexa ships next to the binary must be the archive's own, byte for byte.
  if (licenseCopy) {
    const got = existsSync(licenseCopy) ? sha256(readFileSync(licenseCopy)) : "missing";
    if (got !== lic.sha256) {
      throw new Error(
        `${label} ${licenseCopy} is not the ${lic.member} from the mpv ${MPV_VERSION} archive (sha256 ${got})`,
      );
    }
  }

  if (existsSync(dest)) {
    const cached = readFileSync(dest);
    const got = sha256(cached);
    if (got === spec.memberSha256) {
      checkBinary(cached, machine, `${label} cached ${spec.member}`);
      verify(cached, inspectPe(cached));
      console.log(
        `${label} ${spec.member} (mpv ${MPV_VERSION}, ${arch}) already present and verified`,
      );
      return cached;
    }
    console.warn(
      `${label} rejecting ${dest}: SHA-256 ${got} is not the pinned mpv ${MPV_VERSION} ${arch} ${spec.member} (${spec.memberSha256}); replacing it`,
    );
    rmSync(dest, { force: true });
  }

  const base = process.env.HARBOR_MPV_RELEASE_URL ?? MPV_RELEASE_URL;
  const url = `${base}/${spec.archive}`;
  const archive = await downloadWithRetry(url, { label });
  const archiveHash = sha256(archive);
  if (archiveHash !== spec.sha256) {
    throw new Error(
      `${label} archive checksum mismatch for ${spec.archive} (expected ${spec.sha256}, got ${archiveHash})`,
    );
  }
  const members = listZip(archive);
  const file = extractZipMember(archive, spec.member, members);
  const fileHash = sha256(file);
  if (fileHash !== spec.memberSha256) {
    throw new Error(
      `${label} ${spec.member} checksum mismatch (expected ${spec.memberSha256}, got ${fileHash})`,
    );
  }
  checkBinary(file, machine, `${label} ${spec.member}`);
  verify(file, inspectPe(file));

  const licenseText = extractZipMember(archive, lic.member, members);
  if (sha256(licenseText) !== lic.sha256)
    throw new Error(`${label} ${lic.member} in ${spec.archive} changed`);

  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  writeFileSync(tmp, file);
  renameSync(tmp, dest);
  console.log(`${label} wrote ${dest} (mpv ${MPV_VERSION} ${arch}, sha256 ${fileHash})`);
  return file;
}

function checkBinary(buf, machine, what) {
  const pe = inspectPe(buf);
  if (pe.machine !== machine) {
    throw new Error(
      `${what} is built for machine 0x${pe.machine.toString(16)}, expected 0x${machine.toString(16)}`,
    );
  }
  const foreign = nonSystemImports([...pe.imports, ...pe.delayImports]);
  if (foreign.length)
    throw new Error(`${what} imports DLLs that are not part of Windows: ${foreign.join(", ")}`);
}

/** The mpv_* entry points listed in src-tauri/libmpv/libmpv.def (the import library's API). */
export function libmpvApi(defPath) {
  return readFileSync(defPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((name) => name.startsWith("mpv_"));
}
