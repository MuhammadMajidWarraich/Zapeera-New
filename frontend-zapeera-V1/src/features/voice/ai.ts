/**
 * Voice Assistant AI layer — client transport.
 *
 * Called ONLY when the rule parser returns "unknown". Asks the backend
 * proxy (POST /api/voice/ai-parse) for a structured proposal and maps
 * the reply to an outcome the VoiceAssistant can act on. The proxy
 * holds the provider key and enforces the plan quota; this module
 * re-validates the envelope (ai-intent.ts) before the executor ever
 * sees it. Any failure — network, unconfigured, rate limit, daily cap,
 * invalid envelope — degrades gracefully to parser-only behaviour.
 */

import { apiService } from '@/services/api';
import type { VoiceIntent } from './intents';
import { mapAiStatus, resolveAiEnvelope } from './ai-intent';

export type AiOutcome =
  | { kind: 'intent'; intent: VoiceIntent }
  | { kind: 'actions'; intents: VoiceIntent[] }
  | { kind: 'clarify'; message: string }
  | { kind: 'message'; message: string }
  | { kind: 'quota' }
  | { kind: 'unavailable' };

export async function requestAiParse(utterance: string): Promise<AiOutcome> {
  let data: any;
  try {
    const res: any = await apiService.parseVoiceWithAi({ utterance });
    data = res?.data ?? res;
  } catch {
    return { kind: 'unavailable' };
  }

  const mapped = mapAiStatus(data?.status);
  if (mapped === 'quota') return { kind: 'quota' };
  if (mapped !== 'ok') return { kind: 'unavailable' };

  const envelope = resolveAiEnvelope(data?.envelope);
  if (!envelope) return { kind: 'unavailable' };

  switch (envelope.kind) {
    case 'intent':
      return { kind: 'intent', intent: envelope.intent };
    case 'actions':
      return { kind: 'actions', intents: envelope.intents };
    case 'clarify':
      return { kind: 'clarify', message: envelope.message };
    case 'message':
      return { kind: 'message', message: envelope.message };
  }
}
