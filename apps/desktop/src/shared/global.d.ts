import type { AosDesktopApi } from "./ipc-contract";

declare global {
  interface Window {
    aosDesktop: AosDesktopApi;
  }
}

export {};
