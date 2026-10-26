import React, { useState, useEffect, useRef, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Settings as SettingsIcon,
  User,
  Wifi,
  WifiOff,
  HardDrive,
  Monitor,
  Printer,
  Save,
  RefreshCw,
  Upload,
  Edit,
  X,
  Receipt,
  Download,
  Archive,
  History,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { apiService } from "@/services/api";
import type { ProvincialTaxConfigRecord, ProvincialTaxAuthorityInfo, ProvincialAuthority } from "@/services/api";
import { syncService, type SyncStatus } from "@/services/syncService";
import { config } from "@/lib/config";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isBarcodeApplicableBusinessType } from "@/lib/barcode-scan";
import { formatPrinterPanelValue, type OsPrinter } from "@/lib/printer-status";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";

type DeviceIcon = ComponentType<{ className?: string; strokeWidth?: string | number }>;

function ZV3DeviceStat({
  icon: Icon,
  iconClass,
  value,
  label,
}: {
  icon: DeviceIcon;
  iconClass: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl px-4 py-7 transition-colors hover:bg-[#1a52c5]/[0.02]">
      <div className={cn("grid h-12 w-12 place-items-center rounded-[14px]", iconClass)}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
      </div>
      <div className="text-center text-[15px] font-bold text-[#0a1128]">{value}</div>
      <div className="text-center text-xs font-medium text-[#8c95b0]">{label}</div>
    </div>
  );
}

const formatDateTime = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

const formatBytes = (bytes?: number | null): string | null => {
  if (bytes === null || bytes === undefined || !(bytes > 0)) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
};

const ZV3_POS_SWITCH =
  "h-6 w-11 shrink-0 border-0 shadow-none data-[state=unchecked]:bg-[#d1d5db] data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#1a52c5] data-[state=checked]:to-[#28c2ce] data-[state=checked]:shadow-[0_2px_8px_rgba(26,82,197,0.25)]";

const Settings = () => {
  const { user } = useAuth();
  const { selectedCompanyId, selectedCompany } = useAdmin();
  const isDesktopApp = typeof window !== "undefined" && typeof (window as any).electronAPI !== "undefined";
  // Device Status connection/last-sync come from the SAME syncService
  // the header badge uses — the panel previously derived "Online" from
  // navigator.onLine while the header used cloud-sync state, so the app
  // contradicted itself ("Online" here, "Offline · 3" in the header).
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => syncService.getCurrentStatus());
  const [storageInfo, setStorageInfo] = useState<{ diskTotalBytes?: number | null; diskFreeBytes?: number | null; databaseBytes?: number | null } | null>(null);
  // OS printers as enumerated by the Electron main process; null until
  // the list has loaded (and forever on web — the stat stays hidden).
  const [printerList, setPrinterList] = useState<OsPrinter[] | null>(null);
  const [isEditingBusiness, setIsEditingBusiness] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isEditingPOS, setIsEditingPOS] = useState(false);
  // FBR POS (Wave B7): fiscal config lives behind its own API (the
  // token is write-only), separate from the POS settings object.
  const [fbrConfig, setFbrConfig] = useState({ enabled: false, posId: "", environment: "TEST" as "TEST" | "SANDBOX" | "PRODUCTION", sellerName: "", sellerStrn: "", hasToken: false });
  const [fbrTokenInput, setFbrTokenInput] = useState("");
  const [fbrClearToken, setFbrClearToken] = useState(false);
  const [fbrCounts, setFbrCounts] = useState<Record<string, number> | null>(null);
  const [fbrTestResult, setFbrTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSavingFbr, setIsSavingFbr] = useState(false);
  const [isTestingFbr, setIsTestingFbr] = useState(false);
  const canManageFbr = ["OWNER", "MANAGER", "ADMIN"].includes(user?.membership?.roleName || user?.role || "");
  // Provincial tax (Gap item 1): PRA / SRB / KPRA / BRA alongside FBR.
  // Config writes are OWNER-only (the server enforces it too); the
  // list below is readable by owner/manager/admin. Unlike FBR this
  // has no external posting, so it works in the desktop app as well.
  const isProvTaxOwner = (user?.membership?.roleName || user?.role || "") === "OWNER";
  const [provTaxConfigs, setProvTaxConfigs] = useState<ProvincialTaxConfigRecord[]>([]);
  const [provTaxAuthorities, setProvTaxAuthorities] = useState<ProvincialTaxAuthorityInfo[]>([]);
  const [provTaxBranches, setProvTaxBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [provTaxForm, setProvTaxForm] = useState({ authority: "PRA" as ProvincialAuthority, registrationNumber: "", rate: "", branchId: "", enabled: true });
  const [provTaxEditingId, setProvTaxEditingId] = useState<string | null>(null);
  const [isSavingProvTax, setIsSavingProvTax] = useState(false);
  // Integrations framework: same owner/manager gate as FBR (the server
  // enforces OWNER/MANAGER on every integrations route too).
  const canManageIntegrations = ["OWNER", "MANAGER", "ADMIN"].includes(user?.membership?.roleName || user?.role || "");
  // Backup & Restore: owner-only (the server enforces it too) — a
  // backup carries the business's entire dataset.
  const isBackupOwner = ["OWNER", "ADMIN"].includes(user?.membership?.roleName || user?.role || "");
  const [isExportingBusiness, setIsExportingBusiness] = useState(false);
  const [isExportingAccount, setIsExportingAccount] = useState(false);
  const [restorePayload, setRestorePayload] = useState<any>(null);
  const [restoreFileName, setRestoreFileName] = useState("");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);
  // Restore UPDATE mode: mode → target → preview → done, in one flow.
  const [showRestoreFlow, setShowRestoreFlow] = useState(false);
  const [restoreStep, setRestoreStep] = useState<"mode" | "target" | "preview" | "done">("mode");
  const [ownedBusinesses, setOwnedBusinesses] = useState<Array<{ id: string; name: string; slug?: string | null }>>([]);
  const [targetSelections, setTargetSelections] = useState<Record<string, string>>({});
  const [updatePreview, setUpdatePreview] = useState<any>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [updateConfirmText, setUpdateConfirmText] = useState("");
  const [updateResult, setUpdateResult] = useState<any>(null);
  const [safetyBackups, setSafetyBackups] = useState<any[]>([]);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [importedSettings, setImportedSettings] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [userProfile, setUserProfile] = useState({
    name: '',
    email: '',
    username: '',
    role: '',
    branchName: ''
  });
  const [originalBusinessSettings, setOriginalBusinessSettings] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    license: "",
    taxNumber: ""
  });
  const [settings, setSettings] = useState({
    business: {
      name: "",
      address: "",
      phone: "",
      email: "",
      license: "",
      taxNumber: ""
    },
    pos: {
      autoSync: true,
      offlineMode: true,
      receiptPrinter: "",
      barcodePrinter: "",
      defaultTax: 17,
      loyaltyPointValue: 1,
      // Prescriptions (Wave C1): POS enforcement tri-state —
      // "auto" stores nothing (pharmacies enforce, others don't).
      requirePrescriptionAtPos: "auto" as "auto" | "on" | "off",
      // Barcode scanning at the POS (wedge + camera). Defaults ON;
      // the stored setting is `barcodeScanningEnabled`.
      barcodeScanning: true,
      lowStockAlert: 20,
      expiryAlert: 30
    },
    user: {
      name: userProfile.name || user?.name || "Loading...",
      email: userProfile.email || "Loading...",
      role: userProfile.role || user?.membership?.roleName || user?.role || "Loading...",
      deviceId: "",
      lastLogin: ""
    },
    security: {
      autoLogout: 30,
      requirePin: true,
      encryptData: true,
      backupEnabled: true,
      auditLog: true
    },
    notifications: {
      lowStock: true,
      expiry: true,
      sales: false,
      sync: true,
      errors: true
    }
  });

  // Device Status — every value is real or the stat is not rendered:
  // · Connection / Last Sync: the shared syncService (same source as
  //   the header badge — the app can no longer contradict itself).
  // · Storage: the real disk volume holding the app's data (Electron
  //   get-storage-info now reports statfs figures + the database file
  //   size). Hidden when no truthful figure exists (e.g. web).
  // · Printer: the real OS printer list, enumerated by the Electron
  //   main process (get-printers → webContents.getPrintersAsync). It
  //   used to be a hardcoded "Connected"; now the stat shows the
  //   default printer's name/status, or "No printer connected".
  //   Hidden until the list loads, and on web (no bridge), like Storage.
  // · Battery: REMOVED (2026-10-24) — it was a hardcoded "78%" and
  //   the app has no battery enumeration on desktop.
  const storageLabel = (() => {
    if (!storageInfo?.diskTotalBytes) return null;
    const used = storageInfo.diskTotalBytes - (storageInfo.diskFreeBytes || 0);
    const usedLabel = formatBytes(used);
    const totalLabel = formatBytes(storageInfo.diskTotalBytes);
    return usedLabel && totalLabel ? `${usedLabel} / ${totalLabel}` : null;
  })();
  const deviceStatus = {
    // Setup-pending (2026-10-24 trap): the cloud answers but no business
    // has downloaded yet — this stat must not say "Online" for that state.
    connectivity: syncStatus.syncState === "setup-pending"
      ? "Sync setup pending"
      : syncStatus.connectionState === "online"
        ? "Online"
        : syncStatus.connectionState === "auth-required"
          ? "Sign in again"
          : syncStatus.connectionState === "checking"
            ? "Checking…"
            : "Offline",
    lastSync: formatRelative(syncStatus.lastSyncAt),
    storage: storageLabel,
    printer: formatPrinterPanelValue(printerList),
    // Last account-sync failure, surfaced instead of living only in the
    // desktop console log. Truncated: stat values are single-line tiles.
    syncSetupError: syncStatus.accountSyncError
      ? (syncStatus.accountSyncError.length > 60
        ? `${syncStatus.accountSyncError.slice(0, 57)}…`
        : syncStatus.accountSyncError)
      : null,
    // Last pull's apply failures (v1.0.8, RC-1a): rows the cloud sent
    // that the local DB could not store. Same single-line truncation.
    applyFailures: syncStatus.applyFailures && syncStatus.applyFailures.total > 0
      ? (() => {
          const skipped = syncStatus.applyFailures.skipped || [];
          const label = `${syncStatus.applyFailures.total} record${syncStatus.applyFailures.total === 1 ? '' : 's'} failed to save (${Object.entries(syncStatus.applyFailures.byEntity).map(([k, v]) => `${k} ${v}`).join(', ')})${skipped.length > 0 ? `; skipped ${skipped.length} (${skipped.map((s) => `${s.entityType} ${s.entityId}`).join(', ')})` : ''}`;
          return label.length > 60 ? `${label.slice(0, 57)}…` : label;
        })()
      : null,
  };

  useEffect(() => {
    loadSettings();
    loadUserProfile();
  }, []);

  useEffect(() => {
    const unsubscribe = syncService.subscribe(setSyncStatus);
    syncService.getStatus();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isDesktopApp) return;
    (window as any).electronAPI?.getStorageInfo?.()
      .then((info: any) => { if (info) setStorageInfo(info); })
      .catch(() => { /* storage stat simply stays hidden */ });
    const api = (window as any).electronAPI;
    if (typeof api?.getPrinters === "function") {
      api.getPrinters()
        .then((list: any) => { if (Array.isArray(list)) setPrinterList(list); })
        .catch(() => setPrinterList([]));
    }
  }, [isDesktopApp]);

  const loadUserProfile = async () => {
    try {
      const response = await apiService.getProfile();
      if (response.success && response.data) {
        setUserProfile({
          name: response.data.name,
          email: response.data.email,
          username: response.data.username,
          role: response.data.role,
          branchName: response.data.branch?.name || ''
        });
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      // Fallback to auth context data
      if (user) {
        setUserProfile({
          name: user.name,
          email: 'N/A',
          username: 'N/A',
          role: user.membership?.roleName || user.role,
          branchName: ''
        });
      }
    }
  };

  // FBR POS (Wave B7) ──────────────────────────────────────────────
  const loadFbr = async () => {
    if (isDesktopApp) return; // FBR is cloud-only by design (see the section notice)
    try {
      const [cfg, status] = await Promise.all([apiService.getFbrConfig(), apiService.getFbrStatus()]);
      if (cfg.success && cfg.data) {
        setFbrConfig({
          enabled: cfg.data.enabled,
          posId: cfg.data.posId || "",
          environment: cfg.data.environment || "TEST",
          sellerName: cfg.data.sellerName || "",
          sellerStrn: cfg.data.sellerStrn || "",
          hasToken: cfg.data.hasToken,
        });
      }
      if (status.success && status.data) {
        setFbrCounts(status.data.counts as unknown as Record<string, number>);
      }
    } catch { /* section simply stays at defaults */ }
  };

  useEffect(() => { loadFbr(); }, [selectedCompanyId, isDesktopApp]);

  const handleFbrSave = async () => {
    if (isDesktopApp) return; // FBR config lives on the cloud only (see the section notice)
    setIsSavingFbr(true);
    try {
      const res = await apiService.updateFbrConfig({
        enabled: fbrConfig.enabled,
        posId: fbrConfig.posId.trim(),
        environment: fbrConfig.environment,
        sellerName: fbrConfig.sellerName.trim(),
        sellerStrn: fbrConfig.sellerStrn.trim(),
        ...(fbrTokenInput.trim() ? { apiToken: fbrTokenInput.trim() } : {}),
        ...(fbrClearToken ? { clearApiToken: true } : {}),
      });
      if (res.success) {
        toast({ title: "FBR POS settings saved", description: fbrConfig.enabled ? `Fiscal posting is ON (${fbrConfig.environment}).` : "Fiscal posting is off." });
        setFbrTokenInput("");
        setFbrClearToken(false);
        setFbrTestResult(null);
        loadFbr();
      } else {
        toast({ title: "Could not save FBR settings", description: res.message || "Please check the values and try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not save FBR settings", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsSavingFbr(false);
    }
  };

  const handleFbrTest = async () => {
    if (isDesktopApp) return;
    setIsTestingFbr(true);
    try {
      const res = await apiService.testFbrConnection();
      if (res.success && res.data) {
        setFbrTestResult({ ok: res.data.ok, message: res.data.message });
      } else {
        setFbrTestResult({ ok: false, message: res.message || "Connection test failed." });
      }
    } catch (e: any) {
      setFbrTestResult({ ok: false, message: e.message || "Connection test failed." });
    } finally {
      setIsTestingFbr(false);
    }
  };

  // Provincial tax (Gap item 1) ──────────────────────────────────────
  const loadProvTax = async () => {
    try {
      const [cfgRes, brRes] = await Promise.all([apiService.getProvincialTaxConfigs(), apiService.getBranches()]);
      if (cfgRes.success && cfgRes.data) {
        setProvTaxConfigs(cfgRes.data);
        if (cfgRes.authorities) setProvTaxAuthorities(cfgRes.authorities);
      }
      if (brRes.success && brRes.data) setProvTaxBranches(brRes.data.branches || []);
    } catch { /* section simply stays at defaults */ }
  };

  useEffect(() => { loadProvTax(); }, [selectedCompanyId]);

  const handleProvTaxSave = async () => {
    if (!isProvTaxOwner) return;
    const rate = parseFloat(provTaxForm.rate);
    if (!provTaxForm.authority || Number.isNaN(rate) || rate < 0 || rate > 100) {
      toast({ title: "Check the provincial tax values", description: "Pick an authority and a rate between 0 and 100%.", variant: "destructive" });
      return;
    }
    setIsSavingProvTax(true);
    try {
      const payload = {
        authority: provTaxForm.authority,
        registrationNumber: provTaxForm.registrationNumber.trim() || null,
        rate,
        branchId: provTaxForm.branchId || null,
        enabled: provTaxForm.enabled,
      };
      const res = provTaxEditingId
        ? await apiService.updateProvincialTaxConfig(provTaxEditingId, payload)
        : await apiService.createProvincialTaxConfig(payload);
      if (res.success) {
        toast({ title: "Provincial tax saved", description: provTaxEditingId ? "Configuration updated — future sales use the new rate." : "Provincial tax is now charged on new sales, alongside FBR." });
        setProvTaxForm({ authority: "PRA", registrationNumber: "", rate: "", branchId: "", enabled: true });
        setProvTaxEditingId(null);
        loadProvTax();
      } else {
        toast({ title: "Could not save provincial tax", description: res.message || "Please check the values and try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not save provincial tax", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsSavingProvTax(false);
    }
  };

  const handleProvTaxEdit = (cfg: ProvincialTaxConfigRecord) => {
    setProvTaxEditingId(cfg.id);
    setProvTaxForm({
      authority: cfg.authority,
      registrationNumber: cfg.registrationNumber || "",
      rate: String(cfg.rate),
      branchId: cfg.branchId || "",
      enabled: cfg.enabled,
    });
  };

  const handleProvTaxRetire = async (cfg: ProvincialTaxConfigRecord) => {
    if (!isProvTaxOwner) return;
    try {
      const res = await apiService.deleteProvincialTaxConfig(cfg.id);
      if (res.success) {
        toast({ title: "Provincial tax retired", description: `${cfg.authorityName} will no longer be charged on new sales. Past invoices keep their provincial lines.` });
        loadProvTax();
      } else {
        toast({ title: "Could not retire provincial tax", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not retire provincial tax", description: e.message || "Please try again.", variant: "destructive" });
    }
  };

  const handleExportBusinessBackup = async () => {
    setIsExportingBusiness(true);
    try {
      await apiService.downloadBusinessBackup();
      toast({ title: "Backup downloaded", description: "Keep this file somewhere safe — it contains your complete business data." });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsExportingBusiness(false);
    }
  };

  const handleExportAccountBackup = async () => {
    setIsExportingAccount(true);
    try {
      await apiService.downloadAccountBackup();
      toast({ title: "Account backup downloaded", description: "One file with every business you own." });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsExportingAccount(false);
    }
  };

  const handleRestoreFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.format !== "zapeera-backup") {
        toast({ title: "Not a Zapeera backup", description: "That file was not exported from Zapeera.", variant: "destructive" });
        return;
      }
      setRestorePayload(parsed);
      setRestoreFileName(file.name);
      setRestoreResult(null);
      setUpdateResult(null);
      setUpdatePreview(null);
      setTargetSelections({});
      setUpdateConfirmText("");
      setRestoreStep("mode");
      setShowRestoreFlow(true);
    } catch {
      toast({ title: "Could not read that file", description: "The file is not valid JSON.", variant: "destructive" });
    }
  };

  // Businesses inside the loaded backup file (source list).
  const restoreSources: Array<{ id: string; name: string; slug?: string | null }> = (() => {
    if (!restorePayload) return [];
    if (Array.isArray(restorePayload.businesses)) {
      return restorePayload.businesses
        .map((b: any) => ({ id: b?.business?.id, name: b?.business?.name || "", slug: b?.business?.slug ?? null }))
        .filter((s: any) => s.id);
    }
    if (restorePayload.business?.id) {
      return [{
        id: restorePayload.business.id,
        name: restorePayload.business.name || restorePayload.exportedFrom?.businessName || "",
        slug: restorePayload.business.slug ?? null,
      }];
    }
    return [];
  })();
  const isAccountBackupFile = restoreSources.length > 1;

  const loadSafetyBackups = async () => {
    if (!isBackupOwner || !selectedCompanyId) return;
    try {
      const res = await apiService.listSafetyBackups(selectedCompanyId);
      if (res.success && res.data) setSafetyBackups(res.data.snapshots || []);
    } catch { /* safety list is informational; never block the page */ }
  };

  useEffect(() => { loadSafetyBackups(); }, [selectedCompanyId, isBackupOwner]);

  const openUpdateTargets = async () => {
    setRestoreStep("target");
    try {
      const res = await apiService.getCompanies();
      const list = (res.data || []).filter((c: any) => !c.accessType || c.accessType === "owned");
      setOwnedBusinesses(list);
      const defaults: Record<string, string> = {};
      for (const s of restoreSources) {
        const match =
          list.find((c: any) => c.id === s.id) ||
          list.find((c: any) => s.slug && c.slug === s.slug) ||
          list.find((c: any) => c.name === s.name);
        if (match) defaults[s.id] = match.id;
      }
      setTargetSelections(defaults);
    } catch (e: any) {
      toast({ title: "Could not load your businesses", description: e.message || "Please try again.", variant: "destructive" });
    }
  };

  const allTargetsChosen = restoreSources.length > 0
    && restoreSources.every((s) => targetSelections[s.id])
    && new Set(Object.values(targetSelections)).size === restoreSources.length;

  const handlePreviewUpdate = async () => {
    if (!restorePayload || !allTargetsChosen) return;
    setIsPreviewing(true);
    try {
      const res = await apiService.previewRestoreUpdate(restorePayload, targetSelections);
      if (res.success && res.data) {
        setUpdatePreview(res.data);
        setUpdateConfirmText("");
        setRestoreStep("preview");
      } else {
        toast({ title: "Preview failed", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsPreviewing(false);
    }
  };

  const expectedConfirmText = (() => {
    if (isAccountBackupFile) return "UPDATE";
    const preview = updatePreview?.previews?.[0];
    return preview?.targetBusinessName || "";
  })();
  const updateConfirmValid = expectedConfirmText.length > 0
    && updateConfirmText.trim() === expectedConfirmText;

  const handleConfirmUpdate = async () => {
    if (!restorePayload || !updateConfirmValid) return;
    setIsRestoring(true);
    try {
      const res = await apiService.restoreBackupUpdate(restorePayload, targetSelections);
      if (res.success && res.data) {
        setUpdateResult(res.data);
        setRestoreStep("done");
        loadSafetyBackups();
        toast({ title: "Update complete", description: res.message || "Your business was updated from the backup." });
      } else {
        toast({ title: "Update failed", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDownloadSafetyBackup = async (id: string) => {
    try {
      await apiService.downloadSafetyBackup(id);
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message || "Please try again.", variant: "destructive" });
    }
  };

  const handleConfirmRestore = async () => {
    if (!restorePayload) return;
    setIsRestoring(true);
    try {
      const res = await apiService.restoreBackup(restorePayload);
      if (res.success && res.data) {
        setRestoreResult(res.data);
        setShowRestoreConfirm(false);
        setRestorePayload(null);
        toast({ title: "Restore complete", description: res.message || "Your business was restored as a new business." });
      } else {
        toast({ title: "Restore failed", description: res.message || "Please try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Restore failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const handlePOSEdit = () => {
    setIsEditingPOS(true);
  };

  // The settings endpoint requires the CSRF double-submit header on
  // writes — mirror apiService.getCSRFToken (the raw fetches in this
  // page bypass apiService, so they must attach it themselves,
  // otherwise every save is rejected with 403 CSRF_TOKEN_REQUIRED).
  const csrfHeader = (): Record<string, string> => {
    try {
      for (const cookie of document.cookie.split(';')) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrf-token' || name === 'XSRF-TOKEN') {
          return { 'X-CSRF-Token': decodeURIComponent(value) };
        }
      }
    } catch { /* ignore */ }
    return {};
  };

  const handlePOSSave = async () => {
    try {
      // Persist through the same full-payload PUT the page-level
      // Save Changes uses (the settings endpoint validates the
      // complete object — a POS-only body is rejected).
      const posHeaders: any = {
        'Content-Type': 'application/json',
        ...csrfHeader(),
      };
      if (selectedCompanyId) posHeaders['X-Business-ID'] = selectedCompanyId;
      const posResponse = await fetch(`${config.api.baseUrl}/settings`, {
        method: 'PUT',
        headers: posHeaders,
        credentials: 'include',
        body: JSON.stringify({
          defaultTax: settings.pos.defaultTax,
          loyaltyPointValue: settings.pos.loyaltyPointValue,
          requirePrescriptionAtPos: settings.pos.requirePrescriptionAtPos === "on"
            ? true
            : settings.pos.requirePrescriptionAtPos === "off"
              ? false
              : null,
          barcodeScanningEnabled: settings.pos.barcodeScanning,
          lowStockAlert: settings.pos.lowStockAlert,
          expiryAlert: settings.pos.expiryAlert,
          autoSync: settings.pos.autoSync,
          offlineMode: settings.pos.offlineMode,
          receiptPrinter: settings.pos.receiptPrinter,
          businessName: settings.business.name,
          businessAddress: settings.business.address,
          businessPhone: settings.business.phone,
          businessEmail: settings.business.email,
          businessLicense: settings.business.license,
          businessTaxNumber: settings.business.taxNumber
        }),
      });
      if (!posResponse.ok) {
        throw new Error(`Settings save failed (${posResponse.status})`);
      }

      // Also save to a global variable for easy access in POS
      (window as any).globalPOSSettings = settings.pos;

      // Dispatch a custom event to notify other components about settings change
      window.dispatchEvent(new CustomEvent('posSettingsUpdated', {
        detail: settings.pos
      }));

      setIsEditingPOS(false);
      console.log('POS settings saved:', settings.pos);

      // Show success message
      toast({
        title: "Settings Saved",
        description: `POS settings saved successfully! Tax rate set to ${settings.pos.defaultTax}%`,
        variant: "success",
      });
    } catch (error) {
      console.error('Error saving POS settings:', error);
      toast({
        title: "Error",
        description: "Error saving settings. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePOSCancel = () => {
    setIsEditingPOS(false);
    // Reload settings from localStorage or reset to default
    loadSettings();
  };

  const handleSettingChange = (section: string, key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [key]: value
      }
    }));
  };

  const loadSettings = async () => {
    try {
      // Settings caching disabled - load directly from backend
      const settingsHeaders: any = {};
      if (selectedCompanyId) settingsHeaders['X-Business-ID'] = selectedCompanyId;

      const settingsResponse = await fetch(`${config.api.baseUrl}/settings`, {
        headers: settingsHeaders,
        credentials: 'include',
      });

      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();
        if (settingsData.success && settingsData.data) {
          setSettings(prev => ({
            ...prev,
            pos: {
              ...prev.pos,
              defaultTax: parseFloat(settingsData.data.defaultTax) || 17,
              loyaltyPointValue: parseFloat(settingsData.data.loyaltyPointValue) || 1,
              requirePrescriptionAtPos: (settingsData.data.requirePrescriptionAtPos === 'true' || settingsData.data.requirePrescriptionAtPos === true)
                ? "on"
                : (settingsData.data.requirePrescriptionAtPos === 'false' || settingsData.data.requirePrescriptionAtPos === false)
                  ? "off"
                  : "auto",
              barcodeScanning: !(settingsData.data.barcodeScanningEnabled === 'false' || settingsData.data.barcodeScanningEnabled === false),
              autoSync: settingsData.data.autoSync === 'true',
              offlineMode: settingsData.data.offlineMode === 'true',
              receiptPrinter: settingsData.data.receiptPrinter || ''
            },
            business: {
              ...prev.business,
              name: settingsData.data.businessName || '',
              address: settingsData.data.businessAddress || '',
              phone: settingsData.data.businessPhone || '',
              email: settingsData.data.businessEmail || '',
              license: settingsData.data.businessLicense || '',
              taxNumber: settingsData.data.businessTaxNumber || ''
            }
          }));
        }
      }

      // Load user profile
      const profileHeaders: any = {};
      if (selectedCompanyId) profileHeaders['X-Business-ID'] = selectedCompanyId;

      const userResponse = await fetch(`${config.api.baseUrl}/auth/profile`, {
        headers: profileHeaders,
        credentials: 'include',
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        if (userData.success && userData.data) {
          setSettings(prev => ({
            ...prev,
            user: {
              ...prev.user,
              name: userData.data.name || prev.user.name,
              email: userData.data.email || prev.user.email,
              role: userData.data.membership?.roleName || userData.data.role || prev.user.role,
              deviceId: userData.data.deviceId || prev.user.deviceId,
              lastLogin: formatDateTime(userData.data.lastLogin) || prev.user.lastLogin
            }
          }));
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSyncNow = async () => {
    // A real sync attempt (desktop: push/pull via the sync service),
    // then refresh what this page shows. Previously this button ONLY
    // reloaded settings/profile while claiming "Synced".
    let syncNote = "Settings and profile have been refreshed.";
    try {
      const result = await syncService.triggerSync();
      const status = await syncService.getStatus();
      setSyncStatus(status);
      syncNote = result.success
        ? "Sync completed. Settings and profile have been refreshed."
        : "Sync could not complete — you may be offline or need to sign in again. Your data is safe and will sync later.";
    } catch { /* keep the refresh note */ }
    await Promise.all([loadSettings(), loadUserProfile()]);
    toast({
      title: "Sync",
      description: syncNote,
    });
  };

  const handleSaveSettings = async () => {
    try {
      const saveHeaders: any = {
        'Content-Type': 'application/json',
        ...csrfHeader(),
      };
      if (selectedCompanyId) saveHeaders['X-Business-ID'] = selectedCompanyId;

      const response = await fetch(`${config.api.baseUrl}/settings`, {
        method: 'PUT',
        headers: saveHeaders,
        credentials: 'include',
        body: JSON.stringify({
          defaultTax: settings.pos.defaultTax,
          loyaltyPointValue: settings.pos.loyaltyPointValue,
          // Prescriptions (Wave C1): true = always require, false =
          // never require, null = clear the override (Automatic).
          requirePrescriptionAtPos: settings.pos.requirePrescriptionAtPos === "on"
            ? true
            : settings.pos.requirePrescriptionAtPos === "off"
              ? false
              : null,
          barcodeScanningEnabled: settings.pos.barcodeScanning,
          lowStockAlert: settings.pos.lowStockAlert,
          expiryAlert: settings.pos.expiryAlert,
          autoSync: settings.pos.autoSync,
          offlineMode: settings.pos.offlineMode,
          receiptPrinter: settings.pos.receiptPrinter,
          businessName: settings.business.name,
          businessAddress: settings.business.address,
          businessPhone: settings.business.phone,
          businessEmail: settings.business.email,
          businessLicense: settings.business.license,
          businessTaxNumber: settings.business.taxNumber
        })
      });

      if (response.ok) {
        toast({
          title: "Settings Saved",
          description: "Settings saved successfully!",
          variant: "success",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: `Failed to save settings: ${error.message}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: "Error",
        description: "Error saving settings. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleExportData = async () => {
    try {
      // Create comprehensive data export
      const exportData = {
        settings: settings,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        business: settings.business
      };

      // Convert to JSON
      const jsonString = JSON.stringify(exportData, null, 2);

      // Create and download file
      const blob = new Blob([jsonString], { type: 'application/json' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `business_backup_${new Date().toISOString().split('T')[0]}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Successful",
        description: "Data exported successfully!",
        variant: "success",
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleImportData = () => {
    // Create file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importedData = JSON.parse(text);

        // Validate imported data
        if (importedData.settings && importedData.business) {
          // Show confirmation modal
          setImportedSettings(importedData);
          setShowImportConfirm(true);
        } else {
          toast({
            title: "Invalid File",
            description: "Invalid backup file format.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Import error:', error);
        toast({
          title: "Import Failed",
          description: "Failed to import data. Please check the file format.",
          variant: "destructive",
        });
      }
    };

    input.click();
  };

  const handleConfirmImport = () => {
    if (importedSettings) {
      setSettings(importedSettings.settings);
      toast({
        title: "Import Successful",
        description: "Data imported successfully!",
        variant: "success",
      });
      setImportedSettings(null);
    }
    setShowImportConfirm(false);
  };

  const handleFactoryReset = () => {
    setShowFactoryResetConfirm(true);
  };

  const handleConfirmFactoryReset = () => {
    // Reset to default settings
    setSettings({
      business: {
        name: "",
        address: "",
        phone: "",
        email: "",
        license: "",
        taxNumber: ""
      },
      pos: {
        autoSync: true,
        offlineMode: true,
        receiptPrinter: "",
        barcodePrinter: "",
        defaultTax: 17,
        loyaltyPointValue: 1,
        requirePrescriptionAtPos: "auto" as "auto" | "on" | "off",
        barcodeScanning: true,
        lowStockAlert: 20,
        expiryAlert: 30
      },
      user: {
        name: userProfile.name || user?.name || "Loading...",
        email: userProfile.email || "Loading...",
        role: userProfile.role || user?.membership?.roleName || user?.role || "Loading...",
        deviceId: "",
        lastLogin: ""
      },
      security: {
        autoLogout: 30,
        requirePin: true,
        encryptData: true,
        backupEnabled: true,
        auditLog: true
      },
      notifications: {
            lowStock: true,
            expiry: true,
            sales: false,
            sync: true,
            errors: true
          }
        });

toast({
          title: "Settings Reset",
          description: "Settings have been reset to default values.",
          variant: "success",
        });
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: "Required fields missing",
        description: "Please fill in all password fields.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match. Please try again.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }

    try {
      const pwdHeaders: any = {
        'Content-Type': 'application/json',
      };
      if (selectedCompanyId) pwdHeaders['X-Business-ID'] = selectedCompanyId;

      const response = await fetch(`${config.api.baseUrl}/auth/change-password`, {
        method: 'POST',
        headers: pwdHeaders,
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      if (response.ok) {
        toast({
          title: "✅ Success",
          description: "Password changed successfully!",
          variant: "success",
          duration: 4000,
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setIsChangingPassword(false);
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: `Failed to change password: ${error.message}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error changing password:', error);
      toast({
        title: "Error",
        description: "Error changing password. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateProfile = async () => {
    try {
      const upHeaders: any = {
        'Content-Type': 'application/json',
      };
      if (selectedCompanyId) upHeaders['X-Business-ID'] = selectedCompanyId;

      const response = await fetch(`${config.api.baseUrl}/auth/update-profile`, {
        method: 'PUT',
        headers: upHeaders,
        credentials: 'include',
        body: JSON.stringify({
          name: settings.user.name,
          email: settings.user.email,
          profileImage: user?.profileImage
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // User data caching disabled

          toast({
            title: "✅ Success",
            description: "Profile updated successfully!",
            variant: "success",
            duration: 2000,
          });
          setIsEditingProfile(false);

          // Safe to reload — auth is handled by httpOnly cookies
          setTimeout(() => window.location.reload(), 1500);
        }
      } else {
        const error = await response.json();
        toast({
          title: "Update Failed",
          description: error.message || "Failed to update profile.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Error",
        description: "Error updating profile. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateProfilePicture = () => {
    // Create file input element for image selection
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid File",
          description: "Please select a valid image file.",
          variant: "destructive",
        });
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Image size must be less than 5MB.",
          variant: "destructive",
        });
        return;
      }

      try {
        // Convert file to base64
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
          const base64String = reader.result as string;

          // Update profile with image
          const picHeaders: any = {
            'Content-Type': 'application/json',
          };
          if (selectedCompanyId) picHeaders['X-Business-ID'] = selectedCompanyId;

          const response = await fetch(`${config.api.baseUrl}/auth/update-profile`, {
            method: 'PUT',
            headers: picHeaders,
            credentials: 'include',
            body: JSON.stringify({
              profileImage: base64String
            })
          });

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              // User data caching disabled

              // Safe to reload — auth is handled by httpOnly cookies
              // v1.0.8 (RC-3): the picture is saved locally first; if the
              // cloud push did not confirm, say so — the sync engine
              // retries it on its next tick.
              toast({
                title: "✅ Success",
                description: result.cloudSynced === false ? "Profile picture updated on this device — cloud sync will retry automatically." : "Profile picture updated successfully!",
                variant: "success",
                duration: 2000,
              });
              setTimeout(() => window.location.reload(), 1500);
            } else {
              toast({
                title: "Update Failed",
                description: "Failed to update profile picture.",
                variant: "destructive",
              });
            }
          } else {
            toast({
              title: "Update Failed",
              description: "Failed to update profile picture.",
              variant: "destructive",
            });
          }
        };
      } catch (error) {
        console.error('Profile picture update error:', error);
        toast({
          title: "Error",
          description: "Failed to update profile picture. Please try again.",
          variant: "destructive",
        });
      }
    };

    input.click();
  };

  // All dashboard users see the same settings
  return (
    <>
      <div className="min-h-full bg-[#f0f2f7]">
      <div className="px-11 pb-14 pt-9">
        {/* Page header — zapeera-settings.html */}
        <div className="zv3-settings-block mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Settings</h1>
            <p className="text-sm text-[#8c95b0]">Manage your business POS configuration</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleSyncNow}
              className="h-11 gap-2 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-[22px] text-sm font-semibold text-[#4a5578] shadow-none transition-all hover:border-black/10 hover:bg-white hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            >
              <RefreshCw className="h-[17px] w-[17px]" strokeWidth={2} />
              Sync Now
            </Button>
            <Button
              type="button"
              onClick={handleSaveSettings}
              data-shortcut-save
              title="Save (Ctrl+S)"
              className="h-11 gap-2 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(26,82,197,0.35)]"
            >
              <Save className="h-[17px] w-[17px]" strokeWidth={2} />
              Save Changes
            </Button>
          </div>
        </div>

        {/* Device Status */}
        <section
          className="zv3-settings-block mb-[22px] overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "0ms" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <Monitor className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              Device Status
            </div>
          </div>
          <div className="grid grid-cols-2 gap-0 p-2 sm:grid-cols-3">
            <ZV3DeviceStat
              icon={syncStatus.connectionState === "online" ? Wifi : WifiOff}
              iconClass={
                syncStatus.syncState === "setup-pending"
                  ? "bg-amber-500/10 text-amber-600"
                  : syncStatus.connectionState === "online"
                    ? "bg-green-600/10 text-green-600"
                    : "bg-amber-500/10 text-amber-600"
              }
              value={deviceStatus.connectivity}
              label="Connection"
            />
            {deviceStatus.syncSetupError && (
              <ZV3DeviceStat
                icon={AlertTriangle}
                iconClass="bg-amber-500/10 text-amber-600"
                value={deviceStatus.syncSetupError}
                label="Sync setup"
              />
            )}
            {deviceStatus.applyFailures && (
              <ZV3DeviceStat
                icon={AlertTriangle}
                iconClass="bg-red-500/10 text-red-600"
                value={deviceStatus.applyFailures}
                label="Sync errors"
              />
            )}
            <ZV3DeviceStat
              icon={RefreshCw}
              iconClass="bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]"
              value={deviceStatus.lastSync}
              label="Last Sync"
            />
            {deviceStatus.storage && (
              <ZV3DeviceStat
                icon={HardDrive}
                iconClass="bg-indigo-500/10 text-indigo-600"
                value={deviceStatus.storage}
                label="Storage (this device)"
              />
            )}
            {deviceStatus.printer && (
              <ZV3DeviceStat
                icon={Printer}
                iconClass={
                  printerList && printerList.length > 0
                    ? "bg-green-600/10 text-green-600"
                    : "bg-amber-500/10 text-amber-600"
                }
                value={deviceStatus.printer}
                label="Printer"
              />
            )}
          </div>
        </section>

        {/* User Profile */}
        <section
          className="zv3-settings-block mb-[22px] overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <User className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              User Profile
            </div>
            <button
              type="button"
              onClick={() => setIsEditingProfile(!isEditingProfile)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent px-4 py-1.5 text-[13px] font-semibold text-[#4a5578] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
            >
              <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
              {isEditingProfile ? "Cancel" : "Edit"}
            </button>
          </div>
          <div className="px-[30px] py-[30px]">
            <div className="mb-6 flex flex-wrap items-center gap-5">
              <div className="relative shrink-0">
                <div className="relative h-16 w-16 overflow-hidden rounded-[18px] shadow-[0_4px_16px_rgba(26,82,197,0.25)]">
                  {user?.profileImage ? (
                    <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-2xl font-extrabold text-white">
                      {(settings.user.name?.charAt(0) || "?").toUpperCase()}
                    </div>
                  )}
                </div>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-[3px] border-white bg-green-600"
                  aria-hidden
                />
                <Button
                  size="icon"
                  className="absolute -right-1 -top-1 h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] p-0 text-white shadow-md hover:opacity-95"
                  onClick={handleUpdateProfilePicture}
                  title="Change profile photo"
                >
                  <Upload className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2.5">
                  <span className="text-lg font-bold text-[#0a1128]">{settings.user.name}</span>
                  <span className="inline-flex rounded-md border border-[rgba(26,82,197,0.1)] bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#1a52c5]">
                    {settings.user.role}
                  </span>
                </div>
                {settings.user.deviceId ? (
                  <p className="text-[13px] text-[#8c95b0]">Device: {settings.user.deviceId}</p>
                ) : null}
              </div>
            </div>

            {isEditingProfile && (
              <div className="mb-6 space-y-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f0f2f7]/60 p-5">
                <div className="space-y-2">
                  <Label htmlFor="user-name" className="text-sm font-semibold text-[#0a1128]">
                    Full Name
                  </Label>
                  <Input
                    id="user-name"
                    value={settings.user.name}
                    onChange={(e) => handleSettingChange("user", "name", e.target.value)}
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-[#0a1128] transition-all focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-email" className="text-sm font-semibold text-[#0a1128]">
                    Email
                  </Label>
                  <Input
                    id="user-email"
                    type="email"
                    value={settings.user.email || ""}
                    onChange={(e) => handleSettingChange("user", "email", e.target.value)}
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-[#0a1128] transition-all focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleUpdateProfile}
                    className="flex-1 gap-2 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px hover:opacity-95"
                  >
                    <Save className="h-4 w-4" />
                    Save Changes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditingProfile(false)}
                    className="gap-2 rounded-[10px] border-[rgba(15,23,60,0.06)]"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-10 border-t border-[rgba(15,23,60,0.06)] pt-5">
              {settings.user.lastLogin ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Last Login</div>
                  <div className="text-sm font-semibold text-[#0a1128]">{settings.user.lastLogin}</div>
                </div>
              ) : null}
              {userProfile.branchName ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Branch</div>
                  <div className="text-sm font-semibold text-[#0a1128]">{userProfile.branchName}</div>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col gap-4 border-t border-[rgba(15,23,60,0.06)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Change Password</h4>
                <p className="text-[13px] text-[#8c95b0]">Update your account password</p>
              </div>
              <button
                type="button"
                onClick={() => setIsChangingPassword(!isChangingPassword)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-5 py-2 text-[13px] font-semibold text-[#4a5578] transition-all hover:border-black/10 hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
              >
                {isChangingPassword ? "Cancel" : "Change"}
              </button>
            </div>

            {isChangingPassword && (
              <div className="mt-5 space-y-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f0f2f7]/60 p-5">
                <div className="space-y-2">
                  <Label htmlFor="current-password" className="text-sm font-semibold text-[#0a1128]">
                    Current Password
                  </Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-sm font-semibold text-[#0a1128]">
                    New Password
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm font-semibold text-[#0a1128]">
                    Confirm New Password
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="h-11 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleChangePassword}
                  className="w-full gap-2 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                >
                  <Save className="h-4 w-4" />
                  Update Password
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* POS Configuration */}
        <section
          className="zv3-settings-block overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "160ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <SettingsIcon className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              POS Configuration
            </div>
            <div className="flex flex-wrap gap-2">
              {!isEditingPOS ? (
                <button
                  type="button"
                  onClick={handlePOSEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent px-4 py-1.5 text-[13px] font-semibold text-[#4a5578] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                >
                  <Edit className="h-[15px] w-[15px]" strokeWidth={2} />
                  Edit
                </button>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={handlePOSSave}
                    className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button type="button" onClick={handlePOSCancel} variant="outline" className="rounded-lg border-[rgba(15,23,60,0.06)]">
                    <X className="mr-1 h-4 w-4" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col px-[30px] py-[30px]">
            <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px] first:pt-0">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Auto Sync</h4>
                <p className="text-[13px] text-[#8c95b0]">Automatically sync when online</p>
              </div>
              <Switch
                id="auto-sync"
                className={ZV3_POS_SWITCH}
                checked={settings.pos.autoSync}
                onCheckedChange={(checked) => handleSettingChange("pos", "autoSync", checked)}
                disabled={!isEditingPOS}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Offline Mode</h4>
                <p className="text-[13px] text-[#8c95b0]">Allow operations without internet</p>
              </div>
              <Switch
                id="offline-mode"
                className={ZV3_POS_SWITCH}
                checked={settings.pos.offlineMode}
                onCheckedChange={(checked) => handleSettingChange("pos", "offlineMode", checked)}
                disabled={!isEditingPOS}
              />
            </div>
            {isBarcodeApplicableBusinessType((selectedCompany as any)?.businessType) && (
              <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px]">
                <div>
                  <h4 className="text-sm font-bold text-[#0a1128]">Barcode Scanning</h4>
                  <p className="text-[13px] text-[#8c95b0]">
                    USB/Bluetooth scanner and camera scanning at the POS — scanned products are added to the sale automatically
                  </p>
                </div>
                <Switch
                  id="barcode-scanning"
                  className={ZV3_POS_SWITCH}
                  checked={settings.pos.barcodeScanning}
                  onCheckedChange={(checked) => handleSettingChange("pos", "barcodeScanning", checked)}
                  disabled={!isEditingPOS}
                />
              </div>
            )}
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px] last:border-b-0">
              <Label htmlFor="receipt-printer" className="mb-2 block text-sm font-bold text-[#0a1128]">
                Receipt Printer
              </Label>
              <Input
                id="receipt-printer"
                value={settings.pos.receiptPrinter}
                onChange={(e) => handleSettingChange("pos", "receiptPrinter", e.target.value)}
                disabled={!isEditingPOS}
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
            </div>
            <div className="py-[18px]">
              <Label htmlFor="default-tax" className="mb-2 block text-sm font-bold text-[#0a1128]">
                Default Tax (%) — fallback rate
              </Label>
              <Input
                id="default-tax"
                type="number"
                value={settings.pos.defaultTax || ""}
                onChange={(e) => handleSettingChange("pos", "defaultTax", parseFloat(e.target.value) || 0)}
                disabled={!isEditingPOS}
                placeholder="Enter tax percentage (e.g., 17 for 17%)"
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                The fallback tax rate for products without a tax class. Products assigned a tax class
                (Sales → Tax Classes) use their class rate instead; a product with no class uses the
                default class when one is set, otherwise this rate. Set to 0 for no tax.
              </p>
            </div>
            <div className="border-t border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="loyalty-point-value" className="mb-2 block text-sm font-bold text-[#0a1128]">
                Loyalty Point Value (PKR)
              </Label>
              <Input
                id="loyalty-point-value"
                type="number"
                min="0"
                step="0.01"
                value={settings.pos.loyaltyPointValue || ""}
                onChange={(e) => handleSettingChange("pos", "loyaltyPointValue", parseFloat(e.target.value) || 0)}
                disabled={!isEditingPOS}
                placeholder="PKR value of one loyalty point (e.g., 1)"
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                What one loyalty point is worth when a customer redeems points at the POS. Customers earn 1 point per PKR 100 spent.
              </p>
            </div>
            <div className="border-t border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="require-prescription-pos" className="mb-2 block text-sm font-bold text-[#0a1128]">
                Prescription Required at POS
              </Label>
              <Select
                value={settings.pos.requirePrescriptionAtPos}
                onValueChange={(value) => handleSettingChange("pos", "requirePrescriptionAtPos", value)}
                disabled={!isEditingPOS}
              >
                <SelectTrigger id="require-prescription-pos" className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic (recommended)</SelectItem>
                  <SelectItem value="on">Always require a prescription</SelectItem>
                  <SelectItem value="off">Never require</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                When a cart contains prescription-only medicines, must a prescription from the register be attached before the sale can complete?
                Automatic: required for pharmacy businesses, off for other business types. When it is off, Rx items can be sold without a
                record — the cashier sees a warning instead.
              </p>
            </div>
          </div>
        </section>

        {/* FBR POS (Wave B7) */}
        <section
          className="zv3-settings-block overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "200ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <Receipt className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              FBR POS — Fiscal Invoicing
            </div>
            {fbrCounts && (
              <div className="text-xs font-medium text-[#8c95b0]">
                Queue: {fbrCounts.PENDING || 0} pending · {fbrCounts.SENT || 0} sent · {fbrCounts.TEST || 0} test · {fbrCounts.FAILED || 0} failed
              </div>
            )}
          </div>
          <div className="flex flex-col px-[30px] py-[30px]">
            <p className="text-[13px] leading-relaxed text-[#8c95b0] pb-[18px]">
              When enabled, every sale is posted to FBR's POS invoicing system and the receipt carries the
              FBR invoice number and its QR code. Posting happens in the background — if FBR is unreachable,
              sales continue and invoices sync later. Use TEST mode to see the full flow with simulated
              invoice numbers before you have real FBR credentials.
            </p>
            {isDesktopApp && (
              <p className="mb-[18px] rounded-[10px] bg-amber-500/[0.08] px-4 py-3 text-[13px] leading-relaxed text-amber-700">
                <strong>FBR is managed on the Zapeera cloud.</strong> Your FBR API token
                never leaves the server, so these settings can't be viewed or changed
                in the desktop app — the controls below are disabled here. To change
                FBR settings, sign in to Zapeera on the web. Sales you make here still
                post to FBR through the cloud.
              </p>
            )}
            {!canManageFbr && (
              <p className="mb-[18px] rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                Only the owner or a manager can change FBR settings.
              </p>
            )}
            <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px] first:pt-0">
              <div>
                <h4 className="text-sm font-bold text-[#0a1128]">Enable FBR POS</h4>
                <p className="text-[13px] text-[#8c95b0]">Post every new sale to FBR and print the fiscal number + QR on receipts</p>
              </div>
              <Switch
                id="fbr-enabled"
                className={ZV3_POS_SWITCH}
                checked={fbrConfig.enabled}
                onCheckedChange={(checked) => setFbrConfig({ ...fbrConfig, enabled: checked })}
                disabled={!canManageFbr || isDesktopApp}
              />
            </div>
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="fbr-environment" className="mb-2 block text-sm font-bold text-[#0a1128]">Environment</Label>
              <select
                id="fbr-environment"
                value={fbrConfig.environment}
                onChange={(e) => setFbrConfig({ ...fbrConfig, environment: e.target.value as "TEST" | "SANDBOX" | "PRODUCTION" })}
                disabled={!canManageFbr || isDesktopApp}
                className="h-11 w-full max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] px-3 text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              >
                <option value="TEST">TEST — simulated numbers, nothing sent to FBR</option>
                <option value="SANDBOX">SANDBOX — FBR test system</option>
                <option value="PRODUCTION">PRODUCTION — live FBR reporting</option>
              </select>
              <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                Start with TEST. Move to SANDBOX with the test POS ID/token FBR gives you, then PRODUCTION when FBR approves go-live.
              </p>
            </div>
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="fbr-pos-id" className="mb-2 block text-sm font-bold text-[#0a1128]">POS ID</Label>
              <Input
                id="fbr-pos-id"
                value={fbrConfig.posId}
                onChange={(e) => setFbrConfig({ ...fbrConfig, posId: e.target.value })}
                disabled={!canManageFbr || isDesktopApp}
                placeholder="The POS ID FBR issued for this till"
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
            </div>
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="fbr-token" className="mb-2 block text-sm font-bold text-[#0a1128]">API Token</Label>
              <Input
                id="fbr-token"
                type="password"
                autoComplete="new-password"
                value={fbrTokenInput}
                onChange={(e) => { setFbrTokenInput(e.target.value); setFbrClearToken(false); }}
                disabled={!canManageFbr || isDesktopApp}
                placeholder={fbrConfig.hasToken && !fbrClearToken ? "•••••••••• (saved — type to replace)" : "Bearer token issued with the POS ID"}
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                Write-only: the token is never shown again after saving and is never printed in logs.
                {fbrConfig.hasToken && !fbrClearToken && (
                  <button type="button" onClick={() => { setFbrClearToken(true); setFbrTokenInput(""); }} className="ml-2 font-semibold text-red-600 hover:underline">
                    Clear saved token
                  </button>
                )}
                {fbrClearToken && <span className="ml-2 font-semibold text-red-600">The saved token will be removed on Save.</span>}
              </p>
            </div>
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="fbr-seller-name" className="mb-2 block text-sm font-bold text-[#0a1128]">Registered Business Name (optional)</Label>
              <Input
                id="fbr-seller-name"
                value={fbrConfig.sellerName}
                onChange={(e) => setFbrConfig({ ...fbrConfig, sellerName: e.target.value })}
                disabled={!canManageFbr || isDesktopApp}
                placeholder="Trade name exactly as registered with FBR"
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
            </div>
            <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
              <Label htmlFor="fbr-seller-strn" className="mb-2 block text-sm font-bold text-[#0a1128]">STRN (optional)</Label>
              <Input
                id="fbr-seller-strn"
                value={fbrConfig.sellerStrn}
                onChange={(e) => setFbrConfig({ ...fbrConfig, sellerStrn: e.target.value })}
                disabled={!canManageFbr || isDesktopApp}
                placeholder="Sales Tax Registration Number"
                className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
              />
            </div>
            {fbrTestResult && (
              <div className={`mt-[18px] rounded-[10px] px-4 py-3 text-[13px] ${fbrTestResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {fbrTestResult.message}
              </div>
            )}
            {canManageFbr && (
              <div className="flex flex-wrap gap-2 pt-[22px]">
                <Button
                  type="button"
                  onClick={handleFbrSave}
                  disabled={isSavingFbr || isDesktopApp}
                  className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                >
                  <Save className="h-4 w-4" />
                  {isSavingFbr ? "Saving…" : "Save FBR Settings"}
                </Button>
                <Button
                  type="button"
                  onClick={handleFbrTest}
                  disabled={isTestingFbr || isDesktopApp}
                  variant="outline"
                  className="rounded-lg border-[rgba(15,23,60,0.06)] text-sm font-semibold"
                >
                  {isTestingFbr ? "Testing…" : "Test Connection"}
                </Button>
              </div>
            )}
            <p className="pt-3 text-xs leading-relaxed text-[#8c95b0]">
              The connection test never posts an invoice — in TEST mode it only checks this configuration;
              in SANDBOX/PRODUCTION it checks the FBR endpoint is reachable.
            </p>
          </div>
        </section>
        {/* Provincial Tax — PRA / SRB / KPRA / BRA (Gap item 1) */}
        <section
          className="zv3-settings-block overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "225ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <Receipt className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              Provincial Tax — PRA / SRB / KPRA / BRA
            </div>
            <div className="text-xs font-medium text-[#8c95b0]">Owner only</div>
          </div>
          <div className="flex flex-col px-[30px] py-[30px]">
            <p className="text-[13px] leading-relaxed text-[#8c95b0] pb-[18px]">
              Provincial sales tax on services, charged on each invoice alongside FBR — on the same
              post-discount amount, but as its own line (never inside the FBR tax and never sent to
              FBR). Pick the authority for your province; a branch in another province can have its
              own row. With nothing configured here, invoices are exactly as they are today.
            </p>
            {!isProvTaxOwner && (
              <p className="mb-[18px] rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                Only the business owner can change provincial tax settings.
              </p>
            )}
            {isProvTaxOwner && (
              <>
                <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
                  <Label htmlFor="prov-tax-authority" className="mb-2 block text-sm font-bold text-[#0a1128]">Provincial Authority</Label>
                  <select
                    id="prov-tax-authority"
                    value={provTaxForm.authority}
                    onChange={(e) => setProvTaxForm({ ...provTaxForm, authority: e.target.value as ProvincialAuthority })}
                    className="h-11 w-full max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] px-3 text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  >
                    {(provTaxAuthorities.length > 0 ? provTaxAuthorities : [
                      { authority: "PRA" as ProvincialAuthority, name: "Punjab Revenue Authority", province: "Punjab" },
                      { authority: "SRB" as ProvincialAuthority, name: "Sindh Revenue Board", province: "Sindh" },
                      { authority: "KPRA" as ProvincialAuthority, name: "Khyber Pakhtunkhwa Revenue Authority", province: "Khyber Pakhtunkhwa" },
                      { authority: "BRA" as ProvincialAuthority, name: "Balochistan Revenue Authority", province: "Balochistan" },
                    ]).map((a) => (
                      <option key={a.authority} value={a.authority}>{a.name} ({a.province})</option>
                    ))}
                  </select>
                </div>
                <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
                  <Label htmlFor="prov-tax-reg" className="mb-2 block text-sm font-bold text-[#0a1128]">Registration Number (optional)</Label>
                  <Input
                    id="prov-tax-reg"
                    value={provTaxForm.registrationNumber}
                    onChange={(e) => setProvTaxForm({ ...provTaxForm, registrationNumber: e.target.value })}
                    placeholder="e.g. the PRA / SRB registration number printed on invoices"
                    className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
                  <Label htmlFor="prov-tax-rate" className="mb-2 block text-sm font-bold text-[#0a1128]">Rate (%)</Label>
                  <Input
                    id="prov-tax-rate"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={provTaxForm.rate}
                    onChange={(e) => setProvTaxForm({ ...provTaxForm, rate: e.target.value })}
                    placeholder="e.g. 5"
                    className="h-11 max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  />
                </div>
                <div className="border-b border-[rgba(15,23,60,0.06)] py-[18px]">
                  <Label htmlFor="prov-tax-branch" className="mb-2 block text-sm font-bold text-[#0a1128]">Applies To</Label>
                  <select
                    id="prov-tax-branch"
                    value={provTaxForm.branchId}
                    onChange={(e) => setProvTaxForm({ ...provTaxForm, branchId: e.target.value })}
                    className="h-11 w-full max-w-[400px] rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7] px-3 text-sm focus:border-[#1a52c5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(26,82,197,0.06)]"
                  >
                    <option value="">All branches (business-wide)</option>
                    {provTaxBranches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} only</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#8c95b0]">
                    A branch row overrides the business-wide row for that branch&apos;s sales.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 border-b border-[rgba(15,23,60,0.06)] py-[18px]">
                  <div>
                    <h4 className="text-sm font-bold text-[#0a1128]">Enabled</h4>
                    <p className="text-[13px] text-[#8c95b0]">Charge this provincial tax on new sales</p>
                  </div>
                  <Switch
                    id="prov-tax-enabled"
                    className={ZV3_POS_SWITCH}
                    checked={provTaxForm.enabled}
                    onCheckedChange={(checked) => setProvTaxForm({ ...provTaxForm, enabled: checked })}
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-[22px]">
                  <Button
                    type="button"
                    onClick={handleProvTaxSave}
                    disabled={isSavingProvTax}
                    className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                  >
                    <Save className="h-4 w-4" />
                    {isSavingProvTax ? "Saving…" : provTaxEditingId ? "Update Provincial Tax" : "Save Provincial Tax"}
                  </Button>
                  {provTaxEditingId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setProvTaxEditingId(null); setProvTaxForm({ authority: "PRA", registrationNumber: "", rate: "", branchId: "", enabled: true }); }}
                      className="rounded-lg border-[rgba(15,23,60,0.06)] text-sm font-semibold"
                    >
                      Cancel Edit
                    </Button>
                  )}
                </div>
              </>
            )}
            {provTaxConfigs.length > 0 && (
              <div className="pt-[22px]">
                <h4 className="pb-2 text-sm font-bold text-[#0a1128]">Configured</h4>
                {provTaxConfigs.map((cfg) => (
                  <div key={cfg.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(15,23,60,0.06)] py-3 first:border-t-0">
                    <div className="text-[13px] leading-relaxed">
                      <span className="font-bold text-[#0a1128]">{cfg.authorityName} ({cfg.authority}) — {Number(cfg.rate)}%</span>
                      <span className="text-[#8c95b0]"> · {cfg.branch ? `${cfg.branch.name} only` : "All branches"}</span>
                      {cfg.registrationNumber && <span className="text-[#8c95b0]"> · Reg: {cfg.registrationNumber}</span>}
                      {!cfg.enabled && <span className="ml-2 font-semibold text-red-600">Disabled</span>}
                    </div>
                    {isProvTaxOwner && (
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => handleProvTaxEdit(cfg)} className="h-8 rounded-lg border-[rgba(15,23,60,0.06)] px-3 text-xs font-semibold">Edit</Button>
                        {cfg.enabled && (
                          <Button type="button" variant="outline" onClick={() => handleProvTaxRetire(cfg)} className="h-8 rounded-lg border-red-200 px-3 text-xs font-semibold text-red-600">Retire</Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {provTaxConfigs.length === 0 && (
              <p className="pt-[18px] text-xs leading-relaxed text-[#8c95b0]">
                No provincial tax configured — invoices charge FBR/general tax only, as today.
              </p>
            )}
          </div>
        </section>
        {/* Integrations framework */}
        <IntegrationsSection canManage={canManageIntegrations} selectedCompanyId={selectedCompanyId} />
        {/* Backup & Restore (owner only) */}
        <section
          className="zv3-settings-block overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]"
          style={{ animationDelay: "250ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,60,0.06)] px-[30px] py-6">
            <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.2px] text-[#0a1128]">
              <Archive className="h-5 w-5 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              Backup &amp; Restore
            </div>
            <div className="text-xs font-medium text-[#8c95b0]">Owner only</div>
          </div>
          <div className="flex flex-col px-[30px] py-[30px]">
            <p className="text-[13px] leading-relaxed text-[#8c95b0] pb-[18px]">
              Download a complete backup of your business — products, stock, customers, sales, khata,
              prescriptions, clinic and hotel data — as a single file. Passwords and secret keys
              (like the FBR token) are never included in a backup. Restoring a backup can create a
              <strong> new business</strong> under your account (it starts on the free trial plan), or
              <strong> update a business you choose</strong> — an update refreshes the records that
              match, brings back the ones that are missing, and never deletes anything. Before an
              update is applied, a <strong>safety backup</strong> of the current state is saved
              automatically. Staff accounts are not recreated — you re-invite your team afterwards.
            </p>
            {!isBackupOwner && (
              <p className="rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                Only the business owner can export or restore backups.
              </p>
            )}
            {isBackupOwner && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleExportBusinessBackup}
                    disabled={isExportingBusiness}
                    className="gap-2 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:-translate-y-px"
                  >
                    <Download className="h-4 w-4" />
                    {isExportingBusiness ? "Preparing…" : "Export this business"}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleExportAccountBackup}
                    disabled={isExportingAccount}
                    variant="outline"
                    className="gap-2 rounded-lg border-[rgba(15,23,60,0.06)] text-sm font-semibold"
                  >
                    <Download className="h-4 w-4" />
                    {isExportingAccount ? "Preparing…" : "Export my whole account"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => restoreFileInputRef.current?.click()}
                    variant="outline"
                    className="gap-2 rounded-lg border-[rgba(15,23,60,0.06)] text-sm font-semibold"
                  >
                    <Upload className="h-4 w-4" />
                    Restore from file…
                  </Button>
                  <input
                    ref={restoreFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleRestoreFileSelected}
                  />
                </div>
                {updateResult?.updated?.length > 0 && (
                  <div className="mt-[18px] rounded-[10px] bg-green-50 px-4 py-3 text-[13px] leading-relaxed text-green-800">
                    {updateResult.updated.map((r: any) => (
                      <div key={r.businessId} className="mb-2 last:mb-0">
                        <p className="font-bold">Updated “{r.name}”</p>
                        <p>
                          {r.updatedTotal} record(s) updated · {r.addedTotal} record(s) brought back · {r.keptTotal} record(s) kept as they were
                        </p>
                        {r.skippedStaff?.length > 0 && (
                          <p className="mt-1">
                            Staff not re-linked (re-invite them): {r.skippedStaff.map((s: any) => s.email || s.name).filter(Boolean).join(", ")}
                          </p>
                        )}
                        {r.warnings?.length > 0 && (
                          <ul className="mt-1 list-disc pl-5">
                            {r.warnings.map((w: string, i: number) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        )}
                        {r.safetySnapshotId && (
                          <button
                            type="button"
                            onClick={() => handleDownloadSafetyBackup(r.safetySnapshotId)}
                            className="mt-1 font-semibold underline underline-offset-2"
                          >
                            Download the safety backup taken before this update
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {safetyBackups.length > 0 && (
                  <div className="mt-[18px] rounded-[10px] border border-[rgba(15,23,60,0.06)] px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#0a1128]">
                      <History className="h-4 w-4 text-[#1a52c5]" /> Safety backups
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#8c95b0]">
                      Saved automatically before each update of this business. A safety backup is a
                      normal backup file — you can restore from it the same way.
                    </p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {safetyBackups.map((s: any) => (
                        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#4a5578]">
                          <span>
                            {new Date(s.createdAt).toLocaleString()} · {Math.max(1, Math.round((s.sizeBytes || 0) / 1024))} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDownloadSafetyBackup(s.id)}
                            className="font-semibold text-[#1a52c5] underline underline-offset-2"
                          >
                            Download
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {restoreResult?.restored?.length > 0 && (
                  <div className="mt-[18px] rounded-[10px] bg-green-50 px-4 py-3 text-[13px] leading-relaxed text-green-800">
                    {restoreResult.restored.map((r: any) => (
                      <div key={r.businessId} className="mb-2 last:mb-0">
                        <p className="font-bold">Restored as “{r.name}”</p>
                        <p>
                          {Object.entries(r.counts || {})
                            .filter(([, n]: any) => Number(n) > 0)
                            .map(([k, n]: any) => `${k}: ${n}`)
                            .join(" · ") || "No data rows"}
                        </p>
                        {r.skippedStaff?.length > 0 && (
                          <p className="mt-1">
                            Staff not recreated (re-invite them): {r.skippedStaff.map((s: any) => s.email || s.name).filter(Boolean).join(", ")}
                          </p>
                        )}
                        {r.warnings?.length > 0 && (
                          <ul className="mt-1 list-disc pl-5">
                            {r.warnings.map((w: string, i: number) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

    {/* Restore Flow Modal — choose new-business restore or update mode */}
    <Dialog
      open={showRestoreFlow}
      onOpenChange={(open: boolean) => {
        if (!open && !isRestoring) {
          setShowRestoreFlow(false);
          setRestorePayload(null);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-[#1a52c5]" /> Restore from backup
          </DialogTitle>
        </DialogHeader>

        {restoreStep === "mode" && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-[13px] leading-relaxed text-[#4a5578]">
              “{restoreFileName}” contains {restoreSources.length === 1 ? <>one business: <strong>{restoreSources[0]?.name}</strong></> : <>{restoreSources.length} businesses</>}.
              How should it be restored?
            </p>
            <button
              type="button"
              onClick={() => { setShowRestoreFlow(false); setShowRestoreConfirm(true); }}
              className="rounded-[12px] border border-[rgba(15,23,60,0.08)] px-4 py-3 text-left transition hover:border-[#1a52c5]"
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-[#0a1128]">
                Restore as a new business <ArrowRight className="h-4 w-4 text-[#1a52c5]" />
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[#8c95b0]">
                Creates a separate “(Restored)” copy under your account. Your existing businesses are not touched.
              </span>
            </button>
            <button
              type="button"
              onClick={openUpdateTargets}
              className="rounded-[12px] border border-[rgba(15,23,60,0.08)] px-4 py-3 text-left transition hover:border-[#1a52c5]"
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-[#0a1128]">
                Update a business I choose <ArrowRight className="h-4 w-4 text-[#1a52c5]" />
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[#8c95b0]">
                Applies the backup inside one of your existing businesses: matching records are updated,
                missing records come back, and nothing is ever deleted. A safety backup is saved first.
              </span>
            </button>
          </div>
        )}

        {restoreStep === "target" && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-[13px] leading-relaxed text-[#4a5578]">
              Choose which of your businesses each backed-up business should update.
              Nothing is changed yet — you will see a preview next.
            </p>
            {restoreSources.map((s) => (
              <div key={s.id} className="flex flex-col gap-1">
                <Label className="text-[13px] font-semibold text-[#0a1128]">{s.name || "Business"}</Label>
                <Select
                  value={targetSelections[s.id] || ""}
                  onValueChange={(v: string) => setTargetSelections((prev) => ({ ...prev, [s.id]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a business…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ownedBusinesses.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}{b.id === s.id ? " (the business this backup came from)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {restoreSources.length > 0 && !allTargetsChosen && (
              <p className="text-xs text-[#8c95b0]">Pick a different target business for each one to continue.</p>
            )}
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRestoreStep("mode")}>Back</Button>
              <Button
                type="button"
                disabled={!allTargetsChosen || isPreviewing}
                onClick={handlePreviewUpdate}
                className="border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white"
              >
                {isPreviewing ? "Checking…" : "Preview changes"}
              </Button>
            </div>
          </div>
        )}

        {restoreStep === "preview" && updatePreview && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto py-2">
            {(updatePreview.previews || []).map((p: any) => (
              <div key={p.sourceBusinessId} className="rounded-[12px] border border-[rgba(15,23,60,0.08)] px-4 py-3">
                <p className="text-sm font-bold text-[#0a1128]">
                  {p.sourceBusinessName} <ArrowRight className="inline h-4 w-4 text-[#1a52c5]" /> {p.targetBusinessName}
                  {p.sameBusiness ? " (same business)" : ""}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#4a5578]">
                  <strong>{p.toUpdate}</strong> record(s) will be updated · <strong>{p.toAdd}</strong> record(s)
                  will be brought back · <strong>{p.keptTargetOnly}</strong> record(s) in “{p.targetBusinessName}”
                  are not in the backup and will be kept untouched.
                </p>
                {p.skippedMembers > 0 && (
                  <p className="mt-1 text-[13px] text-[#8c95b0]">
                    {p.skippedMembers} staff member(s) have no account in Zapeera and will be reported for re-inviting.
                  </p>
                )}
                <div className="mt-2 flex flex-col gap-0.5">
                  {Object.entries(p.perTable || {})
                    .filter(([, d]: any) => d.update + d.add + d.kept > 0)
                    .map(([key, d]: any) => (
                      <p key={key} className="text-xs text-[#8c95b0]">
                        {key}: {d.update} update · {d.add} add · {d.kept} kept
                      </p>
                    ))}
                </div>
              </div>
            ))}
            <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-[#4a5578]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1a52c5]" />
              Before anything changes, a safety backup of the current state is saved automatically —
              you will be able to download it afterwards from this section.
            </p>
            <div className="flex flex-col gap-1">
              <Label className="text-[13px] font-semibold text-[#0a1128]">
                {isAccountBackupFile
                  ? <>Type <strong>UPDATE</strong> to confirm</>
                  : <>Type the target business name <strong>“{expectedConfirmText}”</strong> to confirm</>}
              </Label>
              <Input
                value={updateConfirmText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdateConfirmText(e.target.value)}
                placeholder={expectedConfirmText}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRestoreStep("target")} disabled={isRestoring}>Back</Button>
              <Button
                type="button"
                disabled={!updateConfirmValid || isRestoring}
                onClick={handleConfirmUpdate}
                className="border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white"
              >
                {isRestoring ? "Updating…" : "Update business"}
              </Button>
            </div>
          </div>
        )}

        {restoreStep === "done" && updateResult && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto py-2">
            {(updateResult.updated || []).map((r: any) => (
              <div key={r.businessId} className="rounded-[12px] bg-green-50 px-4 py-3 text-[13px] leading-relaxed text-green-800">
                <p className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="h-4 w-4" /> Updated “{r.name}”
                </p>
                <p>
                  {r.updatedTotal} record(s) updated · {r.addedTotal} record(s) brought back · {r.keptTotal} record(s) kept as they were
                </p>
                {r.skippedStaff?.length > 0 && (
                  <p className="mt-1">
                    Staff not re-linked (re-invite them): {r.skippedStaff.map((s: any) => s.email || s.name).filter(Boolean).join(", ")}
                  </p>
                )}
                {r.warnings?.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {r.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {r.safetySnapshotId && (
                  <button
                    type="button"
                    onClick={() => handleDownloadSafetyBackup(r.safetySnapshotId)}
                    className="mt-1 font-semibold underline underline-offset-2"
                  >
                    Download the safety backup taken before this update
                  </button>
                )}
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => { setShowRestoreFlow(false); setRestorePayload(null); }}
                className="border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Restore Backup Confirmation Modal */}
    <ConfirmationModal
      isOpen={showRestoreConfirm}
      onClose={() => { setShowRestoreConfirm(false); setRestorePayload(null); }}
      onConfirm={handleConfirmRestore}
      title="Restore this backup?"
      description={`"${restoreFileName}" will be restored as a NEW business named "<original> (Restored)" under your account. Your existing businesses are not changed. The restored business starts on the free TRIAL plan (subscriptions are not copied), staff accounts are not recreated (you will re-invite your team), and secret keys such as the FBR token must be re-entered.`}
      confirmText="Restore as new business"
      cancelText="Cancel"
      variant="warning"
      isLoading={isRestoring}
      loadingText="Restoring…"
      icon={<Archive className="w-4 h-4" />}
    />

    {/* Import Settings Confirmation Modal */}
    <ConfirmationModal
      isOpen={showImportConfirm}
      onClose={() => { setShowImportConfirm(false); setImportedSettings(null); }}
      onConfirm={handleConfirmImport}
      title="Import Settings"
      description="This will replace your current settings with the imported data. Are you sure you want to continue?"
      confirmText="Import Settings"
      cancelText="Cancel"
      variant="warning"
      icon={<Upload className="w-4 h-4" />}
    />

    {/* Factory Reset Confirmation Modal */}
    <ConfirmationModal
      isOpen={showFactoryResetConfirm}
      onClose={() => setShowFactoryResetConfirm(false)}
      onConfirm={handleConfirmFactoryReset}
      title="Factory Reset"
      description="This will reset ALL settings to default values. This action cannot be undone and will permanently delete all your custom settings. Are you absolutely sure?"
      confirmText="Reset Everything"
      cancelText="Cancel"
      variant="danger"
      isLoading={false}
      icon={<RefreshCw className="w-4 h-4" />}
    />
    </div>
    </>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Settings);