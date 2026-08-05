/**
 * useBarcodeScanner - Hook for POS barcode scanning
 * Handles keyboard input, USB scanner detection, and auto-focus
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';

export interface ScanResult {
  found: boolean;
  product?: any;
  batch?: any;
  stock?: number;
  matchType?: 'primary' | 'additional' | 'sku' | 'name';
  barcode: string;
  timestamp: number;
}

export interface UseBarcodeScannerOptions {
  /** Auto-focus the input field after each action */
  autoFocus?: boolean;
  /** Time in ms to detect scanner input (USB scanners type fast) */
  scannerTimeout?: number;
  /** Callback when product is found */
  onProductFound?: (result: ScanResult) => void;
  /** Callback when product is not found */
  onProductNotFound?: (barcode: string) => void;
  /** Callback on scan error */
  onError?: (error: string) => void;
  /** Play sound on successful scan */
  playSuccessSound?: boolean;
  /** Play sound on failed scan */
  playFailureSound?: boolean;
  /** Business ID for lookup */
  businessId?: string;
  /** Branch ID for lookup */
  branchId?: string;
}

export function useBarcodeScanner(options: UseBarcodeScannerOptions = {}) {
  const {
    autoFocus = true,
    scannerTimeout = 100,
    onProductFound,
    onProductNotFound,
    onError,
    playSuccessSound = true,
    playFailureSound = true,
    businessId,
    branchId,
  } = options;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);

  // Audio contexts for beep sounds
  const successAudioRef = useRef<AudioContext | null>(null);
  const failureAudioRef = useRef<AudioContext | null>(null);

  const playBeep = useCallback((frequency: number, duration: number) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      oscillator.stop(ctx.currentTime + duration / 1000);
    } catch {
      // Audio not available
    }
  }, []);

  const playSuccessSoundFn = useCallback(() => {
    if (playSuccessSound) {
      playBeep(1200, 100); // High beep for success
    }
  }, [playSuccessSound, playBeep]);

  const playFailureSoundFn = useCallback(() => {
    if (playFailureSound) {
      playBeep(300, 200); // Low beep for failure
    }
  }, [playFailureSound, playBeep]);

  const lookupBarcode = useCallback(
    async (barcode: string): Promise<ScanResult> => {
      const trimmed = barcode.trim();
      if (!trimmed) {
        return { found: false, barcode: trimmed, timestamp: Date.now() };
      }

      try {
        setIsScanning(true);

        // Try the barcode lookup endpoint first
        const response = await apiService.lookupBarcode(trimmed);

        if (response.success && response.data?.product) {
          const result: ScanResult = {
            found: true,
            product: response.data.product,
            batch: response.data.batch,
            stock: response.data.stock,
            matchType: response.data.matchType,
            barcode: trimmed,
            timestamp: Date.now(),
          };

          setLastScanResult(result);
          setScanHistory((prev) => [result, ...prev.slice(0, 49)]); // Keep last 50
          playSuccessSoundFn();
          onProductFound?.(result);

          return result;
        }

        // Fallback: search products by barcode field
        const searchResponse = await apiService.getProducts({
          search: trimmed,
          limit: 5,
        });

        if (searchResponse.success && searchResponse.data?.length > 0) {
          const product = searchResponse.data.find(
            (p: any) => p.barcode === trimmed || p.sku === trimmed
          );

          if (product) {
            const result: ScanResult = {
              found: true,
              product,
              stock: product.batches?.reduce(
                (sum: number, b: any) => sum + b.quantity,
                0
              ) || 0,
              matchType: product.barcode === trimmed ? 'primary' : 'sku',
              barcode: trimmed,
              timestamp: Date.now(),
            };

            setLastScanResult(result);
            setScanHistory((prev) => [result, ...prev.slice(0, 49)]);
            playSuccessSoundFn();
            onProductFound?.(result);

            return result;
          }
        }

        // Not found
        const notFoundResult: ScanResult = {
          found: false,
          barcode: trimmed,
          timestamp: Date.now(),
        };

        setLastScanResult(notFoundResult);
        playFailureSoundFn();
        onProductNotFound?.(trimmed);

        return notFoundResult;
      } catch (error: any) {
        console.error('[Barcode Scanner] Lookup error:', error.message);
        playFailureSoundFn();
        onError?.(error.message || 'Scan failed');

        return {
          found: false,
          barcode: trimmed,
          timestamp: Date.now(),
        };
      } finally {
        setIsScanning(false);
      }
    },
    [
      onProductFound,
      onProductNotFound,
      onError,
      playSuccessSoundFn,
      playFailureSoundFn,
    ]
  );

  // Handle keyboard input for barcode scanning
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement> | KeyboardEvent) => {
      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // If time between keys is very short (< scannerTimeout), it's likely a scanner
      const isScannerInput = timeSinceLastKey < scannerTimeout && timeSinceLastKey > 0;

      if (e.key === 'Enter') {
        e.preventDefault();
        const barcode = bufferRef.current.trim();
        bufferRef.current = '';

        if (barcode) {
          lookupBarcode(barcode);
        }
        return;
      }

      // If it's a regular keypress (not special keys), add to buffer
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // If typing slowly (user input, not scanner), clear buffer
        if (!isScannerInput && timeSinceLastKey > 200) {
          bufferRef.current = '';
        }
        bufferRef.current += e.key;
      }
    },
    [scannerTimeout, lookupBarcode]
  );

  // Focus the barcode input field
  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  // Auto-focus effect
  useEffect(() => {
    if (autoFocus) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(focusInput, 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, focusInput]);

  // Clear the scan history
  const clearHistory = useCallback(() => {
    setScanHistory([]);
    setLastScanResult(null);
  }, []);

  return {
    inputRef,
    isScanning,
    lastScanResult,
    scanHistory,
    lookupBarcode,
    handleKeyDown,
    focusInput,
    clearHistory,
  };
}
