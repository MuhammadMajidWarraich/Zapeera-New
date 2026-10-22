/**
 * CameraScannerDialog — camera barcode scanning for the POS and the
 * product form.
 *
 * Engine choice (deliberate, in priority order):
 *  1. The native `BarcodeDetector` API where the browser provides it
 *     (Chrome/Edge on Windows, macOS and Android): zero bundle cost,
 *     hardware-fast.
 *  2. `@zxing/library`, loaded LAZILY via dynamic import only when
 *     the native detector is missing (Firefox, Safari, Linux
 *     Chrome): the chunk never weighs on the main bundle or on
 *     devices that never open the camera.
 *
 * A photo upload path decodes a still image through the same two
 * engines — useful on devices without a camera and for supplier
 * label photos. Permission denial and missing cameras surface as
 * honest messages, never as a dead view.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Camera, ImageUp, Loader2, ScanBarcode, X } from 'lucide-react';
import { CAMERA_BARCODE_FORMATS } from '@/lib/barcode-scan';
import { playScanFailureSound, playScanSuccessSound } from '@/lib/scan-sound';

interface CameraScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once with the decoded code; the dialog closes itself. */
  onScan: (code: string) => void;
}

type ScannerStatus = 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error';

const ZXING_FORMAT_NAMES = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'QR_CODE',
] as const;

async function buildZxingReader() {
  const lib = await import('@zxing/library');
  const hints = new Map();
  hints.set(
    lib.DecodeHintType.POSSIBLE_FORMATS,
    ZXING_FORMAT_NAMES.map((name) => lib.BarcodeFormat[name])
  );
  return { lib, reader: new lib.BrowserMultiFormatReader(hints) };
}

export function CameraScannerDialog({ open, onOpenChange, onScan }: CameraScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>('starting');
  const [errorMessage, setErrorMessage] = useState('');
  const [engineLabel, setEngineLabel] = useState('');
  const [isDecodingFile, setIsDecodingFile] = useState(false);
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let zxingReader: { reset: () => void } | null = null;
    let zxingControls: { stop: () => void } | null = null;

    setStatus('starting');
    setErrorMessage('');
    setFileError('');
    setEngineLabel('');

    const stopTracks = () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    };

    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      try {
        zxingControls?.stop();
      } catch {
        /* already stopped */
      }
      try {
        zxingReader?.reset();
      } catch {
        /* already reset */
      }
      stopTracks();
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }
    };

    const handleDecoded = (text: string) => {
      if (cancelled || !text) return;
      cancelled = true;
      cleanup();
      playScanSuccessSound();
      onScan(text);
      onOpenChange(false);
    };

    const startZxing = async () => {
      const { reader } = await buildZxingReader();
      if (cancelled) return;
      zxingReader = reader as unknown as { reset: () => void };
      stopTracks();
      setEngineLabel('On-device decoder');
      setStatus('scanning');
      zxingControls = (await reader.decodeFromVideoDevice(
        null,
        videoRef.current as HTMLVideoElement,
        (result: any) => {
          if (result) {
            handleDecoded(result.getText());
          }
        }
      )) as unknown as { stop: () => void };
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (err: any) {
        if (cancelled) return;
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          setStatus('denied');
        } else if (
          err?.name === 'NotFoundError' ||
          err?.name === 'OverconstrainedError' ||
          err?.name === 'DevicesNotFoundError'
        ) {
          setStatus('unavailable');
        } else {
          setStatus('error');
          setErrorMessage('The camera could not be started on this device.');
        }
        return;
      }
      if (cancelled) {
        stopTracks();
        return;
      }

      const Detector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
      const video = videoRef.current;
      if (Detector && video) {
        try {
          const supported: string[] = await Detector.getSupportedFormats().catch(() => []);
          const formats = CAMERA_BARCODE_FORMATS.filter(
            (f) => supported.length === 0 || supported.includes(f)
          );
          const detector = new Detector({
            formats: formats.length > 0 ? [...formats] : undefined,
          });
          video.srcObject = stream;
          await video.play().catch(() => undefined);
          if (cancelled) return;
          setEngineLabel('Camera');
          setStatus('scanning');
          const tick = async () => {
            if (cancelled) return;
            try {
              const codes = await detector.detect(video);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                handleDecoded(String(codes[0].rawValue));
                return;
              }
            } catch {
              // Frame not ready yet — keep polling.
            }
            if (!cancelled) {
              timer = window.setTimeout(tick, 200);
            }
          };
          void tick();
          return;
        } catch {
          // Native detector failed mid-flight — fall through to ZXing.
          if (cancelled) return;
        }
      }

      try {
        await startZxing();
      } catch {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage('Barcode scanning is not supported on this browser or device.');
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const handleFile = async (file: File) => {
    setIsDecodingFile(true);
    setFileError('');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = url;
      });

      let text: string | null = null;
      const Detector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
      if (Detector) {
        try {
          const detector = new Detector({ formats: [...CAMERA_BARCODE_FORMATS] });
          const codes = await detector.detect(img);
          if (codes && codes.length > 0) {
            text = String(codes[0].rawValue || '') || null;
          }
        } catch {
          // Fall through to ZXing.
        }
      }
      if (!text) {
        try {
          const { reader } = await buildZxingReader();
          const result = await reader.decodeFromImageElement(img);
          text = result.getText();
        } catch {
          text = null;
        }
      }

      if (text) {
        playScanSuccessSound();
        onScan(text);
        onOpenChange(false);
      } else {
        playScanFailureSound();
        setFileError(
          'No barcode could be read from that photo. Try a sharper, straight-on shot of the label.'
        );
      }
    } catch {
      playScanFailureSound();
      setFileError('That file could not be read as an image.');
    } finally {
      URL.revokeObjectURL(url);
      setIsDecodingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Scan Barcode
          </DialogTitle>
          <DialogDescription>
            Point the camera at a product barcode — EAN, UPC, Code 128, Code 39 or QR.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-2xl bg-[#0a1128]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="aspect-video w-full object-cover"
            />
            {status === 'scanning' && (
              <div
                className="pointer-events-none absolute inset-6 rounded-xl border-2 border-white/70"
                aria-hidden
              />
            )}
            {status !== 'scanning' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                {status === 'starting' ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-white/80" />
                    <p className="text-sm text-white/80">Starting camera…</p>
                  </>
                ) : (
                  <>
                    <Camera className="h-6 w-6 text-white/60" />
                    <p className="text-sm leading-relaxed text-white/85">
                      {status === 'denied' &&
                        'Camera permission was denied. Allow camera access in the browser settings, or upload a barcode photo below.'}
                      {status === 'unavailable' &&
                        'No camera is available on this device. You can upload a barcode photo below — or use a USB/Bluetooth scanner, which works without this window.'}
                      {status === 'error' && errorMessage}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {status === 'scanning' && (
            <p className="text-center text-xs text-muted-foreground">
              {engineLabel ? `${engineLabel} active — ` : ''}hold the barcode inside the frame.
            </p>
          )}

          {fileError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {fileError}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={isDecodingFile}
              onClick={() => fileInputRef.current?.click()}
            >
              {isDecodingFile ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ImageUp className="mr-2 h-4 w-4" />
              )}
              Upload barcode photo
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CameraScannerDialog;
