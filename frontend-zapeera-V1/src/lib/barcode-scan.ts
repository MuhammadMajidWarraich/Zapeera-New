/**
 * Barcode scan engine — pure logic shared by the POS wedge listener
 * (hooks/useWedgeScanner), the product-search input, the camera
 * scanner dialog, and the self-test (scripts/barcode-scan-test.mjs).
 *
 * No DOM / React imports: everything here is deterministic and
 * unit-testable in plain Node.
 *
 * HOW A SCAN IS RECOGNIZED (keyboard-wedge scanners):
 * A USB/Bluetooth scanner "types" the code at machine speed and
 * finishes with Enter. Human typing is far slower and irregular.
 * A burst therefore qualifies as a scan when:
 *   - every character arrives within `maxGapMs` of the previous one,
 *   - Enter arrives within `enterWindowMs` of the last character,
 *   - the code is at least `minLength` characters, and
 *   - the code is barcode-shaped (see looksLikeBarcode).
 */

export interface BurstTrackerOptions {
  /** Minimum characters for a burst to count as a scan. */
  minLength?: number;
  /** Max ms between consecutive characters inside a burst. */
  maxGapMs?: number;
  /** Max ms between the last character and the terminating Enter. */
  enterWindowMs?: number;
}

export class BurstTracker {
  private buffer = '';
  private alive = false;
  private lastTime = 0;
  private readonly minLength: number;
  private readonly maxGapMs: number;
  private readonly enterWindowMs: number;

  constructor(options: BurstTrackerOptions = {}) {
    this.minLength = options.minLength ?? 4;
    this.maxGapMs = options.maxGapMs ?? 50;
    this.enterWindowMs = options.enterWindowMs ?? 120;
  }

  /** Feed one printable character with its event timestamp (ms). */
  pushChar(ch: string, now: number): void {
    if (ch.length !== 1) return;
    if (this.buffer.length === 0) {
      this.buffer = ch;
      this.alive = true;
    } else if (now - this.lastTime <= this.maxGapMs) {
      this.buffer += ch;
      if (this.buffer.length > 64) {
        // Absurdly long for a code — treat as pasted text, not a scan.
        this.reset();
        return;
      }
    } else {
      // A slow keystroke kills the previous candidate; this character
      // starts a fresh one (it will die on the next slow keystroke).
      this.buffer = ch;
      this.alive = true;
    }
    this.lastTime = now;
  }

  /**
   * Feed the Enter key. Returns the scanned code when the burst
   * qualifies, otherwise null. Always resets the tracker.
   */
  pushEnter(now: number): string | null {
    const code = this.buffer;
    const qualifies =
      this.alive &&
      code.length >= this.minLength &&
      now - this.lastTime <= this.enterWindowMs &&
      looksLikeBarcode(code);
    this.reset();
    return qualifies ? code : null;
  }

  /** Any non-character key that should abandon the candidate. */
  invalidate(): void {
    this.reset();
  }

  reset(): void {
    this.buffer = '';
    this.alive = false;
    this.lastTime = 0;
  }

  get pending(): string {
    return this.buffer;
  }

  get isAlive(): boolean {
    return this.alive;
  }
}

/**
 * Barcode-shaped check: symbologies Zapeera sells with (EAN/UPC —
 * digits; Code 128 / Code 39 — compact alphanumerics; generated
 * Zapeera codes — prefix + digits) never contain spaces, and a
 * plain lowercase word is a human search term, not a code.
 */
export function looksLikeBarcode(code: string): boolean {
  const value = (code || '').trim();
  if (value.length < 4) return false;
  if (/\s/.test(value)) return false;
  if (/\d/.test(value)) return true; // any digit-bearing compact code
  // Digit-less codes are only plausible as Code 39 / QR payloads when
  // they are not a plain lowercase word.
  return !/^[a-z]+$/.test(value);
}

/** Match types a scan may resolve through — exact code matches only. */
export const SCAN_MATCH_TYPES = ['primary', 'additional', 'batch', 'sku'] as const;

export type ScanResolution =
  | {
      type: 'hit';
      product: any;
      batch: any | null;
      matchType: string;
      stock: number;
    }
  | { type: 'miss' };

/**
 * Decide what a POST /barcodes/lookup response means for a scan.
 * The backend's last-resort NAME match (a `contains` search) is NOT a
 * scan hit: a scanned code must match a real code exactly
 * (product barcode → additional barcodes → batch barcode → SKU).
 */
export function resolveScanLookup(response: any, code: string): ScanResolution {
  if (!response?.success || !response?.data?.product) {
    return { type: 'miss' };
  }
  const { product, batch, stock, matchType } = response.data;
  if (matchType) {
    if (!(SCAN_MATCH_TYPES as readonly string[]).includes(matchType)) {
      return { type: 'miss' };
    }
    return { type: 'hit', product, batch: batch ?? null, matchType, stock: stock ?? 0 };
  }
  // No matchType reported: only trust an exact code equality.
  if (product.barcode === code || product.sku === code) {
    return {
      type: 'hit',
      product,
      batch: batch ?? null,
      matchType: product.barcode === code ? 'primary' : 'sku',
      stock: stock ?? 0,
    };
  }
  return { type: 'miss' };
}

/** Business types that sell physical products through the POS. */
export const PRODUCT_SELLING_BUSINESS_TYPES = [
  'PHARMACY',
  'RETAIL_STORE',
] as const;

const CANONICAL_BUSINESS_TYPES = [
  ...PRODUCT_SELLING_BUSINESS_TYPES,
  'HOTEL',
  'CLINIC',
] as const;

function normalizeBusinessType(value?: string | null): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Whether barcode scanning belongs to this business at all.
 * Canonical HOTEL / CLINIC businesses have no product register, so
 * scanning is off for them; unknown / legacy / custom types fall
 * through to enabled, mirroring the backend module-applicability
 * philosophy (only canonical types are hard-decided in code).
 */
export function isBarcodeApplicableBusinessType(businessType?: string | null): boolean {
  const key = normalizeBusinessType(businessType);
  if (!key) return true;
  if ((PRODUCT_SELLING_BUSINESS_TYPES as readonly string[]).includes(key)) return true;
  if ((CANONICAL_BUSINESS_TYPES as readonly string[]).includes(key)) return false;
  return true;
}

/**
 * Effective scanning switch: the business's stored setting
 * (`barcodeScanningEnabled`, 'true' | 'false' | null) resolved
 * against applicability. Unset defaults to ON for product-selling
 * businesses (the C1 requirePrescriptionAtPos pattern).
 */
export function resolveBarcodeScanningEnabled(
  stored: string | boolean | null | undefined,
  businessType?: string | null
): boolean {
  if (!isBarcodeApplicableBusinessType(businessType)) return false;
  if (stored === null || stored === undefined || stored === '') return true;
  return stored === true || stored === 'true';
}

/** Symbologies the camera scanner asks the detector for. */
export const CAMERA_BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'qr_code',
] as const;
