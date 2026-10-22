import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  ImagePlus,
  Link2,
  Loader2,
  Palette,
  Store,
  Trash2,
} from 'lucide-react';
import { apiService } from '../services/api';
import { useBranding } from '../contexts/BrandingContext';
import { useToast } from '../hooks/use-toast';

// ─── Partner portal (White-label Feature 3) ───────────────────────────
// The reseller's home in the main app, at /partner. Visible only to a
// partner admin (the partner's adminUserId, resolved server-side by
// GET /partners/me); everyone else gets a plain empty state. Shows the
// partner's attributed businesses with their (standard, read-only)
// plans, the join links to share, and the branding settings form.
// Logo upload follows the profile-photo pattern: client-side downscale
// to ≤512px JPEG → base64 data-URI.

interface Partner {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  supportEmail: string | null;
  tagline: string | null;
  status: string;
}

interface PartnerBusiness {
  id: string;
  name: string;
  businessType: string | null;
  isActive: boolean;
  createdAt: string;
  planName: string | null;
  planPrice: number | null;
  subscriptionStatus: string | null;
}

/** Downscale an image file to a ≤512px JPEG data-URI (mirrors the
 *  profile-photo upload in ProfileSecurityPage). */
function downscaleImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 512 / Math.max(img.width, img.height));
          if (scale >= 1 && file.size <= 400 * 1024) {
            resolve(raw);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(raw);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const PartnerPortal = () => {
  const { toast } = useToast();
  const { refreshBranding } = useBranding();
  const [loading, setLoading] = useState(true);
  const [notPartner, setNotPartner] = useState(false);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [totals, setTotals] = useState({ businessCount: 0, activeBusinessCount: 0 });
  const [businesses, setBusinesses] = useState<PartnerBusiness[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', tagline: '', supportEmail: '', primaryColor: '', logoUrl: '' as string | null });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.getMyPartner();
      if (!res.success || !res.data) {
        setNotPartner(true);
        return;
      }
      const p = res.data.partner as Partner;
      setPartner(p);
      setTotals(res.data.totals);
      setForm({
        name: p.name || '',
        tagline: p.tagline || '',
        supportEmail: p.supportEmail || '',
        primaryColor: p.primaryColor || '',
        logoUrl: p.logoUrl,
      });
      const biz = await apiService.getMyPartnerBusinesses();
      if (biz.success && Array.isArray(biz.data)) setBusinesses(biz.data);
    } catch {
      setNotPartner(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
    } catch {
      toast({ title: 'Copy failed', description: text, variant: 'destructive' });
    }
  };

  const onLogoFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Logo image must be under 5MB.', variant: 'destructive' });
      return;
    }
    const dataUrl = await downscaleImageFile(file);
    setForm((f) => ({ ...f, logoUrl: dataUrl }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiService.updateMyPartnerBranding({
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        supportEmail: form.supportEmail.trim() || null,
        primaryColor: form.primaryColor.trim() || null,
        logoUrl: form.logoUrl || null,
      });
      if (res.success) {
        toast({ title: 'Branding saved', description: 'Your partner branding is live.' });
        refreshBranding();
        load();
      } else {
        toast({ title: 'Save failed', description: (res as any).message || 'Please check the form.', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Unexpected error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notPartner || !partner) {
    return (
      <div className="mx-auto max-w-xl py-24 text-center">
        <Store className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Partner Portal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This account does not administer a white-label partner. If you sell Zapeera under your
          own brand, ask the Zapeera team to set up your partner account.
        </p>
      </div>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const joinUrl = `${origin}/join/${partner.slug}`;
  const signupUrl = `${origin}/signup?partner=${partner.slug}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        {form.logoUrl ? (
          <img src={form.logoUrl} alt={partner.name} className="h-14 w-14 rounded-2xl object-contain bg-white shadow" />
        ) : (
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold">
            {partner.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{partner.name}</h1>
          <p className="text-sm text-muted-foreground">
            Partner portal · slug <span className="font-mono">{partner.slug}</span>
          </p>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            partner.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {partner.status}
        </span>
      </div>

      {partner.status !== 'ACTIVE' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Your partner account is suspended: your branding no longer appears on signup or in the
          app, and new signups are not attributed to you until it is reactivated.
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" /> Businesses sold
          </div>
          <div className="mt-1 text-3xl font-bold">{totals.businessCount}</div>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" /> Active businesses
          </div>
          <div className="mt-1 text-3xl font-bold">{totals.activeBusinessCount}</div>
        </div>
      </div>

      {/* Join links */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Link2 className="h-4 w-4" /> Your join links
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Share these with your customers. Anyone who signs up through them is attributed to{' '}
          {partner.name} and sees your branding.
        </p>
        {[
          { label: 'Join link', url: joinUrl },
          { label: 'Signup link', url: signupUrl },
        ].map((row) => (
          <div key={row.label} className="mt-3 flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{row.label}</span>
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{row.url}</code>
            <button
              type="button"
              onClick={() => copy(row.url, row.label)}
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium hover:bg-muted"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </div>
        ))}
      </div>

      {/* Businesses */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Building2 className="h-4 w-4" /> Your businesses
        </h2>
        {businesses.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No businesses yet. Share your join link — businesses created through it will appear here.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Business</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Subscription</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{b.name}</td>
                    <td className="py-2.5 pr-3">{b.planName || '—'}</td>
                    <td className="py-2.5 pr-3">{b.subscriptionStatus || '—'}</td>
                    <td className="py-2.5 pr-3">{b.isActive ? 'Active' : 'Inactive'}</td>
                    <td className="py-2.5">{new Date(b.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Plans are the standard Zapeera plans; pricing is managed by the Zapeera team.
        </p>
      </div>

      {/* Branding settings */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Palette className="h-4 w-4" /> Branding settings
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Product name (your brand)</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Acme POS"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Support email</span>
            <input
              value={form.supportEmail}
              onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="support@yourbrand.com"
              type="email"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Tagline</span>
            <input
              value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="Shown under your product name on the sign-in page"
            />
          </label>
          <div className="block">
            <span className="text-xs font-medium text-muted-foreground">Primary color</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : '#1F7C47'}
                onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                className="h-10 w-14 cursor-pointer rounded-lg border bg-background"
              />
              <input
                value={form.primaryColor}
                onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                className="w-32 rounded-lg border bg-background px-3 py-2 font-mono text-sm"
                placeholder="#1F7C47"
              />
              {form.primaryColor && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, primaryColor: '' }))}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="block">
            <span className="text-xs font-medium text-muted-foreground">Logo</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onLogoFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <ImagePlus className="h-4 w-4" /> {form.logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, logoUrl: null }))}
                  className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save branding
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartnerPortal;
