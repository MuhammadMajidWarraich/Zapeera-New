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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";
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
  const [profileLoading, setProfileLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [toggling2FA, setToggling2FA] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await apiService.getProfile();
      if (res.success && res.data) {
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
        setTwoFactorEnabled(Boolean(res.data.twoFactorEnabled));
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
      setTwoFactorEnabled(Boolean((user as any)?.twoFactorEnabled));
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

  const hasEmail = Boolean(user?.email);
  const hasPhone = Boolean(profile.phone) || Boolean((user as any)?.phone);
  const has2fa = twoFactorEnabled || Boolean((user as any)?.twoFactorEnabled) || Boolean((user as any)?.is2FAEnabled);

  const handleToggle2FA = async (enabled: boolean) => {
    setToggling2FA(true);
    try {
      const res = await apiService.updateProfile({ twoFactorEnabled: enabled });
      if (res.success) {
        setTwoFactorEnabled(enabled);
        toast({
          title: enabled ? "2FA enabled" : "2FA disabled",
          description: enabled ? "Two-factor authentication is now on." : "Two-factor authentication is now off.",
        });
      } else {
        toast({ title: "Update failed", description: res.message || "Could not update 2FA.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message || "Could not update 2FA.", variant: "destructive" });
    } finally {
      setToggling2FA(false);
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
        const base64String = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const res = await apiService.updateProfile({ profileImage: base64String });
        if (res.success) {
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
    <main className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
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
                    {user?.profileImage ? (
                      <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
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
                { label: "Secure login", ok: true, desc: "Password-protected account" },
                { label: "Email verified", ok: hasEmail, desc: hasEmail ? "Your email is on file" : "Add your email" },
                { label: "Phone number", ok: hasPhone, desc: hasPhone ? "Phone on file" : "Add a phone number" },
                { label: "Two-factor authentication", ok: has2fa, desc: has2fa ? "2FA is enabled" : "Not enabled yet" },
                { label: "Encrypted connection", ok: true, desc: "Data is encrypted in transit" },
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
                checked={has2fa}
                disabled={toggling2FA}
                onCheckedChange={handleToggle2FA}
                className="h-6 w-11 shrink-0 border-0 shadow-none data-[state=unchecked]:bg-[#d1d5db] data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#1a52c5] data-[state=checked]:to-[#28c2ce] data-[state=checked]:shadow-[0_2px_8px_rgba(26,82,197,0.25)]"
              />
            </div>
            <div className="p-6">
              <p className="text-[13px] leading-relaxed text-[#8c95b0]">
                {has2fa
                  ? "Two-factor authentication is enabled on your account for an extra layer of security."
                  : "Add an extra layer of security to your account. Turn this on to require a second verification step."}
              </p>
              <p className="mt-3 text-xs text-[#8c95b0]">
                {has2fa ? "You can disable it anytime from this toggle." : "Your account isn't fully protected until 2FA is on."}
              </p>
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
