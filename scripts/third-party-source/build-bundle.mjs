/*
 * scripts/third-party-source/build-bundle.mjs
 *
 * Assembles the Corresponding Source for the third-party GPL/LGPL binaries
 * Nexa ships on Windows (libmpv-2.dll, mpv.exe, ffmpeg.exe, ffprobe.exe) from
 * the exact revisions recorded in components.json, and writes:
 *
 *   <out>/bundle/sources/<id>.tar.gz          one archive per component
 *   <out>/bundle/sources/<id>.<extra>...      vendored crates, model data, wraps
 *   <out>/bundle/MANIFEST.json                resolved commits + file hashes
 *   <out>/bundle/SHA256SUMS
 *   <out>/bundle/COMPONENT-LICENSES.txt       top-level license files, all components
 *
 * Git sources are exported with `git archive` (byte-exact, symlinks and file
 * modes kept, no CRLF conversion); submodules and the dependency checkouts a
 * stage's download step performs are appended under the same prefix, so each
 * component archive unpacks to the tree the original build used.
 *
 * This is a maintainer tool: it downloads several GB and is NOT run in CI. It is
 * resumable (finished components are recorded in <out>/state). See
 * docs/third-party-source.md.
 *
 * usage: node scripts/third-party-source/build-bundle.mjs <out-dir> [--only id,id] [--evidence dir]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir) {
  console.error("usage: build-bundle.mjs <out-dir> [--only id,id] [--evidence dir]");
  process.exit(2);
}
const opt = (name) => {
  const i = args.indexOf(name);
  return i > 0 ? args[i + 1] : undefined;
};
const only = opt("--only")?.split(",");
const evidenceDir = opt("--evidence");

const { components } = JSON.parse(readFileSync(join(here, "components.json"), "utf8"));
const WORK = join(outDir, "work");
const STATE = join(outDir, "state");
const BUNDLE = join(outDir, "bundle");
const SOURCES = join(BUNDLE, "sources");
for (const d of [WORK, STATE, SOURCES]) mkdirSync(d, { recursive: true });

const BSDTAR = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
const UA = "nexa-third-party-source-bundle";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sha256File = (p) =>
  new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(p)
      .on("data", (d) => h.update(d))
      .on("end", () => res(h.digest("hex")))
      .on("error", rej);
  });

function git(cwd, ...a) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.eol=lf",
      "-c",
      "core.symlinks=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "advice.detachedHead=false",
      ...a,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 },
  )
    .toString()
    .trim();
}

function retry(fn, label, n = 3) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= n) throw e;
      log(
        `  retry ${i}/${n - 1} ${label}: ${String(e.stderr ?? e.message)
          .trim()
          .split("\n")
          .pop()}`,
      );
    }
  }
}

/** Fetch one revision of a git repository into `dir`; returns the resolved commit. */
function gitFetch(dir, src, { checkout = true } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  const urls = [src.url, ...(src.mirrors ?? [])];
  const ref = src.commit ?? `refs/tags/${src.tag}`;
  const filter = src.filter ? [`--filter=${src.filter}`] : [];
  let used;
  let lastErr;
  for (const url of urls) {
    try {
      try {
        git(dir, "remote", "remove", "origin");
      } catch {}
      git(dir, "remote", "add", "origin", url);
      try {
        retry(
          () => git(dir, "fetch", "-q", "--depth=1", "--no-tags", ...filter, "origin", ref),
          url,
        );
      } catch {
        // Some servers refuse fetching an arbitrary commit; fall back to a full fetch.
        retry(
          () =>
            git(
              dir,
              "fetch",
              "-q",
              "--no-tags",
              ...filter,
              "origin",
              "+refs/heads/*:refs/remotes/origin/*",
              "+refs/tags/*:refs/tags/*",
            ),
          `${url} (full)`,
        );
      }
      used = url;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!used) throw lastErr;
  let commit;
  if (src.commit) commit = git(dir, "rev-parse", `${src.commit}^{commit}`);
  else {
    // A full fetch creates refs/tags/<tag>; a shallow fetch of the tag only sets FETCH_HEAD.
    try {
      commit = git(dir, "rev-parse", `refs/tags/${src.tag}^{commit}`);
    } catch {
      commit = git(dir, "rev-parse", "FETCH_HEAD^{commit}");
    }
  }
  if (src.commit && commit !== src.commit)
    throw new Error(`resolved ${commit} != pinned ${src.commit}`);
  if (checkout) git(dir, "checkout", "-q", "--detach", commit);
  else git(dir, "update-ref", "--no-deref", "HEAD", commit);
  return { commit, fetchedFrom: used };
}

/** Offset of the end-of-archive marker of a tar file (start of its zero blocks). */
function tarEnd(file) {
  const fd = openSync(file, "r");
  const hdr = Buffer.alloc(512);
  let off = 0;
  try {
    for (;;) {
      if (readSync(fd, hdr, 0, 512, off) < 512 || hdr.every((b) => b === 0)) return off;
      const sizeField = hdr.subarray(124, 136);
      const size =
        sizeField[0] & 0x80
          ? Number(sizeField.readBigUInt64BE(4))
          : parseInt(sizeField.toString("latin1").split("\u0000")[0].trim() || "0", 8);
      off += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    closeSync(fd);
  }
}

/** Concatenate tar archives (each without its end marker) into `out`, then gzip. */
async function concatTarsGz(parts, outGz) {
  const tmp = `${outGz}.tar.partial`;
  const wfd = openSync(tmp, "w");
  const buf = Buffer.alloc(1 << 20);
  for (const p of parts) {
    const end = tarEnd(p);
    const rfd = openSync(p, "r");
    for (let off = 0; off < end; ) {
      const n = readSync(rfd, buf, 0, Math.min(buf.length, end - off), off);
      writeSync(wfd, buf, 0, n);
      off += n;
    }
    closeSync(rfd);
  }
  writeSync(wfd, Buffer.alloc(1024));
  closeSync(wfd);
  await pipeline(
    createReadStream(tmp),
    createGzip({ level: 9 }),
    createWriteStream(`${outGz}.partial`),
  );
  rmSync(tmp);
  renameAtomic(`${outGz}.partial`, outGz);
}

function renameAtomic(from, to) {
  rmSync(to, { force: true });
  copyFileSync(from, to);
  rmSync(from);
}

function gitArchive(dir, prefix, outTar, pathspec = []) {
  git(dir, "archive", "--format=tar", `--prefix=${prefix}`, "-o", outTar, "HEAD", ...pathspec);
  return outTar;
}

async function download(url, dest, headers = {}) {
  let lastErr;
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, ...headers }, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const b = Buffer.from(await r.arrayBuffer());
      writeFileSync(dest, b);
      return b;
    } catch (e) {
      lastErr = e;
      log(`  download retry ${i}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw lastErr;
}

// --- Subversion over WebDAV (no svn client needed) ---------------------------
// FFmpeg-Builds checks some repositories out as user "anonymous" with an empty
// password (svn.xvid.org answers 401 otherwise); do the same on a 401.
let svnAuth = {};
async function dav(url, method, body, headers = {}) {
  const go = () =>
    fetch(url, {
      method,
      body,
      headers: { "user-agent": UA, "content-type": "text/xml", ...svnAuth, ...headers },
    });
  let r = await go();
  if (r.status === 401 && !svnAuth.authorization) {
    svnAuth = { authorization: `Basic ${Buffer.from("anonymous:").toString("base64")}` };
    r = await go();
  }
  if (!r.ok && r.status !== 207) throw new Error(`${method} ${url}: HTTP ${r.status}`);
  return { headers: r.headers, text: await r.text() };
}

async function svnExport(src, destDir) {
  svnAuth = {};
  const opts = await dav(
    src.url,
    "OPTIONS",
    '<?xml version="1.0" encoding="utf-8"?><D:options xmlns:D="DAV:"><D:activity-collection-set/></D:options>',
  );
  const u = new URL(src.url);
  const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
  let root = opts.headers.get("svn-repository-root"); // HTTPv2 servers
  let base;
  if (root) {
    root = root.replace(/\/$/, "");
    base = `${u.origin}${root}/!svn/rvr/${src.revision}${path.slice(root.length)}`;
  } else {
    // HTTPv1 servers: derive the root from the baseline-relative-path property.
    const { text } = await dav(
      src.url,
      "PROPFIND",
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><S:baseline-relative-path xmlns:S="http://subversion.tigris.org/xmlns/dav/"/></D:prop></D:propfind>',
      { depth: "0" },
    );
    const brp = text.match(/baseline-relative-path>([^<]*)</)?.[1];
    if (brp === undefined)
      throw new Error(`cannot determine the SVN repository root of ${src.url}`);
    root = path.slice(0, path.length - brp.replace(/\/$/, "").length).replace(/\/$/, "");
    base = `${u.origin}${root}/!svn/bc/${src.revision}/${brp.replace(/\/$/, "")}`;
  }
  const files = [];
  const walk = async (dirUrl, relDir) => {
    const { text } = await dav(
      `${dirUrl}/`,
      "PROPFIND",
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
      { depth: "1" },
    );
    const responses = text.split(/<D:response>|<D:response [^>]*>/i).slice(1);
    for (const resp of responses) {
      const href = decodeURIComponent(resp.match(/<D:href>([^<]*)<\/D:href>/i)[1]).replace(
        /\/$/,
        "",
      );
      const name = href.split("/").pop();
      if (href === decodeURIComponent(new URL(dirUrl).pathname).replace(/\/$/, "")) continue;
      const isDir = /<D:collection\s*\/>/i.test(resp);
      const childUrl = `${dirUrl}/${encodeURIComponent(name)}`;
      if (isDir) await walk(childUrl, `${relDir}${name}/`);
      else files.push({ url: childUrl, rel: `${relDir}${name}` });
    }
  };
  await walk(base, "");
  log(`  svn r${src.revision}: ${files.length} files`);
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(
      files.slice(i, i + 8).map(async (f) => {
        const p = join(destDir, f.rel);
        mkdirSync(dirname(p), { recursive: true });
        await download(f.url, p, svnAuth);
      }),
    );
  }
  return files.length;
}

// --- License collection ------------------------------------------------------
const LICENSE_RE = /^(copying|licen[cs]e|copyright|notice|unlicense|patents)([-_. ].*)?$/i;
const licenses = [];
function collectGitLicenses(id, dir, prefix = "") {
  const names = git(dir, "ls-tree", "--name-only", "HEAD")
    .split("\n")
    .filter((n) => LICENSE_RE.test(n));
  for (const n of names) {
    const type = git(dir, "cat-file", "-t", `HEAD:${n}`);
    if (type !== "blob") continue;
    const text = execFileSync("git", ["cat-file", "blob", `HEAD:${n}`], {
      cwd: dir,
      maxBuffer: 1 << 26,
    });
    if (text.length > 512 * 1024) continue;
    licenses.push({ id, file: `${prefix}${n}`, text: text.toString("utf8") });
  }
}
/** License texts kept outside the top level: explicit files, or a header's leading comment. */
function collectExtraLicenses(c, dir) {
  for (const p of c.licensePaths ?? []) {
    const text = execFileSync("git", ["cat-file", "blob", `HEAD:${p}`], {
      cwd: dir,
      maxBuffer: 1 << 26,
    });
    licenses.push({ id: c.id, file: p, text: text.toString("utf8") });
  }
  if (c.licenseHeaderOf) {
    const src = execFileSync("git", ["cat-file", "blob", `HEAD:${c.licenseHeaderOf}`], {
      cwd: dir,
      maxBuffer: 1 << 26,
    }).toString("utf8");
    const end = src.indexOf("*/");
    if (!src.trimStart().startsWith("/*") || end < 0)
      throw new Error(`${c.id}: no leading comment in ${c.licenseHeaderOf}`);
    licenses.push({
      id: c.id,
      file: `${c.licenseHeaderOf} (leading comment)`,
      text: src.slice(0, end + 2),
    });
  }
}
/** Top-level license files inside a downloaded .tar.gz / .zip (one directory deep at most). */
function collectArchiveLicenses(id, archive) {
  const names = execFileSync(BSDTAR, ["-tf", archive], { maxBuffer: 1 << 26 })
    .toString()
    .split(/\r?\n/)
    .filter((n) => n && !n.endsWith("/") && n.split("/").length <= 2)
    .filter((n) => LICENSE_RE.test(n.split("/").pop()));
  for (const n of names) {
    const text = execFileSync(BSDTAR, ["-xOf", archive, n], { maxBuffer: 1 << 26 });
    licenses.push({ id, file: n, text: text.toString("utf8") });
  }
}
function collectDirLicenses(id, dir) {
  for (const n of readdirSync(dir)) {
    if (LICENSE_RE.test(n) && statSync(join(dir, n)).isFile())
      licenses.push({ id, file: n, text: readFileSync(join(dir, n), "utf8") });
  }
}

// --- Per-component extras ------------------------------------------------------
async function cargoVendor(id, dir, result) {
  const vendorRoot = join(WORK, `${id}.vendor`);
  rmSync(vendorRoot, { recursive: true, force: true });
  mkdirSync(vendorRoot, { recursive: true });
  execFileSync(
    "cargo",
    [
      "vendor",
      "--versioned-dirs",
      "--locked",
      "--manifest-path",
      join(dir, "Cargo.toml"),
      join(vendorRoot, "vendor"),
    ],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, CARGO_TERM_PROGRESS_WHEN: "never" },
    },
  );
  const out = join(SOURCES, `${id}.cargo-vendor.tar.gz`);
  execFileSync(BSDTAR, ["-czf", out, "-C", vendorRoot, "vendor"]);
  const crates = readdirSync(join(vendorRoot, "vendor")).sort();
  result.extras.push({
    kind: "cargo-vendor",
    file: relative(BUNDLE, out).replaceAll("\\", "/"),
    crates: crates.length,
  });
  log(`  cargo vendor: ${crates.length} crates`);
}

function parseShadercDeps(dir) {
  const text = readFileSync(join(dir, "DEPS"), "utf8");
  const vars = Object.fromEntries(
    [...text.matchAll(/'(\w+)'\s*:\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
  );
  const depsBlock = text.slice(text.indexOf("deps = {"));
  const deps = [];
  for (const m of depsBlock.matchAll(
    /'([^']+)'\s*:\s*((?:Var\('\w+'\)|'[^']*')(?:\s*\+\s*(?:Var\('\w+'\)|'[^']*'))*)/g,
  )) {
    const value = [...m[2].matchAll(/Var\('(\w+)'\)|'([^']*)'/g)]
      .map((p) => (p[1] ? vars[p[1]] : p[2]))
      .join("");
    const [url, rev] = value.split("@");
    deps.push({ path: m[1], url, commit: rev });
  }
  return deps;
}

async function opusModel(id, dir, result) {
  const autogen = readFileSync(join(dir, "autogen.sh"), "utf8");
  const hash = autogen.match(/download_model\.sh\s+"?([0-9a-f]{64})"?/)?.[1];
  if (!hash) throw new Error("opus: model hash not found in autogen.sh");
  const script = readFileSync(join(dir, "dnn", "download_model.sh"), "utf8");
  const baseUrl = script.match(/https:\/\/media\.xiph\.org\/opus\/models\/?/)?.[0];
  if (!baseUrl) throw new Error("opus: model URL not found in dnn/download_model.sh");
  const name = `opus_data-${hash}.tar.gz`;
  const out = join(SOURCES, `${id}.${name}`);
  await download(`${baseUrl.replace(/\/?$/, "/")}${name}`, out);
  const got = await sha256File(out);
  if (got !== hash) throw new Error(`opus model sha256 ${got} != ${hash}`);
  result.extras.push({
    kind: "opus-model",
    file: relative(BUNDLE, out).replaceAll("\\", "/"),
    sha256: got,
  });
}

async function mesonWrap(id, dir, wrapName, result) {
  const text = readFileSync(join(dir, "subprojects", `${wrapName}.wrap`), "utf8");
  const kv = Object.fromEntries(
    [...text.matchAll(/^(\w+)\s*=\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]),
  );
  if (/\[wrap-git\]/.test(text)) {
    const sub = join(WORK, `${id}.wrap-${wrapName}`);
    const r = gitFetch(sub, {
      url: kv.url,
      commit: /^[0-9a-f]{40}$/.test(kv.revision) ? kv.revision : undefined,
      tag: /^[0-9a-f]{40}$/.test(kv.revision) ? undefined : kv.revision,
    });
    const tar = gitArchive(sub, `${id}/subprojects/${kv.directory ?? wrapName}/`, `${sub}.tar`);
    result.extras.push({ kind: "meson-wrap-git", wrap: wrapName, url: kv.url, commit: r.commit });
    return tar;
  }
  const out = join(SOURCES, `${id}.${kv.source_filename}`);
  await download(kv.source_url, out);
  const got = await sha256File(out);
  if (kv.source_hash && got !== kv.source_hash)
    throw new Error(`${wrapName} wrap sha256 ${got} != ${kv.source_hash}`);
  result.extras.push({
    kind: "meson-wrap-file",
    wrap: wrapName,
    url: kv.source_url,
    file: relative(BUNDLE, out).replaceAll("\\", "/"),
    sha256: got,
  });
  return null;
}

// --- Main loop -----------------------------------------------------------------
async function buildComponent(c) {
  const result = {
    id: c.id,
    usedBy: c.usedBy,
    origins: c.origins,
    source: c.source,
    extras: [],
    files: [],
  };
  const dir = join(WORK, c.id);
  const s = c.source;
  if (s.type === "git") {
    const pathsOnly = Boolean(s.paths);
    const r = gitFetch(dir, s, { checkout: !pathsOnly });
    result.resolvedCommit = r.commit;
    result.fetchedFrom = r.fetchedFrom;
    const parts = [];
    let pathspec = [];
    if (pathsOnly) {
      const top = git(dir, "ls-tree", "--name-only", "HEAD")
        .split("\n")
        .filter((n) => LICENSE_RE.test(n));
      pathspec = ["--", ...s.paths, ...top];
    } else if (s.exclude) {
      pathspec = ["--", ".", ...s.exclude.map((e) => `:(exclude)${e}`)];
    }
    parts.push(gitArchive(dir, `${c.id}/`, `${dir}.tar`, pathspec));
    collectGitLicenses(c.id, dir);
    collectExtraLicenses(c, dir);
    if (s.submodules) {
      const paths = Array.isArray(s.submodules) ? ["--", ...s.submodules] : [];
      retry(
        () => git(dir, "submodule", "update", "--init", "--recursive", "--depth=1", ...paths),
        "submodules",
        2,
      );
      const status = git(dir, "submodule", "status", "--recursive")
        .split("\n")
        .filter(Boolean)
        // "-" marks a submodule that was not initialized (not part of the build's tree)
        .filter((l) => !l.startsWith("-"))
        .map((l) => l.trim().replace(/^[+U]/, "").split(/\s+/))
        .map(([sha, path]) => ({ path, commit: sha }));
      result.submodules = status;
      for (const sm of status) {
        const smDir = join(dir, sm.path);
        parts.push(
          gitArchive(
            smDir,
            `${c.id}/${sm.path}/`,
            join(WORK, `${c.id}.sm-${sm.path.replace(/[\\/]/g, "_")}.tar`),
          ),
        );
      }
    }
    for (const extra of c.extras ?? []) {
      if (extra === "cargo-vendor") await cargoVendor(c.id, dir, result);
      else if (extra === "opus-model") await opusModel(c.id, dir, result);
      else if (extra.startsWith("meson-wrap:")) {
        const tar = await mesonWrap(c.id, dir, extra.slice(11), result);
        if (tar) parts.push(tar);
      } else if (extra === "shaderc-deps") {
        const deps = parseShadercDeps(dir);
        result.syncedDeps = [];
        for (const d of deps) {
          const sub = join(WORK, `${c.id}.dep-${d.path.replace(/[\\/]/g, "_")}`);
          const r2 = gitFetch(sub, { url: d.url, commit: d.commit });
          parts.push(gitArchive(sub, `${c.id}/${d.path}/`, `${sub}.tar`));
          collectGitLicenses(c.id, sub, `${d.path}/`);
          result.syncedDeps.push({ path: d.path, url: d.url, commit: r2.commit });
        }
      } else throw new Error(`unknown extra ${extra}`);
    }
    const out = join(SOURCES, `${c.id}.tar.gz`);
    await concatTarsGz(parts, out);
    for (const p of parts) rmSync(p, { force: true });
  } else if (s.type === "svn") {
    rmSync(dir, { recursive: true, force: true });
    const tree = join(dir, c.id);
    mkdirSync(tree, { recursive: true });
    result.files_in_tree = await svnExport(s, tree);
    collectDirLicenses(c.id, tree);
    execFileSync(BSDTAR, ["-czf", join(SOURCES, `${c.id}.tar.gz`), "-C", dir, c.id]);
  } else if (s.type === "url") {
    const out = join(SOURCES, `${c.id}.${s.file}`);
    await download(s.url, out);
    if (/\.(tar\.gz|zip)$/.test(s.file)) collectArchiveLicenses(c.id, out);
  }
  for (const f of readdirSync(SOURCES)
    .filter((f) => f.startsWith(`${c.id}.`))
    .sort()) {
    const p = join(SOURCES, f);
    result.files.push({
      file: `sources/${f}`,
      size: statSync(p).size,
      sha256: await sha256File(p),
    });
  }
  // keep the license texts with the state so a resumed run can rebuild COMPONENT-LICENSES.txt
  result.licenses = licenses.filter((l) => l.id === c.id);
  return result;
}

const results = [];
let failed = 0;
for (const c of components) {
  if (only && !only.includes(c.id)) continue;
  const stateFile = join(STATE, `${c.id}.json`);
  if (existsSync(stateFile)) {
    results.push(JSON.parse(readFileSync(stateFile, "utf8")));
    continue;
  }
  log(
    `${c.id}  (${c.source.url ?? ""} ${c.source.commit ?? c.source.tag ?? c.source.revision ?? ""})`,
  );
  try {
    const r = await buildComponent(c);
    writeFileSync(stateFile, JSON.stringify(r, null, 1));
    results.push(r);
    rmSync(join(WORK, c.id), { recursive: true, force: true });
    for (const f of readdirSync(WORK))
      if (f.startsWith(`${c.id}.`)) rmSync(join(WORK, f), { recursive: true, force: true });
    log(`  ok ${r.files.map((f) => `${f.file} ${(f.size / 1048576).toFixed(1)}MB`).join(", ")}`);
  } catch (e) {
    failed++;
    log(
      `  FAILED ${c.id}: ${String(e.stderr ?? "")
        .trim()
        .split("\n")
        .slice(-3)
        .join(" | ")} ${e.message}`,
    );
  }
}

if (only || failed) {
  log(`${results.length} components done, ${failed} failed${only ? " (partial run)" : ""}`);
  process.exit(failed ? 1 : 0);
}

// --- Bundle metadata --------------------------------------------------------------
if (evidenceDir) {
  mkdirSync(join(BUNDLE, "evidence"), { recursive: true });
  for (const f of readdirSync(evidenceDir))
    copyFileSync(join(evidenceDir, f), join(BUNDLE, "evidence", f));
}
copyFileSync(join(here, "components.json"), join(BUNDLE, "components.json"));
copyFileSync(join(here, "BUNDLE-README.txt"), join(BUNDLE, "README.txt"));

const lic = [];
const seenText = new Map();
for (const r of results) {
  for (const l of r.licenses ?? []) {
    const h = createHash("sha256").update(l.text).digest("hex");
    lic.push(`${"=".repeat(78)}\n${r.id}: ${l.file}\n${"=".repeat(78)}\n`);
    if (seenText.has(h)) lic.push(`(identical to ${seenText.get(h)} above)\n\n`);
    else {
      seenText.set(h, `${r.id}: ${l.file}`);
      lic.push(`${l.text.replace(/\r\n/g, "\n").trimEnd()}\n\n`);
    }
  }
}
writeFileSync(
  join(BUNDLE, "COMPONENT-LICENSES.txt"),
  `License files of every component in this bundle, as found at the top level of\neach source tree (and of each submodule / synced dependency).\n\n${lic.join("")}`,
);

const manifest = results.map(({ licenses: l, ...r }) => ({
  ...r,
  licenseFiles: (l ?? []).map((x) => x.file),
}));
writeFileSync(
  join(BUNDLE, "MANIFEST.json"),
  `${JSON.stringify({ schema: 1, components: manifest }, null, 2)}\n`,
);

const sums = [];
const walkAll = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const p = join(d, e.name);
    if (e.isDirectory()) walkAll(p);
    else if (e.name !== "SHA256SUMS") sums.push(p);
  }
};
walkAll(BUNDLE);
const lines = [];
for (const p of sums)
  lines.push(`${await sha256File(p)}  ${relative(BUNDLE, p).replaceAll("\\", "/")}`);
writeFileSync(join(BUNDLE, "SHA256SUMS"), `${lines.join("\n")}\n`);
log(`bundle ready: ${results.length} components, ${sums.length} files in ${BUNDLE}`);
