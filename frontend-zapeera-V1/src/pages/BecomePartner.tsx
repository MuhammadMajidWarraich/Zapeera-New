import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Store,
  Clock3,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Palette,
  Link2,
  LayoutDashboard,
} from "lucide-react";
import { apiService, type PartnerApplicationItem } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { toast } from "@/hooks/use-toast";

// Become a Partner — white-label reseller application (2026-10-22).
// Account-level page like Affiliate: a user applies under their own
// brand; the application lands PENDING in Backoffice, and approval
// creates the partner with THIS account as its admin. The four states
// below mirror the application lifecycle exactly; an account that
// already administers a partner is sent to the portal instead.

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

const statusBadge = (status: string) => {
  const tone: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800",
    APPROVED: "bg-emerald-100 text-emerald-800",
    REJECTED: "bg-rose-100 text-rose-800",
  };
  return (
    <Badge className={tone[status] || "bg-gray-100 text-gray-800"} variant="secondary">
      {status}
    </Badge>
  );
};

const BecomePartner: React.FC = () => {
  const { user } = useAuth();
  const { viewer } = useBranding();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [application, setApplication] = useState<PartnerApplicationItem | null>(null);
  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    phone: "",
    website: "",
    message: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.getMyPartnerApplication();
      const app = (res as any)?.data?.application as PartnerApplicationItem | null;
      setApplication(app || null);
      if (app) {
        setForm((f) => ({
          companyName: app.companyName || f.companyName,
          contactName: app.contactName || f.contactName,
          phone: app.phone || f.phone,
          website: app.website || "",
          message: app.message || "",
        }));
      }
    } catch {
      // A failed read must not block applying — the form still works and
      // the server enforces the duplicate/partner guards.
      setApplication(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setForm((f) => (f.contactName ? f : { ...f, contactName: user?.name || "" }));
  }, [user?.name]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName.trim() || !form.phone.trim()) {
      toast({ title: "Company name and phone are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiService.applyForPartner({
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim() || undefined,
        phone: form.phone.trim(),
        website: form.website.trim() || undefined,
        message: form.message.trim() || undefined,
      });
      toast({ title: "Application submitted", description: "Our team will review it and get back to you." });
      await load();
    } catch (err: any) {
      toast({
        title: "Could not submit application",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="w-full space-y-6 px-4 py-7 sm:px-8 lg:px-11 lg:py-9">{children}</div>
  );

  if (loading) {
    return shell(
      <div className="flex items-center justify-center px-4 py-24 text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading partner application…
      </div>
    );
  }

  // Already a partner admin — the portal is the destination.
  if (viewer.isPartnerAdmin || application?.status === "APPROVED") {
    return shell(
      <Card>
        <CardContent className="flex flex-col items-start gap-4 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-[#0a1128]">You're a Zapeera partner 🎉</h1>
            <p className="mt-1 max-w-xl text-sm text-[#4a5578]">
              {application?.createdPartner
                ? <>Your partner <b>{application.createdPartner.name}</b> is active. Open the Partner Portal to manage your branding, join link and businesses.</>
                : <>Your partner account is active. Open the Partner Portal to manage your branding, join link and businesses.</>}
            </p>
          </div>
          <Button onClick={() => navigate("/partner")} className="gap-2">
            Open Partner Portal <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (application?.status === "PENDING") {
    return shell(
      <Card>
        <CardContent className="flex flex-col items-start gap-4 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-700">
            <Clock3 className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[#0a1128]">Application under review</h1>
              {statusBadge(application.status)}
            </div>
            <p className="max-w-xl text-sm text-[#4a5578]">
              You applied to sell Zapeera as <b>{application.companyName}</b> on {fmtDate(application.createdAt)}.
              Our team reviews every application personally — once approved, this account becomes the
              partner admin and your portal, branding and join link switch on here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return shell(
    <>
      <div>
        <h1 className="text-2xl font-bold text-[#0a1128]">Become a Partner</h1>
        <p className="mt-1 text-sm text-[#4a5578]">
          Sell Zapeera under your own brand — your name, your logo, your color. We handle the software,
          hosting and updates; you handle your customers.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { icon: Palette, title: "Your branding", body: "Your logo and color across the app, sign-in and sign-up — Zapeera's name stays hidden from your customers." },
          { icon: Link2, title: "Your join link", body: "Every business that signs up through your link is attributed to you automatically." },
          { icon: LayoutDashboard, title: "Your portal", body: "See your businesses, their plans and statuses, and update your branding any time." },
        ].map((f) => (
          <Card key={f.title}>
            <CardContent className="space-y-2 py-5">
              <f.icon className="h-5 w-5 text-[#1a52c5]" />
              <p className="text-sm font-semibold text-[#0a1128]">{f.title}</p>
              <p className="text-sm text-[#4a5578]">{f.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {application?.status === "REJECTED" && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="flex items-start gap-3 py-5">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="text-sm">
              <p className="font-semibold text-rose-800">Your previous application wasn't approved</p>
              {application.rejectionReason && (
                <p className="mt-0.5 text-rose-700">Reason: {application.rejectionReason}</p>
              )}
              <p className="mt-0.5 text-rose-700">You can update your details and apply again below.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-5 w-5 text-[#1a52c5]" /> Partner application
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bp-company">Company / brand name *</Label>
              <Input
                id="bp-company"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                placeholder="e.g. Acme Business Solutions"
                maxLength={120}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-contact">Contact name</Label>
              <Input
                id="bp-contact"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="Your full name"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-email">Email</Label>
              <Input id="bp-email" value={user?.email || application?.email || ""} disabled readOnly />
              <p className="text-xs text-[#8c95b0]">Approval designates this account as the partner admin.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-phone">Phone / WhatsApp *</Label>
              <Input
                id="bp-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="e.g. 0300 1234567"
                maxLength={40}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bp-website">Website (optional)</Label>
              <Input
                id="bp-website"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="e.g. acme.com.pk"
                maxLength={300}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bp-message">Anything we should know? (optional)</Label>
              <Textarea
                id="bp-message"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Your market, how many businesses you expect to onboard, questions…"
                maxLength={2000}
                rows={4}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                {application?.status === "REJECTED" ? "Apply again" : "Submit application"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
};

export default BecomePartner;
