import { useState, useEffect, useCallback } from "react";
import { BellRing, Settings, Save, RotateCcw, Check } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { key: "sale", label: "Sales", desc: "New sales, refunds and payment proofs" },
  { key: "inventory", label: "Inventory", desc: "Stock changes, low-stock alerts, expiries" },
  { key: "subscription", label: "Subscriptions", desc: "Plan changes, payment approvals, expiry reminders" },
  { key: "invitation", label: "Invitations", desc: "Business invitations and staff invites" },
  { key: "staff", label: "Staff", desc: "Team member changes and role updates" },
  { key: "billing", label: "Billing", desc: "Payment receipts and billing changes" },
  { key: "system", label: "System", desc: "Account alerts, maintenance, and announcements" },
] as const;

const NotificationPreferencesPage = () => {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [original, setOriginal] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.getNotificationPreferences();
      if (res.success && res.data) {
        setPrefs(res.data);
        setOriginal(res.data);
      } else {
        // Defaults: all enabled
        const defaults: Record<string, boolean> = {};
        CATEGORIES.forEach((c) => (defaults[c.key] = true));
        setPrefs(defaults);
        setOriginal(defaults);
      }
    } catch {
      const defaults: Record<string, boolean> = {};
      CATEGORIES.forEach((c) => (defaults[c.key] = true));
      setPrefs(defaults);
      setOriginal(defaults);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const hasChanges = JSON.stringify(prefs) !== JSON.stringify(original);

  const handleToggle = (key: string, enabled: boolean) => {
    setPrefs((p) => ({ ...p, [key]: enabled }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiService.bulkUpdateNotificationPreferences(prefs);
      if (res.success) {
        setOriginal(prefs);
        toast({ title: "Preferences saved", description: "Your notification settings have been updated." });
      } else {
        toast({ title: "Save failed", description: res.message || "Could not save preferences.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message || "Could not save preferences.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    const defaults: Record<string, boolean> = {};
    CATEGORIES.forEach((c) => (defaults[c.key] = true));
    setPrefs(defaults);
  };

  const allOn = CATEGORIES.every((c) => prefs[c.key] !== false);
  const allOff = CATEGORIES.every((c) => prefs[c.key] === false);

  const handleToggleAll = (enabled: boolean) => {
    const next: Record<string, boolean> = {};
    CATEGORIES.forEach((c) => (next[c.key] = enabled));
    setPrefs(next);
  };

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <Settings className="h-3.5 w-3.5" />
          Preferences
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Notification Settings</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Choose which notifications you want to receive across the platform.</p>
      </div>

      {/* Master controls */}
      <section className="mb-6 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-6 py-4">
          <div className="flex items-center gap-2.5 text-[15px] font-bold text-[#0a1128]">
            <BellRing className="h-4 w-4 text-[#1a52c5]" />
            All Notifications
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleToggleAll(true)}
              disabled={allOn || loading}
              className="h-8 rounded-lg text-xs font-semibold"
            >
              <Check className="mr-1 h-3 w-3" /> Enable All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleToggleAll(false)}
              disabled={allOff || loading}
              className="h-8 rounded-lg text-xs font-semibold"
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Disable All
            </Button>
          </div>
        </div>
      </section>

      {/* Category toggles */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-[#f0f2f7]" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {CATEGORIES.map((cat) => {
            const enabled = prefs[cat.key] !== false;
            return (
              <div
                key={cat.key}
                className={cn(
                  "flex items-center gap-5 rounded-2xl border bg-white px-6 py-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all",
                  enabled ? "border-[rgba(15,23,60,0.06)]" : "border-[rgba(15,23,60,0.04)] opacity-60"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#0a1128]">{cat.label}</p>
                  <p className="mt-0.5 text-[13px] text-[#8c95b0]">{cat.desc}</p>
                </div>
                <Switch
                  id={`pref-${cat.key}`}
                  checked={enabled}
                  onCheckedChange={(checked) => handleToggle(cat.key, checked)}
                  className="h-6 w-11 shrink-0 border-0 shadow-none data-[state=unchecked]:bg-[#d1d5db] data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#1a52c5] data-[state=checked]:to-[#28c2ce] data-[state=checked]:shadow-[0_2px_8px_rgba(26,82,197,0.25)]"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={handleResetDefaults}
          disabled={loading || allOn}
          className="h-10 gap-2 rounded-[10px] border-[rgba(15,23,60,0.1)] font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="h-10 gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </main>
  );
};

export default NotificationPreferencesPage;
