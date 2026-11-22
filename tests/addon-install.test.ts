// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  enabledAddonRows,
  localAddonIsNewer,
  managedAddonRows,
  MAX_ADDON_URL_LENGTH,
  parseAddonUrl,
  planAddonInstall,
  type PlannableAddon,
  withAddonEnabled,
} from "../src/lib/addon-install-plan.ts";
import { diffAddons } from "../src/lib/cloud/diff.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const TORRENTIO = "com.stremio.torrentio.addon";
const T_OLD = "https://torrentio.strem.fun/providers=yts/manifest.json";
const T_NEW = "https://torrentio.strem.fun/providers=yts,eztv|qualityfilter=480p/manifest.json";
const T_DUP = "https://torrentio.strem.fun/sort=size/manifest.json";

type Row = PlannableAddon & { name?: string };
const row = (id: string, transportUrl: string, order: number, extra: Partial<Row> = {}): Row => ({
  id,
  transportUrl,
  order,
  installedAt: 1000 + order,
  ...extra,
});

const installed = (): Row[] => [
  row("org.stremio.opensubtitlesv3", "https://opensubtitles-v3.strem.io/manifest.json", 0),
  row("com.linvo.cinemeta", "https://v3-cinemeta.strem.io/manifest.json", 1),
  row(TORRENTIO, T_OLD, 2, { enabled: false }),
];

/** Applies a plan the way installFromUrl does. */
function apply(before: Row[], url: string, id: string, opts = {}) {
  const plan = planAddonInstall(before, url, id, opts);
  const next: Row[] = [...plan.keep];
  next.push({
    id,
    transportUrl: url,
    installedAt: plan.previous?.installedAt ?? 9999,
    enabled: plan.previous?.enabled,
    order: plan.previous?.order ?? next.length,
  });
  return { plan, next };
}

// --- install / reconfigure / duplicates ---------------------------------------

test("a fresh install adds one row at the end", () => {
  const before = installed().slice(0, 2);
  const { plan, next } = apply(before, T_NEW, TORRENTIO);
  assert.equal(plan.replaced, false);
  assert.equal(next.length, 3);
  assert.deepEqual(next.slice(0, 2), before);
  assert.equal(next[2].order, 2);
});

test("a new Torrentio configuration replaces the installed one, keeping its place and state", () => {
  const before = installed();
  const { plan, next } = apply(before, T_NEW, TORRENTIO);
  assert.equal(plan.replaced, true);
  const torrentio = next.filter((a) => a.id === TORRENTIO);
  assert.equal(torrentio.length, 1, "no duplicate");
  assert.equal(torrentio[0].transportUrl, T_NEW);
  assert.equal(torrentio[0].order, 2, "same position");
  assert.equal(torrentio[0].enabled, false, "same enabled state");
  assert.equal(torrentio[0].installedAt, 1002, "install date kept");
  // Every other addon is untouched.
  assert.deepEqual(
    next.filter((a) => a.id !== TORRENTIO),
    before.slice(0, 2),
  );
});

test("reinstalling the identical configuration replaces it instead of duplicating", () => {
  const { plan, next } = apply(installed(), T_OLD, TORRENTIO);
  assert.equal(plan.replaced, true);
  assert.equal(next.filter((a) => a.transportUrl === T_OLD).length, 1);
  assert.equal(next.length, 3);
});

test("pre-existing duplicates are preserved; only one row is replaced", () => {
  const before = [...installed(), row(TORRENTIO, T_DUP, 3)];
  const { next } = apply(before, T_NEW, TORRENTIO);
  const urls = next.filter((a) => a.id === TORRENTIO).map((a) => a.transportUrl);
  assert.deepEqual(
    urls.sort(),
    [T_DUP, T_NEW].sort(),
    "the first (by order) was replaced, the duplicate kept",
  );
  assert.equal(next.length, 4);
});

