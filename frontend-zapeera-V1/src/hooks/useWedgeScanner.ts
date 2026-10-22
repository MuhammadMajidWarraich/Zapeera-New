/**
 * useWedgeScanner — global keyboard-wedge barcode capture.
 *
 * USB/Bluetooth scanners act as keyboards: they "type" the code at
 * machine speed and finish with Enter. This hook listens on window
 * (capture phase) and promotes a keystroke burst to a scan via
 * BurstTracker (lib/barcode-scan), so a scan is caught even when
 * focus is NOT in the search box — while normal typing is never
 * hijacked:
 *
 *  - Slow / irregular typing never qualifies (see BurstTracker).
 *  - When a scan lands inside a text field, the field's pre-burst
 *    value is restored afterwards, so the code never pollutes a
 *    customer name, a discount box, or any other field.
 *  - When the POS search input itself is focused, the consumed Enter
 *    is stopped in the capture phase, so the input's own handlers
 *    never double-process the scan; the caller clears the search
 *    text as part of handling the scan.
 */

import { useEffect, useRef } from 'react';
import { BurstTracker } from '../lib/barcode-scan';

export interface WedgeScannerOptions {
  /** Master switch (feature setting + business-type applicability). */
  enabled: boolean;
  /** Called once per recognized scan with the decoded code. */
  onScan: (code: string) => void;
  minLength?: number;
  maxGapMs?: number;
  enterWindowMs?: number;
  /**
   * Default true: ignore scans while a Radix dialog / alert-dialog
   * is open (payment, shift, refund dialogs must never be
   * interrupted mid-flow). Consumers whose scan target lives INSIDE
   * a dialog (the product form) pass false.
   */
  suspendWhenDialogOpen?: boolean;
}

interface FieldSnapshot {
  el: HTMLInputElement | HTMLTextAreaElement;
  value: string;
}

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'image',
  'range',
  'color',
  'hidden',
]);

function asTextField(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) {
    return NON_TEXT_INPUT_TYPES.has(target.type) ? null : target;
  }
  return null;
}

function restoreFieldValue(snapshot: FieldSnapshot): void {
  const { el, value } = snapshot;
  if (!el.isConnected || el.value === value) return;
  try {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    // Field is gone or read-only — nothing to restore.
  }
}

export function useWedgeScanner(options: WedgeScannerOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const tracker = new BurstTracker({
      minLength: optionsRef.current.minLength,
      maxGapMs: optionsRef.current.maxGapMs,
      enterWindowMs: optionsRef.current.enterWindowMs,
    });
    let snapshot: FieldSnapshot | null = null;

    const anyDialogOpen = () =>
      !!document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
      );

    const onKeyDown = (e: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (!opts.enabled) return;
      const now = e.timeStamp || performance.now();

      if (e.key === 'Enter') {
        const code = tracker.pushEnter(now);
        const snap = snapshot;
        snapshot = null;
        if (!code) return;
        if (opts.suspendWhenDialogOpen !== false && anyDialogOpen()) return;
        // Consume the scan completely: no form submit, no button
        // activation, no downstream React key handler.
        e.preventDefault();
        e.stopPropagation();
        if (snap) restoreFieldValue(snap);
        opts.onScan(code);
        return;
      }

      if (e.key === 'Escape') {
        tracker.invalidate();
        snapshot = null;
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.repeat) {
          tracker.invalidate();
          return;
        }
        const field = asTextField(e.target);
        if (field) {
          if (snapshot && snapshot.el !== field) snapshot = null;
          if (!snapshot && tracker.pending.length === 0) {
            snapshot = { el: field, value: field.value };
          }
        }
        tracker.pushChar(e.key, now);
        if (tracker.pending.length === 0) snapshot = null; // tracker self-reset (overlong)
        return;
      }

      // Any other control key (Tab, Backspace, arrows, …) breaks a
      // burst — a scanner never sends them mid-code. Modifier-only
      // presses (Shift for capitals) leave the candidate alone.
      if (e.key !== 'Shift' && e.key !== 'CapsLock' && e.key !== 'Alt' && e.key !== 'Control' && e.key !== 'Meta') {
        tracker.invalidate();
        snapshot = null;
      }
    };

    const onFocusIn = () => {
      // A scan never spans a focus change.
      tracker.invalidate();
      snapshot = null;
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);
}
