/*
 * scripts/lib/pe.mjs
 *
 * Read-only Portable Executable inspection for the setup scripts: machine
 * type, imported DLLs (normal and delay-load) and exported function names.
 * Bytes are parsed from a buffer; nothing is loaded or executed.
 */

export const MACHINE = { x64: 0x8664, arm64: 0xaa64 };

export function inspectPe(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file (no MZ header)");
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error("not a PE file (no PE signature)");
  const machine = buf.readUInt16LE(pe + 4);
  const sectionCount = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const pe32plus = buf.readUInt16LE(opt) === 0x20b;
  const dataDirs = opt + (pe32plus ? 112 : 96);
  const dir = (i) => ({
    rva: buf.readUInt32LE(dataDirs + i * 8),
    size: buf.readUInt32LE(dataDirs + i * 8 + 4),
  });
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = opt + optSize + i * 40;
    sections.push({
      va: buf.readUInt32LE(s + 12),
      vsize: buf.readUInt32LE(s + 8),
      raw: buf.readUInt32LE(s + 20),
      rsize: buf.readUInt32LE(s + 16),
    });
  }
  const offset = (rva) => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rsize)) return rva - s.va + s.raw;
    }
    throw new Error(`RVA 0x${rva.toString(16)} is outside every section`);
  };
  const cstr = (o) => buf.toString("latin1", o, buf.indexOf(0, o));

  const imports = [];
  const importFunctions = {};
  const imp = dir(1);
  if (imp.rva) {
    for (let o = offset(imp.rva); buf.readUInt32LE(o + 12); o += 20) {
      const dll = cstr(offset(buf.readUInt32LE(o + 12)));
      imports.push(dll);
      // Import lookup table (falls back to the IAT when the ILT is absent).
      const table = buf.readUInt32LE(o) || buf.readUInt32LE(o + 16);
      const names = [];
      const step = pe32plus ? 8 : 4;
      for (let t = offset(table); ; t += step) {
        const entry = pe32plus ? buf.readBigUInt64LE(t) : BigInt(buf.readUInt32LE(t));
        if (entry === 0n) break;
        const byOrdinal = pe32plus ? entry >> 63n === 1n : (entry & 0x80000000n) !== 0n;
        names.push(
          byOrdinal ? `#${Number(entry & 0xffffn)}` : cstr(offset(Number(entry & 0x7fffffffn)) + 2),
        );
      }
      importFunctions[dll.toLowerCase()] = names;
    }
  }
  const delayImports = [];
  const dl = dir(13);
  if (dl.rva) {
    for (let o = offset(dl.rva); buf.readUInt32LE(o + 4); o += 32)
      delayImports.push(cstr(offset(buf.readUInt32LE(o + 4))));
  }
  const exports = [];
  const exp = dir(0);
  if (exp.rva) {
    const e = offset(exp.rva);
    const names = buf.readUInt32LE(e + 24);
    const nameTable = offset(buf.readUInt32LE(e + 32));
    for (let i = 0; i < names; i++) exports.push(cstr(offset(buf.readUInt32LE(nameTable + i * 4))));
  }
  return { machine, imports, importFunctions, delayImports, exports };
}

// DLLs that ship with every supported Windows 10/11 installation. The api-ms-win-*
// API sets (UCRT and core) are resolved by the loader and match by prefix.
const SYSTEM_DLLS = new Set(
  [
    "advapi32",
    "avicap32",
    "avrt",
    "bcrypt",
    "bcryptprimitives",
    "cfgmgr32",
    "comctl32",
    "comdlg32",
    "crypt32",
    "d2d1",
    "d3d11",
    "d3d12",
    "d3d9",
    "d3dcompiler_47",
    "dbghelp",
    "dnsapi",
    "dwmapi",
    "dwrite",
    "dxgi",
    "dxva2",
    "gdi32",
    "gdiplus",
    "hid",
    "imm32",
    "iphlpapi",
    "kernel32",
    "mf",
    "mfplat",
    "mfreadwrite",
    "msimg32",
    "mswsock",
    "ncrypt",
    "netapi32",
    "normaliz",
    "ntdll",
    "ole32",
    "oleaut32",
    "opengl32",
    "powrprof",
    "propsys",
    "psapi",
    "rpcrt4",
    "secur32",
    "setupapi",
    "shcore",
    "shell32",
    "shlwapi",
    "user32",
    "userenv",
    "usp10",
    "uxtheme",
    "version",
    "winhttp",
    "wininet",
    "winmm",
    "winspool",
    "ws2_32",
    "wsock32",
    "wtsapi32",
  ].map((n) => `${n}.dll`),
);

/** DLL names a pinned binary imports that are not part of Windows itself. */
export function nonSystemImports(names, allowed = []) {
  const extra = new Set(allowed.map((n) => n.toLowerCase()));
  return names.filter((n) => {
    const l = n.toLowerCase();
    return !(
      l.startsWith("api-ms-win-") ||
      l.startsWith("ext-ms-") ||
      SYSTEM_DLLS.has(l) ||
      extra.has(l)
    );
  });
}
