import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { config } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageCircle,
  Phone,
  Mail,
  Plus,
  UserPlus,
  LogOut,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Building2,
  X,
} from "lucide-react";
import ZapeeraLayout from "@/components/layout/ZapeeraLayout";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/lib/runtime";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { whatsappUrl, emailUrl, callUrl, SUPPORT_PHONE_DISPLAY } from "@/lib/support-links";
import { AccountStats, SecurityCard, AccountCompletion, SupportWidget, DesktopStatusCard, ActivityTimeline, RecentlyAccessed, FavoriteBusinesses, InvitationsWidget, RecentNotifications } from "@/components/user-dashboard/widgets";
import { BusinessCardGrid } from "@/components/user-dashboard/business-cards";

const ZapeeraDashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const runtime = useRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [businessTypes, setBusinessTypes] = useState<any[]>([]);
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 18) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  // Support deep-link ?create=1 to open the create dialog
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setIsCreateModalOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [formData, setFormData] = useState<{
    name: string;
    businessType: string;
    description: string;
    address: string;
    phone: string;
    email: string;
  }>({
    name: "",
    businessType: "PHARMACY",
    description: "",
    address: "",
    phone: "",
    email: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const res = await apiService.getBusinessTypes();
        if (res.success && res.data && res.data.length > 0) {
          setBusinessTypes(res.data);
          setFormData((prev) => ({ ...prev, businessType: res.data[0].name }));
        }
      } catch (error) {
        console.error("Failed to fetch business types:", error);
      }
    };
    fetchTypes();
  }, []);

  const currentUser = user as { id: string; name: string; username?: string; email?: string; role: string; isActive?: boolean } | null;

  const handleCreateBusiness = () => setIsCreateModalOpen(true);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormErrors({});

    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Business name is required";
    else if (formData.name.trim().length < 2) errors.name = "Business name must be at least 2 characters";
    if (!formData.email.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = "Please enter a valid email address";
    }
    if (!formData.phone.trim()) {
      errors.phone = "Phone number is required";
    } else if (!/^(\+?[0-9]{10,15})$/.test(formData.phone.replace(/[\s\-()]/g, ""))) {
      errors.phone = "Please enter a valid phone number (10-15 digits)";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setIsSubmitting(false);
      toast({ title: "Validation Error", description: "Please fill all required fields correctly", variant: "destructive" });
      return;
    }

    try {
      const response = await apiService.createCompany(formData as any);
      if (response.success) {
        toast({ title: "Success", description: "Business created successfully!" });
        setFormData({ name: "", businessType: "PHARMACY", description: "", address: "", phone: "", email: "" });
        setIsCreateModalOpen(false);
        navigate("/zapeera/my-businesses");
      } else {
        toast({ title: "Error", description: response.message || "Failed to create business", variant: "destructive" });
      }
    } catch (error: unknown) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to create business", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormCancel = () => {
    setIsCreateModalOpen(false);
    setFormData({ name: "", businessType: "PHARMACY", description: "", address: "", phone: "", email: "" });
    setFormErrors({});
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    setIsLoggingOut(false);
  };

  const openWorkspace = useCallback(
    (slug?: string | null, id?: string) => {
      if (slug) navigate(`/business/${encodeURIComponent(slug)}/dashboard`);
      else navigate(id ? `/zapeera/my-businesses` : "/zapeera/my-businesses");
    },
    [navigate]
  );

  const canCreateBusiness = Boolean(currentUser);

  if (currentUser && currentUser.isActive === false) {
    return (
      <ZapeeraLayout>
        <div className="px-4 pb-14 pt-9 sm:px-8 lg:px-11">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_8px_40px_rgba(0,0,0,0.05)]">
            <div className="border-b border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-8 py-10 text-center">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] shadow-lg">
                <MessageCircle className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-[#0a1128]">Account disabled</h1>
              <p className="mt-2 text-[#4a5578]">Your account needs to be activated by an administrator.</p>
            </div>
            <div className="space-y-6 p-8">
              <div className="rounded-2xl border border-[#1a52c5]/15 bg-[#1a52c5]/[0.04] p-6">
                <h3 className="mb-2 text-sm font-bold text-[#0a1128]">Contact support</h3>
                <p className="mb-4 text-sm text-[#4a5578]">Reach us on WhatsApp or email to activate your account.</p>
                <div className="flex items-center justify-center gap-2 text-[#1a52c5]">
                  <Phone className="h-5 w-5" />
                  <a href={callUrl()} className="text-lg font-semibold hover:underline">
                    {SUPPORT_PHONE_DISPLAY}
                  </a>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <a
                  href={whatsappUrl(`Hello! My account is disabled and I need it to be activated. My username: ${currentUser?.username || "N/A"}. Please help me activate my account.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-md hover:opacity-95"
                >
                  <MessageCircle className="mr-2 h-5 w-5" />
                  WhatsApp
                </a>
                <a
                  href={emailUrl("Account Activation Request - Zapeera", `Hello,\n\nMy account is currently disabled and I need it to be activated.\n\nUsername: ${currentUser?.username || "N/A"}\nEmail: ${currentUser?.email || "N/A"}\n\nBest regards,\n${currentUser?.name || "User"}`)}
                  className="inline-flex h-12 items-center justify-center rounded-[10px] border border-[rgba(15,23,60,0.12)] font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
                >
                  <Mail className="mr-2 h-5 w-5" />
                  Email
                </a>
              </div>
              <div className="rounded-xl bg-[#f0f2f7] p-4 text-sm text-[#4a5578]">
                <p>
                  <span className="font-semibold text-[#0a1128]">Username:</span> {currentUser?.username || "N/A"}
                </p>
                <p>
                  <span className="font-semibold text-[#0a1128]">Email:</span> {currentUser?.email || "N/A"}
                </p>
              </div>
              <div className="text-center">
                <Button variant="ghost" onClick={handleLogout} disabled={isLoggingOut} className="text-[#8c95b0]">
                  <LogOut className="mr-2 h-4 w-4" />
                  {isLoggingOut ? "Logging out…" : "Logout"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </ZapeeraLayout>
    );
  }

  return (
    <ZapeeraLayout>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
        {/* Hero greeting + primary actions */}
        <section className="relative mb-7 overflow-hidden rounded-[24px] border border-[rgba(15,23,60,0.05)] bg-gradient-to-br from-white via-white to-[#f4f8ff] p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_10px_40px_rgba(26,82,197,0.06)] sm:p-8">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 85% 15%, rgba(40,194,206,0.08) 0%, transparent 45%), radial-gradient(circle at 10% 90%, rgba(26,82,197,0.06) 0%, transparent 45%)",
            }}
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
                <Sparkles className="h-3.5 w-3.5" />
                Your account overview
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-[#0a1128] sm:text-3xl">
                {greeting}, {currentUser?.name?.split(" ")[0] || "there"} <span aria-hidden>👋</span>
              </h1>
              <p className="mt-1.5 max-w-xl text-sm text-[#4a5578]">
                This is your Zapeera control center — manage your businesses, invitations, subscriptions and account settings in one place.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/zapeera/invitations")}
                className="inline-flex items-center gap-2 rounded-[12px] border border-[rgba(15,23,60,0.1)] bg-white px-6 py-3 text-sm font-semibold text-[#0a1128] shadow-sm transition-all hover:-translate-y-px hover:border-[#1a52c5]/25 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
              >
                <UserPlus className="h-[18px] w-[18px] text-[#1a52c5]" />
                Join a Business
              </button>
              <button
                type="button"
                onClick={handleCreateBusiness}
                disabled={!canCreateBusiness}
                className={cn(
                  "inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(26,82,197,0.3)] transition-all hover:-translate-y-px hover:shadow-[0_8px_32px_rgba(26,82,197,0.4),0_0_0_4px_rgba(26,82,197,0.08)] disabled:pointer-events-none disabled:opacity-50"
                )}
              >
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
                Create New Business
              </button>
            </div>
          </div>
        </section>

        {/* Quick account stats */}
        <AccountStats />

        {/* My Businesses + widgets */}
        <div className="mt-7 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[19px] font-extrabold tracking-tight text-[#0a1128]">My Businesses</h2>
                <p className="text-[13px] text-[#8c95b0]">Owned and joined businesses — open the workspace to operate.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/zapeera/my-businesses")}
                className="hidden items-center gap-1 text-sm font-semibold text-[#1a52c5] transition-colors hover:text-[#28c2ce] sm:inline-flex"
              >
                Manage Businesses <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <BusinessCardGrid />
            <InvitationsWidget />
            <RecentNotifications />
          </div>

          <div className="space-y-6">
            <DesktopStatusCard />
            <SecurityCard />
            <AccountCompletion />
            <RecentlyAccessed onOpen={openWorkspace} />
            <FavoriteBusinesses onOpen={openWorkspace} />
            <ActivityTimeline compact />
            <SupportWidget />
          </div>
        </div>

        {/* Desktop download strip (web only) */}
        {!runtime.isDesktop && (
          <section className="mt-8 overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#0a1128]">Take Zapeera with you</h3>
                  <p className="text-[13px] text-[#8c95b0]">Download the desktop app for offline business management and automatic sync.</p>
                </div>
              </div>
              <Button onClick={() => navigate("/downloads")} className="h-10 shrink-0 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-md">
                Download Desktop App
              </Button>
            </div>
          </section>
        )}
      </main>

      {/* Create business dialog */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-[560px] gap-0 overflow-y-auto rounded-[28px] border border-[rgba(15,23,60,0.06)] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)] [&>button]:hidden">
          <DialogHeader className="shrink-0 space-y-0 p-8 pb-0 text-left">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Create New Business</DialogTitle>
                <p className="mt-1 text-sm text-[#8c95b0]">Fill in the details to create your new business.</p>
              </div>
              <button
                type="button"
                onClick={handleFormCancel}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[rgba(15,23,60,0.06)] text-[#8c95b0] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                aria-label="Close"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            </div>
          </DialogHeader>

          <form onSubmit={handleFormSubmit}>
            <div className="flex flex-col gap-5 px-8 py-7">
              <div className="space-y-2">
                <Label htmlFor="zv3-name" className="text-sm font-semibold text-[#0a1128]">
                  Business Name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="zv3-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter business name"
                  className={cn("h-12 rounded-[10px] border-[1.5px] text-[15px]", formErrors.name && "border-red-500")}
                />
                {formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="zv3-desc" className="text-sm font-semibold text-[#0a1128]">
                  Description
                </Label>
                <Textarea
                  id="zv3-desc"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter business description"
                  rows={3}
                  className="min-h-[90px] resize-none rounded-[10px] border-[1.5px] text-[15px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zv3-business-type" className="text-sm font-semibold text-[#0a1128]">
                  Business Type <span className="text-red-600">*</span>
                </Label>
                <Select value={formData.businessType} onValueChange={(value) => setFormData({ ...formData, businessType: value })}>
                  <SelectTrigger id="zv3-business-type" className="h-12 w-full rounded-[10px] border-[1.5px] px-3 text-[15px]">
                    <SelectValue placeholder="Select business type" />
                  </SelectTrigger>
                  <SelectContent>
                    {businessTypes.length > 0 ? (
                      businessTypes.map((type) => (
                        <SelectItem key={type.name} value={type.name}>
                          {type.name.charAt(0).toUpperCase() + type.name.slice(1).toLowerCase().replace(/_/g, " ")}
                        </SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="PHARMACY">Pharmacy</SelectItem>
                        <SelectItem value="DEPARTMENTAL_STORE">Departmental Store</SelectItem>
                        <SelectItem value="RETAIL_STORE">Retail Store</SelectItem>
                        <SelectItem value="HOTEL">Hotel</SelectItem>
                        <SelectItem value="CLINIC">Clinic</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="zv3-addr" className="text-sm font-semibold text-[#0a1128]">
                  Address
                </Label>
                <Input
                  id="zv3-addr"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Enter business address"
                  className="h-12 rounded-[10px] border-[1.5px] text-[15px]"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="zv3-phone" className="text-sm font-semibold text-[#0a1128]">
                    Phone Number <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="zv3-phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g., +923001234567"
                    className={cn("h-12 rounded-[10px] border-[1.5px] text-[15px]", formErrors.phone && "border-red-500")}
                  />
                  {formErrors.phone && <p className="text-xs text-red-500">{formErrors.phone}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zv3-email" className="text-sm font-semibold text-[#0a1128]">
                    Email Address <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="zv3-email"
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="e.g., business@example.com"
                    className={cn("h-12 rounded-[10px] border-[1.5px] text-[15px]", formErrors.email && "border-red-500")}
                  />
                  {formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-3 border-0 px-8 pb-7 pt-0 sm:justify-end">
              <Button type="button" variant="outline" onClick={handleFormCancel} className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7] hover:text-[#0a1128]">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95">
                {isSubmitting ? "Creating…" : "Create Business"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ZapeeraLayout>
  );
};

export default ZapeeraDashboard;
