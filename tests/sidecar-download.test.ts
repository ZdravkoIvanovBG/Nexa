// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { createServer } from "node:http";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { tmpdir } from "node:os";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { join } from "node:path";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { downloadWithRetry, isValidBinary } from "../scripts/lib/download.mjs";

/** Starts a local HTTP server whose responses are driven by `handler`, and returns its base URL + a close function. */
function startServer(
  handler: (req: any, res: any) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

test("downloadWithRetry retries transient 503s and eventually succeeds", async () => {
  let hits = 0;
  const { url, close } = await startServer((_req, res) => {
    hits += 1;
    if (hits < 3) {
      res.writeHead(503);
      res.end("Service Unavailable");
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok-body");
    }
  });
  try {
    const buf = await downloadWithRetry(url, { label: "[test]", delays: [0, 0, 0] });
    assert.equal(buf.toString(), "ok-body");
    assert.equal(hits, 3);
  } finally {
    await close();
  }
});

test("downloadWithRetry does not retry a permanent 404", async () => {
  let hits = 0;
  const { url, close } = await startServer((_req, res) => {
    hits += 1;
    res.writeHead(404);
    res.end("Not Found");
  });
  try {
    await assert.rejects(() => downloadWithRetry(url, { label: "[test]", delays: [0, 0, 0] }));
    assert.equal(hits, 1);
  } finally {
    await close();
  }
});

test("downloadWithRetry recovers from a connection dropped mid-response", async () => {
  let hits = 0;
  const { url, close } = await startServer((_req, res) => {
    hits += 1;
    if (hits === 1) {
      res.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("recovered");
  });
  try {
    const buf = await downloadWithRetry(url, { label: "[test]", delays: [0, 0, 0] });
    assert.equal(buf.toString(), "recovered");
    assert.equal(hits, 2);
  } finally {
    await close();
  }
});

test("downloadWithRetry treats a truncated content-length body as retryable", async () => {
  let hits = 0;
  const { url, close } = await startServer((_req, res) => {
    hits += 1;
    if (hits === 1) {
      // Claim a larger body than actually sent -- looks truncated on the client side.
      res.writeHead(200, { "content-type": "text/plain", "content-length": "1000" });
      res.end("short");
    } else {
      res.writeHead(200, { "content-type": "text/plain", "content-length": "4" });
      res.end("full");
    }
  });
  try {
    const buf = await downloadWithRetry(url, { label: "[test]", delays: [0, 0, 0] });
    assert.equal(buf.toString(), "full");
    assert.equal(hits, 2);
  } finally {
    await close();
  }
});

test("isValidBinary rejects missing, empty, small, and non-binary files; accepts a real header", () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-sidecar-test-"));
  try {
    assert.equal(isValidBinary(join(dir, "does-not-exist.exe")), false);

    const empty = join(dir, "empty.exe");
    writeFileSync(empty, "");
    assert.equal(isValidBinary(empty), false);

    const small = join(dir, "small.exe");
    writeFileSync(small, "MZ", "latin1");
    assert.equal(isValidBinary(small), false);

    // Padded with the "utf8" encoding's 2-byte-per-char rejection: write raw
    // latin1 bytes so the on-disk byte count matches the string length.
    const padding = "\0".repeat(2_000_000);

    const html = join(dir, "error-page.exe");
    writeFileSync(html, `<html>503</html>${padding}`, "latin1");
    assert.equal(isValidBinary(html), false);

    const real = join(dir, "real.exe");
    writeFileSync(real, `MZ${padding}`, "latin1");
    assert.equal(isValidBinary(real), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
