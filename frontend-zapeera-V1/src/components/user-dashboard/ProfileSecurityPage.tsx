import { useState, useEffect, useCallback } from "react";
import {
  User,
  ShieldCheck,
  Lock,
  Mail,
  Save,
  Camera,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Copy,
  Download,
  KeyRound,
} from "lucide-react";
import QRCode from "qrcode";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";
import {
  deriveAccountStatus,
  invalidateAccountStatus,
  type AccountStatusProfile,
} from "@/lib/account-status";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const ProfileSecurityPage = () => {
  const { user } = useAuth();

  const [profile, setProfile] = useState({
    name: "",
    email: "",
    username: "",
    phone: "",
    address: "",
    city: "",
    country: "",
    dateOfBirth: "",
    bio: "",
  });
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  // twoFactorConfigured = a TOTP secret exists server-side. The pair
  // (enabled, configured) distinguishes: truly on (true,true), legacy
  // flag-only from the old fake toggle (true,false — NOT enforced),
  // setup started but unconfirmed (false,true), and off (false,false).
  const [twoFactorConfigured, setTwoFactorConfigured] = useState(false);
  const [setupStep, setSetupStep] = useState<"idle" | "password" | "confirm" | "codes">("idle");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [setupOtpauthUri, setSetupOtpauthUri] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [issuedRecoveryCodes, setIssuedRecoveryCodes] = useState<string[]>([]);
  const [savedCodesAck, setSavedCodesAck] = useState(false);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableRecoveryCode, setDisableRecoveryCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [regenCode, setRegenCode] = useState("");
  const [showRegen, setShowRegen] = useState(false);
  // Raw GET /auth/profile payload — the Security Status card derives
  // from this via lib/account-status (the same source the dashboard
  // CompletionStrip uses, so the two surfaces cannot disagree).
  const [profileData, setProfileData] = useState<AccountStatusProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // The avatar must render the freshest known picture: the one returned by
  // GET /auth/profile (seeded in loadProfile) or by the update call itself.
  // Rendering only the AuthContext user is what made a saved picture look
  // lost — on web that snapshot is written at login and was never refreshed
  // after a profile update, so the page re-rendered the old value forever.
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await apiService.getProfile();
      if (res.success && res.data) {
        setProfileData(res.data as AccountStatusProfile);
        setProfile({
          name: res.data.name || "",
          email: res.data.email || "",
          username: res.data.username || "",
          phone: res.data.phone || "",
          address: res.data.address || "",
          city: res.data.city || "",
          country: res.data.country || "",
          dateOfBirth: res.data.dateOfBirth ? String(res.data.dateOfBirth).slice(0, 10) : "",
          bio: res.data.bio || "",
        });
        setProfileImage(res.data.profileImage || null);
        setTwoFactorEnabled(Boolean(res.data.twoFactorEnabled));
        setTwoFactorConfigured(Boolean((res.data as any).twoFactorConfigured));
      } else if (user) {
        setProfile({
          name: user.name || "",
          email: (user as any).email || "",
          username: (user as any).username || "",
          phone: (user as any).phone || "",
          address: (user as any).address || "",
          city: (user as any).city || "",
          country: (user as any).country || "",
          dateOfBirth: (user as any).dateOfBirth ? String((user as any).dateOfBirth).slice(0, 10) : "",
          bio: (user as any).bio || "",
        });
        setTwoFactorEnabled(Boolean((user as any).twoFactorEnabled));
        setTwoFactorConfigured(Boolean((user as any).twoFactorConfigured));
        // Fallback profileData from the login snapshot (M1 fix): carry
        // the snapshot's real-state fields the form already knows —
        // profileImage (else "Complete profile" reads false-incomplete
        // for a user who has an avatar), emailVerified and
        // twoFactorConfigured when present. hasPassword cannot be
        // derived from the snapshot, so it stays absent (conservative:
        // the check reads incomplete until a fresh profile loads).
        setProfileData({
          name: user.name || "",
          email: (user as any).email || "",
          phone: (user as any).phone || "",
          address: (user as any).address || "",
          city: (user as any).city || "",
          country: (user as any).country || "",
          dateOfBirth: (user as any).dateOfBirth || "",
          bio: (user as any).bio || "",
          profileImage: (user as any).profileImage ?? null,
          emailVerified: Boolean((user as any).emailVerified),
          twoFactorEnabled: Boolean((user as any).twoFactorEnabled),
          twoFactorConfigured: Boolean((user as any).twoFactorConfigured),
        });
      }
    } catch (error) {
      console.error("Failed to load profile:", error);
      if (user)
        setProfile({
          name: user.name || "",
          email: (user as any).email || "",
          username: (user as any).username || "",
          phone: (user as any).phone || "",
          address: (user as any).address || "",
          city: (user as any).city || "",
          country: (user as any).country || "",
          dateOfBirth: (user as any).dateOfBirth ? String((user as any).dateOfBirth).slice(0, 10) : "",
          bio: (user as any).bio || "",
        });
      if (user)
        setProfileData({
          name: user.name || "",
          email: (user as any).email || "",
          phone: (user as any).phone || "",
          address: (user as any).address || "",
          city: (user as any).city || "",
          country: (user as any).country || "",
          dateOfBirth: (user as any).dateOfBirth || "",
          bio: (user as any).bio || "",
          // M1 fix (see the else-branch above): carry the snapshot's
          // profileImage / emailVerified / twoFactorConfigured so the
          // card does not read false-incomplete on the error path.
          profileImage: (user as any).profileImage ?? null,
          emailVerified: Boolean((user as any).emailVerified),
          twoFactorEnabled: Boolean((user as any)?.twoFactorEnabled),
          twoFactorConfigured: Boolean((user as any)?.twoFactorConfigured),
        });
      setTwoFactorEnabled(Boolean((user as any)?.twoFactorEnabled));
      setTwoFactorConfigured(Boolean((user as any)?.twoFactorConfigured));
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSaveProfile = async () => {
    if (!profile.name.trim()) {
      toast({ title: "Validation", description: "Name cannot be empty.", variant: "destructive" });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await apiService.updateProfile({
        name: profile.name.trim(),
        phone: profile.phone.trim() || null,
        address: profile.address.trim() || null,
        city: profile.city.trim() || null,
        country: profile.country.trim() || null,
        dateOfBirth: profile.dateOfBirth || null,
        bio: profile.bio.trim() || null,
      });
      if (res.success) {
        toast({ title: "Profile updated", description: "Your profile has been saved." });
        // Resync from the server so the Security Status card (and, via
        // the invalidated cache, the dashboard strip) reflect the SAVED
        // state — not whatever the form happened to contain.
        invalidateAccountStatus();
        await loadProfile();
      } else {
        toast({ title: "Update failed", description: res.message || "Could not update profile.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message || "Could not update profile.", variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Required fields missing", description: "Please fill in all password fields.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "New passwords do not match.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Weak password", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await apiService.changePassword({ currentPassword, newPassword });
      if (res.success) {
        toast({ title: "Password changed", description: "Your password has been updated." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast({ title: "Change failed", description: res.message || "Could not change password.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Change failed", description: e.message || "Could not change password.", variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  // Status-truth (2026-10-24): the Security Status card below derives
  // EVERY row from the shared module over the freshly loaded profile —
  // previously `hasPhone` here also counted unsaved form input, and the
  // email row was `Boolean(user?.email)` (presence, not verification).
  // The 2FA toggle keeps editing the raw flag (its own state); the card
  // shows the enrolled truth via accountStatus.twoFactorOn.
  const accountStatus = deriveAccountStatus(profileData);
  // ── Real two-factor state ──────────────────────────────────────────
  // Only (enabled && configured) is truly on: the account is challenged
  // at login. (enabled && !configured) is the legacy fake-toggle state —
  // the flag is set but no secret exists, so nothing is enforced and the
  // UI must say "setup not finished" instead of pretending protection.
  const twoFactorOn = twoFactorEnabled && twoFactorConfigured;
  const twoFactorFlagOnly = twoFactorEnabled && !twoFactorConfigured;
  const twoFactorPending = !twoFactorEnabled && twoFactorConfigured;
  const has2fa = accountStatus.twoFactorOn;

  const resetSetupWizard = () => {
    setSetupStep("idle");
    setSetupPassword("");
    setSetupSecret("");
    setSetupOtpauthUri("");
    setQrDataUrl("");
    setSetupCode("");
    setIssuedRecoveryCodes([]);
    setSavedCodesAck(false);
  };

  const handleToggle2FA = (enabled: boolean) => {
    if (enabled) {
      // Turning on always runs the enrollment wizard — a bare flip is
      // exactly the fiction this replaces.
      setShowDisable(false);
      setSetupStep(twoFactorPending ? "confirm" : "password");
    } else {
      resetSetupWizard();
      setShowDisable(true);
    }
  };

  const submitSetupPassword = async () => {
    if (!setupPassword) {
      toast({ title: "Password required", description: "Confirm your password to set up two-factor authentication.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiService.setup2fa(setupPassword);
      if (res.success && res.data) {
        setSetupSecret(res.data.secret);
        setSetupOtpauthUri(res.data.otpauthUri);
        try {
          setQrDataUrl(await QRCode.toDataURL(res.data.otpauthUri, { width: 208, margin: 1 }));
        } catch {
          setQrDataUrl("");
        }
        setSetupPassword("");
        setSetupStep("confirm");
      } else {
        toast({ title: "Setup failed", description: res.message || "Could not start 2FA setup.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Setup failed", description: e.message || "Could not start 2FA setup.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const submitEnable2fa = async () => {
    const code = setupCode.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "Enter the 6-digit code", description: "Open your authenticator app and enter the current code.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiService.enable2fa(code);
      if (res.success && res.data?.recoveryCodes) {
        setIssuedRecoveryCodes(res.data.recoveryCodes);
        setTwoFactorEnabled(true);
        setTwoFactorConfigured(true);
        // Status-truth: the Security Status card derives from profileData
        // + the shared account-status cache — refresh both here, or the
        // card still shows "Not enabled yet" after enrollment succeeds.
        setProfileData((prev) => (prev ? { ...prev, twoFactorEnabled: true, twoFactorConfigured: true } : prev));
        invalidateAccountStatus();
        setSetupCode("");
        setSetupStep("codes");
        toast({ title: "2FA enabled", description: "Two-factor authentication is now protecting your account." });
      } else {
        toast({ title: "Code not accepted", description: res.message || "That code does not match.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Code not accepted", description: e.message || "That code does not match.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const finishCodesStep = async () => {
    resetSetupWizard();
    setShowRegen(false);
    setRegenCode("");
    await loadProfile();
  };

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(issuedRecoveryCodes.join("\n"));
      toast({ title: "Copied", description: "Recovery codes copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Select the codes and copy them manually.", variant: "destructive" });
    }
  };

  const downloadRecoveryCodes = () => {
    const blob = new Blob(
      [`Zapeera two-factor recovery codes\nAccount: ${profile.email || profile.username}\nEach code works once. Keep this file somewhere safe.\n\n${issuedRecoveryCodes.join("\n")}\n`],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zapeera-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitDisable2fa = async () => {
    const payload: { code?: string; recoveryCode?: string; password?: string } = {};
    if (twoFactorFlagOnly) {
      if (!disablePassword) {
        toast({ title: "Password required", description: "Confirm your password to turn this off.", variant: "destructive" });
        return;
      }
      payload.password = disablePassword;
    } else if (disableRecoveryCode.trim()) {
      payload.recoveryCode = disableRecoveryCode.trim();
    } else if (disableCode.trim()) {
      payload.code = disableCode.trim();
    } else {
      toast({ title: "Code required", description: "Enter a current authenticator code or a recovery code to disable 2FA.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiService.disable2fa(payload);
      if (res.success) {
        setTwoFactorEnabled(false);
        setTwoFactorConfigured(false);
        setShowDisable(false);
        setDisableCode("");
        setDisableRecoveryCode("");
        setDisablePassword("");
        toast({ title: "2FA disabled", description: "Two-factor authentication is now off." });
        // Status-truth: loadProfile refreshes profileData; invalidate the
        // shared account-status cache too, or the card + dashboard strip
        // keep showing the pre-disable state.
        invalidateAccountStatus();
        await loadProfile();
      } else {
        toast({ title: "Could not disable", description: res.message || "Verification failed.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not disable", description: e.message || "Verification failed.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const submitRegenCodes = async () => {
    const code = regenCode.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "Enter the 6-digit code", description: "A current authenticator code is required to issue new recovery codes.", variant: "destructive" });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const res = await apiService.regenerate2faRecoveryCodes(code);
      if (res.success && res.data?.recoveryCodes) {
        setIssuedRecoveryCodes(res.data.recoveryCodes);
        setSavedCodesAck(false);
        setSetupStep("codes");
        setShowRegen(false);
        setRegenCode("");
        toast({ title: "New recovery codes", description: "Your previous recovery codes no longer work." });
      } else {
        toast({ title: "Could not regenerate", description: res.message || "That code does not match.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not regenerate", description: e.message || "That code does not match.", variant: "destructive" });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleChangeProfilePicture = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast({ title: "Invalid file", description: "Please select an image.", variant: "destructive" });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "File too large", description: "Image must be under 5MB.", variant: "destructive" });
        return;
      }
      setUploadingPhoto(true);
      try {
        // Downscale before upload: a full-size phone photo is several MB of
        // base64, which the API body limits reject. An avatar never needs
        // more than 512px — re-encode to JPEG at that size (falls back to
        // the original file if the image cannot be decoded, e.g. HEIC).
        const base64String = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const raw = reader.result as string;
            const img = new Image();
            img.onload = () => {
              try {
                const scale = Math.min(1, 512 / Math.max(img.width, img.height));
                if (scale >= 1 && file.size <= 400 * 1024) { resolve(raw); return; }
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext("2d");
                if (!ctx) { resolve(raw); return; }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", 0.85));
              } catch { resolve(raw); }
            };
            img.onerror = () => resolve(raw);
            img.src = raw;
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const res = await apiService.updateProfile({ profileImage: base64String });
        if (res.success) {
          // Show the picture the server just saved (the response carries
          // it), not the stale context snapshot.
          setProfileImage((res.data && res.data.profileImage) || base64String);
          toast({ title: "Photo updated", description: "Your profile picture has been saved." });
          setTimeout(() => window.location.reload(), 800);
        } else {
          toast({ title: "Update failed", description: res.message || "Could not update profile picture.", variant: "destructive" });
        }
      } catch (e: any) {
        toast({ title: "Update failed", description: e.message || "Could not update profile picture.", variant: "destructive" });
      } finally {
        setUploadingPhoto(false);
      }
    };
    input.click();
  };

  return (
    <main className="w-full px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Account
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Profile & Security</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Manage your personal information and account security.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Profile */}
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-6 py-5">
              <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
                <User className="h-5 w-5 text-[#1a52c5]" />
                Personal Information
              </div>
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center gap-4">
                <div className="relative">
                  <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-[18px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-2xl font-extrabold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)]">
                    {profileImage || user?.profileImage ? (
                      <img src={(profileImage || user?.profileImage) as string} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (profile.name?.charAt(0) || user?.name?.charAt(0) || "U").toUpperCase()
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleChangeProfilePicture}
                    disabled={uploadingPhoto}
                    title="Change profile photo"
                    className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-md transition-opacity hover:opacity-90"
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-[#0a1128]">{profile.name || user?.name || "User"}</p>
                  <p className="truncate text-[13px] text-[#8c95b0]">@{profile.username || (user as any)?.username || "user"}</p>
                </div>
              </div>

              {profileLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-[10px] bg-[#f0f2f7]" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="pp-name" className="text-sm font-semibold text-[#0a1128]">Full Name</Label>
                    <Input
                      id="pp-name"
                      value={profile.name}
                      onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                      className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pp-email" className="text-sm font-semibold text-[#0a1128]">Email</Label>
                    <Input
                      id="pp-email"
                      type="email"
                      value={profile.email}
                      disabled
                      className="h-12 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7]/50 text-[15px] text-[#8c95b0]"
                    />
                    <p className="text-xs text-[#8c95b0]">Email cannot be changed here. Contact support for help.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pp-username" className="text-sm font-semibold text-[#0a1128]">Username</Label>
                    <Input
                      id="pp-username"
                      value={profile.username}
                      disabled
                      className="h-12 rounded-[10px] border-[1.5px] border-black/10 bg-[#f0f2f7]/50 text-[15px] text-[#8c95b0]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="pp-phone" className="text-sm font-semibold text-[#0a1128]">Phone</Label>
                      <Input
                        id="pp-phone"
                        type="tel"
                        value={profile.phone}
                        onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+92 300 1234567"
                        className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pp-dob" className="text-sm font-semibold text-[#0a1128]">Date of Birth</Label>
                      <Input
                        id="pp-dob"
                        type="date"
                        value={profile.dateOfBirth}
                        onChange={(e) => setProfile((p) => ({ ...p, dateOfBirth: e.target.value }))}
                        className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pp-city" className="text-sm font-semibold text-[#0a1128]">City</Label>
                      <Input
                        id="pp-city"
                        value={profile.city}
                        onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                        placeholder="e.g. Lahore"
                        className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pp-country" className="text-sm font-semibold text-[#0a1128]">Country</Label>
                      <Input
                        id="pp-country"
                        value={profile.country}
                        onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))}
                        placeholder="e.g. Pakistan"
                        className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="pp-address" className="text-sm font-semibold text-[#0a1128]">Address</Label>
                      <Input
                        id="pp-address"
                        value={profile.address}
                        onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                        placeholder="Street, area"
                        className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="pp-bio" className="text-sm font-semibold text-[#0a1128]">About</Label>
                      <Textarea
                        id="pp-bio"
                        value={profile.bio}
                        onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
                        placeholder="Tell us a little about yourself"
                        rows={3}
                        className="min-h-[84px] rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                    className="h-11 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {savingProfile ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* Password */}
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-6 py-5">
              <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
                <Lock className="h-5 w-5 text-[#1a52c5]" />
                Change Password
              </div>
            </div>
            <div className="space-y-4 p-6">
              <div className="space-y-2">
                <Label htmlFor="pp-current" className="text-sm font-semibold text-[#0a1128]">Current Password</Label>
                <Input
                  id="pp-current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pp-new" className="text-sm font-semibold text-[#0a1128]">New Password</Label>
                  <Input
                    id="pp-new"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-confirm" className="text-sm font-semibold text-[#0a1128]">Confirm New Password</Label>
                  <Input
                    id="pp-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                  />
                </div>
              </div>
              <Button
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="h-11 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white font-semibold text-[#0a1128] hover:bg-[#f0f2f7]"
              >
                <Lock className="mr-2 h-4 w-4 text-[#1a52c5]" />
                {changingPassword ? "Updating…" : "Update Password"}
              </Button>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Security Status */}
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-6 py-5">
              <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
                <ShieldAlert className="h-5 w-5 text-[#1a52c5]" />
                Security Status
              </div>
            </div>
            <div className="divide-y divide-[rgba(15,23,60,0.06)]">
              {[
                { label: "Secure login", ok: accountStatus.secureLogin, desc: accountStatus.secureLogin ? "Password-protected account" : "No password set on this account" },
                { label: "Email verified", ok: accountStatus.emailVerified, desc: accountStatus.emailVerified ? "Your email is on file" : "Not verified yet — check your inbox" },
                { label: "Phone number", ok: accountStatus.phoneOnFile, desc: accountStatus.phoneOnFile ? "Phone on file" : "Add a phone number" },
                { label: "Two-factor authentication", ok: accountStatus.twoFactorOn, desc: twoFactorOn ? "2FA is enabled" : twoFactorFlagOnly ? "Setup not finished \u2014 not active yet" : twoFactorPending ? "Setup started \u2014 enter a code to finish" : "Not enabled yet" },
                { label: "Encrypted connection", ok: accountStatus.encryptedConnection, desc: accountStatus.encryptedConnection ? "Data is encrypted in transit" : "This connection is not encrypted" },
              ].map((it) => (
                <div key={it.label} className="flex items-center gap-3 px-6 py-4">
                  {it.ok ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", it.ok ? "text-[#0a1128]" : "text-[#4a5578]")}>{it.label}</p>
                    <p className="text-xs text-[#8c95b0]">{it.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Two-factor authentication */}
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-[rgba(15,23,60,0.06)] px-6 py-5">
              <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
                <ShieldCheck className="h-5 w-5 text-[#1a52c5]" />
                Two-Factor Authentication
              </div>
              <Switch
                id="2fa-toggle"
                checked={twoFactorOn}
                disabled={twoFactorBusy || setupStep === "codes"}
                onCheckedChange={handleToggle2FA}
                className="h-6 w-11 shrink-0 border-0 shadow-none data-[state=unchecked]:bg-[#d1d5db] data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#1a52c5] data-[state=checked]:to-[#28c2ce] data-[state=checked]:shadow-[0_2px_8px_rgba(26,82,197,0.25)]"
              />
            </div>
            <div className="space-y-4 p-6">
              {setupStep === "codes" ? (
                <div className="space-y-4">
                  <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">Save your recovery codes now</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
                      These codes are shown only once. If you lose your authenticator app, one of these
                      codes is the only way back into your account. Each code works a single time.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {issuedRecoveryCodes.map((code) => (
                      <div key={code} className="rounded-[10px] bg-[#f0f2f7] px-3 py-2.5 text-center font-mono text-[15px] font-semibold tracking-wider text-[#0a1128]">
                        {code}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={copyRecoveryCodes} className="h-10 flex-1 rounded-[10px] font-semibold">
                      <Copy className="mr-2 h-4 w-4" /> Copy
                    </Button>
                    <Button variant="outline" onClick={downloadRecoveryCodes} className="h-10 flex-1 rounded-[10px] font-semibold">
                      <Download className="mr-2 h-4 w-4" /> Download
                    </Button>
                  </div>
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#4a5578]">
                    <input
                      type="checkbox"
                      checked={savedCodesAck}
                      onChange={(e) => setSavedCodesAck(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-black/20 accent-[#1a52c5]"
                    />
                    I have saved these codes somewhere safe.
                  </label>
                  <Button
                    onClick={finishCodesStep}
                    disabled={!savedCodesAck}
                    className="h-11 w-full rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white hover:opacity-95"
                  >
                    Done
                  </Button>
                </div>
              ) : setupStep === "password" ? (
                <div className="space-y-4">
                  <p className="text-[13px] leading-relaxed text-[#8c95b0]">
                    First, confirm it is really you. Enter your account password to start setup.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="pp-2fa-password" className="text-sm font-semibold text-[#0a1128]">Account password</Label>
                    <Input
                      id="pp-2fa-password"
                      type="password"
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-[15px] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={submitSetupPassword} disabled={twoFactorBusy} className="h-11 flex-1 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white hover:opacity-95">
                      {twoFactorBusy ? "Checking\u2026" : "Continue"}
                    </Button>
                    <Button variant="outline" onClick={resetSetupWizard} disabled={twoFactorBusy} className="h-11 rounded-[10px] font-semibold">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : setupStep === "confirm" ? (
                <div className="space-y-4">
                  {setupSecret ? (
                    <>
                      <p className="text-[13px] leading-relaxed text-[#8c95b0]">
                        Scan this QR code with your authenticator app (Google Authenticator, Authy,
                        Microsoft Authenticator, or your password manager), then enter the 6-digit code
                        it shows to finish.
                      </p>
                      {qrDataUrl ? (
                        <div className="flex justify-center">
                          <img src={qrDataUrl} alt="Two-factor setup QR code" className="h-52 w-52 rounded-[10px] border border-black/10" />
                        </div>
                      ) : null}
                      <div className="rounded-[10px] bg-[#f0f2f7] p-3 text-center">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8c95b0]">Or enter this key manually</p>
                        <p className="mt-1 break-all font-mono text-sm font-semibold tracking-wider text-[#0a1128]">{setupSecret}</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-[#8c95b0]">
                      Setup was started earlier. Enter the current 6-digit code from the authenticator
                      entry you added then \u2014 or start over if you no longer have it.
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="pp-2fa-code" className="text-sm font-semibold text-[#0a1128]">Authenticator code</Label>
                    <Input
                      id="pp-2fa-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={setupCode}
                      onChange={(e) => setSetupCode(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="------"
                      className="h-12 rounded-[10px] border-[1.5px] border-black/10 text-center text-xl font-semibold tracking-[0.4em] focus:border-[#1a52c5] focus:ring-[#1a52c5]/10"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={submitEnable2fa} disabled={twoFactorBusy} className="h-11 flex-1 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white hover:opacity-95">
                      {twoFactorBusy ? "Verifying\u2026" : "Enable 2FA"}
                    </Button>
                    <Button variant="outline" onClick={resetSetupWizard} disabled={twoFactorBusy} className="h-11 rounded-[10px] font-semibold">
                      Cancel
                    </Button>
                  </div>
                  {!setupSecret && (
                    <button type="button" onClick={() => setSetupStep("password")} className="text-sm font-semibold text-[#1a52c5] hover:underline">
                      Start over with a new code instead
                    </button>
                  )}
                </div>
              ) : twoFactorOn ? (
                <div className="space-y-4">
                  <p className="text-[13px] leading-relaxed text-[#8c95b0]">
                    Two-factor authentication is enabled. Signing in now requires your password plus a
                    code from your authenticator app (or a recovery code).
                  </p>
                  {showRegen ? (
                    <div className="space-y-3 rounded-[10px] border border-black/[0.06] bg-[#f8f9fc] p-4">
                      <p className="text-[13px] text-[#4a5578]">
                        Issuing new recovery codes invalidates all previous ones. Enter a current
                        authenticator code to continue.
                      </p>
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={regenCode}
                        onChange={(e) => setRegenCode(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="6-digit code"
                        className="h-11 rounded-[10px] bg-white text-center text-lg font-semibold tracking-[0.3em]"
                      />
                      <div className="flex gap-2">
                        <Button onClick={submitRegenCodes} disabled={twoFactorBusy} className="h-10 flex-1 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white hover:opacity-95">
                          Issue new codes
                        </Button>
                        <Button variant="outline" onClick={() => { setShowRegen(false); setRegenCode(""); }} disabled={twoFactorBusy} className="h-10 rounded-[10px] font-semibold">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : showDisable ? (
                    <div className="space-y-3 rounded-[10px] border border-red-100 bg-red-50/60 p-4">
                      <p className="text-[13px] font-medium text-red-900">
                        To disable 2FA, prove it is you with a current authenticator code or a recovery code.
                      </p>
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="Authenticator code"
                        className="h-11 rounded-[10px] bg-white text-center text-lg font-semibold tracking-[0.3em]"
                      />
                      <Input
                        value={disableRecoveryCode}
                        onChange={(e) => setDisableRecoveryCode(e.target.value)}
                        placeholder="Or a recovery code (XXXX-XXXX)"
                        className="h-11 rounded-[10px] bg-white text-center font-mono text-[15px] uppercase"
                      />
                      <div className="flex gap-2">
                        <Button onClick={submitDisable2fa} disabled={twoFactorBusy} className="h-10 flex-1 rounded-[10px] bg-red-600 font-semibold text-white hover:bg-red-700">
                          Disable 2FA
                        </Button>
                        <Button variant="outline" onClick={() => setShowDisable(false)} disabled={twoFactorBusy} className="h-10 rounded-[10px] bg-white font-semibold">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" onClick={() => setShowRegen(true)} className="h-10 w-full rounded-[10px] font-semibold">
                        <KeyRound className="mr-2 h-4 w-4 text-[#1a52c5]" />
                        Regenerate recovery codes
                      </Button>
                      <p className="text-xs leading-relaxed text-[#8c95b0]">
                        To turn 2FA off, use the switch above \u2014 you will be asked for a code first.
                      </p>
                    </div>
                  )}
                </div>
              ) : twoFactorFlagOnly ? (
                <div className="space-y-4">
                  <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">Setup not finished</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
                      Two-factor authentication was switched on here before, but enrollment was never
                      completed \u2014 so it is <strong>not protecting your account yet</strong> and sign-in
                      does not ask for a code. Finish setup to make it real.
                    </p>
                  </div>
                  {showDisable ? (
                    <div className="space-y-3 rounded-[10px] border border-black/[0.06] bg-[#f8f9fc] p-4">
                      <p className="text-[13px] text-[#4a5578]">
                        Confirm your account password to clear this unfinished state.
                      </p>
                      <Input
                        type="password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="Account password"
                        className="h-11 rounded-[10px] bg-white"
                      />
                      <div className="flex gap-2">
                        <Button onClick={submitDisable2fa} disabled={twoFactorBusy} className="h-10 flex-1 rounded-[10px] bg-red-600 font-semibold text-white hover:bg-red-700">
                          Turn off
                        </Button>
                        <Button variant="outline" onClick={() => setShowDisable(false)} disabled={twoFactorBusy} className="h-10 rounded-[10px] font-semibold">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button onClick={() => setSetupStep("password")} className="h-11 flex-1 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white hover:opacity-95">
                        Finish setup
                      </Button>
                      <Button variant="outline" onClick={() => setShowDisable(true)} className="h-11 rounded-[10px] font-semibold">
                        Turn off
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {twoFactorPending && (
                    <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-amber-900">Setup started but not confirmed</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
                        A setup key was issued for your account but never confirmed with a code, so 2FA
                        is not active yet.
                      </p>
                    </div>
                  )}
                  <p className="text-[13px] leading-relaxed text-[#8c95b0]">
                    Add an extra layer of security: after your password, signing in will also ask for a
                    one-time code from an authenticator app on your phone.
                  </p>
                  <Button onClick={() => setSetupStep(twoFactorPending ? "confirm" : "password")} className="h-11 w-full rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white hover:opacity-95">
                    {twoFactorPending ? "Enter a code to finish setup" : "Set up two-factor authentication"}
                  </Button>
                  {twoFactorPending && (
                    <button type="button" onClick={() => setSetupStep("password")} className="text-sm font-semibold text-[#1a52c5] hover:underline">
                      Start over with a new key
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.04] to-[#28c2ce]/[0.04] p-6">
            <h3 className="text-[15px] font-bold text-[#0a1128]">Need to change your email?</h3>
            <p className="mt-1 text-[13px] text-[#8c95b0]">Contact support and our team will help you update your account email.</p>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "mailto:support@zapeera.com?subject=Change%20account%20email")}
              className="mt-4 h-10 w-full rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white font-semibold text-[#0a1128] hover:bg-[#f0f2f7]"
            >
              <Mail className="mr-2 h-4 w-4 text-[#1a52c5]" />
              Contact Support
            </Button>
          </section>
        </div>
      </div>
    </main>
  );
};

export default ProfileSecurityPage;