test("Reconfigure replaces exactly the installation it was opened from", () => {
  const before = [...installed(), row(TORRENTIO, T_DUP, 3, { enabled: true })];
  const { plan, next } = apply(before, T_NEW, TORRENTIO, { replaceTransportUrl: T_DUP });
  assert.equal(plan.previous?.transportUrl, T_DUP);
  const urls = next.filter((a) => a.id === TORRENTIO).map((a) => a.transportUrl);
  assert.deepEqual(urls.sort(), [T_NEW, T_OLD].sort(), "the other Torrentio row is kept");
  assert.equal(next.find((a) => a.transportUrl === T_NEW)?.order, 3);
});

test("an explicit target that is no longer installed falls back to the id rule", () => {
  const { plan } = apply(installed(), T_NEW, TORRENTIO, {
    replaceTransportUrl: "https://gone/manifest.json",
  });
  assert.equal(plan.previous?.transportUrl, T_OLD);
});

test("the install modal's hostname match still supersedes the other id", () => {
  const before = [row("old.torrentio.id", T_OLD, 0), row("x", "https://x/manifest.json", 1)];
  const { plan, next } = apply(before, T_NEW, TORRENTIO, { replaceId: "old.torrentio.id" });
  assert.equal(plan.replaced, true);
  assert.deepEqual(
    next.map((a) => a.id),
    ["x", TORRENTIO],
  );
  assert.equal(next[1].order, 0);
});

test("a replaceId equal to the new id is ignored, as before", () => {
  const { plan } = apply(installed(), T_NEW, TORRENTIO, { replaceId: TORRENTIO });
  assert.equal(plan.previous?.transportUrl, T_OLD);
});

// --- cloud sync ----------------------------------------------------------------

test("cloud sync of a reconfiguration deletes the old URL and adds the new one", () => {
  const before = installed();
  const { next } = apply(before, T_NEW, TORRENTIO);
  const delta = diffAddons(before as never, next as never);
  assert.deepEqual(delta.deletes, [T_OLD]);
  assert.deepEqual(
    delta.upserts.map((a: Row) => a.transportUrl),
    [T_NEW],
  );
});

test("cloud sync of a fresh install only adds", () => {
  const before = installed().slice(0, 2);
  const { next } = apply(before, T_NEW, TORRENTIO);
  const delta = diffAddons(before as never, next as never);
  assert.deepEqual(delta.deletes, []);
  assert.deepEqual(
    delta.upserts.map((a: Row) => a.transportUrl),
    [T_NEW],
  );
});

// --- URL validation ---------------------------------------------------------------

test("stremio:// install links and configure pages become https manifest URLs", () => {
  assert.deepEqual(parseAddonUrl("stremio://torrentio.strem.fun/providers=yts/manifest.json"), {
    kind: "ok",
    url: "https://torrentio.strem.fun/providers=yts/manifest.json",
  });
  assert.deepEqual(parseAddonUrl("  https://torrentio.strem.fun/configure  "), {
    kind: "ok",
    url: "https://torrentio.strem.fun/manifest.json",
  });
  assert.deepEqual(parseAddonUrl("https://torrentio.strem.fun/#/configure"), {
    kind: "ok",
    url: "https://torrentio.strem.fun/manifest.json",
  });
});

test("unexpected install URLs are rejected", () => {
  for (const bad of [
    "",
    "   ",
    "javascript:alert(1)",
    "file:///C:/Windows/win.ini",
    "data:application/json,{}",
    "ftp://example.com/manifest.json",
    "harbor://open",
    "stremio:/missing-slash",
    "torrentio.strem.fun/manifest.json",
  ]) {
    assert.equal(parseAddonUrl(bad).kind, "error", JSON.stringify(bad));
  }
  const long = "https://x.example/" + "a".repeat(MAX_ADDON_URL_LENGTH) + "/manifest.json";
  assert.equal(parseAddonUrl(long).kind, "error");
});

// --- wiring --------------------------------------------------------------------------

