import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, StrictMode, Suspense, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { StartupLoader } from "@/components/startup-loader";
import { isLinuxDesktop, isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import {
  detectHdrOverlay,
  detectModalOverlay,
  detectPipMode,
  detectRemoteMode,
} from "@/lib/window-role";
import "@/index.css";

// Every root is lazy so that only the one this window actually needs is
// evaluated. The overlays share an origin with the main window, and statically
// importing App here would run its whole module graph -- including the Supabase
// client -- in all four auxiliary webviews.
const App = lazy(() => import("@/App").then((m) => ({ default: m.App })));
const ModalOverlayApp = lazy(() =>
  import("@/views/modal-overlay-app").then((m) => ({ default: m.ModalOverlayApp })),
);
const HdrOverlayApp = lazy(() =>
  import("@/views/hdr-overlay-app").then((m) => ({ default: m.HdrOverlayApp })),
);
const PipApp = lazy(() => import("@/views/pip").then((m) => ({ default: m.PipApp })));
const RemoteApp = lazy(() => import("@/views/remote-app").then((m) => ({ default: m.RemoteApp })));

const isPip = detectPipMode();
const isModal = detectModalOverlay();
const isHdrOverlay = detectHdrOverlay();
const isRemote = detectRemoteMode();
if (isModal || isHdrOverlay) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.backgroundColor = "transparent";
  const root = document.getElementById("root");
  if (root) {
    root.style.background = "transparent";
    root.style.backgroundColor = "transparent";
  }
}
if (isRemote) {
  document.documentElement.style.overflow = "auto";
  document.body.style.overflow = "auto";
  document.body.style.userSelect = "auto";
  document.body.style.cursor = "auto";
}
if (!isPip && !isModal && !isHdrOverlay) {
  document.documentElement.dataset.os = isLinuxDesktop()
    ? "linux"
    : isMacDesktop()
      ? "macos"
      : isWindowsDesktop()
        ? "windows"
        : "web";
}
if (import.meta.env.DEV)
  console.log(
    "[harbor] entry: pip =",
    isPip,
    "modal =",
    isModal,
    "hdr =",
    isHdrOverlay,
    "remote =",
    isRemote,
    "label =",
    (() => {
      try {
        return getCurrentWindow().label;
      } catch {
        return "?";
      }
    })(),
  );
if (import.meta.env.DEV && !isPip && !isModal && !isHdrOverlay && !isRemote) {
  void import("./lib/streams/__fixtures__/verify").then((m) => m.logVerificationReport());
}

function StartupReady() {
  useEffect(() => {
    requestAnimationFrame(() => {
      document.getElementById("harbor-boot")?.remove();
      const root = document.getElementById("root");
      if (root instanceof HTMLElement) {
        root.removeAttribute("data-startup-hidden");
        root.inert = false;
      }
    });
  }, []);
  return null;
}

function MainRoot() {
  const [appReady, setAppReady] = useState(false);
  const [startupVisible, setStartupVisible] = useState(true);
  const markAppReady = useCallback(() => setAppReady(true), []);
  const revealApplication = useCallback(() => {
    setStartupVisible(false);
    document.getElementById("harbor-boot")?.remove();
    const root = document.getElementById("root");
    if (root instanceof HTMLElement) {
      root.removeAttribute("data-startup-hidden");
      root.inert = false;
    }
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("harbor_startup_ready").catch(() => {}),
      );
    }
  }, []);

  // Fail-open: never strand the window on the boot loader when the ready
  // signal hangs (stalled network, dead query) — reveal the UI anyway.
  useEffect(() => {
    if (!startupVisible) return;
    const t = window.setTimeout(revealApplication, 6000);
    return () => window.clearTimeout(t);
  }, [startupVisible, revealApplication]);

  return (
    <>
      {/* The startup loader stays outside the boundary so it keeps painting
          while App's chunk is still in flight. */}
      <Suspense fallback={null}>
        <App onReady={markAppReady} />
      </Suspense>
      {startupVisible && <StartupLoader ready={appReady} onComplete={revealApplication} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {isHdrOverlay ? (
        <HdrOverlayApp />
      ) : isModal ? (
        <ModalOverlayApp />
      ) : isPip ? (
        <PipApp />
      ) : isRemote ? (
        <RemoteApp />
      ) : (
        <MainRoot />
      )}
      {(isHdrOverlay || isModal || isPip || isRemote) && <StartupReady />}
    </Suspense>
  </StrictMode>,
);
