/**
 * Keyboard shortcuts — single source of truth for Zapeera's keyboard map.
 *
 * Why one file: the help overlay, the global listener and the POS listener
 * must never drift apart. Every shortcut is declared here as data; the
 * listeners below match keydown events against it.
 *
 * Rules enforced by the matcher:
 * - Shortcuts never fire while the user is typing in an input / textarea /
 *   select / contenteditable element — unless the binding explicitly sets
 *   `allowWhileTyping` (function keys and Alt/Ctrl combos, which cannot
 *   type characters, and Ctrl+S, which exists to save the form being typed
 *   in). Esc is handled by Radix dialogs natively.
 * - No browser/OS-reserved combos: no Ctrl+W/T/N, no F5, no F12, no
 *   Alt+Left/Right (history), no Alt+D (address bar), no Ctrl+Shift+T/J.
 * - The POS listener runs in the capture phase and stops propagation for
 *   the keys it owns, so Alt+1/Alt+2 mean Cash/Card tender on the POS
 *   screen and Dashboard/POS navigation everywhere else.
 */
import { useEffect, useRef } from "react";

export interface ShortcutCombo {
  /** KeyboardEvent.key — compared case-insensitively. */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface ShortcutBinding {
  combo?: ShortcutCombo;
  /** Extra predicate for keys a single combo cannot express (e.g. digits 1-8). */
  test?: (e: KeyboardEvent) => boolean;
  handler: (e: KeyboardEvent) => void;
  /** Allow firing while focus is in an input/textarea/select. Default false. */
  allowWhileTyping?: boolean;
}

/** True when the event target is a text-entry control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Exact modifier match: a combo only fires with exactly its modifiers. */
export function comboMatches(e: KeyboardEvent, combo: ShortcutCombo): boolean {
  if (e.key.toLowerCase() !== combo.key.toLowerCase()) return false;
  if (!!e.ctrlKey !== !!combo.ctrl) return false;
  if (!!e.altKey !== !!combo.alt) return false;
  if (!!e.metaKey !== !!combo.meta) return false;
  if (!!e.shiftKey !== !!combo.shift) return false;
  return true;
}

/**
 * Register window keydown bindings. `capture: true` listeners run first
 * and stop propagation on a match, so a screen-level listener (POS) can
 * own keys that the global listener also defines (Alt+1 / Alt+2).
 */
export function useKeyboardShortcuts(
  bindings: ShortcutBinding[],
  options?: { capture?: boolean; enabled?: boolean },
) {
  const capture = options?.capture ?? false;
  const enabled = options?.enabled ?? true;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      for (const binding of bindingsRef.current) {
        if (!binding.allowWhileTyping && typing) continue;
        if (binding.combo && !comboMatches(e, binding.combo)) continue;
        if (binding.test && !binding.test(e)) continue;
        e.preventDefault();
        if (capture) e.stopPropagation();
        binding.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, capture);
    return () => window.removeEventListener("keydown", onKeyDown, capture);
  }, [capture, enabled]);
}

/** Event that opens the shortcuts help overlay from anywhere. */
export const OPEN_SHORTCUTS_HELP_EVENT = "zapeera:open-shortcuts-help";

export function openShortcutsHelp(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_HELP_EVENT));
}

/** Event fired when Ctrl+S has no [data-shortcut-save] button to click. */
export const SAVE_REQUESTED_EVENT = "zapeera:save-requested";

// ---------------------------------------------------------------------------
// Help overlay data — rendered by ShortcutsHelpDialog. Keep in sync with the
// bindings in GlobalShortcuts and CreateInvoice (same keys, same labels).
// ---------------------------------------------------------------------------

export interface ShortcutHelpItem {
  keys: string;
  label: string;
}

export interface ShortcutHelpGroup {
  title: string;
  items: ShortcutHelpItem[];
}

export const SHORTCUT_HELP_GROUPS: ShortcutHelpGroup[] = [
  {
    title: "Point of Sale",
    items: [
      { keys: "F2", label: "Focus product search" },
      { keys: "Enter", label: "Add first matching product (in search)" },
      { keys: "+ / −", label: "Increase / decrease last line quantity" },
      { keys: "F4", label: "Proceed to Payment" },
      { keys: "F8", label: "Hold sale" },
      { keys: "Alt+R", label: "Open Transactions" },
      { keys: "Alt+1 / Alt+2", label: "Cash / Card tender" },
      { keys: "1–8", label: "Pick payment method (payment dialog open)" },
      { keys: "Ctrl+Enter", label: "Complete Sale" },
      { keys: "F9", label: "Print Receipt (receipt open)" },
      { keys: "N", label: "New Sale (receipt open)" },
      { keys: "Esc", label: "Close dialog / clear search" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: "Alt+1", label: "Go to Dashboard" },
      { keys: "Alt+2", label: "Go to Point of Sale" },
      { keys: "Alt+3", label: "Go to Products" },
      { keys: "Alt+4", label: "Go to Sales / Invoices" },
      { keys: "Alt+5", label: "Go to Customers" },
      { keys: "Alt+6", label: "Go to Settings" },
    ],
  },
  {
    title: "General",
    items: [
      { keys: "/", label: "Focus search" },
      { keys: "?", label: "Show this shortcuts help" },
      { keys: "Ctrl+S", label: "Save (where a save button exists)" },
      { keys: "Esc", label: "Close dialog or menu" },
    ],
  },
];
