/*
 * scripts/lib/zip.mjs
 *
 * Minimal, dependency-free ZIP reader for the setup scripts. Reads the central
 * directory of an in-memory archive and extracts single members (stored or
 * deflated), checking each member's CRC-32 against the directory. Enough for
 * the pinned upstream archives we fetch; no external `7z`/`unzip` needed, so
 * the same code path runs on every OS and CI runner.
 */

import { crc32, inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEndOfCentralDirectory(buf) {
  // The EOCD record is 22 bytes plus a comment of at most 65535 bytes.
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error("not a ZIP archive (end of central directory not found)");
}

/** Lists the archive's members: name -> { method, compressedSize, size, crc, localOffset }. */
export function listZip(buf) {
  const eocd = findEndOfCentralDirectory(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let dirOffset = buf.readUInt32LE(eocd + 16);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z64) !== ZIP64_EOCD) throw new Error("corrupt ZIP64 end record");
    count = Number(buf.readBigUInt64LE(z64 + 32));
    dirOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const members = new Map();
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error("corrupt ZIP central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    // ZIP64 extended information extra field (0x0001) for oversized values.
    for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; ) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (localOffset === 0xffffffff) localOffset = Number(buf.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    if (flags & 0x1) throw new Error(`ZIP member ${name} is encrypted`);
    members.set(name, { method, compressedSize, size, crc, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return members;
}

/** Extracts one member by exact path inside the archive; verifies size and CRC-32. */
export function extractZipMember(buf, name, members = listZip(buf)) {
  const m = members.get(name);
  if (!m) throw new Error(`${name} not found in archive`);
  const p = m.localOffset;
  if (buf.readUInt32LE(p) !== LOCAL) throw new Error(`corrupt local header for ${name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + m.compressedSize);
  let out;
  if (m.method === 0) out = Buffer.from(raw);
  else if (m.method === 8) out = inflateRawSync(raw);
  else throw new Error(`${name} uses unsupported ZIP compression method ${m.method}`);
  if (out.length !== m.size) throw new Error(`${name}: size ${out.length} != ${m.size}`);
  if (crc32(out) >>> 0 !== m.crc >>> 0) throw new Error(`${name}: CRC-32 mismatch`);
  return out;
}
