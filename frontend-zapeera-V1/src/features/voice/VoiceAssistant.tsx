import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  Loader2,
  Mic,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAdmin } from '@/contexts/useAdmin';
import { useAuth } from '@/contexts/AuthContext';
import { parseUtterance, EXAMPLE_COMMANDS, type VoiceIntent } from './intents';
import {
  runIntent,
  executePending,
  type PendingAction,
  type VoiceResult,
} from './executor';
import { requestAiParse } from './ai';
import { AI_QUOTA_MESSAGE, AI_UNAVAILABLE_MESSAGE } from './ai-intent';
import { apiService } from '@/services/api';
import {
  isSpeechRecognitionSupported,
  startListening,
  speak,
  stopSpeaking,
  type VoiceLang,
} from './speech';

interface HistoryEntry {
  id: number;
  role: 'user' | 'assistant' | 'error';
  title?: string;
  lines?: string[];
}

interface ChoiceState {
  title: string;
  options: Array<{ key: string; label: string; pending: PendingAction }>;
}

const LANG_STORAGE_KEY = 'zapeera-voice-lang';
const MUTE_STORAGE_KEY = 'zapeera-voice-muted';

function loadLang(): VoiceLang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'ur-PK' ? 'ur-PK' : 'en-US';
  } catch {
    return 'en-US';
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function VoiceAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedBranchId } = useAdmin();
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [choices, setChoices] = useState<ChoiceState | null>(null);
  const [lang, setLang] = useState<VoiceLang>(loadLang);
  const [muted, setMuted] = useState<boolean>(loadMuted);
  const [aiUsage, setAiUsage] = useState<{ calls: number; approxLimit: number; percent: number } | null>(null);

  const speechSupported = useMemo(() => isSpeechRecognitionSupported(), []);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const idRef = useRef(0);

  const businessSlug = useMemo(() => {
    const match = location.pathname.match(/\/business\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const branchId = useMemo(() => {
    const u = user as any;
    return (
      selectedBranchId ||
      u?.membership?.branchIds?.[0] ||
      u?.branchId ||
      null
    ) as string | null;
  }, [selectedBranchId, user]);

  const speakIfOn = useCallback(
    (text: string) => {
      if (!muted && text) speak(text, lang);
    },
    [muted, lang],
  );

  const pushHistory = useCallback((entry: Omit<HistoryEntry, 'id'>) => {
    idRef.current += 1;
    const id = idRef.current;
    setHistory((prev) => [...prev.slice(-29), { ...entry, id }]);
  }, []);

  const pushResult = useCallback(
    (result: VoiceResult) => {
      pushHistory({
        role: result.ok ? 'assistant' : 'error',
        title: result.title,
        lines: result.lines,
      });
      speakIfOn(result.speak);
    },
    [pushHistory, speakIfOn],
  );

  const confirmPending = useCallback(
    async (action: PendingAction) => {
      setBusy(true);
      try {
        const result = await executePending(action);
        pushResult(result);
      } finally {
        setPending(null);
        setBusy(false);
      }
    },
    [pushResult],
  );

  // AI usage meter (plan quota). Decorative: it never blocks or breaks
  // the assistant — when the AI layer is unconfigured it stays hidden.
  const refreshAiUsage = useCallback(async () => {
    try {
      const res: any = await apiService.getVoiceAiUsage();
      const data = res?.data ?? res;
      if (data?.configured) {
        setAiUsage({
          calls: data.calls || 0,
          approxLimit: data.approxCommandLimit || 0,
          percent: data.percentUsed || 0,
        });
      } else {
        setAiUsage(null);
      }
    } catch {
      // ignore — meter only
    }
  }, []);

  useEffect(() => {
    if (open) void refreshAiUsage();
  }, [open, refreshAiUsage]);

  const processUtterance = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || busy) return;
      pushHistory({ role: 'user', lines: [text] });
      const intent = parseUtterance(text);

      // Confirmation / cancellation of a pending write action.
      if (intent.type === 'confirm') {
        if (pending) {
          await confirmPending(pending);
        } else {
          pushHistory({ role: 'assistant', title: 'Nothing to confirm right now.' });
        }
        return;
      }
      if (intent.type === 'cancel') {
        if (pending || choices) {
          setPending(null);
          setChoices(null);
          pushHistory({ role: 'assistant', title: 'Cancelled.' });
          speakIfOn('Cancelled.');
        } else {
          pushHistory({ role: 'assistant', title: 'Nothing to cancel.' });
        }
        return;
      }

      // A fresh command replaces any pending confirmation / choices.
      if (pending) {
        setPending(null);
        pushHistory({ role: 'assistant', title: 'Previous action discarded.' });
      }
      if (choices) setChoices(null);

      const ctx = {
        branchId,
        businessSlug,
        navigate: (path: string) => {
          navigate(path);
          setOpen(false);
        },
      };
      const handleOutcome = (outcome: Awaited<ReturnType<typeof runIntent>>) => {
        if (outcome.kind === 'result') {
          pushResult(outcome.result);
        } else if (outcome.kind === 'confirm') {
          setPending(outcome.pending);
          pushHistory({
            role: 'assistant',
            title: 'Please confirm',
            lines: [outcome.pending.summary],
          });
          speakIfOn(outcome.pending.speakPrompt);
        } else if (outcome.kind === 'choices') {
          setChoices({ title: outcome.title, options: outcome.options });
          pushHistory({ role: 'assistant', title: outcome.title });
          speakIfOn(outcome.speak);
        }
      };

      setBusy(true);
      try {
        let intentToRun: VoiceIntent = intent;
        let aiNote: string | null = null;

        // AI fallback: ONLY for utterances the rule parser cannot
        // handle. The AI proposes a validated action in the parser's
        // own schema; the same executor + confirm cards dispose of it.
        if (intent.type === 'unknown') {
          const ai = await requestAiParse(text);
          if (ai.kind === 'intent') {
            intentToRun = ai.intent;
          } else if (ai.kind === 'actions') {
            // Read-only chain (validated): run each lookup in order;
            // a confirm/choices outcome defensively pauses the chain.
            for (const step of ai.intents) {
              const stepOutcome = await runIntent(step, ctx);
              handleOutcome(stepOutcome);
              if (stepOutcome.kind !== 'result') break;
            }
            void refreshAiUsage();
            return;
          } else if (ai.kind === 'clarify' || ai.kind === 'message') {
            pushHistory({ role: 'assistant', title: ai.message });
            speakIfOn(ai.message);
            void refreshAiUsage();
            return;
          } else if (ai.kind === 'quota') {
            pushHistory({ role: 'assistant', title: 'AI quota khatam', lines: [AI_QUOTA_MESSAGE] });
            speakIfOn(AI_QUOTA_MESSAGE);
            return;
          } else {
            // AI unavailable (unconfigured / rate-limited / error):
            // fall through to the parser's own "didn't understand"
            // reply and add the honest note below it.
            aiNote = AI_UNAVAILABLE_MESSAGE;
          }
        }

        const outcome = await runIntent(intentToRun, ctx);
        handleOutcome(outcome);
        if (aiNote) pushHistory({ role: 'assistant', lines: [aiNote] });
        if (intentToRun !== intent) void refreshAiUsage();
      } catch (e: any) {
        pushHistory({
          role: 'error',
          title: 'Something went wrong',
          lines: [e?.message || 'Please try again.'],
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, pending, choices, branchId, businessSlug, navigate, pushHistory, pushResult, speakIfOn, confirmPending, refreshAiUsage],
  );

  // Keep a ref to the latest processor so speech callbacks never go stale.
  const processRef = useRef(processUtterance);
  processRef.current = processUtterance;

  const stopListening = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    if (!speechSupported) return;
    const session = startListening(lang, {
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim('');
        setListening(false);
        sessionRef.current = null;
        void processRef.current(t);
      },
      onError: (err) => {
        setListening(false);
        sessionRef.current = null;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          pushHistory({
            role: 'error',
            title: 'Microphone blocked',
            lines: ['Allow microphone access in the browser, or type your command below.'],
          });
        } else if (err !== 'aborted' && err !== 'no-speech') {
          pushHistory({
            role: 'error',
            title: 'Voice input failed',
            lines: ['Please try again, or type your command below.'],
          });
        }
      },
      onEnd: () => setListening(false),
    });
    if (session) {
      sessionRef.current = session;
      setListening(true);
    }
  }, [listening, speechSupported, lang, stopListening, pushHistory]);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const toggleLang = (next: VoiceLang) => {
    setLang(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    stopListening();
  };

  const toggleMuted = () => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      if (next) stopSpeaking();
      return next;
    });
  };

  const chooseOption = (option: ChoiceState['options'][number]) => {
    setChoices(null);
    setPending(option.pending);
    pushHistory({
      role: 'assistant',
      title: 'Please confirm',
      lines: [option.pending.summary],
    });
    speakIfOn(option.pending.speakPrompt);
  };

  return (
    <>
      {/* Floating mic button — bottom-right of every workspace page */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open voice assistant"
        title="Voice Assistant"
        className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_8px_24px_rgba(26,82,197,0.4)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(26,82,197,0.45)]"
      >
        <Mic className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-[92vw] flex-col p-0 sm:w-[400px]">
          <SheetHeader className="shrink-0 bg-gradient-to-br from-[#0f2350] to-[#1a52c5] px-5 py-4 text-left">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="flex items-center gap-2 text-white">
                <Mic className="h-5 w-5" /> Voice Assistant
              </SheetTitle>
              <div className="flex items-center gap-1.5">
                <div className="flex overflow-hidden rounded-lg border border-white/25 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleLang('en-US')}
                    className={`px-2.5 py-1 ${lang === 'en-US' ? 'bg-white text-[#1a52c5]' : 'text-white/85 hover:bg-white/10'}`}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleLang('ur-PK')}
                    className={`px-2.5 py-1 ${lang === 'ur-PK' ? 'bg-white text-[#1a52c5]' : 'text-white/85 hover:bg-white/10'}`}
                  >
                    اردو
                  </button>
                </div>
                <button
                  type="button"
                  onClick={toggleMuted}
                  aria-label={muted ? 'Unmute voice replies' : 'Mute voice replies'}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-white/25 text-white/85 hover:bg-white/10"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <SheetDescription className="text-[12px] text-white/70">
              Bol kar ya likh kar command dein — sell, stock, reports aur zyada.
            </SheetDescription>
          </SheetHeader>

          {/* AI usage meter — visible only when the AI layer is on */}
          {aiUsage && (
            <div className="shrink-0 border-b border-black/[0.06] bg-[#f7f9fc] px-5 py-2.5">
              <div className="flex items-center justify-between text-[11.5px] text-[#4a5578]">
                <span>
                  AI commands this month: <b className="text-[#16213c]">{aiUsage.calls}</b> of ~{aiUsage.approxLimit}
                </span>
                <span>{Math.round(aiUsage.percent)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1a52c5] to-[#28c2ce]"
                  style={{ width: `${Math.min(100, Math.max(0, aiUsage.percent))}%` }}
                />
              </div>
            </div>
          )}

          {!speechSupported && (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[12px] text-amber-800">
              Voice input isn&apos;t supported in this browser — type your command below instead.
            </div>
          )}

          {/* Pending confirmation card */}
          {pending && (
            <div className="shrink-0 border-b border-[#1a52c5]/20 bg-[#eef4ff] px-5 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a52c5]">
                Please confirm
              </p>
              <p className="mt-1 text-sm font-semibold text-[#16213c]">{pending.summary}</p>
              <ul className="mt-1.5 space-y-0.5">
                {pending.detailLines.map((line, i) => (
                  <li key={i} className="text-[12px] text-[#4a5578]">
                    {line}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void confirmPending(pending)}
                  className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-95"
                >
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    pushHistory({ role: 'assistant', title: 'Cancelled.' });
                  }}
                >
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-[#4a5578]">
                Ya bolain: &ldquo;confirm&rdquo; / &ldquo;cancel&rdquo;
              </p>
            </div>
          )}

          {/* Product choices card */}
          {choices && !pending && (
            <div className="shrink-0 border-b border-[#1a52c5]/20 bg-[#eef4ff] px-5 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a52c5]">
                {choices.title}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {choices.options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => chooseOption(option)}
                    className="rounded-lg border border-[#1a52c5]/25 bg-white px-3 py-2 text-left text-[13px] font-medium text-[#16213c] transition-colors hover:border-[#1a52c5]"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {history.length === 0 && (
              <div>
                <p className="text-[13px] text-[#4a5578]">
                  Try one of these — tap a chip or press the mic:
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {EXAMPLE_COMMANDS.map((cmd) => (
                    <button
                      key={cmd}
                      type="button"
                      onClick={() => void processUtterance(cmd)}
                      className="rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-[12px] font-medium text-[#16213c] shadow-sm transition-colors hover:border-[#1a52c5] hover:text-[#1a52c5]"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {history.map((entry) =>
              entry.role === 'user' ? (
                <div key={entry.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-3.5 py-2 text-[13px] font-medium text-white">
                    {entry.lines?.[0]}
                  </div>
                </div>
              ) : (
                <div
                  key={entry.id}
                  className={`max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 ${
                    entry.role === 'error'
                      ? 'border-red-200 bg-red-50'
                      : 'border-black/[0.05] bg-white shadow-sm'
                  }`}
                >
                  {entry.title && (
                    <p
                      className={`text-[13px] font-semibold ${
                        entry.role === 'error' ? 'text-red-700' : 'text-[#16213c]'
                      }`}
                    >
                      {entry.title}
                    </p>
                  )}
                  {entry.lines?.map((line, i) => (
                    <p
                      key={i}
                      className={`text-[12.5px] leading-relaxed ${
                        entry.role === 'error' ? 'text-red-600' : 'text-[#4a5578]'
                      } ${entry.title ? 'mt-0.5' : ''}`}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-[12px] text-[#4a5578]">
                <Loader2 className="h-4 w-4 animate-spin text-[#1a52c5]" /> Working…
              </div>
            )}
            {listening && (
              <div className="flex items-center gap-2 text-[12.5px] italic text-[#1a52c5]">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1a52c5] opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1a52c5]" />
                </span>
                {interim || 'Listening… bolain'}
              </div>
            )}
          </div>

          {/* Input row */}
          <form
            className="flex shrink-0 items-center gap-2 border-t border-black/[0.06] bg-white px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = input;
              setInput('');
              void processUtterance(value);
            }}
          >
            {speechSupported && (
              <button
                type="button"
                onClick={toggleListening}
                aria-label={listening ? 'Stop listening' : 'Start voice input'}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-all ${
                  listening
                    ? 'bg-red-500 shadow-[0_4px_14px_rgba(239,68,68,0.4)]'
                    : 'bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] shadow-[0_4px_14px_rgba(26,82,197,0.35)]'
                }`}
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command… e.g. sell 2 paracetamol"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-[#f7f9fc] px-3 text-[13px] text-[#16213c] outline-none placeholder:text-[#8a94b0] focus:border-[#1a52c5] focus:bg-white"
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !input.trim()}
              className="h-10 w-10 shrink-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-95"
              aria-label="Send command"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
