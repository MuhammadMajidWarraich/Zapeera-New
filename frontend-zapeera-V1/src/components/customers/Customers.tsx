import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Plus,
  Users,
  Phone,
  Mail,
  Receipt,
  RefreshCw,
  Package,
  AlertTriangle,
  Pencil,
  Trash2,
  BookOpen,
  Printer,
  Wallet,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";

const customerFormField = cn(
  "h-[46px] w-full rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 text-[15px] text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);

const customerFormTextarea = cn(
  "min-h-[90px] w-full resize-y rounded-[10px] border-[1.5px] border-black/[0.08] bg-white px-4 py-3.5 text-[15px] leading-relaxed text-[#0a1128] transition-colors",
  "placeholder:text-[#8c95b0] focus-visible:border-[#1a52c5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);

function customerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().charAt(0).toUpperCase() || "?";
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  totalPurchases: number;
  lastVisit: string;
  loyaltyPoints: number;
  isVIP: boolean;
  createdBy?: string;
  // Khata balance (Wave B2): positive = the customer owes the shop.
  balance: number;
}

interface KhataEntry {
  id: string;
  type: 'SALE_DUE' | 'PAYMENT' | 'ADJUSTMENT' | 'REFUND';
  amount: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  saleId?: string | null;
  sale?: { invoiceNumber?: string | null } | null;
  createdAt: string;
  balanceAfter: number;
}

interface PurchaseHistory {
  id: string;
  date: string;
  items: string[];
  total: number;
  paymentMethod: string;
  receiptNumber: string;
}

// Loyalty points ledger row (Wave B3). `points` is the signed delta
// that was applied to the customer's balance.
interface LoyaltyEntry {
  id: string;
  type: 'EARN' | 'REDEEM' | 'REVERSAL' | 'ADJUST';
  points: number;
  note?: string | null;
  saleId?: string | null;
  refundId?: string | null;
  sale?: { invoiceNumber?: string | null } | null;
  createdAt: string;
}

const Customers = () => {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId } = useAdmin();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("all"); // New filter for created by
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false); // Don't show loading initially
  const [error, setError] = useState<string | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });

  // Form state for adding new customer
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    address: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit / delete customer state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editCustomerForm, setEditCustomerForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: ""
  });
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Khata (udhaar ledger) state — Wave B2
  const [khataCustomer, setKhataCustomer] = useState<Customer | null>(null);
  const [isKhataDialogOpen, setIsKhataDialogOpen] = useState(false);
  const [khataLoading, setKhataLoading] = useState(false);
  const [khataSummary, setKhataSummary] = useState<{
    balance: number;
    totalDue: number;
    totalPaid: number;
    entryCount: number;
  } | null>(null);
  const [khataEntries, setKhataEntries] = useState<KhataEntry[]>([]);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    method: "CASH",
    reference: "",
    note: ""
  });
  const [adjustmentForm, setAdjustmentForm] = useState({
    amount: "",
    note: ""
  });
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [isRecordingAdjustment, setIsRecordingAdjustment] = useState(false);

  // Loyalty points state — Wave B3 (shown inside the Khata dialog)
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [loyaltyPointValue, setLoyaltyPointValue] = useState(1);
  const [loyaltyEntries, setLoyaltyEntries] = useState<LoyaltyEntry[]>([]);
  const [loyaltyAdjustForm, setLoyaltyAdjustForm] = useState({
    points: "",
    note: ""
  });
  const [isAdjustingLoyalty, setIsAdjustingLoyalty] = useState(false);

  // Khata adjustments rewrite the meaning of the ledger (write-offs,
  // opening balances) — the backend restricts them to OWNER/MANAGER,
  // so the form is only rendered for those roles.
  const currentRole = String(
    (user as any)?.membership?.roleName || user?.role || ""
  ).toUpperCase();
  const canAdjustKhata =
    currentRole === "OWNER" || currentRole === "MANAGER" || currentRole === "ADMIN";

  const handleAddCustomer = async () => {
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
      toast({
        title: "Validation Error",
        description: "Name and phone number are required!",
        variant: "destructive",
      });
      return;
    }

    // Get branch ID - convert empty string to null
    let branchId = selectedBranchId || user?.branchId || null;
    
    // For managers/cashiers, check membership.branchIds if branchId is still null
    if (!branchId && Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
      branchId = String(user.membership.branchIds[0]);
    }

    if (!branchId && user?.role === 'OWNER') {
      toast({
        title: "Branch Required",
        description: "Please select a branch before adding a customer!",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await apiService.createCustomer({
        name: newCustomer.name,
        phone: newCustomer.phone,
        email: newCustomer.email,
        address: newCustomer.address,
        branchId: branchId || undefined // Send undefined instead of empty string
      });

      if (response.success) {
        toast({
          title: "Success",
          description: "Customer added successfully!",
        });

        // Reset form
        setNewCustomer({
          name: "",
          phone: "",
          email: "",
          address: ""
        });

        setIsAddDialogOpen(false);
        void loadCustomers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to add customer",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error adding customer:', error);
      const errorMessage = error?.message || error?.response?.message || 'Failed to add customer. Please try again.';
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditCustomerForm({
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || ""
    });
    setIsEditDialogOpen(true);
  };

  const handleEditCustomer = async () => {
    if (!editingCustomer) return;
    if (!editCustomerForm.name.trim() || !editCustomerForm.phone.trim()) {
      toast({
        title: "Validation Error",
        description: "Name and phone number are required!",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await apiService.updateCustomer(editingCustomer.id, {
        name: editCustomerForm.name,
        phone: editCustomerForm.phone,
        email: editCustomerForm.email,
        address: editCustomerForm.address
      });

      if (response.success) {
        toast({
          title: "Success",
          description: "Customer updated successfully!",
        });
        setIsEditDialogOpen(false);
        setEditingCustomer(null);
        void loadCustomers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to update customer",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error updating customer:', error);
      const errorMessage = error?.message || error?.response?.message || 'Failed to update customer. Please try again.';
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = async () => {
    if (!customerToDelete) return;

    try {
      setIsDeleting(true);
      const response = await apiService.deleteCustomer(customerToDelete.id);

      if (response.success) {
        toast({
          title: "Success",
          description: "Customer deleted successfully!",
        });
        setCustomerToDelete(null);
        void loadCustomers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to delete customer",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error deleting customer:', error);
      const errorMessage = error?.message || error?.response?.message || 'Failed to delete customer. Please try again.';
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const loadKhata = useCallback(async (customerId: string) => {
    try {
      setKhataLoading(true);
      const response = await apiService.getCustomerLedger(customerId, {
        page: 1,
        limit: 200
      });
      if (response.success && response.data) {
        setKhataSummary(response.data.summary);
        setKhataEntries(response.data.entries as KhataEntry[]);
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to load khata",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error loading khata:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to load khata",
        variant: "destructive",
      });
    } finally {
      setKhataLoading(false);
    }
  }, [toast]);

  const loadLoyalty = useCallback(async (customerId: string) => {
    try {
      setLoyaltyLoading(true);
      const response = await apiService.getCustomerLoyalty(customerId, {
        page: 1,
        limit: 50
      });
      if (response.success && response.data) {
        setLoyaltyBalance(response.data.balance);
        setLoyaltyPointValue(response.data.pointValue || 1);
        setLoyaltyEntries(response.data.transactions as LoyaltyEntry[]);
      }
    } catch (error: any) {
      // Loyalty history is secondary to the khata itself — log and
      // leave the section empty rather than blocking the dialog.
      console.error('Error loading loyalty:', error);
    } finally {
      setLoyaltyLoading(false);
    }
  }, []);

  const openKhata = async (customer: Customer) => {
    setKhataCustomer(customer);
    setKhataSummary(null);
    setKhataEntries([]);
    setPaymentForm({ amount: "", method: "CASH", reference: "", note: "" });
    setAdjustmentForm({ amount: "", note: "" });
    setLoyaltyBalance(null);
    setLoyaltyEntries([]);
    setLoyaltyAdjustForm({ points: "", note: "" });
    setIsKhataDialogOpen(true);
    await Promise.all([loadKhata(customer.id), loadLoyalty(customer.id)]);
  };

  const handleLoyaltyAdjustment = async () => {
    if (!khataCustomer) return;
    const points = Number(loyaltyAdjustForm.points);
    if (!points || !Number.isInteger(points)) {
      toast({
        title: "Validation Error",
        description: "Enter a whole number of points (negative removes points).",
        variant: "destructive",
      });
      return;
    }
    if (!loyaltyAdjustForm.note.trim()) {
      toast({
        title: "Validation Error",
        description: "A note is required for loyalty adjustments.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsAdjustingLoyalty(true);
      const response = await apiService.recordLoyaltyAdjustment(khataCustomer.id, {
        points,
        note: loyaltyAdjustForm.note.trim()
      });
      if (response.success) {
        toast({
          title: "Success",
          description: "Loyalty points adjusted.",
        });
        setLoyaltyAdjustForm({ points: "", note: "" });
        await loadLoyalty(khataCustomer.id);
        void loadCustomers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to adjust loyalty points",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error adjusting loyalty points:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to adjust loyalty points",
        variant: "destructive",
      });
    } finally {
      setIsAdjustingLoyalty(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!khataCustomer) return;
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      toast({
        title: "Validation Error",
        description: "Enter a payment amount greater than zero.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsRecordingPayment(true);
      const response = await apiService.recordCustomerPayment(khataCustomer.id, {
        amount,
        method: paymentForm.method as 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER' | 'MOBILE',
        reference: paymentForm.reference.trim() || undefined,
        note: paymentForm.note.trim() || undefined,
      });

      if (response.success) {
        toast({
          title: "Success",
          description: "Payment recorded in the khata.",
        });
        setPaymentForm({ amount: "", method: "CASH", reference: "", note: "" });
        await loadKhata(khataCustomer.id);
        void loadCustomers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to record payment",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error recording khata payment:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to record payment",
        variant: "destructive",
      });
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const handleRecordAdjustment = async () => {
    if (!khataCustomer) return;
    const amount = Number(adjustmentForm.amount);
    if (!amount || Number.isNaN(amount)) {
      toast({
        title: "Validation Error",
        description: "Enter a non-zero adjustment amount (use a negative amount to reduce the due).",
        variant: "destructive",
      });
      return;
    }
    if (!adjustmentForm.note.trim()) {
      toast({
        title: "Validation Error",
        description: "A note is required for khata adjustments.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsRecordingAdjustment(true);
      const response = await apiService.recordCustomerAdjustment(khataCustomer.id, {
        amount,
        note: adjustmentForm.note.trim(),
      });

      if (response.success) {
        toast({
          title: "Success",
          description: "Khata adjustment recorded.",
        });
        setAdjustmentForm({ amount: "", note: "" });
        await loadKhata(khataCustomer.id);
        void loadCustomers();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to record adjustment",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Error recording khata adjustment:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to record adjustment",
        variant: "destructive",
      });
    } finally {
      setIsRecordingAdjustment(false);
    }
  };

  const printKhataStatement = () => {
    if (!khataCustomer || !khataSummary) return;
    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const typeLabel: Record<string, string> = {
      SALE_DUE: "Udhaar",
      PAYMENT: "Payment received",
      ADJUSTMENT: "Adjustment",
      REFUND: "Refund adjustment",
    };
    // The statement prints oldest → newest so the running balance
    // reads top-down, the way a paper khata does.
    const rows = [...khataEntries]
      .reverse()
      .map(
        (entry) => `<tr>
          <td>${new Date(entry.createdAt).toLocaleDateString()}</td>
          <td>${esc(typeLabel[entry.type] || entry.type)}${entry.sale?.invoiceNumber ? ` — ${esc(entry.sale.invoiceNumber)}` : ""}${entry.note ? `<br/><small>${esc(entry.note)}</small>` : ""}</td>
          <td>${esc(entry.method || "—")}${entry.reference ? `<br/><small>${esc(entry.reference)}</small>` : ""}</td>
          <td style="text-align:right">${entry.amount > 0 ? "+" : "−"} PKR ${Math.abs(entry.amount).toLocaleString()}</td>
          <td style="text-align:right">PKR ${entry.balanceAfter.toLocaleString()}</td>
        </tr>`
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><title>Khata Statement — ${esc(khataCustomer.name)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0a1128}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:8px;font-size:13px;text-align:left}th{background:#f0f2f7}small{color:#666}</style>
      </head><body>
      <h2 style="margin:0">Khata Statement</h2>
      <p style="margin:4px 0">Customer: <b>${esc(khataCustomer.name)}</b> — ${esc(khataCustomer.phone)}<br/>Printed: ${new Date().toLocaleString()}</p>
      <p style="margin:4px 0">Total udhaar: <b>PKR ${khataSummary.totalDue.toLocaleString()}</b> &nbsp;|&nbsp; Total paid: <b>PKR ${khataSummary.totalPaid.toLocaleString()}</b> &nbsp;|&nbsp; Balance due: <b>PKR ${khataSummary.balance.toLocaleString()}</b></p>
      <table><thead><tr><th>Date</th><th>Detail</th><th>Method</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No khata entries yet.</td></tr>'}</tbody></table>
      <script>window.onload = () => window.print();</script>
      </body></html>`;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    }
  };

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let branchId: string | undefined;

      if (user?.role === 'OWNER') {
        if (selectedBranchId) {
          branchId = selectedBranchId;
          console.log('Admin selected specific branch for customers:', selectedBranch?.name);
        } else {
          console.log('Admin viewing all branches - loading all customers');
        }
      } else {
        // For non-owner users (MANAGER, CASHIER), get branch from branchId or membership.branchIds
        branchId = user?.branchId;
        
        // If no single branchId, check membership.branchIds array
        if (!branchId && Array.isArray(user?.membership?.branchIds) && user.membership.branchIds.length > 0) {
          // Use the first branch from membership if no specific branch selected
          branchId = String(user.membership.branchIds[0]);
        }
        
        // If still no branch, check if a branch is selected in the context
        if (!branchId && selectedBranchId) {
          branchId = selectedBranchId;
        }
        
        // Last resort: fetch branches and use the first one
        if (!branchId) {
          const branchesResponse = await apiService.getBranches();
          if (branchesResponse.success && branchesResponse.data?.branches?.length > 0) {
            branchId = branchesResponse.data.branches[0].id;
          }
        }
        console.log('Regular user branch for customers:', branchId);
      }

      const params: Record<string, string | number> = {
        page: pagination.page,
        limit: pagination.limit,
        search: searchQuery,
        branchId: branchId || '',
        companyId: selectedCompanyId || '',
      };

      if (createdByFilter !== 'all') {
        params.createdByRole = createdByFilter;
      }

      const response = await apiService.getCustomers(params);

      if (response.success && response.data) {
        const transformedCustomers = response.data.customers.map((customer: any) => ({
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email || '',
          address: customer.address || '',
          totalPurchases: Number(customer.totalPurchases) || 0,
          lastVisit: customer.lastVisit
            ? new Date(customer.lastVisit).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
          loyaltyPoints: Number(customer.loyaltyPoints) || 0,
          isVIP: Boolean(customer.isVIP) || false,
          createdBy: customer.createdBy || null,
          balance: Number(customer.balance) || 0,
        }));

        setCustomers(transformedCustomers);
        setPagination(response.data.pagination);

        const cacheBranchId =
          user?.role === 'OWNER'
            ? selectedBranchId || user?.branchId || ''
            : user?.branchId || '';
        const cacheKey = `cached_customers_${user?.id || 'default'}_${cacheBranchId || 'all'}`;
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ customers: transformedCustomers, timestamp: Date.now() }),
          );
        } catch (e) {
          console.error('Error caching customers:', e);
        }
      } else {
        setError('Failed to load customers: ' + (response.message || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error loading customers:', err);
      setError('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [
    pagination.page,
    pagination.limit,
    searchQuery,
    createdByFilter,
    selectedBranchId,
    selectedCompanyId,
    user?.role,
    user?.branchId,
    user?.id,
    selectedBranch?.name,
  ]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [searchQuery, createdByFilter, selectedBranchId, selectedCompanyId]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) void loadCustomers();
    };
    const handleCustomerCreated = () => {
      void loadCustomers();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('customerCreated', handleCustomerCreated);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('customerCreated', handleCustomerCreated);
    };
  }, [loadCustomers]);

  const loadPurchaseHistory = async (customerId: string) => {
    try {
      const response = await apiService.getCustomerPurchaseHistory(customerId, {
        page: 1,
        limit: 10
      });

      if (response.success && response.data) {
        setPurchaseHistory(response.data.sales);
      }
    } catch (err) {
      console.error('Error loading purchase history:', err);
    }
  };


  const viewPurchaseHistory = async (customer: Customer) => {
    setSelectedCustomer(customer);
    await loadPurchaseHistory(customer.id);
    setIsHistoryDialogOpen(true);
  };

  const totalPages = Math.max(1, pagination.pages || 1);
  const filterSelectTrigger = cn(
    "h-[50px] min-w-[160px] w-full rounded-2xl border border-border bg-card text-[14px] font-medium text-foreground shadow-none",
    "focus:ring-4 focus:ring-ring/10 focus:ring-offset-0",
  );

  return (
    <div className="relative min-h-full bg-[#f0f2f7]">
      <div
        className="pointer-events-none fixed right-[-100px] top-[-100px] z-0 h-[500px] w-[500px] rounded-full bg-[rgba(40,194,206,0.06)] blur-[100px]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed bottom-[100px] left-[350px] z-0 h-[400px] w-[400px] rounded-full bg-[rgba(26,82,197,0.04)] blur-[100px]"
        aria-hidden
      />

      <div className="relative z-[1] space-y-5 px-6 pb-14 pt-9 sm:px-11">
        <PageHeader
          className="zv3-animate-fadeUp"
          title="Customer Management"
          description={
            <>
              Manage customer relationships and loyalty
              {selectedBranch?.name ? (
                <>
                  {" "}
                  • <b className="font-semibold text-foreground">{selectedBranch.name}</b>
                </>
              ) : null}
            </>
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => void loadCustomers()}
                className="h-auto rounded-[10px] px-[22px] py-3 text-sm font-semibold shadow-none"
              >
                <RefreshCw
                  className={cn("mr-2 h-[18px] w-[18px] stroke-[2]", loading && "animate-spin")}
                  strokeLinecap="round"
                />
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
              <Button
                type="button"
                onClick={() => setIsAddDialogOpen(true)}
                className="h-auto shrink-0 rounded-[10px] px-6 py-3 text-sm font-semibold"
              >
                <Plus className="h-[18px] w-[18px] stroke-[2.5]" strokeLinecap="round" />
                Add Customer
              </Button>
            </>
          }
        />

        <div className="zv3-animate-fadeUp zv3-delay-1 rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white px-5 py-5">
          {error && (
            <div className="zv3-animate-fadeUp zv3-delay-1">
              <Alert
                variant="destructive"
                className="rounded-2xl border border-red-200/60 bg-red-50/90 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{error}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadCustomers()}
                    className="shrink-0 rounded-[10px]"
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <div className="zv3-animate-fadeUp zv3-delay-2 flex flex-col gap-3.5 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-[18px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8c95b0]"
                strokeWidth={2}
              />
              <Input
                placeholder="Search by name, phone, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-[50px] rounded-2xl border border-border bg-card pl-12 pr-5 text-[15px] text-foreground shadow-none transition-all placeholder:text-muted-foreground placeholder:font-normal focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/10"
              />
            </div>
          <Select value={createdByFilter} onValueChange={setCreatedByFilter}>
            <SelectTrigger className={filterSelectTrigger}>
              <SelectValue placeholder="Created by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              <SelectItem value="OWNER">Admin</SelectItem>
              <SelectItem value="MANAGER">Manager</SelectItem>
              <SelectItem value="CASHIER">Cashier</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>

        <div
          className="zv3-animate-fadeUp zv3-delay-3 overflow-hidden rounded-[28px] border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02),0_8px_40px_rgba(0,0,0,0.04)]"
        >
          {customers.length === 0 ? (
            <div className="px-8 py-16 text-center">
              <div className="mx-auto mb-6 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[rgba(26,82,197,0.06)]">
                <Users className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />
              </div>
              <h3 className="mb-2 text-sm font-bold text-[#0a1128]">
                {error ? "Couldn’t load customers" : searchQuery || createdByFilter !== "all" ? "No customers found" : "No customers yet"}
              </h3>
              <p className="mx-auto mb-6 max-w-md text-sm text-[#8c95b0]">
                {error
                  ? "Check your connection and try again."
                  : searchQuery || createdByFilter !== "all"
                    ? "No customers match your search or staff filter. Try adjusting your criteria."
                    : "Add your first customer to start tracking visits and purchases."}
              </p>
              {!error && !searchQuery && createdByFilter === "all" && (
                <button
                  type="button"
                  onClick={() => setIsAddDialogOpen(true)}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                >
                  <Plus className="h-4 w-4" />
                  Add customer
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                      <th className="px-2.5 py-4 pl-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Customer
                      </th>
                      <th className="px-2.5 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Contact
                      </th>
                      <th className="px-2.5 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Total Purchases
                      </th>
                      <th className="px-2.5 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Khata Balance
                      </th>
                      <th className="px-2.5 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Last Visit
                      </th>
                      <th className="px-2.5 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Status
                      </th>
                      <th className="px-2.5 py-4 pr-4 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <tr
                        key={customer.id}
                        className="transition-colors hover:bg-[rgba(26,82,197,0.015)] [&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                      >
                        <td className="px-2.5 py-4 pl-4 align-middle">
                          <div className="flex items-center gap-3">
                            <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)] text-sm font-bold text-[#1a52c5]">
                              {customerInitials(customer.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="max-w-[88px] truncate text-[15px] font-bold text-[#0a1128]" title={customer.name}>{customer.name}</div>
                              <div className="mt-0.5 truncate text-xs text-[#8c95b0]" title={customer.address || undefined}>
                                {customer.address?.trim() || "—"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2.5 py-4 align-middle">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <Phone className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span className="whitespace-nowrap">{customer.phone}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <Mail className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span className="max-w-[104px] truncate" title={customer.email || undefined}>
                                {customer.email?.trim() || "—"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-2.5 py-4 align-middle">
                          <span className="text-[15px] font-bold text-[#1a52c5]">
                            PKR {customer.totalPurchases.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-2.5 py-4 align-middle">
                          {customer.balance > 0 ? (
                            <span className="text-[15px] font-bold text-[#dc2626]">
                              PKR {customer.balance.toLocaleString()}
                            </span>
                          ) : customer.balance < 0 ? (
                            <span className="text-[13px] font-semibold text-emerald-600">
                              PKR {Math.abs(customer.balance).toLocaleString()} advance
                            </span>
                          ) : (
                            <span className="text-[13px] font-medium text-[#8c95b0]">Settled</span>
                          )}
                        </td>
                        <td className="px-2.5 py-4 align-middle">
                          <span className="text-[13px] font-medium text-[#4a5578]">
                            {new Date(customer.lastVisit).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-2.5 py-4 align-middle">
                          <span
                            className={cn(
                              "inline-flex rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
                              customer.isVIP
                                ? "border border-amber-500/15 bg-amber-500/[0.08] text-amber-700"
                                : "border border-[rgba(26,82,197,0.1)] bg-[rgba(26,82,197,0.06)] text-[#1a52c5]",
                            )}
                          >
                            {customer.isVIP ? "VIP" : "Regular"}
                          </span>
                        </td>
                        <td className="px-2.5 py-4 pr-4 text-right align-middle">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => void openKhata(customer)}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-transparent px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <BookOpen className="h-[15px] w-[15px]" strokeWidth={2} />
                              Khata
                            </button>
                            <button
                              type="button"
                              onClick={() => void viewPurchaseHistory(customer)}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-transparent px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Receipt className="h-[15px] w-[15px]" strokeWidth={2} />
                              History
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditCustomer(customer)}
                              title="Edit customer"
                              className="inline-flex items-center justify-center rounded-lg border border-border bg-transparent p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Pencil className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setCustomerToDelete(customer)}
                              title="Delete customer"
                              className="inline-flex items-center justify-center rounded-lg border border-border bg-transparent p-1.5 text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-[15px] w-[15px]" strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4 border-t border-[rgba(15,23,60,0.06)]">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[#8c95b0]">
                    Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} customers
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-[#8c95b0]">Per page:</span>
                    <select
                      value={pagination.limit}
                      onChange={(e) => setPagination((prev) => ({ ...prev, limit: Number(e.target.value), page: 1 }))}
                      className="h-[32px] rounded-lg border border-border bg-card px-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring/30"
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                    disabled={pagination.page === 1}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                  >
                    Previous
                  </button>
                  <span className="text-sm font-semibold text-[#0a1128]">Page {pagination.page} of {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                    disabled={pagination.page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f0f2f7]"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader className="space-y-1 pr-10 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#0a1128]">
              <Receipt className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
              Purchase history — {selectedCustomer?.name}
            </DialogTitle>
            <DialogDescription className="text-sm text-[#8c95b0]">
              Receipts and line items for this customer.
            </DialogDescription>
          </DialogHeader>

          {selectedCustomer && (
            <div className="space-y-6 pt-6">
              <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f8f9fb] p-5">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Total purchases</p>
                    <p className="mt-1 text-lg font-extrabold text-[#1a52c5]">
                      PKR {selectedCustomer.totalPurchases.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Loyalty points</p>
                    <p className="mt-1 text-lg font-extrabold text-amber-600">{selectedCustomer.loyaltyPoints}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Last visit</p>
                    <p className="mt-1 text-base font-semibold text-[#0a1128]">
                      {new Date(selectedCustomer.lastVisit).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Status</p>
                    <div className="mt-2 flex justify-center">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
                          selectedCustomer.isVIP
                            ? "border border-amber-500/15 bg-amber-500/[0.08] text-amber-700"
                            : "border border-[rgba(26,82,197,0.1)] bg-[rgba(26,82,197,0.06)] text-[#1a52c5]",
                        )}
                      >
                        {selectedCustomer.isVIP ? "VIP" : "Regular"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#8c95b0]">Recent purchases</h3>
                {purchaseHistory.length > 0 ? (
                  purchaseHistory.map((purchase) => (
                    <div
                      key={purchase.id}
                      className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 transition-shadow hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
                    >
                      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[rgba(26,82,197,0.1)] to-[rgba(40,194,206,0.08)]">
                            <Receipt className="h-5 w-5 text-[#1a52c5]" />
                          </div>
                          <div>
                            <p className="font-semibold text-[#0a1128]">Receipt #{purchase.id}</p>
                            <p className="text-sm text-[#8c95b0]">
                              {new Date(purchase.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-lg font-extrabold text-[#1a52c5]">PKR {purchase.totalAmount}</p>
                          <Badge variant="outline" className="mt-1 capitalize border-[rgba(15,23,60,0.08)]">
                            {purchase.paymentMethod}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-[#0a1128]">Items</p>
                        <div className="flex flex-wrap gap-2">
                          {purchase.items.map((item: any, index: number) => (
                            <Badge
                              key={index}
                              variant="secondary"
                              className="border-0 bg-[#f0f2f7] text-xs text-[#4a5578]"
                            >
                              <Package className="mr-1 h-3 w-3" />
                              {item.product.name} ({item.quantity} {item.product.unitType})
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f8f9fb] px-6 py-12 text-center">
                    <Receipt className="mx-auto mb-4 h-12 w-12 text-[#8c95b0]" />
                    <h3 className="mb-2 text-sm font-bold text-[#0a1128]">No purchase history</h3>
                    <p className="text-sm text-[#8c95b0]">This customer has not made any purchases yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">
              Add new customer
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              Add a new customer to your business records.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-6">
            <div className="space-y-2">
              <Label htmlFor="customerName" className="text-sm font-semibold text-[#0a1128]">
                Customer name <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="customerName"
                placeholder="Enter customer name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                className={customerFormField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerPhone" className="text-sm font-semibold text-[#0a1128]">
                Phone number <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="customerPhone"
                placeholder="Enter phone number"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                className={customerFormField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerEmail" className="text-sm font-semibold text-[#0a1128]">
                Email <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
              </Label>
              <Input
                id="customerEmail"
                type="email"
                placeholder="Enter email address"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                className={customerFormField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerAddress" className="text-sm font-semibold text-[#0a1128]">
                Address <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
              </Label>
              <Textarea
                id="customerAddress"
                placeholder="Enter address"
                value={newCustomer.address}
                onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                rows={3}
                className={customerFormTextarea}
              />
            </div>
          </div>

          <DialogFooter className="gap-3 border-t-0 p-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                setNewCustomer({ name: "", phone: "", email: "", address: "" });
              }}
              disabled={isSubmitting}
              className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-7 py-3 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddCustomer}
              disabled={isSubmitting || !newCustomer.name.trim() || !newCustomer.phone.trim()}
              className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
            >
              {isSubmitting ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Adding…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add customer
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">
              Edit customer
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              Update this customer&apos;s details.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-6">
            <div className="space-y-2">
              <Label htmlFor="editCustomerName" className="text-sm font-semibold text-[#0a1128]">
                Customer name <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="editCustomerName"
                placeholder="Enter customer name"
                value={editCustomerForm.name}
                onChange={(e) => setEditCustomerForm({ ...editCustomerForm, name: e.target.value })}
                className={customerFormField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editCustomerPhone" className="text-sm font-semibold text-[#0a1128]">
                Phone number <span className="text-[#dc2626]">*</span>
              </Label>
              <Input
                id="editCustomerPhone"
                placeholder="Enter phone number"
                value={editCustomerForm.phone}
                onChange={(e) => setEditCustomerForm({ ...editCustomerForm, phone: e.target.value })}
                className={customerFormField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editCustomerEmail" className="text-sm font-semibold text-[#0a1128]">
                Email <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
              </Label>
              <Input
                id="editCustomerEmail"
                type="email"
                placeholder="Enter email address"
                value={editCustomerForm.email}
                onChange={(e) => setEditCustomerForm({ ...editCustomerForm, email: e.target.value })}
                className={customerFormField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editCustomerAddress" className="text-sm font-semibold text-[#0a1128]">
                Address <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
              </Label>
              <Textarea
                id="editCustomerAddress"
                placeholder="Enter address"
                value={editCustomerForm.address}
                onChange={(e) => setEditCustomerForm({ ...editCustomerForm, address: e.target.value })}
                rows={3}
                className={customerFormTextarea}
              />
            </div>
          </div>

          <DialogFooter className="gap-3 border-t-0 p-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setEditingCustomer(null);
              }}
              disabled={isSubmitting}
              className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-7 py-3 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleEditCustomer}
              disabled={isSubmitting || !editCustomerForm.name.trim() || !editCustomerForm.phone.trim()}
              className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
            >
              {isSubmitting ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!customerToDelete} onOpenChange={(open) => { if (!open) setCustomerToDelete(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader className="space-y-2 pr-10 text-left">
            <DialogTitle className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">
              Delete customer
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-[#8c95b0]">
              Are you sure you want to delete {customerToDelete?.name}? They will be
              removed from your customer list. Their past invoices stay on record.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-3 border-t-0 p-0 pt-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCustomerToDelete(null)}
              disabled={isDeleting}
              className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-7 py-3 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDeleteCustomer}
              disabled={isDeleting}
              className="rounded-[10px] bg-[#dc2626] px-7 py-3 text-sm font-semibold text-white hover:bg-[#b91c1c]"
            >
              {isDeleting ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Deleting…
                </>
              ) : (
                "Delete customer"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isKhataDialogOpen} onOpenChange={setIsKhataDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader className="space-y-1 pr-10 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#0a1128]">
              <BookOpen className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
              Khata — {khataCustomer?.name}
            </DialogTitle>
            <DialogDescription className="text-sm text-[#8c95b0]">
              Udhaar ledger: credit sales, payments received and the running balance for this customer.
            </DialogDescription>
          </DialogHeader>

          {khataCustomer && (
            <div className="space-y-6 pt-6">
              <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f8f9fb] p-5">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Balance due</p>
                    <p
                      className={cn(
                        "mt-1 text-lg font-extrabold",
                        (khataSummary?.balance || 0) > 0 ? "text-[#dc2626]" : "text-[#1a52c5]"
                      )}
                    >
                      PKR {(khataSummary?.balance || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Total udhaar</p>
                    <p className="mt-1 text-lg font-extrabold text-[#0a1128]">
                      PKR {(khataSummary?.totalDue || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Total paid</p>
                    <p className="mt-1 text-lg font-extrabold text-emerald-600">
                      PKR {(khataSummary?.totalPaid || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-[#8c95b0]">Phone</p>
                    <p className="mt-1 text-base font-semibold text-[#0a1128]">{khataCustomer.phone}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#8c95b0]">Statement</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={printKhataStatement}
                  disabled={khataLoading || !khataSummary}
                  className="rounded-[10px]"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print statement
                </Button>
              </div>

              {khataLoading ? (
                <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f8f9fb] px-6 py-12 text-center">
                  <p className="text-sm text-[#8c95b0]">Loading khata…</p>
                </div>
              ) : khataEntries.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-[rgba(15,23,60,0.06)]">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead>
                      <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Date</th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Detail</th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Method</th>
                        <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Amount</th>
                        <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {khataEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="[&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                        >
                          <td className="px-4 py-3 text-[13px] text-[#4a5578]">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-[13px] font-semibold text-[#0a1128]">
                              {entry.type === 'SALE_DUE' && 'Udhaar'}
                              {entry.type === 'PAYMENT' && 'Payment received'}
                              {entry.type === 'ADJUSTMENT' && 'Adjustment'}
                              {entry.type === 'REFUND' && 'Refund adjustment'}
                              {entry.sale?.invoiceNumber ? (
                                <span className="font-medium text-[#8c95b0]"> — {entry.sale.invoiceNumber}</span>
                              ) : null}
                            </div>
                            {entry.note ? (
                              <div className="mt-0.5 text-xs text-[#8c95b0]">{entry.note}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-[13px] text-[#4a5578]">
                            {entry.method || "—"}
                            {entry.reference ? (
                              <div className="text-xs text-[#8c95b0]">{entry.reference}</div>
                            ) : null}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right text-[13px] font-bold",
                              entry.amount > 0 ? "text-[#dc2626]" : "text-emerald-600"
                            )}
                          >
                            {entry.amount > 0 ? "+" : "−"} PKR {Math.abs(entry.amount).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-[13px] font-semibold text-[#0a1128]">
                            PKR {entry.balanceAfter.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-[#f8f9fb] px-6 py-12 text-center">
                  <BookOpen className="mx-auto mb-4 h-12 w-12 text-[#8c95b0]" />
                  <h3 className="mb-2 text-sm font-bold text-[#0a1128]">No khata entries yet</h3>
                  <p className="text-sm text-[#8c95b0]">
                    Credit sales and payments for this customer will appear here.
                  </p>
                </div>
              )}
              {khataSummary && khataSummary.entryCount > khataEntries.length && (
                <p className="text-xs text-[#8c95b0]">
                  Showing the latest {khataEntries.length} of {khataSummary.entryCount} entries.
                </p>
              )}

              <div className={cn("grid gap-4", canAdjustKhata ? "md:grid-cols-2" : "md:grid-cols-1")}>
                <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#0a1128]">
                    <Wallet className="h-4 w-4 text-[#1a52c5]" />
                    Record payment
                  </h3>
                  <div className="flex flex-col gap-3.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="khataPaymentAmount" className="text-[13px] font-semibold text-[#0a1128]">
                        Amount (PKR) <span className="text-[#dc2626]">*</span>
                      </Label>
                      <Input
                        id="khataPaymentAmount"
                        type="number"
                        min="0"
                        placeholder="e.g. 500"
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                        className={customerFormField}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[13px] font-semibold text-[#0a1128]">Method</Label>
                      <Select
                        value={paymentForm.method}
                        onValueChange={(value) => setPaymentForm({ ...paymentForm, method: value })}
                      >
                        <SelectTrigger className={customerFormField}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="CARD">Card</SelectItem>
                          <SelectItem value="JAZZCASH">JazzCash</SelectItem>
                          <SelectItem value="EASYPAISA">Easypaisa</SelectItem>
                          <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                          <SelectItem value="MOBILE">Mobile</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="khataPaymentReference" className="text-[13px] font-semibold text-[#0a1128]">
                        Reference <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                      </Label>
                      <Input
                        id="khataPaymentReference"
                        placeholder="Transaction ID / receipt no."
                        value={paymentForm.reference}
                        onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                        className={customerFormField}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="khataPaymentNote" className="text-[13px] font-semibold text-[#0a1128]">
                        Note <span className="text-xs font-normal text-[#8c95b0]">(optional)</span>
                      </Label>
                      <Input
                        id="khataPaymentNote"
                        placeholder="Note"
                        value={paymentForm.note}
                        onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                        className={customerFormField}
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={handleRecordPayment}
                      disabled={isRecordingPayment || !paymentForm.amount}
                      className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                    >
                      {isRecordingPayment ? "Recording…" : "Record payment"}
                    </Button>
                  </div>
                </div>

                {canAdjustKhata && (
                  <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#0a1128]">
                      <BookOpen className="h-4 w-4 text-[#1a52c5]" />
                      Adjustment
                    </h3>
                    <div className="flex flex-col gap-3.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="khataAdjustmentAmount" className="text-[13px] font-semibold text-[#0a1128]">
                          Amount (PKR) <span className="text-[#dc2626]">*</span>
                        </Label>
                        <Input
                          id="khataAdjustmentAmount"
                          type="number"
                          placeholder="Negative reduces the due, e.g. -200"
                          value={adjustmentForm.amount}
                          onChange={(e) => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })}
                          className={customerFormField}
                        />
                        <p className="text-xs text-[#8c95b0]">
                          Use a negative amount for a write-off or correction, positive to add an opening balance.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="khataAdjustmentNote" className="text-[13px] font-semibold text-[#0a1128]">
                          Note <span className="text-[#dc2626]">*</span>
                        </Label>
                        <Input
                          id="khataAdjustmentNote"
                          placeholder="Why is this adjustment being made?"
                          value={adjustmentForm.note}
                          onChange={(e) => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })}
                          className={customerFormField}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleRecordAdjustment}
                        disabled={isRecordingAdjustment || !adjustmentForm.amount || !adjustmentForm.note.trim()}
                        className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6 py-3 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
                      >
                        {isRecordingAdjustment ? "Recording…" : "Post adjustment"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Loyalty points (Wave B3) */}
              <div className="border-t border-[rgba(15,23,60,0.06)] pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#8c95b0]">
                    <Sparkles className="h-4 w-4 text-[#1a52c5]" />
                    Loyalty points
                  </h3>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-[#0a1128]">
                      {(loyaltyBalance ?? khataCustomer.loyaltyPoints ?? 0).toLocaleString()} pts
                    </span>
                    <span className="ml-2 text-xs text-[#8c95b0]">
                      ≈ PKR {(((loyaltyBalance ?? khataCustomer.loyaltyPoints ?? 0) * loyaltyPointValue)).toLocaleString()} at PKR {loyaltyPointValue}/point
                    </span>
                  </div>
                </div>

                {loyaltyLoading ? (
                  <p className="pt-4 text-sm text-[#8c95b0]">Loading points history…</p>
                ) : loyaltyEntries.length > 0 ? (
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-[rgba(15,23,60,0.06)]">
                    <table className="w-full min-w-[560px] border-collapse">
                      <thead>
                        <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                          <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Date</th>
                          <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Detail</th>
                          <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loyaltyEntries.map((entry) => (
                          <tr
                            key={entry.id}
                            className="[&:not(:last-child)_td]:border-b [&:not(:last-child)_td]:border-[rgba(15,23,60,0.06)]"
                          >
                            <td className="px-4 py-3 text-[13px] text-[#4a5578]">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-[13px] font-semibold text-[#0a1128]">
                                {entry.type === 'EARN' && 'Earned'}
                                {entry.type === 'REDEEM' && 'Redeemed'}
                                {entry.type === 'REVERSAL' && 'Reversal'}
                                {entry.type === 'ADJUST' && 'Adjustment'}
                                {entry.sale?.invoiceNumber ? (
                                  <span className="font-medium text-[#8c95b0]"> — {entry.sale.invoiceNumber}</span>
                                ) : null}
                              </div>
                              {entry.note ? (
                                <div className="mt-0.5 text-xs text-[#8c95b0]">{entry.note}</div>
                              ) : null}
                            </td>
                            <td
                              className={cn(
                                "px-4 py-3 text-right text-[13px] font-bold",
                                entry.points > 0 ? "text-emerald-600" : "text-[#dc2626]"
                              )}
                            >
                              {entry.points > 0 ? "+" : "−"}{Math.abs(entry.points).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="pt-4 text-sm text-[#8c95b0]">
                    No points activity yet. Points are earned at 1 per PKR 100 spent and can be spent at the POS.
                  </p>
                )}

                {canAdjustKhata && (
                  <div className="mt-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5">
                    <h4 className="mb-4 text-sm font-bold text-[#0a1128]">Adjust points</h4>
                    <div className="flex flex-col gap-3.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="loyaltyAdjustPoints" className="text-[13px] font-semibold text-[#0a1128]">
                          Points <span className="text-[#dc2626]">*</span>
                        </Label>
                        <Input
                          id="loyaltyAdjustPoints"
                          type="number"
                          step="1"
                          placeholder="Negative removes points, e.g. -50"
                          value={loyaltyAdjustForm.points}
                          onChange={(e) => setLoyaltyAdjustForm({ ...loyaltyAdjustForm, points: e.target.value })}
                          className={customerFormField}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="loyaltyAdjustNote" className="text-[13px] font-semibold text-[#0a1128]">
                          Note <span className="text-[#dc2626]">*</span>
                        </Label>
                        <Input
                          id="loyaltyAdjustNote"
                          placeholder="Why are these points being adjusted?"
                          value={loyaltyAdjustForm.note}
                          onChange={(e) => setLoyaltyAdjustForm({ ...loyaltyAdjustForm, note: e.target.value })}
                          className={customerFormField}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleLoyaltyAdjustment}
                        disabled={isAdjustingLoyalty || !loyaltyAdjustForm.points || !loyaltyAdjustForm.note.trim()}
                        className="rounded-[10px] border border-[rgba(15,23,60,0.06)] px-6 py-3 text-sm font-semibold text-[#4a5578] hover:bg-[#f0f2f7]"
                      >
                        {isAdjustingLoyalty ? "Recording…" : "Post points adjustment"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Customers);