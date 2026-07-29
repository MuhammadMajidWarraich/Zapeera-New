import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import PricingPlansSection from "@/components/subscription/PricingPlansSection";
import PaymentReceiptUpload, { PaymentReceiptUploadRef } from "@/components/subscription/PaymentReceiptUpload";
import { defaultPricingPlans, loadPricingPlans, PricingPlan, savePricingPlans, subscribeToPricingPlanChanges } from "@/lib/pricing-plans";
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Calendar,
  CreditCard,
  Download,
  Filter,
  Lock,
  Minus,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Info,
  Upload,
  Clock,
} from "lucide-react";

interface EntitlementLimits {
  maxBranches: number | null;
  maxCountersPerBranch: number | null;
  maxConcurrentUsers: number | null;
  maxConcurrentSessions?: number | null;
}

interface AccountEntitlementSummary {
  userId: string;
  planId: string;
  isSubscribed: boolean;
  plan: { id: string; name: string };
  limits: EntitlementLimits;
  usage: { activeBusinesses: number };
  remaining: { businesses: number | null };
}

interface BusinessEntitlementSummary {
  companyId: string;
  businessType: "PHARMACY" | "STORE" | "HOTEL" | "CLINIC";
  planId: string;
  plan: { id: string; name: string };
  limits: EntitlementLimits;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  isSubscribed: boolean;
  subscriptionStatus?: string | null;
  usage?: {
    activeBranches: number;
    activeUsers: number;
    totalUsers: number;
  };
}

interface UpgradePlanConfig {
  id: string;
  basePrice: number;
  includedBranchesPerBusiness: number | null;
  includedCountersPerBranch: number | null;
  extraBranchPrice: number | null;
  extraCounterPrice: number | null;
}

interface CompanyDetailsLite {
  id: string;
  name: string;
  branches?: Array<{ id: string }>;
  _count?: {
    users: number;
    employees: number;
    products: number;
  };
  usageMetrics?: {
    branchesActive: number;
    countersActive: number;
    activeConcurrentSessions: number;
    inventoryItems: number;
    inventoryBreakdown: {
      products: number;
      categories: number;
      manufacturers: number;
      suppliers: number;
      shelves: number;
      batches: number;
    };
  };
}

interface PaymentMethod {
  id: string;
  type: "card" | "bank" | "mobile";
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
  holderName: string;
}


interface PaymentHistory {
  id: string;
  amount: number;
  status: "success" | "failed" | "pending";
  method: string;
  date: string;
  invoiceNumber: string;
  description: string;
}

const billingDetails = {
  name: "Zapeera Inc.",
  addressLines: ["123 Innovation Drive, Suite 400", "San Francisco, CA 94103", "United States"],
  taxLabel: "VAT / Tax ID",
  taxId: "US-987654321",
};

