/**
 * Recommended Bundles: curated, hardcoded groups of addons that install together
 * in one click. Deliberately separate from CURATED_ADDONS/CURATED_RAILS in
 * curated.ts -- a bundle is an install action, not a catalog entry.
 */

export type BundleItem = {
  /** Canonical manifest URL, fed straight to installFromUrl. */
  transportUrl: string;
  /** The manifest's own `id`, known ahead of time -- used for logo matching. */
  id: string;
  /** Display fallback shown before the manifest resolves. */
  name: string;
  role: string;
  /** True => surface a post-install "Configure" affordance for this item. */
  configurable?: boolean;
};

export type Bundle = {
  id: string;
  title: string;
  blurb: string;
  items: BundleItem[];
};

export const BUNDLES: Bundle[] = [
  {
    id: "essentials",
    title: "The Essentials",
    blurb:
      "Streams, subtitles, and catalogs -- everything a fresh install needs to play something tonight.",
    items: [
      {
        transportUrl: "https://torrentio.strem.fun/manifest.json",
        id: "com.stremio.torrentio.addon",
        name: "Torrentio",
        role: "Streams",
        configurable: true,
      },
      {
        transportUrl: "https://opensubtitles-v3.strem.io/manifest.json",
        id: "org.stremio.opensubtitlesv3",
        name: "OpenSubtitles v3",
        role: "Subtitles",
      },
      {
        transportUrl: "https://v3-cinemeta.strem.io/manifest.json",
        id: "com.linvo.cinemeta",
        name: "Cinemeta",
        role: "Catalogs & metadata",
      },
    ],
  },
];

export function bundleById(id: string): Bundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}
