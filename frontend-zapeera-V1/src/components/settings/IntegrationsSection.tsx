// ─── Settings → Integrations (feature/integration-framework) ─────────────
// Provider cards for every Tier 1 + Tier 2 vendor in the backend registry.
// A provider is connectable only once its sync-handler module is
// registered server-side — until then the card renders "Coming soon" with
// its honest limitation line. Tier 3 vendors (TikTok Shop, Stripe,
// PayPal, Bykea, Trax) are never listed: they are not feasible in
// Pakistan. Credentials entered here are write-only — no API response
// ever echoes them back.
//
// Pattern follows the FBR POS section in Settings.tsx: same
// zv3-settings-block section shell, same Button/Input/Label/Switch
// components, same toast feedback, same OWNER/MANAGER gating.
import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  History,
  Link2,
  MessageSquare,
  Plug,
  RefreshCw,
  Store,
  Table2,
  Truck,
  Unplug,
} from "lucide-react";
import { apiService, getApiBaseUrl, type IntegrationCategory, type IntegrationProviderInfo, type IntegrationSyncConfig, type IntegrationSyncLogRecord, type IntegrationTrackingResult } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<IntegrationCategory, typeof Store> = {
  "sales-channel": Store,
  payments: CreditCard,
  logistics: Truck,
  accounting: Calculator,
  productivity: Table2,
  messaging: MessageSquare,
};

const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  "sales-channel": "Sales channel",
  payments: "Payments",
  logistics: "Logistics",
  accounting: "Accounting",
  productivity: "Productivity",
  messaging: "Messaging",
};

const formatRelative = (iso?: string | null): string => {
  if (!iso) return "Not synced yet";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return "Not synced yet";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"} ago`;
};

