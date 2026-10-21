// FBR POS fiscal integration (Wave B7): shared receipt/invoice pieces.
//
// The QR code encodes the FBR invoice number itself (the IMS spec
// leaves QR rendering to the vendor: "QR Code functionality is at
// vendors end" — the number is what a customer types into FBR's
// verification portal). Rendered client-side with the `qrcode`
// package; no external service is involved.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Generates a QR data URL for a value (null until ready / no value). */
export function useQrDataUrl(value: string | null | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(value, { width: 200, margin: 1 })
      .then(url => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return dataUrl;
}

export function FbrQrImage({ value, size = 96 }: { value: string | null | undefined; size?: number }) {
  const dataUrl = useQrDataUrl(value);
  if (!value || !dataUrl) return null;
  return (
    <img
      src={dataUrl}
      alt={`FBR invoice ${value}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

const CHIP_STYLES: Record<string, { label: string; className: string }> = {
  SENT: { label: 'Fiscal: Sent', className: 'bg-green-100 text-green-700 border-green-200' },
  TEST: { label: 'Fiscal: Test', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  PENDING: { label: 'Fiscal: Pending', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  SENDING: { label: 'Fiscal: Sending', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  FAILED: { label: 'Fiscal: Failed', className: 'bg-red-100 text-red-700 border-red-200' },
  SKIPPED: { label: 'Fiscal: Skipped', className: 'bg-gray-100 text-gray-600 border-gray-200' }
};

/** Small fiscal-status badge for invoice lists. Renders "—" when the
 *  sale was never queued (FBR disabled at sale time). */
export function FiscalChip({ status }: { status?: string | null }) {
  if (!status) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const style = CHIP_STYLES[status] || CHIP_STYLES.SKIPPED;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.className}`}>
      {style.label}
    </span>
  );
}
