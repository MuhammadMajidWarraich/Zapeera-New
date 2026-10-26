import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import {
  OPEN_SHORTCUTS_HELP_EVENT,
  SAVE_REQUESTED_EVENT,
  useKeyboardShortcuts,
} from "@/lib/keyboard-shortcuts";

/**
 * Global keyboard shortcuts — mounted once inside the router (AppRoutes).
 * Active only while signed in. Revised map (research, 2026-10-26):
 * Alt+1–6 are navigation-only everywhere now that tender moved off
 * Alt+digits, so the global listener owns them on the POS screen too.
 */
export function GlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_HELP_EVENT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_HELP_EVENT, open);
  }, []);

  const businessSlug = useMemo(() => {
    const match = location.pathname.match(/^\/business\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  // Business-scoped when inside a business workspace, top-level otherwise.
  const navTarget = (businessPath: string, fallback: string) =>
    businessSlug
      ? `/business/${encodeURIComponent(businessSlug)}${businessPath}`
      : fallback;

  const focusSearch = () => {
    const pos = document.getElementById(
      "pos-search-input",
    ) as HTMLInputElement | null;
    if (pos) {
      pos.focus();
      pos.select();
      return;
    }
    const global = document.getElementById(
      "global-search-input",
    ) as HTMLInputElement | null;
    if (global) {
      global.focus();
      global.select();
    }
  };

  const save = () => {
    const button = document.querySelector(
      "[data-shortcut-save]",
    ) as HTMLElement | null;
    if (button) {
      button.click();
      return;
    }
    window.dispatchEvent(new CustomEvent(SAVE_REQUESTED_EVENT));
  };

  useKeyboardShortcuts(
    [
      {
        combo: { key: "1", alt: true },
        handler: () => navigate(navTarget("/dashboard", "/zapeera")),
        allowWhileTyping: true,
      },
      {
        combo: { key: "2", alt: true },
        handler: () => navigate(navTarget("/pos", "/pos")),
        allowWhileTyping: true,
      },
      {
        combo: { key: "3", alt: true },
        handler: () => navigate(navTarget("/products", "/inventory")),
        allowWhileTyping: true,
      },
      {
        combo: { key: "4", alt: true },
        handler: () => navigate(navTarget("/invoices", "/invoices")),
        allowWhileTyping: true,
      },
      {
        combo: { key: "5", alt: true },
        handler: () => navigate(navTarget("/customers", "/customers")),
        allowWhileTyping: true,
      },
      {
        combo: { key: "6", alt: true },
        handler: () => navigate(navTarget("/settings", "/settings")),
        allowWhileTyping: true,
      },
      { combo: { key: "/" }, handler: () => focusSearch() },
      {
        // Ctrl+F focuses search too (Shopify convention) — same
        // handler as `/` (POS search first, else global search).
        combo: { key: "f", ctrl: true },
        handler: () => focusSearch(),
        allowWhileTyping: true,
      },
      {
        // '?' with or without Shift (layouts and synthetic events differ)
        test: (e) => e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey,
        handler: () => setHelpOpen(true),
      },
      {
        combo: { key: "s", ctrl: true },
        handler: () => save(),
        allowWhileTyping: true,
      },
    ],
    { enabled: isAuthenticated },
  );

  return (
    <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
  );
}
