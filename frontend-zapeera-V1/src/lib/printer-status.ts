/**
 * Printer display logic for Settings → Device Status (desktop only).
 *
 * The panel used to show a hardcoded "Connected". The values here come
 * from the OS printer list the Electron main process enumerates
 * (webContents.getPrintersAsync via the `get-printers` IPC channel), so
 * every string this module produces traces back to a real printer —
 * or says plainly that there is none.
 */

export interface OsPrinter {
  name: string;
  displayName?: string;
  description?: string;
  /** Raw OS status code (Win32 PRINTER_STATUS bitmask on Windows). */
  status?: number | null;
  isDefault?: boolean;
}

/** The printer the panel features: the OS default, else the first one. */
export function selectPrimaryPrinter(printers: OsPrinter[]): OsPrinter | null {
  if (!Array.isArray(printers) || printers.length === 0) return null;
  return printers.find((p) => p && p.isDefault) || printers[0];
}

/**
 * Short human word for a raw printer status code. On Windows the code
 * is the PRINTER_STATUS bitmask: 0 means no flag is set (idle/ready);
 * any bit set means the printer wants attention (paused, error,
 * offline, paper out, …) — which one is an OS-dialog question, so the
 * panel stays generic rather than guessing.
 */
export function printerStatusWord(status: number | null | undefined): string | null {
  if (status === null || status === undefined) return null;
  return status === 0 ? "Ready" : "Needs attention";
}

/**
 * The Device Status "Printer" stat value:
 * · null/undefined input → null (OS list not loaded yet, or not the
 *   desktop app) — the caller hides the stat, like Storage on web.
 * · empty list → "No printer connected" (the honest desktop answer).
 * · otherwise → the primary printer's real name, its status word when
 *   known, and "+N more" when further printers exist.
 */
export function formatPrinterPanelValue(printers: OsPrinter[] | null | undefined): string | null {
  if (!printers) return null;
  if (printers.length === 0) return "No printer connected";
  const primary = selectPrimaryPrinter(printers);
  if (!primary) return "No printer connected";
  const name = primary.displayName || primary.name || "Printer";
  const word = printerStatusWord(primary.status);
  const more = printers.length > 1 ? ` · +${printers.length - 1} more` : "";
  return `${name}${word ? ` (${word})` : ""}${more}`;
}
