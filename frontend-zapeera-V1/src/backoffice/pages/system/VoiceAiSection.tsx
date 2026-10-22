import { useState, useEffect, useCallback } from 'react';
import { Mic, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import type { VoiceAiConfig, VoiceAiUsageReport } from '../../types';

/**
 * Voice AI Assistant — platform settings section (Settings page).
 *
 * The voice assistant's rule parser is always free and unlimited. The
 * AI fallback (for commands the parser cannot understand) runs on a
 * shared free-tier provider pool, so each subscription plan gets a
 * monthly TOKEN quota and the whole platform gets a daily token cap.
 * Values are stored server-side (Settings table, owner
 * 'global_voice_ai') and enforced by the backend proxy before any
 * provider call — see backend voice-ai-config.util / voice-ai.service.
 * ≈ commands uses the planning estimate of ~1,350 tokens per command.
 */

const TOKENS_PER_COMMAND = 1350;

const fmt = (n: number) => n.toLocaleString('en-US');

export function VoiceAiSection() {
  const [config, setConfig] = useState<VoiceAiConfig | null>(null);
  const [usage, setUsage] = useState<VoiceAiUsageReport | null>(null);
  const [quotas, setQuotas] = useState<Record<string, string>>({});
  const [dailyCap, setDailyCap] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, usageRes] = await Promise.all([
        backofficeApi.getVoiceAiConfig(),
        backofficeApi.getVoiceAiUsage(),
      ]);
      const cfg = (cfgRes as any).data as VoiceAiConfig;
      setConfig(cfg);
      setQuotas(Object.fromEntries(cfg.plans.map((p) => [p.id, String(p.monthlyTokens)])));
      setDailyCap(String(cfg.dailyTokenCap));
      setUsage((usageRes as any).data as VoiceAiUsageReport);
    } catch (e: any) {
      setError(e?.message || 'Could not load voice AI settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!config) return;
    const planQuotas: Record<string, number> = {};
    for (const plan of config.plans) {
      const v = Number(quotas[plan.id]);
      if (!Number.isFinite(v) || v < 0) {
        toast.error(`Invalid token quota for ${plan.name}`);
        return;
      }
      planQuotas[plan.id] = Math.floor(v);
    }
    const cap = Number(dailyCap);
    if (!Number.isFinite(cap) || cap < 0) {
      toast.error('Invalid daily token cap');
      return;
    }
    setSaving(true);
    try {
      await backofficeApi.updateVoiceAiConfig({ planQuotas, dailyTokenCap: Math.floor(cap) });
      toast.success('Voice AI quotas saved');
      await load();
    } catch {
      toast.error('Failed to save voice AI quotas');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Mic className="w-5 h-5 text-gray-400" /> Voice AI Assistant
        </h3>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition text-xs font-medium disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5 max-w-3xl">
        The rule-based voice parser is always free and unlimited. Only commands the parser cannot
        understand go to the AI layer, which runs on a shared free-tier provider pool — so each plan
        gets a monthly token quota and the platform a daily safety cap. Quotas apply immediately,
        including mid-month plan changes. The AI layer itself activates when{' '}
        <code className="text-xs bg-gray-100 rounded px-1 py-0.5">VOICE_AI_API_KEY</code> is set in
        the server .env.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading voice AI settings…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : config ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
            {config.plans.map((plan) => (
              <div key={plan.id} className="bg-gray-50 rounded-xl p-4">
                <label className="block text-xs text-gray-500 mb-1" htmlFor={`voice-ai-quota-${plan.id}`}>
                  {plan.name} — tokens / month{plan.customised ? '' : ' (default)'}
                </label>
                <input
                  id={`voice-ai-quota-${plan.id}`}
                  type="number"
                  min={0}
                  step={1000}
                  value={quotas[plan.id] ?? ''}
                  onChange={(e) => setQuotas((prev) => ({ ...prev, [plan.id]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1.5">
                  ≈ {fmt(Math.floor((Number(quotas[plan.id]) || 0) / TOKENS_PER_COMMAND))} AI commands / month
                </p>
              </div>
            ))}
            <div className="bg-gray-50 rounded-xl p-4">
              <label className="block text-xs text-gray-500 mb-1" htmlFor="voice-ai-daily-cap">
                Platform daily cap — tokens / day (all businesses)
              </label>
              <input
                id="voice-ai-daily-cap"
                type="number"
                min={0}
                step={1000}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Protects the shared free-tier pool from a single heavy day.
              </p>
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save quotas'}
          </button>

          <h4 className="text-sm font-semibold text-gray-900 mt-8 mb-3">
            Usage — {usage?.period || 'this month'}
            {usage ? (
              <span className="font-normal text-gray-500">
                {' '}· {fmt(usage.totals.calls)} AI commands · {fmt(usage.totals.tokensUsed)} tokens platform-wide
              </span>
            ) : null}
          </h4>
          {!usage || usage.businesses.length === 0 ? (
            <p className="text-sm text-gray-400">
              No business has used the AI layer this month. (Businesses with no AI use are not listed.)
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-4 font-medium">Business</th>
                    <th className="py-2 pr-4 font-medium">Plan</th>
                    <th className="py-2 pr-4 font-medium">AI commands</th>
                    <th className="py-2 pr-4 font-medium">Tokens used</th>
                    <th className="py-2 pr-4 font-medium">% of quota</th>
                    <th className="py-2 font-medium">Provider</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.businesses.map((b) => (
                    <tr key={b.businessId} className="border-b border-gray-50">
                      <td className="py-2.5 pr-4 font-medium text-gray-900">{b.businessName}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{b.planName}</td>
                      <td className="py-2.5 pr-4 text-gray-600">
                        {fmt(b.calls)}
                        {b.estimatedCalls > 0 ? (
                          <span className="text-gray-400"> ({b.estimatedCalls} est.)</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600">
                        {fmt(b.tokensUsed)} <span className="text-gray-400">of {fmt(b.tokenLimit)}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full ${b.percentUsed >= 100 ? 'bg-red-500' : b.percentUsed >= 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
                              style={{ width: `${Math.min(100, b.percentUsed)}%` }}
                            />
                          </div>
                          <span className="text-gray-600">{b.percentUsed}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-gray-600">{b.lastProvider || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