const store = read("src/lib/addon-store.ts");
const viewport = read("src/components/installer-viewport.tsx");
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
const libRs = read("src-tauri/src/lib.rs");
const captureRs = read("src-tauri/src/installer_capture.rs");

test("installFromUrl validates with parseAddonUrl and applies the shared plan", () => {
  const fn = store.match(/export async function installFromUrl[\s\S]*?\n}\n/)?.[0];
  assert.ok(fn);
  assert.match(fn, /parseAddonUrl\(rawUrl\)/);
  assert.match(fn, /planAddonInstall\(loadInstalled\(\), parsed\.url, id, options\)/);
  assert.match(
    store,
    /export \{ MAX_ADDON_URL_LENGTH, parseAddonUrl \} from "\.\/addon-install-plan";/,
  );
});

test("the installer arms a per-session token and names its iframe with it", () => {
  assert.match(viewport, /crypto\.getRandomValues\(bytes\)/);
  assert.match(viewport, /invoke\("installer_capture_arm", \{ token: captureToken \}\)/);
  assert.match(viewport, /invoke\("installer_capture_disarm", \{ token: captureToken \}\)/);
  assert.match(viewport, /name=\{`\$\{INSTALLER_FRAME_PREFIX\}\$\{captureToken\}`\}/);
  assert.match(viewport, /if \(token !== captureToken \|\| typeof captured !== "string"\) return;/);
  assert.match(captureRs, /pub const INSTALLER_FRAME_PREFIX: &str = "harbor-installer-";/);
  assert.match(viewport, /export const INSTALLER_FRAME_PREFIX = "harbor-installer-";/);
});

test("postMessage install links are accepted only from the installer's own iframe", () => {
  assert.match(viewport, /if \(!frame \|\| e\.source !== frame\) return;/);
});

test("the installer replaces the configuration it was opened for", () => {
  assert.match(viewport, /installFromUrl\(normalized, \{ replaceTransportUrl \}\)/);
  assert.match(
    read("src/views/addons/addon-detail.tsx"),
    /\{ replaceTransportUrl: resolved\.transportUrl \}/,
  );
  assert.match(
    read("src/views/addons/install-modal.tsx"),
    /replaceTransportUrl: mode\.kind === "manage" \? mode\.existing\.transportUrl : undefined/,
  );
});

