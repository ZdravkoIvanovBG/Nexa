import { useSyncExternalStore } from "react";
import { safeFetch } from "@/lib/safe-fetch";
import { unzip } from "@/lib/unzip";

export type AwardPack = {
  name: string;
  author?: string;
  version?: string;
  description?: string;
  icons: Record<string, string>;
};

type State = { packs: AwardPack[]; custom: Record<string, string> };

const KEY = "harbor.awardpacks.v1";

function load(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<State>;
    return { packs: Array.isArray(raw.packs) ? raw.packs : [], custom: raw.custom ?? {} };
  } catch {
    return { packs: [], custom: {} };
  }
}

let state: State = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota: keep in-memory */
  }
  emit();
}

export function resolveAwardIcon(key: string): string | undefined {
  if (state.custom[key]) return state.custom[key];
  for (let i = state.packs.length - 1; i >= 0; i -= 1) {
    const url = state.packs[i].icons?.[key];
    if (url) return url;
  }
  return undefined;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useAwardIcon(key: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => resolveAwardIcon(key),
    () => resolveAwardIcon(key),
  );
}

export function useAwardPacks(): { packs: AwardPack[]; custom: Record<string, string> } {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export async function installPackFromUrl(url: string): Promise<AwardPack> {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const pack = (await res.json()) as AwardPack;
  if (!pack?.name || typeof pack.icons !== "object") throw new Error("Not a valid award pack");
  state = { ...state, packs: [...state.packs.filter((p) => p.name !== pack.name), pack] };
  persist();
  return pack;
}

export function installAwardPack(pack: AwardPack): void {
  state = { ...state, packs: [...state.packs.filter((p) => p.name !== pack.name), pack] };
  persist();
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

async function toIconDataUrl(name: string, bytes: Uint8Array): Promise<string | null> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "svg") return `data:image/svg+xml;base64,${bytesToBase64(bytes)}`;
  const mime = MIME[ext];
  if (!mime) return null;
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const scale = Math.min(1, 96 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/webp", 0.85);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function normAlias(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

let aliasCache: Map<string, string> | null = null;

export function keyForFilename(base: string): string | undefined {
  if (!aliasCache) {
    const m = new Map<string, string>();
    const add = (alias: string, key: string) => {
      const a = normAlias(alias);
      if (a && !m.has(a)) m.set(a, key);
    };
    for (const g of AWARD_ICON_REGISTRY) {
      for (const it of g.items) {
        add(it.key, it.key);
        if (it.label.includes("/")) for (const part of it.label.split("/")) add(part, it.key);
        else add(it.label, it.key);
      }
    }
    aliasCache = m;
  }
  return aliasCache.get(normAlias(base));
}

export async function installPackFromFiles(
  files: File[],
  packName = "My icons",
): Promise<{ name: string; matched: number; unmatched: string[] }> {
  const icons: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = await toIconDataUrl(file.name, bytes);
    if (!url) continue;
    const key = keyForFilename(file.name.replace(/\.[^.]+$/, ""));
    if (key) icons[key] = url;
    else unmatched.push(file.name);
  }
  if (Object.keys(icons).length === 0) {
    throw new Error("No files matched an award ID. Name each file after its award (oscar.png).");
  }
  const pack: AwardPack = { name: packName, author: "Uploaded", icons };
  state = { ...state, packs: [...state.packs.filter((p) => p.name !== pack.name), pack] };
  persist();
  return { name: packName, matched: Object.keys(icons).length, unmatched };
}

export async function installPackFromZip(
  file: File,
): Promise<{ name: string; matched: number; unmatched: string[] }> {
  const entries = await unzip(await file.arrayBuffer());
  const icons: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const [name, bytes] of entries) {
    if (name.startsWith("__MACOSX") || name.includes("/.")) continue;
    const url = await toIconDataUrl(name, bytes);
    if (!url) continue;
    const base = (name.split("/").pop() ?? name).replace(/\.[^.]+$/, "");
    const key = keyForFilename(base);
    if (key) icons[key] = url;
    else unmatched.push(name.split("/").pop() ?? name);
  }
  if (Object.keys(icons).length === 0) {
    throw new Error("No files matched an award ID. Name each file after its award (oscar.png).");
  }
  const name = file.name.replace(/\.zip$/i, "") || "Imported pack";
  const pack: AwardPack = { name, author: "Imported", icons };
  state = { ...state, packs: [...state.packs.filter((p) => p.name !== pack.name), pack] };
  persist();
  return { name, matched: Object.keys(icons).length, unmatched };
}

export function removePack(name: string): void {
  state = { ...state, packs: state.packs.filter((p) => p.name !== name) };
  persist();
}

export function setCustomIcon(key: string, dataUrl: string): void {
  state = { ...state, custom: { ...state.custom, [key]: dataUrl } };
  persist();
}

export function clearCustomIcon(key: string): void {
  const custom = { ...state.custom };
  delete custom[key];
  state = { ...state, custom };
  persist();
}

export type AwardIconGroup = { title: string; items: Array<{ key: string; label: string }> };

export const AWARD_ICON_REGISTRY: AwardIconGroup[] = [
  {
    title: "Film & TV",
    items: [
      { key: "oscar", label: "Academy Award" },
      { key: "emmy", label: "Emmy" },
      { key: "golden_globe", label: "Golden Globe" },
      { key: "bafta", label: "BAFTA" },
      { key: "bafta_tv", label: "BAFTA Television" },
      { key: "sag", label: "SAG Award" },
      { key: "critics_choice", label: "Critics' Choice" },
      { key: "cannes", label: "Cannes" },
      { key: "venice", label: "Venice" },
      { key: "berlin", label: "Berlinale" },
      { key: "annie", label: "Annie Award" },
      { key: "spirit", label: "Spirit Award" },
      { key: "saturn", label: "Saturn Award" },
      { key: "cesar", label: "César Award" },
      { key: "goya", label: "Goya Award" },
      { key: "blue_dragon", label: "Blue Dragon" },
      { key: "baeksang", label: "Baeksang" },
      { key: "bifa", label: "BIFA" },
    ],
  },
];
