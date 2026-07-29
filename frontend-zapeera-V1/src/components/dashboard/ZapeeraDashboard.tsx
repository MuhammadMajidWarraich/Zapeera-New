import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { config } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart3,
  Clock,
  DollarSign,
  Home,
  LogOut,
  Mail,
  MessageCircle,
  Phone,
  Play,
  Plus,
  TrendingUp,
  Users,
  Check,
  CircleDot,
  Lock,
  X,
} from "lucide-react";
import ZapeeraLayout from "@/components/layout/ZapeeraLayout";
import OnboardingTour, { OnboardingStep } from "@/components/OnboardingTour";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ZapeeraDashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { allCompanies } = useAdmin();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [businessTypes, setBusinessTypes] = useState<any[]>([]);
  const [greeting, setGreeting] = useState('');

  // Update greeting based on time of day
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      setGreeting('Good morning');
    } else if (hour < 18) {
      setGreeting('Good afternoon');
    } else {
      setGreeting('Good evening');
    }
  }, []);
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

  // Fetch business types
  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const res = await apiService.getBusinessTypes();
        if (res.success && res.data) {
          setBusinessTypes(res.data);
          // Set default type to first available business type
          if (res.data.length > 0) {
            setFormData(prev => ({ ...prev, businessType: res.data[0].name }));
          }
        }
      } catch (error) {
        console.error("Failed to fetch business types:", error);
      }
    };
    fetchTypes();
  }, []);

  const currentUser = user as {
    id: string;
    name: string;
    username?: string;
    email?: string;
    role: string;
    isActive?: boolean;
  } | null;

  const activeCompanyCount = allCompanies?.length ?? 0;

  const dashboardSteps: OnboardingStep[] = [
    {
      target: ".sidebar-menu",
      content: (
        <div>
          <h3 className="mb-2 text-lg font-semibold">Navigation Menu</h3>
          <p>
            This is your main menu — access all modules from here. You can navigate to different sections like POS, Reports, and
            Settings.
          </p>
        </div>
      ),
      title: "Welcome to Zapeera! 👋",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: ".zv3-hero-cta",
      content: (
        <div>
          <h3 className="mb-2 text-lg font-semibold">Create your business</h3>
          <p>Start by registering your pharmacy or business profile to unlock branches, inventory, and POS.</p>
        </div>
      ),
      title: "Get started",
      placement: "bottom",
    },
    {
      target: ".zv3-bento-grid",
      content: (
        <div>
          <h3 className="mb-2 text-lg font-semibold">Key features</h3>
          <p>Explore what Zapeera can do for your business — multi-location, analytics, live ops, and permissions.</p>
        </div>
      ),
      title: "Discover features",
      placement: "top",
    },
    {
      target: ".zv3-support-banner",
      content: (
        <div>
          <h3 className="mb-2 text-lg font-semibold">Need help?</h3>
          <p>Use chat or schedule a demo — our team can walk you through setup and your first sale.</p>
        </div>
      ),
      title: "Get support",
      placement: "top",
    },
  ];

  const handleCreateBusiness = () => {
    setIsCreateModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormErrors({});

    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = "Business name is required";
    } else if (formData.name.trim().length < 2) {
      errors.name = "Business name must be at least 2 characters";
    }

    if (!formData.email.trim()) {
      errors.email = "Email is required";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        errors.email = "Please enter a valid email address";
      }
    }

    if (!formData.phone.trim()) {
      errors.phone = "Phone number is required";
    } else {
      const cleanPhone = formData.phone.replace(/[\s\-()]/g, "");
      const phoneRegex = /^(\+?[0-9]{10,15})$/;
      if (!phoneRegex.test(cleanPhone)) {
        errors.phone = "Please enter a valid phone number (10-15 digits)";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setIsSubmitting(false);
      toast({
        title: "Validation Error",
        description: "Please fill all required fields correctly",
        variant: "destructive",
      });
      return;
    }

    try {
      // Business creation limits removed: each subscription now supports unlimited businesses.
      // Limits only apply to resources within each business (branches, counters, etc).

      const response = await apiService.createCompany(formData as any);
      if (response.success) {
        toast({
          title: "Success",
          description: "Business created successfully!",
        });

        setFormData({
          name: "",
          businessType: "PHARMACY",
          description: "",
          address: "",
          phone: "",
          email: "",
        });
        setIsCreateModalOpen(false);

        navigate("/zapeera/my-businesses");
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to create business",
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to create business";
      toast({
        title: "Error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormCancel = () => {
    setIsCreateModalOpen(false);
    setFormData({
      name: "",
      businessType: "PHARMACY",
      description: "",
      address: "",
      phone: "",
      email: "",
    });
    setFormErrors({});
  };

  const handleChatSupport = () => {
    const phoneNumber = config.support.phoneNumber;
    const message = "Hello! I need support with Zapeera.";
    const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const handleScheduleDemo = () => {
    window.open(config.support.contactUrl, "_blank");
  };

  const handleContactSupport = () => {
    const phoneNumber = config.support.phoneNumber;
    const message = `Hello! My account is disabled and I need it to be activated. My username: ${currentUser?.username || "N/A"}. Please help me activate my account.`;
    const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const handleEmailSupport = () => {
    const subject = "Account Activation Request - Zapeera";
    const body = `Hello,

My account is currently disabled and I need it to be activated.

Account Details:
- Username: ${currentUser?.username || "N/A"}
- Email: ${currentUser?.email || "N/A"}
- Name: ${currentUser?.name || "N/A"}

Please help me activate my account so I can access the system.

Best regards,
${currentUser?.name || "User"}`;

    const emailUrl = `mailto:${config.support.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(emailUrl, "_blank");
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    setIsLoggingOut(false);
  };

  const canCreateBusiness = Boolean(currentUser);

  if (currentUser && currentUser.isActive === false) {
    return (
      <ZapeeraLayout>
        <div className="px-11 pb-14 pt-9">
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
                  <span className="text-lg font-semibold">{config.support.phoneNumber}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                  onClick={handleContactSupport}
                  className="h-12 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] font-semibold text-white shadow-md hover:opacity-95"
                >
                  <MessageCircle className="mr-2 h-5 w-5" />
                  WhatsApp
                </Button>
                <Button onClick={handleEmailSupport} variant="outline" className="h-12 border-[rgba(15,23,60,0.12)] font-semibold">
                  <Mail className="mr-2 h-5 w-5" />
                  Email
                </Button>
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
      {currentUser && (
        <OnboardingTour
          steps={dashboardSteps}
          storageKey={`zapeera-dashboard-tour-${currentUser.id}`}
          onComplete={() => {}}
          onSkip={() => {}}
        />
      )}

      <div className="px-11 pb-14 pt-9">
        <section className="zv3-animate-hero mb-9 flex min-h-[280px] overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_40px_rgba(0,0,0,0.05)]">
          <div className="relative z-[2] flex flex-1 flex-col justify-center px-8 py-10 sm:px-12 sm:py-12">
            <div className="zv3-animate-chip zv3-delay-1 mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] py-1.5 pl-2 pr-4 text-xs font-semibold text-[#1a52c5]">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce]">
                <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
              </span>
              {greeting}, {currentUser?.name || 'User'}
            </div>
            <h1 className="zv3-animate-fadeUp zv3-delay-1 mb-3 text-3xl font-extrabold leading-tight tracking-tight text-[#0a1128] sm:text-[38px]">
              Welcome to <span className="bg-gradient-to-br from-[#1a52c5] via-[#1f8ac8] to-[#28c2ce] bg-clip-text text-transparent">Zapeera</span> 👋
            </h1>
            <p className="zv3-animate-fadeUp zv3-delay-2 mb-8 max-w-[400px] text-[15px] leading-relaxed text-[#4a5578]">
              Manage all your businesses, branches, sales, and staff — all in one place. Get started in seconds.
            </p>
            <div className="zv3-animate-fadeUp zv3-delay-3 zv3-hero-cta flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={handleCreateBusiness}
                disabled={!canCreateBusiness}
                className={cn(
                  "inline-flex items-center gap-2.5 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_4px_24px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(26,82,197,0.35),0_0_0_4px_rgba(26,82,197,0.08)] disabled:pointer-events-none disabled:opacity-50"
                )}
              >
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
                Create Your Business
              </button>
              <button
                type="button"
                onClick={handleScheduleDemo}
                className="inline-flex items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-transparent px-6 py-3.5 text-sm font-medium text-[#4a5578] transition-all hover:border-black/10 hover:bg-black/[0.02] hover:text-[#0a1128]"
              >
                <Play className="h-4 w-4" />
                Watch Demo
              </button>
            </div>
          </div>

          <div className="relative hidden w-full max-w-[380px] shrink-0 overflow-hidden bg-gradient-to-br from-[#1a52c5]/[0.03] to-[#28c2ce]/[0.04] lg:block">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 30% 80%, rgba(26,82,197,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(40,194,206,0.08) 0%, transparent 50%)",
              }}
            />
            <div className="absolute bottom-10 left-10 flex h-40 items-end gap-2.5">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="zv3-vis-bar" />
              ))}
            </div>

            <div
              className="zv3-glass-card absolute right-6 top-7 z-[1] flex items-center gap-3.5 rounded-2xl border border-white/70 bg-white/85 px-5 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-md"
              style={{ animationDelay: "0.5s" }}
            >
              <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10">
                <DollarSign className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
              </div>
              <div>
                <div className="text-[11px] font-medium tracking-wide text-[#8c95b0]">Total Revenue</div>
                <div className="text-xl font-extrabold tracking-tight text-[#0a1128]">$24.8k</div>
              </div>
            </div>

            <div
              className="zv3-glass-card absolute left-4 top-[100px] z-[1] flex items-center gap-2.5 rounded-2xl border border-white/70 bg-white/85 px-[18px] py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-md"
              style={{ animationDelay: "0.65s" }}
            >
              <div className="zv3-spark flex h-6 items-end gap-0.5">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <span key={i} />
                ))}
              </div>
              <span className="text-[11px] font-semibold text-[#4a5578]">Sales Trend</span>
            </div>

            <div
              className="zv3-glass-card absolute bottom-7 right-7 z-[1] flex items-center gap-2 rounded-full border border-white/70 bg-white/85 px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-md"
              style={{ animationDelay: "0.8s" }}
            >
              <span className="flex items-center gap-1 text-[13px] font-bold text-green-600">
                <TrendingUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                +12.5%
              </span>
              <span className="text-[11px] font-medium text-[#8c95b0]">this month</span>
            </div>
          </div>
        </section>

        <div className="zv3-support-banner help-section relative mb-7 flex flex-col gap-4 overflow-hidden rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-7 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="absolute bottom-0 left-0 top-0 w-1 rounded-l bg-gradient-to-b from-[#1a52c5] to-[#28c2ce]"
            aria-hidden
          />
          <div className="flex items-center gap-4 pl-2">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5]/[0.08] to-[#28c2ce]/[0.06]">
              <MessageCircle className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
            </div>
            <div>
              <h4 className="text-sm font-bold tracking-tight text-[#0a1128]">Need help getting started?</h4>
              <p className="text-xs text-[#8c95b0]">Our team is ready to walk you through everything — from setup to your first sale.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 sm:pl-4">
            <button
              type="button"
              onClick={handleChatSupport}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-[18px] py-2.5 text-[13px] font-semibold text-white shadow-[0_3px_14px_rgba(26,82,197,0.2)] transition-all hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(26,82,197,0.3)]"
            >
              <MessageCircle className="h-[15px] w-[15px]" strokeWidth={2} />
              Chat with Support
            </button>
            <button
              type="button"
              onClick={handleScheduleDemo}
              className="inline-flex items-center gap-2 rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent px-[18px] py-2.5 text-[13px] font-semibold text-[#4a5578] transition-all hover:border-black/10 hover:bg-black/[0.02] hover:text-[#0a1128]"
            >
              <CalendarDaysIcon />
              Schedule a Demo
            </button>
          </div>
        </div>

        <div className="zv3-section-head mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Everything you need to grow</h2>
            <p className="text-[13px] text-[#8c95b0]">Powerful tools designed for modern pharmacy operations</p>
          </div>
        </div>

        <div className="zv3-bento-grid feature-cards grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-4">
          <BentoCard
            icon={<Home className="h-6 w-6 text-white" strokeWidth={2} />}
            iconClass="bg-gradient-to-br from-[#1a52c5] to-[#2d6ed9] shadow-[0_4px_16px_rgba(26,82,197,0.25)]"
            title="Multiple Businesses"
            description="Manage all your businesses from a single account. Switch between branches instantly."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1a52c5]/[0.08] bg-[#1a52c5]/[0.06] px-3 py-1 text-[11px] font-semibold text-[#1a52c5]">
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                  {activeCompanyCount} Active
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#28c2ce]/10 bg-[#28c2ce]/[0.06] px-3 py-1 text-[11px] font-semibold text-[#1aa8b3]">
                  <Plus className="h-3 w-3" />
                  Add New
                </span>
              </div>
            }
          />
          <BentoCard
            icon={<BarChart3 className="h-6 w-6 text-white" strokeWidth={2} />}
            iconClass="bg-gradient-to-br from-[#28c2ce] to-[#20a8b3] shadow-[0_4px_16px_rgba(40,194,206,0.25)]"
            title="Smart Analytics"
            description="Get insights into your sales, inventory, and performance metrics in real-time."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <div className="zv3-bento-visual-bar flex h-7 items-end gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} />
                  ))}
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green-600/10 bg-green-600/[0.06] px-3 py-1 text-[11px] font-semibold text-green-600">
                  <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
                  +18.2%
                </span>
              </div>
            }
          />
          <BentoCard
            icon={<Clock className="h-6 w-6 text-white" strokeWidth={2} />}
            iconClass="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] shadow-[0_4px_16px_rgba(26,82,197,0.2)]"
            title="Real-time Operations"
            description="Track sales and inventory in real-time across all your locations."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#1a52c5]" />
                  <span className="h-2 w-2 rounded-full bg-[#1f8ac8]" />
                  <span className="h-2 w-2 rounded-full bg-[#28c2ce]" />
                  <span className="h-2 w-2 rounded-full bg-[#28c2ce]/40" />
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1a52c5]/[0.08] bg-[#1a52c5]/[0.06] px-3 py-1 text-[11px] font-semibold text-[#1a52c5]">
                  <CircleDot className="h-3 w-3" />
                  Live
                </span>
              </div>
            }
          />
          <BentoCard
            icon={<Users className="h-6 w-6 text-white" strokeWidth={2} />}
            iconClass="bg-gradient-to-br from-[#0f3d8f] to-[#1a52c5] shadow-[0_4px_16px_rgba(26,82,197,0.2)]"
            title="Role-based Access"
            description="Control what each staff member can see and do with granular permissions."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex">
                  {["A", "B", "C"].map((l, i) => (
                    <span
                      key={l}
                      className={cn(
                        "grid h-7 w-7 place-items-center rounded-full border-2 border-white text-[10px] font-bold text-white",
                        i === 0 && "z-[4] bg-[#1a52c5]",
                        i === 1 && "-ml-2 z-[3] bg-[#1f8ac8]",
                        i === 2 && "-ml-2 z-[2] bg-[#28c2ce]"
                      )}
                    >
                      {l}
                    </span>
                  ))}
                  <span className="-ml-2 z-[1] grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-[#8c95b0] text-[10px] font-bold text-white">
                    +2
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#28c2ce]/10 bg-[#28c2ce]/[0.06] px-3 py-1 text-[11px] font-semibold text-[#1aa8b3]">
                  <Lock className="h-3 w-3" />
                  Secured
                </span>
              </div>
            }
          />
        </div>
      </div>

      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-[560px] gap-0 overflow-y-scroll rounded-[28px] border border-[rgba(15,23,60,0.06)] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:max-w-[560px] [&>button]:hidden">
          <DialogHeader className="space-y-0 p-8 pb-0 text-left shrink-0">
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
            <div className="flex flex-col gap-5 px-8 py-7 min-h-0">
              <div className="space-y-2">
                <Label htmlFor="zv3-name" className="text-sm font-semibold text-[#0a1128]">
                  Business Name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="zv3-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter business name"
                  className={cn(
                    "h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8",
                    formErrors.name && "border-red-500"
                  )}
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
                  className="min-h-[90px] rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8 resize-none"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zv3-business-type" className="text-sm font-semibold text-[#0a1128]">
                  Business Type <span className="text-red-600">*</span>
                </Label>
                <Select
                  value={formData.businessType}
                  onValueChange={(value) => setFormData({ ...formData, businessType: value })}
                >
                  <SelectTrigger id="zv3-business-type" className="h-12 w-full rounded-[10px] border-[1.5px] border-input bg-background px-3 text-[15px] focus:ring-[#1a52c5]/8">
                    <SelectValue placeholder="Select business type" />
                  </SelectTrigger>
                  <SelectContent>
                    {businessTypes.length > 0 ? (
                      businessTypes.map((type) => (
                        <SelectItem key={type.name} value={type.name}>
                          {type.name.charAt(0).toUpperCase() + type.name.slice(1).toLowerCase().replace(/_/g, ' ')}
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
                  className="h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8"
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
                    className={cn(
                      "h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-[#1a52c5]/8",
                      formErrors.phone && "border-red-500"
                    )}
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
                    className={cn(
                      "zv3-modal-email-input h-12 rounded-[10px] border-[1.5px] text-[15px] focus-visible:border-[#1a52c5] focus-visible:ring-0 focus-visible:ring-offset-0",
                      formErrors.email && "border-red-500"
                    )}
                  />
                  {formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-3 border-0 px-8 pb-7 pt-0 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleFormCancel}
                className="h-11 rounded-[10px] border-[rgba(15,23,60,0.06)] px-7 font-semibold text-[#4a5578] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-11 rounded-[10px] border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
              >
                {isSubmitting ? "Creating…" : "Create Business"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ZapeeraLayout>
  );
};

function CalendarDaysIcon() {
  return (
    <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function BentoCard({
  icon,
  iconClass,
  title,
  description,
  footer,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  description: string;
  footer: React.ReactNode;
}) {
  return (
    <div className="group relative flex cursor-pointer flex-col gap-[18px] overflow-hidden rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white p-7 transition-all duration-[400ms] hover:-translate-y-1 hover:border-[#1a52c5]/12 hover:shadow-[0_16px_48px_rgba(0,0,0,0.07)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: "linear-gradient(135deg, rgba(26,82,197,0.02), rgba(40,194,206,0.02))",
        }}
      />
      <div
        className={cn(
          "relative z-[1] grid h-[52px] w-[52px] place-items-center rounded-[14px] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-2",
          iconClass
        )}
      >
        {icon}
      </div>
      <div className="relative z-[1] flex-1">
        <h3 className="mb-2 text-[17px] font-bold tracking-tight text-[#0a1128]">{title}</h3>
        <p className="mb-4 text-sm leading-relaxed text-[#4a5578]">{description}</p>
        {footer}
      </div>
    </div>
  );
}

export default ZapeeraDashboard;
