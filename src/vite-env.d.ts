/// <reference types="vite-plus/client" />

declare const __APP_VERSION__: string;

interface Window {
  __harborStremioDeeplink?: boolean;
  __harborInstallerOpen?: boolean;
}
