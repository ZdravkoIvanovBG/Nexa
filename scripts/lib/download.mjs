/*
 * scripts/lib/download.mjs
 *
 * Shared helper for the setup scripts (fetch-binaries, fetch-mpv, fetch-libmpv,
 * fetch-fonts): a bounded retry-with-backoff fetch, and a lightweight "is this
 * actually a native binary" check used to validate files before trusting them
 * (whether just-downloaded or restored from a CI cache).
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch `url`, retrying on transient failures with backoff.
 *
 * Retries on: network exceptions (DNS, connection reset, timeout), HTTP
 * 408/429/500/502/503/504, a body read failure, and a truncated body (fewer
 * bytes than the response's `content-length`).
 *
 * Does NOT retry other non-OK statuses (e.g. 403, 404) -- those fail immediately.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.label] log prefix, e.g. "[binaries]"
 * @param {Record<string,string>} [opts.headers]
 * @param {number[]} [opts.delays] backoff delays in ms between attempts (default: 5s/10s/20s)
 * @param {number} [opts.timeoutMs] per-attempt timeout
 * @returns {Promise<Buffer>}
 */
export async function downloadWithRetry(url, opts = {}) {
  const {
    label = "[download]",
    headers = {},
    delays = [5000, 10000, 20000],
    timeoutMs = 600000,
  } = opts;
  const attempts = delays.length + 1;

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(
        `${label} fetching ${url}${attempt > 1 ? ` (attempt ${attempt}/${attempts})` : ""}`,
      );
      const res = await fetch(url, {
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const err = new Error(`download failed (${res.status} ${res.statusText})`);
        err.status = res.status;
        if (!RETRYABLE_STATUS.has(res.status)) throw err; // permanent failure, no retry
        lastErr = err;
      } else {
        const expected = Number(res.headers.get("content-length") ?? "");
        const buf = Buffer.from(await res.arrayBuffer());
        if (Number.isFinite(expected) && expected > 0 && buf.length < expected) {
          lastErr = new Error(`truncated download (got ${buf.length} of ${expected} bytes)`);
        } else {
          return buf;
        }
      }
    } catch (err) {
      if (err?.status !== undefined && !RETRYABLE_STATUS.has(err.status)) throw err;
      lastErr = err;
    }

    if (attempt < attempts) {
      const delay = delays[attempt - 1];
      console.warn(
        `${label} attempt ${attempt}/${attempts} failed: ${lastErr.message}; retrying in ${delay / 1000}s`,
      );
      await sleep(delay);
    }
  }
  throw new Error(`${label} giving up after ${attempts} attempts: ${lastErr.message}`);
}

const MAGIC = [
  [0x4d, 0x5a], // MZ - PE (Windows .exe)
  [0x7f, 0x45, 0x4c, 0x46], // \x7fELF (Linux)
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64-bit
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64-bit (reversed)
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat binary
];

/**
 * Lightweight sanity check that `path` is a real native binary, not empty,
 * truncated, or an HTML error page saved with a binary extension. Does not
 * execute the file.
 */
export function isValidBinary(path, minBytes = 1_000_000) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return false;
  }
  if (stat.size < minBytes) return false;

  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(8);
    const read = readSync(fd, buf, 0, 8, 0);
    if (read < 4) return false;
    return MAGIC.some((magic) => magic.every((b, i) => buf[i] === b));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
