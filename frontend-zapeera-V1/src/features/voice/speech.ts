/**
 * Speech helpers for the Voice Assistant: Web Speech recognition
 * (push-to-talk, single utterance) and speech-synthesis readback.
 * Framework-free; all browser access is guarded so unsupported browsers
 * degrade gracefully to the text-command input.
 */

export type VoiceLang = 'en-US' | 'ur-PK';

interface RecognitionHandlers {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Start a single-utterance recognition session.
 * Returns a stop function, or null when speech recognition is unavailable.
 */
export function startListening(
  lang: VoiceLang,
  handlers: RecognitionHandlers,
): { stop: () => void } | null {
  if (!isSpeechRecognitionSupported()) return null;
  const w = window as unknown as Record<string, any>;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let stopped = false;

  recognition.onresult = (event: any) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result?.[0]?.transcript || '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (interim && handlers.onInterim) handlers.onInterim(interim);
    if (finalText && handlers.onFinal) handlers.onFinal(finalText.trim());
  };
  recognition.onerror = (event: any) => {
    if (handlers.onError) handlers.onError(String(event?.error || 'unknown'));
  };
  recognition.onend = () => {
    if (!stopped && handlers.onEnd) handlers.onEnd();
  };

  try {
    recognition.start();
  } catch {
    if (handlers.onError) handlers.onError('start-failed');
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
    },
  };
}

/** Speak a short summary phrase. No-ops when synthesis is unavailable. */
export function speak(text: string, lang: VoiceLang): void {
  if (!isSpeechSynthesisSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.02;
    const voices = synth.getVoices();
    const prefix = lang.split('-')[0];
    const voice =
      voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang?.toLowerCase().startsWith(prefix));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  } catch {
    // speech is best-effort only
  }
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
