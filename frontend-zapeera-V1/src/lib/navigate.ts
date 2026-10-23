/**
 * Protocol-safe in-app navigation for code that cannot use the React
 * router (error boundaries, toast actions, global API error handlers).
 *
 * On desktop the renderer is loaded via loadFile (file://). Assigning
 * `window.location.href = "/zapeera"` there resolves against the DRIVE
 * ROOT (file:///C:/zapeera) — a file that does not exist — which fires
 * Electron's did-fail-load (ERR_FILE_NOT_FOUND) and the native
 * "Zapeera - Load Error" dialog (incident 2026-10-24: Promotions →
 * ErrorBoundary "Go to Dashboard"). The app uses HashRouter under
 * file:, so in-app navigation must set the hash instead. On the web
 * (http/https) a normal href assignment is correct.
 */
export function navigateToAppPath(path: string): void {
  const target = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    window.location.hash = `#${target}`;
    return;
  }
  window.location.href = target;
}

/**
 * The app's current route path. Under HashRouter (desktop file://) the
 * route lives in location.hash while location.pathname is the on-disk
 * path of index.html; on the web it is location.pathname.
 */
export function getAppPathname(): string {
  if (typeof window === "undefined") return "/";
  if (window.location.protocol === "file:" || window.location.hash.startsWith("#/")) {
    const fromHash = window.location.hash.replace(/^#/, "");
    if (fromHash) return fromHash.split("?")[0];
  }
  return window.location.pathname;
}