const SubscriptionManagement = () => {
  const { selectedCompanyId, allCompanies } = useAdmin();
  const { businessSlug } = useParams<{ businessSlug?: string }>();
  const companyByUrlSlug = useMemo(() => {
    console.log('[SubscriptionManagement] Finding company by slug:', {
      businessSlug,
      allCompaniesCount: allCompanies?.length,
      allCompaniesSlugs: allCompanies?.map(c => ({ name: c.name, slug: c.slug, id: c.id })),
    });
    if (!businessSlug || !allCompanies) {
      console.log('[SubscriptionManagement] Early return: businessSlug or allCompanies missing');
      return null;
    }
    const found = allCompanies.find((company) => company.slug === businessSlug) || null;
    console.log('[SubscriptionManagement] Found company:', found);
    return found;
  }, [businessSlug, allCompanies]);
  const [accountEntitlement, setAccountEntitlement] = useState<AccountEntitlementSummary | null>(null);
  const [businessEntitlement, setBusinessEntitlement] = useState<BusinessEntitlementSummary | null>(null);
  const [selectedCompanyDetails, setSelectedCompanyDetails] = useState<CompanyDetailsLite | null>(null);
  const [allCompanyDetails, setAllCompanyDetails] = useState<CompanyDetailsLite[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [subscriptionSummary, setSubscriptionSummary] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [isEditCardOpen, setIsEditCardOpen] = useState(false);
  const [isBillingDetailsOpen, setIsBillingDetailsOpen] = useState(false);
  const [isEditingBilling, setIsEditingBilling] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [upgradeStep, setUpgradeStep] = useState<"plans" | "configure" | "payment" | "final">("plans");
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>(defaultPricingPlans);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annually">("monthly");
  const [annualDiscountPercent, setAnnualDiscountPercent] = useState<number>(20);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [branchesPerBusiness, setBranchesPerBusiness] = useState(1);
  const [countersPerBranch, setCountersPerBranch] = useState(1);
  const [editingCard, setEditingCard] = useState<PaymentMethod | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [billingDetailsState, setBillingDetailsState] = useState(billingDetails);
  const [billingForm, setBillingForm] = useState({
    name: "",
    addressLine1: "",
    addressLine2: "",
    addressLine3: "",
    taxId: "",
  });
  const [newCardData, setNewCardData] = useState({
    type: "card" as "card" | "bank" | "mobile",
    last4: "",
    brand: "",
    expiryMonth: 0,
    expiryYear: 0,
    holderName: "",
    isDefault: false,
  });
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDetails, setCancelDetails] = useState("");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const paymentReceiptRef = useRef<PaymentReceiptUploadRef>(null);

  const loadSubscriptionData = useCallback(async () => {
    console.log('[SubscriptionManagement] loadSubscriptionData called!');
    (window as any).__lastLoadAttempt = new Date().toISOString();
    setIsLoading(true);
    try {
      const effectiveCompanyId = companyByUrlSlug?.id || selectedCompanyId || allCompanies?.[0]?.id || null;
      console.log('[SubscriptionManagement] Loading subscription data:', {
        businessSlug,
        companyByUrlSlug: companyByUrlSlug?.id,
        selectedCompanyId,
        allCompaniesCount: allCompanies?.length,
        effectiveCompanyId,
      });

      const [paymentMethodsResponse, billingHistoryResponse, subscriptionResponse] = await Promise.all([
        apiService.getPaymentMethods(),
        apiService.getBillingHistory(),
        effectiveCompanyId ? apiService.getBusinessEntitlements(effectiveCompanyId) : Promise.resolve({ success: true, data: null as any }),
      ]);

      setAccountEntitlement(null); // Explicitly remove account entitlements

      if (paymentMethodsResponse.success) {
        setPaymentMethods(paymentMethodsResponse.data);
      }

      if (billingHistoryResponse.success) {
        setPaymentHistory(billingHistoryResponse.data);
      }

      setSubscriptionSummary(subscriptionResponse.success ? subscriptionResponse.data : null);

      if (effectiveCompanyId) {
        console.log('[SubscriptionManagement] Calling getBusinessEntitlements for', effectiveCompanyId);
        const [businessEntitlementResponse, companyResponse] = await Promise.all([
          apiService.getBusinessEntitlements(effectiveCompanyId),
          apiService.getCompany(effectiveCompanyId),
        ]);

        // Store full response in window for debugging
        (window as any).__subscriptionAPIResponse = {
          businessEntitlementResponse,
          companyResponse,
        };

        console.log('[SubscriptionManagement] API responses:', {
          businessEntitlementSuccess: businessEntitlementResponse.success,
          businessEntitlementData: businessEntitlementResponse.data,
          businessEntitlementError: businessEntitlementResponse.error || (businessEntitlementResponse as any).message,
          companyResponseSuccess: companyResponse.success,
        });

        if (businessEntitlementResponse.success && businessEntitlementResponse.data) {
          console.log('[SubscriptionManagement] Setting businessEntitlement with isSubscribed:', businessEntitlementResponse.data.isSubscribed);
          setBusinessEntitlement(businessEntitlementResponse.data as BusinessEntitlementSummary);
          if (companyResponse.success && companyResponse.data) {
            setSelectedCompanyDetails(companyResponse.data as CompanyDetailsLite);
          } else {
            setSelectedCompanyDetails(null);
          }
        } else {
          console.log('[SubscriptionManagement] API call failed, setting businessEntitlement to null');
          setBusinessEntitlement(null);
          setSelectedCompanyDetails(null);
        }
      }
    } catch (error) {
      console.error("Error loading subscription data:", error);
      (window as any).__lastLoadError = String(error);
      toast({
        title: "Error",
        description: "Failed to load subscription data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, selectedCompanyId, allCompanies?.[0]?.id, companyByUrlSlug?.id]);

  useEffect(() => {
    loadSubscriptionData();
  }, [loadSubscriptionData]);

  // Listen for payment proof status changes to refresh subscription data
  useEffect(() => {
    const handlePaymentProofStatusChange = (event: CustomEvent) => {
      console.log('[SubscriptionManagement] Payment proof status changed, refreshing subscription data');
      loadSubscriptionData();
    };

    window.addEventListener('paymentProofStatusChanged', handlePaymentProofStatusChange as EventListener);
    return () => window.removeEventListener('paymentProofStatusChanged', handlePaymentProofStatusChange as EventListener);
  }, [loadSubscriptionData]);

  useEffect(() => {
    if (!allCompanies || allCompanies.length === 0) {
      setAllCompanyDetails([]);
      return;
    }

    const loadAllCompanyDetails = async () => {
      try {
        const results = await Promise.allSettled(
          allCompanies.map((company) => apiService.getCompany(company.id))
        );

        const loadedDetails = results.reduce<CompanyDetailsLite[]>((acc, result) => {
          if (result.status === "fulfilled" && result.value.success && result.value.data) {
            acc.push(result.value.data as CompanyDetailsLite);
          }
          return acc;
        }, []);

        setAllCompanyDetails(loadedDetails);
      } catch (error) {
        console.error("Failed to load company details for usage totals:", error);
      }
    };

    loadAllCompanyDetails();
  }, [allCompanies]);

  useEffect(() => {
    const plans = loadPricingPlans();
    setPricingPlans(plans);

    const hydrateAnnualDiscount = async () => {
      try {
        const response = await apiService.getAnnualDiscount();
        if (response.success && response.data && typeof (response.data as any).percent === 'number') {
          setAnnualDiscountPercent(Math.max(0, Math.min(100, Math.floor((response.data as any).percent))));
        }
      } catch (error) {
        console.error('Failed to load annual discount from server:', error);
      }
    };

    const hydrateFromServer = async () => {
      try {
        const response = await apiService.getPricingPlans();
        if (response.success && Array.isArray(response.data) && response.data.length > 0) {
          // Deduplicate by plan ID (keep first occurrence)
          const seenIds = new Set<string>();
          const uniquePlans = (response.data as PricingPlan[]).filter((plan) => {
            if (seenIds.has(plan.id)) return false;
            seenIds.add(plan.id);
            return true;
          });
          setPricingPlans(uniquePlans);
          savePricingPlans(uniquePlans);
        }
      } catch (error) {
        console.error("Failed to load pricing plans from server:", error);
      }
    };

    hydrateFromServer();
    hydrateAnnualDiscount();

    return subscribeToPricingPlanChanges((updatedPlans) => {
      setPricingPlans((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(updatedPlans)) {
          return prev;
        }
        return updatedPlans;
      });
    });
  }, []);

  const refreshPricingPlansFromServer = async () => {
    try {
      const response = await apiService.getPricingPlans();
      if (response.success && Array.isArray(response.data) && response.data.length > 0) {
        // Deduplicate by plan ID (keep first occurrence)
        const seenIds = new Set<string>();
        const uniquePlans = (response.data as PricingPlan[]).filter((plan) => {
          if (seenIds.has(plan.id)) return false;
          seenIds.add(plan.id);
          return true;
        });
        setPricingPlans(uniquePlans);
        savePricingPlans(uniquePlans);
      }
    } catch (error) {
      console.error("Failed to refresh pricing plans from server:", error);
    }
  };

  const buildPlanConfig = (plan: PricingPlan): UpgradePlanConfig => {
    const pricingModel = plan.pricingModel;
    const includedBranchesPerBusiness = pricingModel && Object.prototype.hasOwnProperty.call(pricingModel, 'includedBranchesPerBusiness')
      ? pricingModel.includedBranchesPerBusiness
      : plan.limits?.maxBranches ?? 1;
    const includedCountersPerBranch = pricingModel && Object.prototype.hasOwnProperty.call(pricingModel, 'includedCountersPerBranch')
      ? pricingModel.includedCountersPerBranch
      : plan.limits?.maxCountersPerBranch ?? 1;

    return {
      id: plan.id,
      basePrice: plan.price || 0,
      includedBranchesPerBusiness,
      includedCountersPerBranch,
      extraBranchPrice: pricingModel?.extraBranchPrice ?? null,
      extraCounterPrice: pricingModel?.extraCounterPrice ?? null,
    };
  };

  const upgradePlans = useMemo<PricingPlan[]>(() => {
    const order = new Map<string, number>([
      ["single-trial", 0],
      ["single-starter", 1],
      ["single-growth", 2],
      ["single-scale", 3],
    ]);

    const base = [...pricingPlans];
    const eligible = businessEntitlement ? base.filter((plan) => plan.id !== 'single-trial') : base;

    return eligible.sort((a, b) => {
      const ao = order.get(a.id) ?? 999;
      const bo = order.get(b.id) ?? 999;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [pricingPlans, businessEntitlement]);

  useEffect(() => {
    if (!upgradePlans.length) return;
    if (!selectedPlanId || !upgradePlans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(upgradePlans[0].id);
    }
  }, [upgradePlans, selectedPlanId]);

  const selectedPlanConfig = useMemo<UpgradePlanConfig | null>(() => {
    const plan = upgradePlans.find((entry) => entry.id === selectedPlanId) || upgradePlans[0];
    return plan ? buildPlanConfig(plan) : null;
  }, [upgradePlans, selectedPlanId]);

  const selectedPlan = useMemo(
    () => upgradePlans.find((plan) => plan.id === selectedPlanId) || upgradePlans[0] || null,
    [upgradePlans, selectedPlanId]
  );

  const applyPlanDefaults = (planConfig: UpgradePlanConfig | null) => {
    if (!planConfig) return;
    const defaultBranches =
      planConfig.includedBranchesPerBusiness === null ? 1 : Math.max(1, planConfig.includedBranchesPerBusiness);
    const defaultCounters =
      planConfig.includedCountersPerBranch === null ? 1 : Math.max(1, planConfig.includedCountersPerBranch);

    setBranchesPerBusiness(defaultBranches);
    setCountersPerBranch(defaultCounters);
  };

  useEffect(() => {
    if (!isUpgradeOpen || upgradeStep !== "plans") return;
    applyPlanDefaults(selectedPlanConfig);
  }, [isUpgradeOpen, upgradeStep, selectedPlanConfig]);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return paymentHistory;
    const term = searchTerm.toLowerCase();
    return paymentHistory.filter((item) => {
      return (
        item.invoiceNumber.toLowerCase().includes(term) ||
        item.date.toLowerCase().includes(term) ||
        item.status.toLowerCase().includes(term) ||
        item.amount.toString().includes(term)
      );
    });
  }, [paymentHistory, searchTerm]);

  const handleAddPaymentMethod = async () => {
    try {
      if (!newCardData.last4 || !newCardData.brand || !newCardData.holderName || !newCardData.expiryMonth || !newCardData.expiryYear) {
        toast({
          title: "Error",
          description: "Please fill in all required fields",
          variant: "destructive",
        });
        return;
      }

      const response = await apiService.addPaymentMethod(newCardData);

      if (response.success) {
        setPaymentMethods((prev) => [...prev, response.data as PaymentMethod]);
        setNewCardData({
          type: "card",
          last4: "",
          brand: "",
          expiryMonth: 0,
          expiryYear: 0,
          holderName: "",
          isDefault: false,
        });
        setIsAddCardOpen(false);
        toast({
          title: "Success",
          description: "Payment method added successfully",
        });
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to add payment method",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error adding payment method:", error);
      toast({
        title: "Error",
        description: "Failed to add payment method",
        variant: "destructive",
      });
    }
  };

  const handleEditCard = (card: PaymentMethod) => {
    setEditingCard(card);
    setNewCardData({
      type: card.type,
      last4: card.last4,
      brand: card.brand,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      holderName: card.holderName,
      isDefault: card.isDefault,
    });
    setIsEditCardOpen(true);
  };

  const handleUpdateCard = async () => {
    if (!editingCard) return;

    try {
      setPaymentMethods((prev) =>
        prev.map((method) => (method.id === editingCard.id ? { ...method, ...newCardData } : method))
      );

      setIsEditCardOpen(false);
      setEditingCard(null);

      toast({
        title: "Success",
        description: "Payment method updated successfully",
      });
    } catch (error) {
      console.error("Error updating payment method:", error);
      toast({
        title: "Error",
        description: "Failed to update payment method",
        variant: "destructive",
      });
    }
  };

  const handleSetDefault = async (methodId: string) => {
    try {
      const response = await apiService.setDefaultPaymentMethod(methodId);

      if (response.success) {
        setPaymentMethods((prev) =>
          prev.map((method) => ({
            ...method,
            isDefault: method.id === methodId,
          }))
        );
        toast({
          title: "Success",
          description: "Default payment method updated",
        });
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to update default payment method",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error setting default payment method:", error);
      toast({
        title: "Error",
        description: "Failed to update default payment method",
        variant: "destructive",
      });
    }
  };

  const handleDeletePaymentMethod = async (methodId: string) => {
    try {
      const response = await apiService.deletePaymentMethod(methodId);

      if (response.success) {
        setPaymentMethods((prev) => prev.filter((method) => method.id !== methodId));
        toast({
          title: "Success",
          description: "Payment method removed",
        });
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to remove payment method",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error deleting payment method:", error);
      toast({
        title: "Error",
        description: "Failed to remove payment method",
        variant: "destructive",
      });
    }
  };

  const handleDownloadInvoice = (invoiceNumber: string) => {
    toast({
      title: "Download Invoice",
      description: `Downloading ${invoiceNumber}...`,
    });
  };

  const openAddBilling = () => {
    setIsEditingBilling(false);
    setBillingForm({
      name: "",
      addressLine1: "",
      addressLine2: "",
      addressLine3: "",
      taxId: "",
    });
    setIsBillingDetailsOpen(true);
  };

  const openEditBilling = () => {
    setIsEditingBilling(true);
    setBillingForm({
      name: billingDetailsState.name,
      addressLine1: billingDetailsState.addressLines[0] || "",
      addressLine2: billingDetailsState.addressLines[1] || "",
      addressLine3: billingDetailsState.addressLines[2] || "",
      taxId: billingDetailsState.taxId,
    });
    setIsBillingDetailsOpen(true);
  };

  const handleSaveBilling = () => {
    if (!billingForm.name.trim()) {
      toast({
        title: "Error",
        description: "Business name is required",
        variant: "destructive",
      });
      return;
    }

    const lines = [billingForm.addressLine1, billingForm.addressLine2, billingForm.addressLine3]
      .map((line) => line.trim())
      .filter(Boolean);

    setBillingDetailsState({
      ...billingDetailsState,
      name: billingForm.name.trim(),
      addressLines: lines.length ? lines : billingDetailsState.addressLines,
      taxId: billingForm.taxId.trim() || billingDetailsState.taxId,
    });

    setIsBillingDetailsOpen(false);
    toast({
      title: "Success",
      description: isEditingBilling ? "Billing details updated" : "Billing details added",
    });
  };

  const handleDeleteBilling = () => {
    setBillingDetailsState({
      ...billingDetailsState,
      name: "",
      addressLines: [],
      taxId: "",
    });
    toast({
      title: "Billing details removed",
      description: "You can add them again anytime.",
    });
  };

  const effectiveCompanyId = companyByUrlSlug?.id || selectedCompanyId || (businessSlug ? null : allCompanies?.[0]?.id) || null;
  const currentPlan = pricingPlans.find((plan) => plan.id === businessEntitlement?.planId);
  const hasActiveSubscription = Boolean(effectiveCompanyId && businessEntitlement?.isSubscribed);
  
  // Debug logging  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__subscriptionDebug = {
        businessSlug,
        companyByUrlSlugId: companyByUrlSlug?.id,
        companyByUrlSlugName: companyByUrlSlug?.name,
        selectedCompanyId,
        allCompaniesCount: allCompanies?.length,
        effectiveCompanyId,
        businessEntitlementExists: !!businessEntitlement,
        businessEntitlementIsSubscribed: businessEntitlement?.isSubscribed,
        businessEntitlementFull: businessEntitlement,
        hasActiveSubscription,
        isLoading,
      };
      console.log('[SubscriptionManagement] Debug state:', window.__subscriptionDebug);
    }
  }, [effectiveCompanyId, businessEntitlement, businessSlug, companyByUrlSlug, selectedCompanyId, allCompanies, isLoading]);

  const subscriptionStatus = businessEntitlement?.subscriptionStatus?.toString().toLowerCase() ?? '';
  const isPendingApproval = !hasActiveSubscription && Boolean(subscriptionStatus) && [
    'pending',
    'pending_payment',
    'pending_payment_approval',
    'payment_pending_approval',
    'payment approval pending',
    'awaiting approval',
    'waiting for approval',
  ].includes(subscriptionStatus);
  const isExpiredSubscription = !hasActiveSubscription && subscriptionStatus?.toString().toLowerCase() === 'expired';
  const isGraceSubscription = !hasActiveSubscription && subscriptionStatus?.toString().toLowerCase() === 'grace';
  const planName = hasActiveSubscription
    ? (businessEntitlement?.plan?.name || currentPlan?.name || "Current Plan")
    : isPendingApproval
      ? (businessEntitlement?.plan?.name || currentPlan?.name || "Pending Approval")
      : isExpiredSubscription
        ? (businessEntitlement?.plan?.name || currentPlan?.name || "Expired Plan")
        : isGraceSubscription
          ? (businessEntitlement?.plan?.name || currentPlan?.name || "Grace Period")
          : "No Active Subscription";
  const statusLabel = hasActiveSubscription
    ? "ACTIVE"
    : isPendingApproval
      ? "PENDING APPROVAL"
      : isExpiredSubscription
        ? "EXPIRED"
        : isGraceSubscription
          ? "GRACE"
          : "NOT SUBSCRIBED";
  const statusBadgeClass = hasActiveSubscription
    ? "border-green-200 bg-green-100 text-green-700"
    : isPendingApproval
      ? "border-amber-200 bg-amber-100 text-amber-700"
      : isExpiredSubscription
        ? "border-rose-200 bg-rose-100 text-rose-700"
        : isGraceSubscription
          ? "border-amber-200 bg-amber-100 text-amber-700"
          : "border-slate-200 bg-slate-100 text-slate-600";
  const currentPrice = currentPlan?.price ?? 0;
  const currentPriceUnit = currentPlan?.priceUnit ?? "per month";
  const renewText = hasActiveSubscription
    ? "Renews monthly"
    : isPendingApproval
      ? "Pending admin approval"
      : isExpiredSubscription
        ? "Renew your subscription to restore access"
        : isGraceSubscription
          ? "Renew now to restore access during grace period"
          : "No subscription renewal date yet";
  const currentBillingText = hasActiveSubscription
    ? `PKR ${currentPrice.toLocaleString()} / ${currentPriceUnit}`
    : isPendingApproval
      ? currentPlan
        ? `Pending approval for PKR ${currentPrice.toLocaleString()} / ${currentPriceUnit}`
        : "Pending approval"
      : isExpiredSubscription
        ? currentPlan
          ? `Expired ${currentPlan.name} plan`
          : "Subscription expired"
        : isGraceSubscription
          ? currentPlan
            ? `Grace period for ${currentPlan.name}`
            : "Grace period active"
          : "No active billing";
  const expiryDateText = businessEntitlement?.currentPeriodEnd
    ? `Expires on ${new Date(businessEntitlement.currentPeriodEnd).toLocaleDateString()}`
    : (businessEntitlement?.trialEndsAt
      ? `Expires on ${new Date(businessEntitlement.trialEndsAt).toLocaleDateString()}`
      : null);

  const remainingDays = (() => {
    const endDate = businessEntitlement?.currentPeriodEnd
      ? new Date(businessEntitlement.currentPeriodEnd)
      : businessEntitlement?.trialEndsAt
        ? new Date(businessEntitlement.trialEndsAt)
        : null;
    if (!endDate) return null;
    const now = new Date();
    const diffMs = endDate.getTime() - now.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return days;
  })();

  const remainingDaysText = remainingDays !== null
    ? remainingDays <= 0
      ? 'Expired'
      : remainingDays === 1
        ? '1 day remaining'
        : `${remainingDays} days remaining`
    : null;

  const usageLimits = useMemo(() => {
    if (!hasActiveSubscription || !businessEntitlement) return [];
    const limits = businessEntitlement.limits;
    const companyDetailsById = new Map(allCompanyDetails.map((details) => [details.id, details]));

    // Only show usage for the currently selected/effective business
    const effectiveDetails = effectiveCompanyId ? companyDetailsById.get(effectiveCompanyId) : null;
    const effectiveCompany = allCompanies.find((c) => c.id === effectiveCompanyId);

    const branchesUsed = effectiveDetails?.usageMetrics?.branchesActive != null
      ? effectiveDetails.usageMetrics.branchesActive
      : effectiveCompany?.branches?.length ?? 0;

    const countersUsed = effectiveDetails?.usageMetrics?.countersActive ?? 0;

    const activeSessionsUsed = effectiveDetails?.usageMetrics?.activeConcurrentSessions ?? 0;

    const staffUsed = businessEntitlement?.usage?.totalUsers ?? 0;

    const inventoryItemsUsed = effectiveDetails?.usageMetrics?.inventoryItems ?? 0;

    const countersTotal = (() => {
      const perBranch = limits.maxCountersPerBranch ?? null;
      if (perBranch === null) return null;
      const branchesCapacity = limits.maxBranches === null ? branchesUsed : limits.maxBranches ?? branchesUsed;
      return Math.max(0, branchesCapacity) * Math.max(0, perBranch);
    })();

    return [
      {
        label: "Branches",
        used: branchesUsed,
        total: limits.maxBranches,
        tone: "primary" as const,
      },
      {
        label: "Counters",
        used: countersUsed,
        total: countersTotal,
        tone: "primary" as const,
        tooltip: "Counters are activated POS devices for this business. The limit is based on counters-per-branch multiplied by branch capacity.",
      },
      {
        label: "Concurrent Sessions",
        used: activeSessionsUsed,
        total: limits.maxConcurrentSessions ?? null,
        tone: "primary" as const,
        tooltip: "Concurrent sessions are the number of staff users currently logged in to this business at the same time (active within the session timeout window).",
      },
      {
        label: "Staff Members",
        used: staffUsed,
        total: limits.maxConcurrentUsers,
        tone: "primary" as const,
        tooltip: "Staff members means how many staff accounts can be added for this business (not how many can login at the same time).",
      },
      {
        label: "Inventory Items",
        used: inventoryItemsUsed,
        total: null as number | null,
        tone: "warning" as const,
        tooltip:
          "Inventory items include products, categories, manufacturers, suppliers, shelves, and batches for this business.",
      },
    ];
  }, [hasActiveSubscription, businessEntitlement, allCompanyDetails, allCompanies, selectedCompanyDetails, effectiveCompanyId]);

  const upgradeTitle =
    upgradeStep === "plans"
      ? "Subscription Upgrade"
      : upgradeStep === "configure"
      ? "Configure Plan"
      : upgradeStep === "payment"
      ? "Payment"
      : "Payment Complete";

  const configuredBranchesPerBusiness = Math.max(1, branchesPerBusiness);
  const configuredCountersPerBranch = Math.max(1, countersPerBranch);

  const pricingBreakdown = useMemo(() => {
    if (!selectedPlanConfig) {
      return {
        basePlan: 0,
        extraBusinesses: 0,
        extraBranches: 0,
        extraCounters: 0,
        total: 0,
      };
    }

    const extraBranchesQty =
      selectedPlanConfig.includedBranchesPerBusiness === null
        ? 0
        : Math.max(0, configuredBranchesPerBusiness - selectedPlanConfig.includedBranchesPerBusiness);
    const extraCountersQty =
      selectedPlanConfig.includedCountersPerBranch === null
        ? 0
        : Math.max(0, configuredCountersPerBranch - selectedPlanConfig.includedCountersPerBranch);

    const extraBranchesCost = (selectedPlanConfig.extraBranchPrice || 0) * extraBranchesQty;
    const extraCountersCost =
      (selectedPlanConfig.extraCounterPrice || 0) * extraCountersQty * configuredBranchesPerBusiness;

    return {
      basePlan: selectedPlanConfig.basePrice,
      extraBranches: extraBranchesCost,
      extraCounters: extraCountersCost,
      total: selectedPlanConfig.basePrice + extraBranchesCost + extraCountersCost,
    };
  }, [selectedPlanConfig, configuredBranchesPerBusiness, configuredCountersPerBranch]);

  const calculateMonthlyTotal = () => pricingBreakdown.total;

  const handleProceedToPayment = () => {
    if (!selectedPlan) {
      toast({
        title: "Select a plan",
        description: "Please choose a subscription plan before continuing.",
        variant: "destructive",
      });
      return;
    }
    
    setUpgradeStep("payment");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-xl bg-white/60">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#007bff] border-t-transparent" />
          <div className="text-center">
            <p className="text-base font-semibold text-slate-900">Loading subscription data...</p>
            <p className="text-xs text-slate-500">Please wait while we fetch your subscription information</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="font-[Montserrat] px-6 py-6 md:px-10 md:py-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Subscription & Billing</h1>
          <p className="text-sm text-slate-500">Manage your plan, limits, and payment details.</p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 rounded-bl-full bg-gradient-to-br from-[#007bff]/5 to-[#007bff]/10" />
              <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center">
                <div className="shrink-0 rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <ShieldCheck className="h-10 w-10 text-[#007bff]" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Subscription</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <h2 className="mb-1 text-xl font-bold text-slate-900">{planName}</h2>
                  <p className="mb-4 text-sm text-slate-500">
                    {hasActiveSubscription
                      ? "Your plan and limits are synced with your selected business."
                      : isPendingApproval
                        ? "Your payment receipt is under review. We'll activate your subscription once approval is complete."
                        : isExpiredSubscription
                          ? "Your plan has expired. Renew now to restore business access and billing."
                          : "You have not purchased a subscription yet. Choose a plan to activate billing and limits."}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-5 w-5 text-slate-400" />
                      <span className="font-medium text-slate-900">
                        {currentBillingText}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-slate-400" />
                      <span className="font-medium text-slate-900">{expiryDateText ?? renewText}</span>
                      {remainingDaysText && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          remainingDays !== null && remainingDays <= 3
                            ? 'border-red-200 bg-red-100 text-red-700'
                            : remainingDays !== null && remainingDays <= 7
                              ? 'border-amber-200 bg-amber-100 text-amber-700'
                              : 'border-green-200 bg-green-100 text-green-700'
                        }`}>
                          {remainingDaysText}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row">
                  <button
                    type="button"
                    onClick={() => setIsUpgradeOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#007bff] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition-colors hover:bg-[#0056b3]"
                  >
                    <TrendingUp className="h-4 w-4" />
                    {hasActiveSubscription ? "Upgrade Plan" : "Get Plan"}
                  </button>
                  {hasActiveSubscription && (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      onClick={() => setIsCancelOpen(true)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="h-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-5 flex items-center gap-2 text-base font-bold text-slate-900">
                <BarChart3 className="h-5 w-5 text-slate-400" />
                Usage Limits
              </h3>
              {!hasActiveSubscription ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  No active subscription yet. Usage limits will appear after plan activation.
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {usageLimits.map((item) => {
                    const percent = item.total === null || item.total === 0
                      ? Math.min(100, item.used > 0 ? 60 : 0)
                      : Math.min(100, Math.round((item.used / item.total) * 100));
                    const barColor = item.tone === "warning" ? "bg-yellow-500" : "bg-[#007bff]";
                    return (
                      <div key={item.label}>
                        <div className="mb-1.5 flex items-end justify-between">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-700">{item.label}</p>
                            {"tooltip" in item && item.tooltip ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                  >
                                    <Info className="h-4 w-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {item.tooltip}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                          <p className="text-xs font-semibold text-slate-500">
                            {item.used} of {item.total === null ? "Unlimited" : item.total}
                          </p>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100">
                          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-bold text-slate-900">Billing History</h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#007bff]/50 sm:w-64"
                  placeholder="Search invoices..."
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-colors hover:text-slate-900"
              >
                <Filter className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Invoice ID</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Date</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Amount</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Download className="h-8 w-8" />
                        <p className="text-sm font-medium">No billing history yet</p>
                        <p className="text-xs">Payments and invoices will appear here once you subscribe.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((payment) => {
                    const isPaid = payment.status === "success";
                    const statusClass = isPaid
                      ? "bg-green-100 text-green-700 border-green-200"
                      : payment.status === "failed"
                      ? "bg-red-100 text-red-700 border-red-200"
                      : "bg-slate-100 text-slate-600 border-slate-200";
                    return (
                      <tr key={payment.id} className="group transition-colors hover:bg-slate-50">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900">{payment.invoiceNumber}</td>
                        <td className="px-6 py-4 text-sm text-slate-500">{payment.date}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                          PKR {payment.amount.toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {payment.status === "success" ? "Paid" : payment.status === "failed" ? "Failed" : "Pending"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDownloadInvoice(payment.invoiceNumber)}
                            className="inline-flex items-center gap-1 text-sm font-bold text-[#007bff] transition-colors hover:text-blue-700"
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filteredHistory.length > 0 && (
            <div className="flex justify-center border-t border-slate-200 bg-slate-50 px-6 py-4">
              <span className="text-sm text-slate-500">
                Showing {filteredHistory.length} invoice{filteredHistory.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isEditCardOpen} onOpenChange={setIsEditCardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment Method</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Card Brand</Label>
              <select
                className="w-full rounded-md border border-gray-300 p-2"
                value={newCardData.brand}
                onChange={(e) => setNewCardData((prev) => ({ ...prev, brand: e.target.value }))}
              >
                <option value="">Select Brand</option>
                <option value="Visa">Visa</option>
                <option value="Mastercard">Mastercard</option>
                <option value="American Express">American Express</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Last 4 Digits</Label>
              <Input
                placeholder="1234"
                value={newCardData.last4}
                onChange={(e) => setNewCardData((prev) => ({ ...prev, last4: e.target.value }))}
                maxLength={4}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Expiry Month</Label>
                <select
                  className="w-full rounded-md border border-gray-300 p-2"
                  value={newCardData.expiryMonth}
                  onChange={(e) =>
                    setNewCardData((prev) => ({ ...prev, expiryMonth: Number.parseInt(e.target.value, 10) }))
                  }
                >
                  <option value={0}>Select Month</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {String(i + 1).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Expiry Year</Label>
                <select
                  className="w-full rounded-md border border-gray-300 p-2"
                  value={newCardData.expiryYear}
                  onChange={(e) =>
                    setNewCardData((prev) => ({ ...prev, expiryYear: Number.parseInt(e.target.value, 10) }))
                  }
                >
                  <option value={0}>Select Year</option>
                  {Array.from({ length: 10 }, (_, i) => {
                    const year = new Date().getFullYear() + i;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cardholder Name</Label>
              <Input
                placeholder="John Doe"
                value={newCardData.holderName}
                onChange={(e) => setNewCardData((prev) => ({ ...prev, holderName: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefaultEdit"
                checked={newCardData.isDefault}
                onChange={(e) => setNewCardData((prev) => ({ ...prev, isDefault: e.target.checked }))}
              />
              <Label htmlFor="isDefaultEdit">Set as default payment method</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditCardOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateCard}>Update Card</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isBillingDetailsOpen} onOpenChange={setIsBillingDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditingBilling ? "Update Billing Details" : "Add Billing Details"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Business Name</Label>
              <Input
                placeholder="Business name"
                value={billingForm.name}
                onChange={(e) => setBillingForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Address Line 1</Label>
              <Input
                placeholder="Street address"
                value={billingForm.addressLine1}
                onChange={(e) => setBillingForm((prev) => ({ ...prev, addressLine1: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Address Line 2</Label>
              <Input
                placeholder="Suite, building, etc."
                value={billingForm.addressLine2}
                onChange={(e) => setBillingForm((prev) => ({ ...prev, addressLine2: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Address Line 3</Label>
              <Input
                placeholder="City, region, country"
                value={billingForm.addressLine3}
                onChange={(e) => setBillingForm((prev) => ({ ...prev, addressLine3: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>VAT / Tax ID</Label>
              <Input
                placeholder="Tax ID"
                value={billingForm.taxId}
                onChange={(e) => setBillingForm((prev) => ({ ...prev, taxId: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBillingDetailsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveBilling}>{isEditingBilling ? "Update" : "Add"} Details</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isUpgradeOpen} onOpenChange={(open) => {
        setIsUpgradeOpen(open);
        if (open) {
          setUpgradeStep("plans");
          void refreshPricingPlansFromServer();
        }
      }}>
        <DialogContent className="z-[200] max-w-6xl p-0">
          <div className="border-b border-slate-200 px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-slate-900">{upgradeTitle}</DialogTitle>
            </DialogHeader>
          </div>
          {upgradeStep === "plans" && (
            <div className="space-y-8 px-6 pb-8 pt-6 md:px-8">
            <PricingPlansSection
              title="Choose Your Starting Plan"
              description="Pick a plan, then configure businesses, branches, and counters with live pricing."
              plans={upgradePlans}
              currentPlanId={businessEntitlement?.planId || null}
              billingCycle={billingCycle}
              onBillingCycleChange={setBillingCycle}
              annualDiscountPercent={annualDiscountPercent}
              primaryActionLabel="Continue Setup"
              selectedPlanId={selectedPlanId}
              onPrimaryAction={(plan) => {
                setSelectedPlanId(plan.id);
                applyPlanDefaults(buildPlanConfig(plan));
                setUpgradeStep("configure");
              }}
            />

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-slate-900">
                <BarChart3 className="h-5 w-5 text-[#1565C0]" />
                Pricing Model
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    title: "Base Plan",
                    desc: "Platform access + included limits",
                    price: `Rs ${(selectedPlanConfig?.basePrice || 0).toLocaleString()}`,
                    suffix: "/ month",
                  },
                  {
                    title: "Extra Branch",
                    desc: "Add branches as you grow",
                    price: selectedPlanConfig?.extraBranchPrice ? `Rs ${selectedPlanConfig.extraBranchPrice.toLocaleString()}` : "Custom",
                    suffix: "/ branch",
                  },
                  {
                    title: "Extra POS Counter",
                    desc: "Increase counters per branch",
                    price: selectedPlanConfig?.extraCounterPrice ? `Rs ${selectedPlanConfig.extraCounterPrice.toLocaleString()}` : "Custom",
                    suffix: "/ counter",
                  },
                ].map((addon) => (
                  <div key={addon.title} className="flex h-full flex-col rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-slate-900">{addon.title}</span>
                      </div>
                      <p className="mb-3 text-xs text-slate-500">{addon.desc}</p>
                    </div>
                    <div className="mt-auto border-t border-slate-200 pt-3">
                      <span className="text-sm font-bold text-slate-700">
                        {addon.price} <span className="text-[10px] font-normal text-slate-500">{addon.suffix}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-center text-sm text-slate-500">
              Prices are exclusive of taxes. Configure first and review live total before checkout.{" "}
              <button type="button" className="text-[#1565C0] hover:underline">
                Contact Sales
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => setIsUpgradeOpen(false)}
              >
                Previous
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#1565C0] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-colors hover:bg-blue-700"
                onClick={() => {
                  applyPlanDefaults(selectedPlanConfig);
                  setUpgradeStep("configure");
                }}
              >
                Continue Setup
              </button>
            </div>
          </div>
          )}
          {upgradeStep === "configure" && (
            <div>
              <div className="space-y-8 px-6 pb-8 pt-6 md:px-8">
                <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                  <div>
                    <h2 className="mb-1 text-2xl font-bold text-slate-900 md:text-3xl">Configure your plan</h2>
                    <p className="text-sm text-slate-500">Customize your subscription to fit your business needs.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                  <div className="space-y-6 lg:col-span-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-slate-900">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-[#1565C0]">1</span>
                    Configure your setup
                  </h3>
                  <div className="space-y-8">
                    <div className="flex flex-col gap-6 border-b border-slate-100 pb-6 md:flex-row md:items-center md:justify-between">
                      <div className="flex-1">
                        <Label htmlFor="branchesPerBusiness" className="mb-1 block text-sm font-semibold text-slate-700">
                          Number of Branches
                        </Label>
                        <p className="text-xs text-slate-500">Set the number of branches for your business.</p>
                      </div>
                      <div className="w-full md:w-48">
                        <div className="relative flex items-center">
                          <button
                            type="button"
                            onClick={() => setBranchesPerBusiness((prev) => Math.max(1, prev - 1))}
                            className="absolute left-0 flex h-full w-10 items-center justify-center rounded-l-lg border-r border-slate-200 bg-slate-100 text-slate-500 transition-colors hover:text-[#1565C0]"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            id="branchesPerBusiness"
                            type="number"
                            min={1}
                            value={configuredBranchesPerBusiness}
                            onChange={(e) => setBranchesPerBusiness(Math.max(1, Number.parseInt(e.target.value || "1", 10)))}
                            className="w-full rounded-lg border border-slate-200 py-2.5 text-center font-bold text-slate-900 focus:border-[#1565C0] focus:ring-[#1565C0]"
                          />
                          <button
                            type="button"
                            onClick={() => setBranchesPerBusiness((prev) => prev + 1)}
                            className="absolute right-0 flex h-full w-10 items-center justify-center rounded-r-lg border-l border-slate-200 bg-slate-100 text-slate-500 transition-colors hover:text-[#1565C0]"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 text-center text-xs font-medium text-slate-500">
                          Included: <span className="text-[#1565C0]">{selectedPlanConfig?.includedBranchesPerBusiness ?? "Unlimited"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                      <div className="flex-1">
                        <Label htmlFor="countersPerBranch" className="mb-1 block text-sm font-semibold text-slate-700">
                          POS Counters per Branch
                        </Label>
                        <p className="text-xs text-slate-500">Control concurrent counters for each branch.</p>
                      </div>
                      <div className="w-full md:w-48">
                        <div className="relative flex items-center">
                          <button
                            type="button"
                            onClick={() => setCountersPerBranch((prev) => Math.max(1, prev - 1))}
                            className="absolute left-0 flex h-full w-10 items-center justify-center rounded-l-lg border-r border-slate-200 bg-slate-100 text-slate-500 transition-colors hover:text-[#1565C0]"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            id="countersPerBranch"
                            type="number"
                            min={1}
                            value={configuredCountersPerBranch}
                            onChange={(e) => setCountersPerBranch(Math.max(1, Number.parseInt(e.target.value || "1", 10)))}
                            className="w-full rounded-lg border border-slate-200 py-2.5 text-center font-bold text-slate-900 focus:border-[#1565C0] focus:ring-[#1565C0]"
                          />
                          <button
                            type="button"
                            onClick={() => setCountersPerBranch((prev) => prev + 1)}
                            className="absolute right-0 flex h-full w-10 items-center justify-center rounded-r-lg border-l border-slate-200 bg-slate-100 text-slate-500 transition-colors hover:text-[#1565C0]"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 text-center text-xs font-medium text-slate-500">
                          Included: <span className="text-[#1565C0]">{selectedPlanConfig?.includedCountersPerBranch ?? "Unlimited"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="mb-3 text-lg font-bold text-slate-900">Your Setup</h3>
                  <div className="space-y-1 text-sm text-slate-700">
                    <p>Account</p>
                    <p className="pl-4">└── {configuredBranchesPerBusiness} Branch{configuredBranchesPerBusiness > 1 ? "es" : ""}</p>
                    <p className="pl-8">└── {configuredCountersPerBranch} Counter{configuredCountersPerBranch > 1 ? "s" : ""} each</p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1">
                <div className="sticky top-6 rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="border-b border-slate-100 p-6">
                    <h2 className="text-lg font-bold text-slate-900">Order Summary</h2>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
                      <span>Plan Type</span>
                      <span className="font-semibold text-[#1565C0]">{selectedPlan?.name || "Selected Plan"}</span>
                    </div>
                  </div>
                  <div className="space-y-4 p-6">
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-600">
                        Base Plan
                        <div className="text-xs font-normal text-slate-400">
                          Rs {(selectedPlanConfig?.basePrice || 0).toLocaleString()} / month
                        </div>
                      </div>
                      <div className="font-semibold text-slate-900">Rs {pricingBreakdown.basePlan.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-600">
                        Extra Counters
                        <div className="text-xs font-normal text-slate-400">
                          {Math.max(0, configuredCountersPerBranch - (selectedPlanConfig?.includedCountersPerBranch ?? configuredCountersPerBranch))} above included
                        </div>
                      </div>
                      <div className="font-semibold text-slate-900">Rs {pricingBreakdown.extraCounters.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-600">
                        Add-ons
                        <div className="text-xs font-normal text-slate-400">
                          Dynamic business and branch add-ons
                        </div>
                      </div>
                      <div className="font-semibold text-slate-900">Rs {pricingBreakdown.extraBranches.toLocaleString()}</div>
                    </div>
                    <div className="my-4 border-t border-dashed border-slate-300" />
                    <div className="flex items-end justify-between">
                      <div className="text-sm font-semibold text-slate-700">Based on your configuration</div>
                      <div className="text-2xl font-bold text-[#1565C0]">Rs {pricingBreakdown.total.toLocaleString()}</div>
                    </div>
                    <p className="text-right text-xs text-slate-400">Excludes GST</p>
                  </div>
                  <div className="rounded-b-xl bg-slate-50 p-6">
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1565C0] px-4 py-3 font-bold text-white shadow-md shadow-blue-500/20 transition-colors hover:bg-blue-700"
                      onClick={() => setUpgradeStep("payment")}
                    >
                      Review & Pay
                      <TrendingUp className="h-4 w-4" />
                    </button>
                    <p className="mt-4 text-center text-xs text-slate-500">
                      <Lock className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />
                      Secure SSL Payment
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => {
                  setUpgradeStep("plans");
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#1565C0] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-colors hover:bg-blue-700"
                onClick={() => {
                  setUpgradeStep("payment");
                }}
              >
                Review & Pay
              </button>
            </div>
          </div>
        </div>
      )}
      {upgradeStep === "payment" && (
        <div>
          <div className="space-y-8 px-6 pb-8 pt-6 md:px-8">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
              <div>
                <h2 className="mb-1 text-2xl font-bold text-slate-900 md:text-3xl">Complete your payment</h2>
                <p className="text-sm text-slate-500">Review your order and choose a payment method.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-slate-900">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-[#1565C0]">1</span>
                    Billing Information
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Business Name</Label>
                      <Input placeholder="Business name" />
                    </div>
                    <div className="space-y-2">
                      <Label>Tax ID</Label>
                      <Input placeholder="Tax ID" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Billing Address</Label>
                      <Input placeholder="Street, city, country" />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-slate-900">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-[#1565C0]">2</span>
                    Payment Method
                  </h3>
                  <p className="text-sm text-slate-600 mb-6">Pay via Bank Transfer, JazzCash, or EasyPaisa and upload your receipt for verification.</p>
                  {effectiveCompanyId && (
                    <PaymentReceiptUpload 
                      ref={paymentReceiptRef}
                      businessId={effectiveCompanyId} 
                      planId={selectedPlan?.id}
                      planName={selectedPlan?.name}
                      amount={pricingBreakdown.total}
                      onSuccess={() => setUpgradeStep("final")}
                    />
                  )}
                </div>
              </div>
              <div className="lg:col-span-1">
                <div className="sticky top-6 rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="border-b border-slate-100 p-6">
                    <h2 className="text-lg font-bold text-slate-900">Order Summary</h2>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
                      <span>Plan Type</span>
                      <span className="font-semibold text-[#1565C0]">{selectedPlan?.name || "Selected Plan"}</span>
                    </div>
                  </div>
                  <div className="space-y-4 p-6">
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-600">
                        Base Plan
                        <div className="text-xs font-normal text-slate-400">
                          Rs {(selectedPlanConfig?.basePrice || 0).toLocaleString()} / month
                        </div>
                      </div>
                      <div className="font-semibold text-slate-900">Rs {pricingBreakdown.basePlan.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-600">
                        Extra Counters
                        <div className="text-xs font-normal text-slate-400">
                          {Math.max(0, configuredCountersPerBranch - (selectedPlanConfig?.includedCountersPerBranch ?? configuredCountersPerBranch))} above included
                        </div>
                      </div>
                      <div className="font-semibold text-slate-900">Rs {pricingBreakdown.extraCounters.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-600">
                        Add-ons
                        <div className="text-xs font-normal text-slate-400">
                          Dynamic business and branch add-ons
                        </div>
                      </div>
                      <div className="font-semibold text-slate-900">Rs {pricingBreakdown.extraBranches.toLocaleString()}</div>
                    </div>
                    <div className="my-4 border-t border-dashed border-slate-300" />
                    <div className="flex items-end justify-between">
                      <div className="text-sm font-semibold text-slate-700">Based on your configuration</div>
                      <div className="text-2xl font-bold text-[#1565C0]">Rs {pricingBreakdown.total.toLocaleString()}</div>
                    </div>
                    <p className="text-right text-xs text-slate-400">Excludes GST</p>
                  </div>
                  <div className="rounded-b-xl bg-slate-50 p-6">
                    <button
                      type="button"
                      id="submitPaymentProofBtn"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1565C0] px-4 py-3 font-bold text-white shadow-md shadow-blue-500/20 transition-colors hover:bg-blue-700"
                      onClick={() => {
                        paymentReceiptRef.current?.submit();
                      }}
                    >
                      Submit Payment Proof
                      <Upload className="h-4 w-4" />
                    </button>
                    <p className="mt-4 text-center text-xs text-slate-500">
                      <Lock className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />
                      Secure SSL Payment
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => {
                  setUpgradeStep("configure");
                }}
              >
                Previous
              </button>
            </div>
          </div>
        </div>
      )}
      {upgradeStep === "final" && (
        <div>
          <div className="space-y-8 px-6 pb-8 pt-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-amber-800">Payment Proof Submitted Successfully</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    Your payment proof has been submitted for review. Your subscription will be activated once the super admin approves your payment.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-lg font-bold text-slate-900">Plan Summary</h3>
                <div className="space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Plan Type</span>
                    <span className="font-semibold text-[#1565C0]">{selectedPlan?.name || "Selected Plan"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Businesses</span>
                    <span className="font-semibold text-emerald-600">Unlimited</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Branches</span>
                    <span className="font-semibold text-slate-900">{configuredBranchesPerBusiness}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Counters per Branch</span>
                    <span className="font-semibold text-slate-900">{configuredCountersPerBranch}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Structure</span>
                    <span className="font-semibold text-slate-900">
                      Live-configured
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-lg font-bold text-slate-900">Payment Summary</h3>
                <div className="space-y-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Base Plan</span>
                    <span className="font-semibold text-slate-900">Rs {pricingBreakdown.basePlan.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Extra Branches</span>
                    <span className="font-semibold text-slate-900">Rs {pricingBreakdown.extraBranches.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Extra Counters</span>
                    <span className="font-semibold text-slate-900">Rs {pricingBreakdown.extraCounters.toLocaleString()}</span>
                  </div>
                  <div className="border-t border-dashed border-slate-200 pt-4">
                    <div className="flex items-end justify-between">
                      <span className="text-sm font-semibold text-slate-700">Based on your configuration</span>
                      <span className="text-2xl font-bold text-[#1565C0]">Rs {
                        calculateMonthlyTotal().toLocaleString()
                      }</span>
                    </div>
                    <p className="mt-1 text-right text-xs text-slate-400">Excludes GST</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => {
                  setIsUpgradeOpen(false);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </DialogContent>
      </Dialog>
      <Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
          <div className="border-b border-slate-200 px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-slate-900">Cancel Your Subscription</DialogTitle>
            </DialogHeader>
          </div>
          <div className="space-y-6 px-6 pb-6 pt-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-base text-amber-700">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-800">You are about to cancel your plan</p>
                  <p className="mt-2 text-amber-700">
                    Your plan will remain active until the end of your current billing period. After that, your account
                    will move to a limited access state.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-base text-slate-600">
              <p className="font-semibold text-slate-900">What happens next:</p>
              <ul className="space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Access continues until {hasActiveSubscription ? "the end of your billing cycle" : "you activate a subscription"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Future billing stops immediately
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Data remains exportable for 30 days
                </li>
              </ul>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">Reason for cancellation</Label>
                <select
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-base"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                >
                  <option value="">Select a reason</option>
                  <option value="price">Too expensive</option>
                  <option value="switch">Switching to another product</option>
                  <option value="features">Feature missing</option>
                  <option value="no_longer_needed">No longer needed</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">Additional details (optional)</Label>
                <textarea
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-base"
                  rows={5}
                  placeholder="Help us improve by sharing more details..."
                  value={cancelDetails}
                  onChange={(e) => setCancelDetails(e.target.value)}
                />
              </div>
              <label className="flex items-start gap-3 text-base text-slate-600">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#1565C0] focus:ring-[#1565C0]"
                  checked={cancelConfirmed}
                  onChange={(e) => setCancelConfirmed(e.target.checked)}
                />
                <span>I understand my plan will be canceled at the end of the current billing cycle.</span>
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setIsCancelOpen(false);
                  setCancelConfirmed(false);
                }}
              >
                Keep My Plan
              </Button>
              <Button
                onClick={async () => {
                  if (!cancelConfirmed) return;
                  setIsCancelling(true);
                  setTimeout(() => {
                    setIsCancelling(false);
                    setIsCancelOpen(false);
                    setCancelConfirmed(false);
                    toast({
                      title: "Cancellation scheduled",
                      description: "Your plan will end at the close of the billing period.",
                    });
                  }, 600);
                }}
                disabled={!cancelConfirmed || isCancelling}
                className="bg-red-600 text-base text-white hover:bg-red-700"
              >
                {isCancelling ? "Processing..." : "Confirm Cancellation"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SubscriptionManagement;
