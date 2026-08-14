import type { DocketDesktopApi } from "./ipc-contract";

declare global {
  interface Window {
    docketDesktop: DocketDesktopApi;
  }
}

export {};
