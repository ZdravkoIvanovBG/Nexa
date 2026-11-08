// Static (non-executing) parse of FFmpeg-Builds stage scripts.
// usage: node parse-stages.mjs <ffbuilds-dir> <out.json>
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const sd = join(root, "scripts.d");
const files = [];
for (const e of readdirSync(sd).sort()) {
  const p = join(sd, e);
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p).sort()) if (f.endsWith(".sh")) files.push(`${e}/${f}`);
  } else if (e.endsWith(".sh")) files.push(e);
}

const out = [];
for (const f of files) {
  const t = readFileSync(join(sd, f), "utf8").split("\r\n").join("\n");
  const vars = {};
  for (const m of t.matchAll(/^(SCRIPT_[A-Z0-9_]+)="?([^"\n]*)"?/gm)) vars[m[1]] = m[2];
  const fn = (name) => {
    const m = t.match(new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)^\\}`, "m"));
    return m ? m[1].trim() : null;
  };
  out.push({ stage: f, vars, enabled: fn("ffbuild_enabled"), dl: fn("ffbuild_dockerdl") });
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(`${out.length} stages parsed`);
