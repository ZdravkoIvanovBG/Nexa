import { installFromUrl, loadInstalled, parseAddonUrl } from "@/lib/addon-store";
import type { Bundle, BundleItem } from "./bundles";

export type BundleItemResult =
  | { item: BundleItem; status: "installed" | "already" }
  | { item: BundleItem; status: "failed"; message: string };

/**
 * Installs every item in a bundle, one at a time. Sequential (not Promise.all)
 * because installFromUrl -> saveInstalled does a read-modify-write of a single
 * localStorage key -- concurrent writes would interleave and drop rows.
 *
 * Never throws: a dead addon is reported as a failed result so the rest of the
 * bundle still installs.
 */
export async function installBundle(
  bundle: Bundle,
  onProgress?: (done: number, total: number) => void,
): Promise<BundleItemResult[]> {
  const results: BundleItemResult[] = [];
  const total = bundle.items.length;
  for (const item of bundle.items) {
    try {
      const parsed = parseAddonUrl(item.transportUrl);
      if (parsed.kind === "error") {
        results.push({ item, status: "failed", message: parsed.message });
        continue;
      }
      const alreadyInstalled = loadInstalled().some((a) => a.transportUrl === parsed.url);
      if (alreadyInstalled) {
        results.push({ item, status: "already" });
        continue;
      }
      await installFromUrl(parsed.url);
      results.push({ item, status: "installed" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Install failed.";
      results.push({ item, status: "failed", message });
    } finally {
      onProgress?.(results.length, total);
    }
  }
  return results;
}
