/**
 * Scan feedback sounds — one shared AudioContext for the whole app
 * (the legacy useBarcodeScanner hook created a fresh context per
 * beep, which browsers throttle/suspend). Success = short high beep,
 * failure = longer low beep, matching the tones cashiers already
 * know from the old hook.
 */

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (!sharedContext) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      sharedContext = new Ctor();
    }
    if (sharedContext.state === 'suspended') {
      void sharedContext.resume();
    }
    return sharedContext;
  } catch {
    return null;
  }
}

function beep(frequency: number, durationMs: number): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.value = 0.25;
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Audio unavailable — visual feedback still fires.
  }
}

export function playScanSuccessSound(): void {
  beep(1200, 100);
}

export function playScanFailureSound(): void {
  beep(300, 200);
}