const formatDateTime = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function StatusPill({ status, connectable }: { status: IntegrationProviderInfo["status"]; connectable: boolean }) {
  if (!connectable) {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
        Coming soon
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">
        <AlertTriangle className="h-3 w-3" /> Error
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[#f0f2f7] px-2.5 py-1 text-[11px] font-bold text-[#4a5578]">
      Not connected
    </span>
  );
}

// ─── PostEx shipments (feature/integration-postex) ───────────────────────
// Book / track / cancel / return, rendered on the PostEx card only, once
// connected. Booking takes a sale's invoice number (or sale id): the
// server builds the shipment from that sale — recipient from the customer,
// COD from the unpaid balance, parcel from the sale lines — and stores the
// tracking number on the sale. PostEx publishes no public API docs, so the
// honest limitation below is shown on the card itself.
function PostExShipmentPanel({ canManage }: { canManage: boolean }) {
  const [saleRef, setSaleRef] = useState("");
  const [trackingInput, setTrackingInput] = useState("");
  const [tracking, setTracking] = useState<IntegrationTrackingResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const showError = (title: string, e: any, fallback: string) => {
    toast({ title, description: e?.message || fallback, variant: "destructive" });
  };

  const handleBook = async () => {
    if (!saleRef.trim()) {
      toast({ title: "Sale reference needed", description: "Enter the sale's invoice number (or sale id).", variant: "destructive" });
      return;
    }
    setBusy("book");
    try {
      const res = await apiService.triggerIntegrationSync("postex", { entity: "shipment", saleRef: saleRef.trim() });
      if (res.success && res.data) {
        toast({ title: "PostEx shipment booked", description: res.data.result.message || `${res.data.result.recordsProcessed} shipment booked.` });
        const match = /tracking (\S+)/i.exec(res.data.result.message ?? "");
        if (match) setTrackingInput(match[1].replace(/[),.]+$/, ""));
        setSaleRef("");
      } else {
        toast({ title: "Could not book the shipment", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      showError("Could not book the shipment", e, "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleTrack = async () => {
    if (!trackingInput.trim()) {
      toast({ title: "Tracking number needed", description: "Enter the PostEx tracking (CN) number.", variant: "destructive" });
      return;
    }
    setBusy("track");
    try {
      const res = await apiService.getShipmentTracking("postex", trackingInput.trim());
      if (res.success && res.data) {
        setTracking(res.data);
      } else {
        toast({ title: "Could not fetch tracking", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      showError("Could not fetch tracking", e, "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (!tracking?.trackingNumber) return;
    setBusy("cancel");
    try {
      const res = await apiService.cancelShipment("postex", tracking.trackingNumber);
      if (res.success && res.data) {
        toast({ title: "Shipment cancelled", description: res.data.message || `Shipment ${tracking.trackingNumber} cancelled.` });
        setTracking({ ...tracking, status: "CANCELLED" });
      } else {
        toast({ title: "Could not cancel the shipment", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      showError("Could not cancel the shipment", e, "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleReturn = async () => {
    if (!tracking?.trackingNumber) return;
    setBusy("return");
    try {
      const res = await apiService.returnShipment("postex", tracking.trackingNumber);
      if (res.success && res.data) {
        toast({ title: "Return shipment booked", description: `Return tracking ${res.data.trackingNumber} (${res.data.status}).` });
      } else {
        toast({ title: "Could not book the return", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      showError("Could not book the return", e, "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-[10px] border border-[rgba(15,23,60,0.08)] px-4 py-3">
      <div className="text-[13px] font-bold text-[#0a1128]">Shipments</div>
      <div className="mt-3 flex flex-col gap-2">
        <Label htmlFor="postex-sale-ref" className="text-xs font-bold text-[#0a1128]">
          Book a shipment from a sale
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="postex-sale-ref"
            value={saleRef}
            onChange={(e) => setSaleRef(e.target.value)}
            placeholder="Invoice number, e.g. INV-1001"
            disabled={!canManage || busy !== null}
            className="h-9 min-w-[180px] flex-1 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white"
          />
          <Button type="button" size="sm" onClick={handleBook} disabled={!canManage || busy !== null} className="gap-1.5 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-xs font-semibold text-white">
            <Truck className="h-3.5 w-3.5" /> {busy === "book" ? "Booking…" : "Book shipment"}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-[#8c95b0]">
          Recipient comes from the sale&apos;s customer, COD from the unpaid balance (fully-paid sales book as prepaid, COD 0). The tracking number is stored on the sale.
        </p>
        <Label htmlFor="postex-tracking" className="mt-1 text-xs font-bold text-[#0a1128]">
          Track a shipment
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="postex-tracking"
            value={trackingInput}
            onChange={(e) => setTrackingInput(e.target.value)}
            placeholder="Tracking (CN) number"
            disabled={!canManage || busy !== null}
            className="h-9 min-w-[180px] flex-1 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white"
          />
          <Button type="button" size="sm" variant="outline" onClick={handleTrack} disabled={!canManage || busy !== null} className="rounded-lg text-xs font-semibold">
            {busy === "track" ? "Checking…" : "Track"}
          </Button>
        </div>
        {tracking && (
          <div className="rounded-[10px] bg-[#f0f2f7] px-3 py-2 text-[12px] leading-relaxed text-[#4a5578]">
            <span className="font-bold text-[#0a1128]">{tracking.trackingNumber}</span> · {tracking.status}
            {tracking.events.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {tracking.events.map((event, i) => (
                  <li key={i}>
                    {event.status}
                    {event.location ? ` · ${event.location}` : ""}
                    {event.timestamp ? ` · ${formatDateTime(event.timestamp)}` : ""}
                    {event.description ? ` — ${event.description}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={!canManage || busy !== null} className="rounded-lg text-xs font-semibold">
                {busy === "cancel" ? "Cancelling…" : "Cancel shipment"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleReturn} disabled={!canManage || busy !== null} className="rounded-lg text-xs font-semibold">
                {busy === "return" ? "Booking return…" : "Book return"}
              </Button>
            </div>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-[#8c95b0]">
          PostEx publishes no public API docs — the API address comes from your PostEx merchant account. Webhook updates arrive without a signature (PostEx publishes none), so confirm a status with Track before acting on it.
        </p>
      </div>
    </div>
  );
}

function IntegrationProviderCard({
  provider,
  canManage,
  onConnect,
  onSync,
  onDisconnect,
  syncing,
  logs,
  logsOpen,
  logsLoading,
  onToggleLogs,
}: {
  provider: IntegrationProviderInfo;
  canManage: boolean;
  onConnect: (provider: IntegrationProviderInfo) => void;
  onSync: (provider: IntegrationProviderInfo) => void;
  onDisconnect: (provider: IntegrationProviderInfo) => void;
  syncing: boolean;
  logs: IntegrationSyncLogRecord[];
  logsOpen: boolean;
  logsLoading: boolean;
  onToggleLogs: (provider: IntegrationProviderInfo) => void;
}) {
  const Icon = CATEGORY_ICON[provider.category] ?? Plug;
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const connected = provider.status === "connected";
  // Payment rails (JazzCash) are not syncs: money moves at checkout,
  // not on a schedule, so there is no "Sync now" for them — the card
  // says so instead of offering a button that would 501.
  const isPaymentRail = provider.category === "payments";

  return (
    <div className="flex flex-col rounded-[16px] border border-[rgba(15,23,60,0.08)] bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#1a52c5]/[0.08]">
            <Icon className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight text-[#0a1128]">{provider.displayName}</div>
            <div className="text-xs font-medium text-[#8c95b0]">
              {CATEGORY_LABEL[provider.category]}
              {provider.tier === 1 ? " · Tier 1" : " · Tier 2"}
              {provider.sandboxAvailable ? " · Sandbox available" : ""}
            </div>
          </div>
        </div>
        <StatusPill status={provider.status} connectable={provider.connectable} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {provider.capabilities.map((cap) => (
          <span key={cap} className="rounded-full bg-[#f0f2f7] px-2 py-0.5 text-[11px] font-semibold text-[#4a5578]">
            {cap}
          </span>
        ))}
      </div>

      {provider.limitation && (
        <p className="mt-3 text-[13px] leading-relaxed text-[#8c95b0]">{provider.limitation}</p>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-[#8c95b0]">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {isPaymentRail
          ? connected
            ? "Payments are recorded on sales, not synced"
            : "Connect to take payments at checkout"
          : connected
            ? `Last ${provider.id === "google-sheets" ? "exported" : "synced"} ${formatRelative(provider.lastSyncAt)}`
            : provider.id === "google-sheets"
              ? "Not exported yet"
            : "Not synced yet"}
      </div>
      {provider.id === "google-sheets" && provider.config?.spreadsheetId && (
        <a
          href={`https://docs.google.com/spreadsheets/d/${provider.config.spreadsheetId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] hover:underline"
        >
          Open spreadsheet <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {provider.status === "error" && provider.lastError && (
        <p className="mt-2 rounded-[10px] bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
          {provider.lastError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[rgba(15,23,60,0.06)] pt-4">
        {provider.connectable ? (
          <>
            {connected ? (
              <>
                {isPaymentRail ? (
                  <p className="text-[13px] leading-relaxed text-[#4a5578]">
                    Payments happen at checkout, not by sync — take JazzCash payments from a sale and they
                    land on that sale&apos;s record.
                  </p>
                ) : provider.id === "postex" ? (
                  /* PostEx has no product/stock sync — shipments are booked from
                     the Shipments panel below, so the generic Sync now button
                     would only 501. */
                  null
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onSync(provider)}
                    disabled={!canManage || syncing}
                    className="gap-1.5 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-xs font-semibold text-white"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                    {provider.id === "google-sheets"
                      ? syncing
                        ? "Exporting…"
                        : "Export now"
                      : syncing
                        ? "Syncing…"
                        : "Sync now"}
                  </Button>
                )}
                {confirmingDisconnect ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setConfirmingDisconnect(false);
                        onDisconnect(provider);
                      }}
                      disabled={!canManage}
                      className="rounded-lg text-xs font-semibold"
                    >
                      Confirm disconnect
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmingDisconnect(false)}
                      className="rounded-lg text-xs font-semibold"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmingDisconnect(true)}
                    disabled={!canManage}
                    className="gap-1.5 rounded-lg text-xs font-semibold"
                  >
                    <Unplug className="h-3.5 w-3.5" /> Disconnect
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => onConnect(provider)}
                disabled={!canManage}
                className="gap-1.5 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-xs font-semibold text-white"
              >
                <Plug className="h-3.5 w-3.5" /> Connect
              </Button>
            )}
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled className="rounded-lg text-xs font-semibold">
            Coming soon
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onToggleLogs(provider)}
          className="gap-1.5 rounded-lg text-xs font-semibold text-[#4a5578]"
        >
          <History className="h-3.5 w-3.5" /> {logsOpen ? "Hide logs" : "View logs"}
        </Button>
        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] hover:underline"
          >
            Docs <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {provider.id === "postex" && connected && <PostExShipmentPanel canManage={canManage} />}

      {logsOpen && (
        <div className="mt-4 rounded-[10px] bg-[#f0f2f7] px-4 py-3">
          {logsLoading ? (
            <p className="text-[13px] text-[#8c95b0]">Loading logs…</p>
          ) : logs.length === 0 ? (
            <p className="text-[13px] text-[#8c95b0]">No sync runs yet for this provider.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {logs.map((log) => (
                <li key={log.id} className="text-[12px] leading-relaxed text-[#4a5578]">
                  <span
                    className={cn(
                      "mr-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                      log.status === "success" && "bg-green-100 text-green-700",
                      log.status === "partial" && "bg-amber-100 text-amber-700",
                      log.status === "failed" && "bg-red-100 text-red-700"
                    )}
                  >
                    {log.status}
                  </span>
                  {log.entity} · {log.direction} · {log.recordsProcessed} ok
                  {log.recordsFailed > 0 ? ` · ${log.recordsFailed} failed` : ""} ·{" "}
                  {formatDateTime(log.startedAt)}
                  {log.errorMessage && <span className="block text-red-700">{log.errorMessage}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function IntegrationsSection({
  canManage,
  selectedCompanyId,
}: {
  canManage: boolean;
  selectedCompanyId?: string | null;
}) {
  const [providers, setProviders] = useState<IntegrationProviderInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dialogProvider, setDialogProvider] = useState<IntegrationProviderInfo | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [configDraft, setConfigDraft] = useState<IntegrationSyncConfig>({
    syncProducts: false,
    syncStock: false,
    syncOrders: false,
    syncCustomers: false,
    direction: "both",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; isActive: boolean }> | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [logsByProvider, setLogsByProvider] = useState<Record<string, IntegrationSyncLogRecord[]>>({});
  const [logsOpenId, setLogsOpenId] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [sheetBranches, setSheetBranches] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiService.getIntegrations();
      if (res.success && res.data) {
        setProviders(res.data.providers);
        setLoadError(false);
      }
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, selectedCompanyId]);

  // Google Sheets OAuth return: the callback redirects here with
  // ?integration=google-sheets&oauth=connected|error. Surface the
  // outcome once, then clean the URL so a refresh does not re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("integration") !== "google-sheets" || !params.get("oauth")) return;
    if (params.get("oauth") === "connected") {
      toast({
        title: "Google Sheets connected",
        description: "Your Google account is linked. Use Export now to send your first export.",
      });
    } else {
      toast({
        title: "Google Sheets was not connected",
        description: params.get("oauthMessage") || "Please try again.",
        variant: "destructive",
      });
    }
    window.history.replaceState({}, "", window.location.pathname);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openConnectDialog = (provider: IntegrationProviderInfo) => {
    setCredValues({});
    setConfigDraft(
      provider.config ?? {
        syncProducts: false,
        syncStock: false,
        syncOrders: false,
        syncCustomers: false,
        direction: "both",
      }
    );
    setDialogProvider(provider);
    // Sales channels map to ONE Zapeera branch (feature/integration-shopify):
    // load the branch list for the picker below. The default (first active
    // branch) applies when the merchant leaves it unset.
    if (provider.category === "sales-channel" && branches === null && !branchesLoading) {
      setBranchesLoading(true);
      apiService
        .getBranches()
        .then((res) => {
          if (res.success && res.data) {
            setBranches(res.data.branches.filter((b) => b.isActive));
          }
        })
        .catch(() => {
          // Picker simply stays on the default; the server resolves it.
        })
        .finally(() => setBranchesLoading(false));
    }
    // Google Sheets needs the branch list for its branch picker.
    if (provider.id === "google-sheets") {
      apiService
        .getBranches()
        .then((res) => {
          if (res.success && res.data) {
            setSheetBranches(
              res.data.branches
                .filter((b) => b.isActive)
                .map((b) => ({ id: b.id, name: b.name }))
            );
          }
        })
        .catch(() => {
          // Branch picker simply falls back to "All branches".
        });
    }
  };

  // Google Sheets connects via OAuth, not the generic credential save:
  // fetch the Google consent URL (with the merchant's spreadsheet +
  // branch picks) and navigate the whole page to it.
  const handleGoogleSheetsConnect = async () => {
    if (!dialogProvider) return;
    setIsSaving(true);
    try {
      const res = await apiService.startGoogleSheetsOAuth({
        spreadsheetId: configDraft.spreadsheetId?.trim() || undefined,
        branchId: configDraft.branchId || undefined,
      });
      if (res.success && res.data?.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        toast({
          title: "Could not start Google sign-in",
          description: res.message || "Please try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: "Could not start Google sign-in",
        description: e.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnectSave = async () => {
    if (!dialogProvider) return;
    // Optional credential fields (e.g. the WooCommerce webhook secret,
    // only needed once webhooks are registered) may be left empty.
    const missing = dialogProvider.credentialFields.filter(
      (f) => !f.optional && !credValues[f.key]?.trim()
    );
    if (missing.length > 0) {
      toast({
        title: "Missing credentials",
        description: `Fill in: ${missing.map((f) => f.label).join(", ")}.`,
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiService.connectIntegration(dialogProvider.id, {
        credentials: credValues,
        config: configDraft,
      });
      if (res.success) {
        toast({ title: `${dialogProvider.displayName} connected` });
        setDialogProvider(null);
        load();
      } else {
        toast({
          title: `Could not connect ${dialogProvider.displayName}`,
          description: res.message || "Please check the credentials and try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: `Could not connect ${dialogProvider.displayName}`,
        description: e.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSync = async (provider: IntegrationProviderInfo) => {
    setSyncingId(provider.id);
    try {
      // Google Sheets is export-only: "Export now" runs the generic
      // export (entity 'export'), not a per-entity sync.
      const isSheets = provider.id === "google-sheets";
      const res = await apiService.triggerIntegrationSync(
        provider.id,
        isSheets ? { entity: "export" } : {}
      );
      if (res.success && res.data) {
        toast({
          title: `${provider.displayName} ${isSheets ? "export" : "sync"} finished`,
          description:
            res.data.result.message ||
            `${res.data.result.recordsProcessed} records processed, ${res.data.result.recordsFailed} failed.`,
        });
        setLogsByProvider((prev) => ({ ...prev, [provider.id]: [res.data.log, ...(prev[provider.id] ?? [])] }));
        load();
      } else {
        toast({
          title: `${provider.displayName} ${isSheets ? "export" : "sync"} failed`,
          description: res.message || "Please try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: `${provider.displayName} sync failed`,
        description: e.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (provider: IntegrationProviderInfo) => {
    try {
      const res = await apiService.disconnectIntegration(provider.id);
      if (res.success) {
        toast({ title: `${provider.displayName} disconnected`, description: "Its stored credentials were deleted." });
        load();
      } else {
        toast({
          title: `Could not disconnect ${provider.displayName}`,
          description: res.message || "Please try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: `Could not disconnect ${provider.displayName}`,
        description: e.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleLogs = async (provider: IntegrationProviderInfo) => {
    if (logsOpenId === provider.id) {
      setLogsOpenId(null);
      return;
    }
    setLogsOpenId(provider.id);
    if (!logsByProvider[provider.id]) {
      setLogsLoading(true);
      try {
        const res = await apiService.getIntegrationLogs(provider.id, 20, 0);
        if (res.success && res.data) {
          setLogsByProvider((prev) => ({ ...prev, [provider.id]: res.data.logs }));
        }
      } catch {
        // Logs panel simply stays empty.
      } finally {
        setLogsLoading(false);
      }
    }
  };

  return (
    <section
      className="zv3-settings-block overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
      style={{ animationDelay: "220ms" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
        <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
          <Link2 className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
          Integrations
        </div>
        <div className="text-xs font-medium text-[#8c95b0]">Owner / manager only</div>
      </div>
      <div className="flex flex-col px-[30px] py-[30px]">
        <p className="text-[13px] leading-relaxed text-[#8c95b0] pb-[18px]">
          Connect your sales channels, payment wallets, couriers, accounting tools and SMS gateways so Zapeera
          can sync products, stock, orders and customers with them. Payment providers don&apos;t sync —
          once connected, their payments are taken at checkout and land on the sale&apos;s record.
          Credentials are encrypted on the server and are never shown back. Providers marked “Coming soon”
          are not built yet — their cards show the honest limitation (for example, Daraz has no webhooks,
          so it polls instead).
        </p>
        {!canManage && (
          <p className="mb-[18px] rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
            Only the owner or a manager can manage integrations.
          </p>
        )}
        {loadError && (
          <p className="mb-[18px] rounded-[10px] bg-red-50 px-4 py-3 text-[13px] text-red-700">
            Could not load integrations. Please refresh the page.
          </p>
        )}
        {providers === null && !loadError ? (
          <p className="text-[13px] text-[#8c95b0]">Loading integrations…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {(providers ?? []).map((provider) => (
              <IntegrationProviderCard
                key={provider.id}
                provider={provider}
                canManage={canManage}
                onConnect={openConnectDialog}
                onSync={handleSync}
                onDisconnect={handleDisconnect}
                syncing={syncingId === provider.id}
                logs={logsByProvider[provider.id] ?? []}
                logsOpen={logsOpenId === provider.id}
                logsLoading={logsLoading && logsOpenId === provider.id}
                onToggleLogs={handleToggleLogs}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogProvider !== null} onOpenChange={(open) => !open && setDialogProvider(null)}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Connect {dialogProvider?.displayName}</DialogTitle>
          </DialogHeader>
          {dialogProvider && (
            <div className="flex flex-col gap-4 pt-2">
              {dialogProvider.credentialFields.length === 0 ? (
                <p className="rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                  {dialogProvider.displayName} connects with OAuth — you will sign in on the provider’s own
                  page. No credentials are typed here.
                </p>
              ) : (
                dialogProvider.credentialFields.map((field) => (
                  <div key={field.key}>
                    <Label htmlFor={`int-cred-${field.key}`} className="mb-2 block text-sm font-bold text-[#0a1128]">
                      {field.label}
                      {field.optional ? " (optional)" : ""}
                    </Label>
                    <Input
                      id={`int-cred-${field.key}`}
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      value={credValues[field.key] ?? ""}
                      onChange={(e) => setCredValues({ ...credValues, [field.key]: e.target.value })}
                      placeholder={field.placeholder ?? ""}
                      className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white"
                    />
                  </div>
                ))
              )}
              {dialogProvider.category === "sales-channel" && (
                <div>
                  <Label className="mb-2 block text-sm font-bold text-[#0a1128]">Zapeera branch</Label>
                  <Select
                    value={configDraft.branchId ?? "default"}
                    onValueChange={(v) =>
                      setConfigDraft({ ...configDraft, branchId: v === "default" ? null : v })
                    }
                  >
                    <SelectTrigger className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        Default — first active branch
                      </SelectItem>
                      {(branches ?? []).map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                    One store maps to one branch — only this branch&apos;s products and stock sync to{" "}
                    {dialogProvider.displayName}, and its orders land in this branch.
                  </p>
                </div>
              )}
              {dialogProvider.id === "shopify" && (
                <div className="rounded-[10px] border border-[rgba(15,23,60,0.08)] px-4 py-3">
                  <p className="text-[13px] leading-relaxed text-[#4a5578]">
                    Prefer OAuth? Install the Zapeera app on your store instead of pasting a token — the
                    access token is issued by Shopify and stored encrypted.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!credValues.shopDomain?.trim()}
                    onClick={() => {
                      const shop = credValues.shopDomain.trim();
                      window.location.href = `${getApiBaseUrl()}/integrations/shopify/oauth/install?shop=${encodeURIComponent(shop)}`;
                    }}
                    className="mt-2 gap-1.5 rounded-lg text-xs font-semibold"
                  >
                    <Plug className="h-3.5 w-3.5" /> Connect with Shopify (OAuth)
                  </Button>
                  {!credValues.shopDomain?.trim() && (
                    <p className="mt-1.5 text-xs text-[#8c95b0]">Enter the shop domain above first.</p>
                  )}
                </div>
              )}

              {dialogProvider.id === "google-sheets" && (
                <>
                  <div>
                    <Label htmlFor="int-sheets-spreadsheet" className="mb-2 block text-sm font-bold text-[#0a1128]">
                      Spreadsheet ID (optional)
                    </Label>
                    <Input
                      id="int-sheets-spreadsheet"
                      type="text"
                      autoComplete="off"
                      value={configDraft.spreadsheetId ?? ""}
                      onChange={(e) => setConfigDraft({ ...configDraft, spreadsheetId: e.target.value })}
                      placeholder="Leave blank to create a new spreadsheet"
                      className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white"
                    />
                    <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                      The ID in the sheet&apos;s URL: docs.google.com/spreadsheets/d/
                      <span className="font-semibold text-[#4a5578]">this-part</span>/edit
                    </p>
                  </div>
                  <div>
                    <Label className="mb-2 block text-sm font-bold text-[#0a1128]">Branch</Label>
                    <Select
                      value={configDraft.branchId ?? "all"}
                      onValueChange={(v) =>
                        setConfigDraft({ ...configDraft, branchId: v === "all" ? undefined : v })
                      }
                    >
                      <SelectTrigger className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All branches</SelectItem>
                        {sheetBranches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                      Every exported row carries its branch, so “All branches” never mixes them silently.
                    </p>
                  </div>
                  <p className="rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                    Export only — Google Sheets has no webhooks, so Zapeera exports on demand instead of
                    live-syncing. Each export appends Sales, Stock, Customers and Khata rows to their own
                    tabs; previous exports are kept.
                  </p>
                </>
              )}

              {dialogProvider.category === "payments" ? (
                <p className="rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                  {dialogProvider.displayName} is a payment rail, not a sync — no products, stock,
                  orders or customers sync. Once connected, payments are taken at checkout and land on
                  the sale&apos;s record.
                </p>
              ) : dialogProvider.id === "google-sheets" ? (
                null
              ) : (
                <div>
                  <Label className="mb-2 block text-sm font-bold text-[#0a1128]">What syncs</Label>
                <div className="flex flex-col gap-3 rounded-[10px] border border-[rgba(15,23,60,0.08)] px-4 py-3">
                  {(
                    [
                      ["syncProducts", "Products"],
                      ["syncStock", "Stock levels"],
                      ["syncOrders", "Orders"],
                      ["syncCustomers", "Customers"],
                    ] as Array<["syncProducts" | "syncStock" | "syncOrders" | "syncCustomers", string]>
                  ).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-medium text-[#0a1128]">{label}</span>
                      <Switch
                        checked={configDraft[key]}
                        onCheckedChange={(checked) => setConfigDraft({ ...configDraft, [key]: checked })}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium text-[#0a1128]">Direction</span>
                    <Select
                      value={configDraft.direction}
                      onValueChange={(v) =>
                        setConfigDraft({ ...configDraft, direction: v as IntegrationSyncConfig["direction"] })
                      }
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">Both directions</SelectItem>
                        <SelectItem value="in">Into Zapeera only</SelectItem>
                        <SelectItem value="out">Out of Zapeera only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                </div>
              )}
              <p className="text-xs leading-relaxed text-[#8c95b0]">
                Credentials are encrypted on the server before they are stored, and are never shown back. The
                connection is verified against {dialogProvider.displayName} before anything is saved.
              </p>
              <div className="flex flex-wrap gap-2">
                {dialogProvider.id === "google-sheets" ? (
                  <Button
                    type="button"
                    onClick={handleGoogleSheetsConnect}
                    disabled={isSaving}
                    className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white"
                  >
                    {isSaving ? "Redirecting…" : "Connect with Google"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleConnectSave}
                    disabled={isSaving}
                    className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white"
                  >
                    {isSaving ? "Connecting…" : "Connect"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogProvider(null)}
                  className="rounded-lg text-sm font-semibold"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default IntegrationsSection;
