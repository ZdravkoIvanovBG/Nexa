import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useSettings } from "@/lib/settings";
import { useView, type View } from "@/lib/view";
import { metaPath, pathFromView, viewFromPath } from "./paths";

/**
 * Bidirectional bridge: root tab changes ↔ TanStack Router path.
 * Nested stack frames (meta, player, …) stay View-only until fully migrated.
 */
export function ViewRouterSync() {
  const router = useRouter();
  const { settings } = useSettings();
  const { view, setView, topKind, meta } = useView();
  const downloadsEnabled = settings.showDownloadsNav;
  const metaId = meta?.id;
  const metaType = meta?.type;
  const lastPath = useRef(router.state.location.pathname);
  const lastView = useRef(view);
  const previousMetaId = useRef(metaId);
  const suppress = useRef(false);

  // View → Router
  useEffect(() => {
    const closedMeta = previousMetaId.current != null && metaId == null;
    previousMetaId.current = metaId;
    if (suppress.current) {
      suppress.current = false;
      lastView.current = view;
      return;
    }
    if (view === lastView.current && topKind !== "meta" && !closedMeta) return;
    lastView.current = view;

    let next = pathFromView(view);
    if (topKind === "meta" && metaType && metaId) {
      next = metaPath(metaType, metaId);
    }

    if (router.state.location.pathname === next) return;
    lastPath.current = next;
    void router.navigate({ to: next, replace: false });
  }, [view, topKind, metaType, metaId, router]);

  // Router → View (back/forward or external navigate)
  useEffect(() => {
    return router.subscribe("onResolved", ({ toLocation }) => {
      const path = toLocation.pathname;
      if (path === lastPath.current) return;
      lastPath.current = path;

      const asView = viewFromPath(path);
      if (asView && asView !== lastView.current) {
        suppress.current = true;
        lastView.current = asView;
        setView(asView as View);
      }
    });
  }, [router, setView]);

  // Downloads is opt-in. Bounce back to Home whichever way the view was reached
  // (a /downloads URL, back/forward, or a programmatic setView) while it is off;
  // the View → Router effect above then rewrites the path to "/".
  useEffect(() => {
    if (view === "downloads" && !downloadsEnabled) setView("home");
  }, [view, downloadsEnabled, setView]);

  return null;
}
