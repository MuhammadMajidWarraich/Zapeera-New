import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
}

interface PurchaseHistory {
  id: string;
  date: string;
  items: string[];
  total: number;
  paymentMethod: string;
  receiptNumber: string;
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
    "h-[50px] min-w-[160px] w-full rounded-2xl border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white text-[14px] font-medium text-[#0a1128] shadow-none",
    "focus:ring-4 focus:ring-[rgba(26,82,197,0.06)] focus:ring-offset-0",
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
        <div className="zv3-animate-fadeUp flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-[#0a1128]">
              Customer Management
            </h1>
            <p className="text-sm text-[#8c95b0]">
              Manage customer relationships and loyalty
              {selectedBranch?.name ? (
                <>
                  {" "}
                  • <b className="font-semibold text-[#4a5578]">{selectedBranch.name}</b>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void loadCustomers()}
              className="h-auto rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-white px-[22px] py-3 text-sm font-semibold text-[#4a5578] shadow-none transition-all hover:border-black/10 hover:bg-white hover:text-[#0a1128] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            >
              <RefreshCw
                className={cn("mr-2 h-[18px] w-[18px] stroke-[2]", loading && "animate-spin")}
                strokeLinecap="round"
              />
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <button
              type="button"
              onClick={() => setIsAddDialogOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,82,197,0.35)]"
            >
              <Plus className="h-[18px] w-[18px] stroke-[2.5]" strokeLinecap="round" />
              Add Customer
            </button>
          </div>
        </div>

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
                className="h-[50px] rounded-2xl border-[1.5px] border-[rgba(15,23,60,0.06)] bg-white pl-12 pr-5 text-[15px] text-[#0a1128] shadow-none transition-all placeholder:text-[#8c95b0] placeholder:font-normal focus-visible:border-[#1a52c5] focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.06)]"
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
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[rgba(15,23,60,0.06)] bg-black/[0.015]">
                      <th className="px-6 py-4 pl-8 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Customer
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Contact
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Total Purchases
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Last Visit
                      </th>
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
                        Status
                      </th>
                      <th className="px-6 py-4 pr-8 text-right text-[11px] font-bold uppercase tracking-wide text-[#8c95b0]">
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
                        <td className="px-6 py-5 pl-8 align-middle">
                          <div className="flex items-center gap-3.5">
                            <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[rgba(26,82,197,0.08)] to-[rgba(40,194,206,0.06)] text-sm font-bold text-[#1a52c5]">
                              {customerInitials(customer.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[15px] font-bold text-[#0a1128]">{customer.name}</div>
                              <div className="mt-0.5 truncate text-xs text-[#8c95b0]" title={customer.address || undefined}>
                                {customer.address?.trim() || "—"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 align-middle">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <Phone className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span>{customer.phone}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[13px] text-[#4a5578]">
                              <Mail className="h-3.5 w-3.5 shrink-0 text-[#8c95b0]" strokeWidth={2} />
                              <span className="max-w-[220px] truncate" title={customer.email || undefined}>
                                {customer.email?.trim() || "—"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 align-middle">
                          <span className="text-[15px] font-bold text-[#1a52c5]">
                            PKR {customer.totalPurchases.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-5 align-middle">
                          <span className="text-[13px] font-medium text-[#4a5578]">
                            {new Date(customer.lastVisit).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-6 py-5 align-middle">
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
                        <td className="px-6 py-5 pr-8 text-right align-middle">
                          <button
                            type="button"
                            onClick={() => void viewPurchaseHistory(customer)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,23,60,0.06)] bg-transparent px-4 py-2 text-[13px] font-semibold text-[#4a5578] transition-colors hover:border-black/10 hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                          >
                            <Receipt className="h-[15px] w-[15px]" strokeWidth={2} />
                            History
                          </button>
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
                      className="h-[32px] rounded-lg border border-[rgba(15,23,60,0.06)] bg-white px-2 text-sm font-semibold text-[#0a1128] outline-none focus:ring-2 focus:ring-[rgba(26,82,197,0.15)]"
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
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(Customers);