test("capture is hooked natively and its commands are registered", () => {
  assert.match(libRs, /#\[cfg\(windows\)\]\s*installer_capture::install\(&app\.handle\(\)\);/);
  assert.match(libRs, /installer_capture::installer_capture_arm,/);
  assert.match(libRs, /installer_capture::installer_capture_disarm,/);
  assert.match(libRs, /\.manage\(installer_capture::InstallerCaptureState::default\(\)\)/);
});

test("the stremio deep-link scheme registration is unchanged", () => {
  assert.deepEqual(conf.plugins["deep-link"].desktop.schemes, ["harbor", "stremio"]);
  assert.doesNotMatch(captureRs, /deep_link\(\)|register\(/);
});

test("no install link, transport or manifest URL is logged", () => {
  assert.doesNotMatch(captureRs, /eprintln!\([^)]*uri/);
  assert.doesNotMatch(read("src-tauri/src/browser.rs"), /captured install link: \{\}", s\)/);
  const picker = read("src/views/play-picker/use-addons.ts");
  assert.doesNotMatch(picker, /console\.\w+\([^)]*transportUrl/);
});

test("the CSP only adds stremio: to frame-src, so the installer iframe's link reaches the capture hook", () => {
  const base =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' asset: https://asset.localhost data: blob: https: http:; media-src 'self' asset: https://asset.localhost blob: https: http:; connect-src 'self' ipc: http://ipc.localhost https: http: ws: wss:; font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com; object-src 'none'; frame-src https: stremio:; base-uri 'self'";
  // Without stremio: the CSP turns the iframe's own navigation into an error
  // page before the hook can cancel it. Every iframe of the main webview is
  // hooked and never navigates to stremio: (it is always cancelled).
  assert.equal(conf.app.security.csp, base);
  assert.equal(conf.app.security.devCsp, base);
  assert.match(captureRs, /Decision::Cancel => \{\s*args\.SetCancel\(true\)\?;/);
  assert.match(captureRs, /Decision::Capture => \{\s*args\.SetCancel\(true\)\?;/);
});

test("bundles never replace or duplicate an addon that is already installed", () => {
  const bundle = read("src/lib/addons-store/install-bundle.ts");
  assert.match(bundle, /a\.transportUrl === parsed\.url \|\| a\.id === item\.id/);
  // The "already" check runs before installFromUrl, which would otherwise
  // replace the user's configured installation with the bundle's default.
  assert.ok(bundle.indexOf("alreadyInstalled") < bundle.indexOf("await installFromUrl("));
});

// --- disable / enable --------------------------------------------------------------

type TRow = Row & { updatedAt?: number };
const ids = (rows: readonly { id: string }[]) => rows.map((a) => a.id);
const OS = "org.stremio.opensubtitlesv3";
const CM = "com.linvo.cinemeta";
const enabledAll = (): TRow[] => installed().map((a) => ({ ...a, enabled: true, updatedAt: 500 }));

test("turning an addon off keeps it installed and listed, with its switch off", () => {
  const next = withAddonEnabled(enabledAll(), T_OLD, false, 2000)!;
  // The Installed tab still lists all three, in order; Torrentio is just off.
  assert.deepEqual(ids(managedAddonRows(next)), [OS, CM, TORRENTIO]);
  assert.equal(managedAddonRows(next)[2].enabled, false);
  assert.equal(next[2].order, 2);
  // Catalogs, streams and subtitles skip it.
  assert.deepEqual(ids(enabledAddonRows(next)), [OS, CM]);
});

test("turning it back on restores it everywhere, in the same place", () => {
  const off = withAddonEnabled(enabledAll(), T_OLD, false, 2000)!;
  const on = withAddonEnabled(off, T_OLD, true, 3000)!;
  assert.deepEqual(ids(managedAddonRows(on)), [OS, CM, TORRENTIO]);
  assert.deepEqual(ids(enabledAddonRows(on)), [OS, CM, TORRENTIO]);
  assert.equal(on[2].enabled, true);
  assert.equal(on[2].order, 2);
  assert.equal(on[2].transportUrl, T_OLD);
});

test("a toggle changes only that addon, stamps it, and is a no-op when nothing changes", () => {
  const before = enabledAll();
  const next = withAddonEnabled(before, T_OLD, false, 2000)!;
  assert.deepEqual(next.slice(0, 2), before.slice(0, 2));
  assert.equal(next[2].updatedAt, 2000);
  assert.equal(next.length, before.length);
  assert.equal(withAddonEnabled(next, T_OLD, false, 3000), null);
  assert.equal(withAddonEnabled(before, "https://not-installed/manifest.json", false, 3000), null);
  // A row with no enabled field counts as on.
  const legacy = before.map(({ enabled: _e, ...a }) => a);
  assert.equal(withAddonEnabled(legacy, T_OLD, true, 3000), null);
});

test("a pre-existing duplicate is toggled on its own", () => {
  const before: TRow[] = [...enabledAll(), row(TORRENTIO, T_DUP, 3, { enabled: true })];
  const next = withAddonEnabled(before, T_DUP, false, 2000)!;
  assert.equal(next.length, 4);
  assert.equal(next[2].enabled, true);
  assert.equal(next[3].enabled, false);
  assert.deepEqual(ids(managedAddonRows(next)), [OS, CM, TORRENTIO, TORRENTIO]);
});

test("reconfiguring a disabled addon keeps it installed, disabled and in place", () => {
  const off = withAddonEnabled(enabledAll(), T_OLD, false, 2000)!;
  const { plan, next } = apply(off, T_NEW, TORRENTIO, { replaceTransportUrl: T_OLD });
  assert.equal(plan.replaced, true);
  const listed = managedAddonRows(next);
  assert.deepEqual(ids(listed), [OS, CM, TORRENTIO]);
  assert.equal(listed[2].transportUrl, T_NEW);
  assert.equal(listed[2].enabled, false);
  assert.equal(listed[2].order, 2);
  assert.deepEqual(ids(enabledAddonRows(next)), [OS, CM]);
});

// --- sync after restart ---------------------------------------------------------------

test("disabling syncs as an update of that one row, never a delete", () => {
  const before = enabledAll();
  const next = withAddonEnabled(before, T_OLD, false, 2000)!;
  const delta = diffAddons(before as never, next as never);
  assert.deepEqual(delta.deletes, []);
  assert.deepEqual(
    delta.upserts.map((a) => [a.transportUrl, a.enabled]),
    [[T_OLD, false]],
  );
  const back = diffAddons(next as never, withAddonEnabled(next, T_OLD, true, 3000) as never);
  assert.deepEqual(back.deletes, []);
  assert.deepEqual(
    back.upserts.map((a) => [a.transportUrl, a.enabled]),
    [[T_OLD, true]],
  );
});

test("after a restart a toggle the cloud has not seen yet is kept, not overwritten", () => {
  // The cloud still has the older, enabled copy (the push never landed).
  const cloud = { ...enabledAll()[2] };
  const local = withAddonEnabled(enabledAll(), T_OLD, false, 2000)![2];
  assert.equal(localAddonIsNewer(local, cloud), true, "local disabled copy is uploaded");
  // Without the stamp (the old toggle), the stale cloud copy won the merge.
  assert.equal(localAddonIsNewer({ ...local, updatedAt: cloud.updatedAt }, cloud), false);
});

test("after a restart a synced toggle comes back from the cloud as it was", () => {
  const local = withAddonEnabled(enabledAll(), T_OLD, false, 2000)![2];
  const cloud = { ...local }; // the mirror upserted it with the same stamp
  assert.equal(localAddonIsNewer(local, cloud), false, "the cloud copy is taken");
  assert.equal(cloud.enabled, false);
  // A toggle made elsewhere later wins over this device's older copy.
  const elsewhere: TRow = { ...local, enabled: true, updatedAt: 3000 };
  assert.equal(localAddonIsNewer(local, elsewhere), false);
});

test("the Installed tab lists disabled addons; content queries still skip them", () => {
  const store = read("src/lib/addon-store.ts");
  const catalog = read("src/lib/addons-store/store.ts");
  const hydrate = read("src/lib/cloud/hydrate.ts");
  // The Addons screens' installed list (tab, badges, count) is every installed row.
  assert.match(catalog, /fetchInstalledAddonsList\(\)[^{]*\{\s*return managedAddonsResolved\(\)/);
  assert.match(
    store,
    /managedAddonsResolved\(\)[^{]*\{\s*return resolveEntries\(managedAddonRows\(loadInstalled\(\)\)\)/,
  );
  // Catalogs, streams and subtitles keep the enabled-only list.
  assert.match(
    store,
    /orderedEnabledEntries\(\)[^{]*\{\s*return enabledAddonRows\(loadInstalled\(\)\)/,
  );
  assert.match(
    store,
    /installedAddonsResolved\(\)[^{]*\{\s*return resolveEntries\(orderedEnabledEntries\(\)\)/,
  );
  // The toggle edits that one row, and the cloud merge honours its stamp.
  assert.match(
    store,
    /withAddonEnabled\(loadInstalled\(\), transportUrl, enabled, Date\.now\(\)\)/,
  );
  assert.match(hydrate, /if \(localAddonIsNewer\(mine, remote\)\) uploads\.push\(mine\);/);
});
