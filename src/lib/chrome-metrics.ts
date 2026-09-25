/**
 * Single source of truth for how much horizontal room the sidebar takes.
 *
 * The sidebar variants are flex siblings, so the main content column offsets
 * itself automatically. The topbar is `position: fixed` and full-width, so it
 * has to be told — and used to be told by a hand-copied `ps-[84px]
 * lg:ps-[260px]`, which only ever matched the default sidebar and was wrong for
 * nord (224px), dracula (256px) and forest.
 *
 * Each layout publishes `--harbor-sidebar-w` on the shell root instead, so the
 * `lg:` gate stays in CSS (no JS resize listener) and anything that needs the
 * offset reads the same value.
 *
 * The strings below must stay written out in full: Tailwind scans source files
 * for complete class names, so a value built by concatenation is never emitted.
 */
export type ChromeLayout = string;

const EXPANDED: Record<string, string> = {
  sidebar: "[--harbor-sidebar-w:72px] lg:[--harbor-sidebar-w:240px]",
  nord: "[--harbor-sidebar-w:78px] lg:[--harbor-sidebar-w:224px]",
  dracula: "[--harbor-sidebar-w:78px] lg:[--harbor-sidebar-w:256px]",
  forest: "[--harbor-sidebar-w:78px] lg:[--harbor-sidebar-w:240px]",
  rail: "[--harbor-sidebar-w:200px]",
  stremio: "[--harbor-sidebar-w:80px]",
};

const COLLAPSED: Record<string, string> = {
  sidebar: "[--harbor-sidebar-w:72px]",
  nord: "[--harbor-sidebar-w:78px]",
  dracula: "[--harbor-sidebar-w:78px]",
  forest: "[--harbor-sidebar-w:78px]",
  rail: "[--harbor-sidebar-w:68px]",
  stremio: "[--harbor-sidebar-w:80px]",
};

const NONE = "[--harbor-sidebar-w:0px]";

/** Class that publishes `--harbor-sidebar-w` for the current layout. */
export function sidebarWidthClass(layout: ChromeLayout, collapsed: boolean): string {
  const table = collapsed ? COLLAPSED : EXPANDED;
  return table[layout] ?? NONE;
}

/** Start padding that clears the sidebar, for fixed-position chrome. */
export const SIDEBAR_OFFSET_CLASS = "ps-[calc(var(--harbor-sidebar-w,0px)+12px)]";
