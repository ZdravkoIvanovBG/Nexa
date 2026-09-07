import { convertFileSrc } from "@tauri-apps/api/core";

export function gameAssetSrc(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return /^https?:\/\//i.test(path) ? path : convertFileSrc(path);
}
