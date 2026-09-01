import { resolveAddonLogo } from "@/components/addon-logo";
import type { Addon } from "@/lib/addons";
import { hostOf } from "@/lib/addons-store/reorder";
import type { OrganizeEntry } from "./section-card";

export type Notice = { tone: "info" | "danger"; text: string; retry?: boolean; reload?: boolean };

export function urlsOf(items: Array<{ transportUrl: string }>): string[] {
  return items.map((i) => i.transportUrl);
}

export function entriesOf(
  items: Array<{ transportUrl: string; manifest?: Addon["manifest"] }>,
): OrganizeEntry[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = seen.get(item.transportUrl) ?? 0;
    seen.set(item.transportUrl, n + 1);
    const host = hostOf(item.transportUrl);
    return {
      key: `${item.transportUrl}#${n}`,
      name: item.manifest?.name ?? host,
      host,
      addonId: item.manifest?.id ?? item.transportUrl,
      logo: resolveAddonLogo(item.manifest?.logo, item.transportUrl),
    };
  });
}
