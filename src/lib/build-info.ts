import { useEffect, useState } from "react";

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

// A build is Beta only when the version itself carries a semver prerelease
// suffix (e.g. "0.9.26-beta.1"). A plain "0.9.26" is always stable. This ties
// the badge to the one version authority (package.json) instead of a build
// flag that can drift out of sync with what actually got tagged and released.
export const IS_BETA_BUILD: boolean = /^\d+\.\d+\.\d+-/.test(APP_VERSION);

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The version of the app actually running right now. Starts at the
 * build-time APP_VERSION (no flicker), then in Tauri switches to
 * getVersion() -- the version compiled into the running binary, which is
 * exactly what the updater compares against. After an in-app update and
 * relaunch, this reflects the new version with no code changes needed.
 */
export function useInstalledVersion(): string {
  const [version, setVersion] = useState(APP_VERSION);
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    void import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then((v) => {
        if (!cancelled) setVersion(v);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
