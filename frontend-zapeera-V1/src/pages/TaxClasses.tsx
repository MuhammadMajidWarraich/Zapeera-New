import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Percent,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  apiService,
  type TaxClassRecord,
  type TaxClassPayload,
} from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

// Tax classes management (Wave B5). The classes defined here are the
// rate groups the checkout taxes each product under: a product with a
// class is taxed at the class rate; a product without one falls back
// to the DEFAULT class, or to the Default Tax setting when the
// business has no classes. Rates are applied by the server — this
// page only defines them. Writes are OWNER/MANAGER (the API enforces
// the same gate). Deleting retires a class: past sales keep the
// name/rate snapshot stored on them, and products still pointing at
// the retired class fall back to the default handling.

interface TaxClassFormState {
  name: string;
  rate: string;
  isDefault: boolean;
  isActive: boolean;
}

const emptyForm: TaxClassFormState = {
  name: "",
  rate: "",
  isDefault: false,
  isActive: true,
};

const TaxClasses = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user);
  const canManage = role === "OWNER" || role === "MANAGER" || role === "ADMIN";

  const [taxClasses, setTaxClasses] = useState<TaxClassRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxClassRecord | null>(null);
  const [form, setForm] = useState<TaxClassFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [retiring, setRetiring] = useState<TaxClassRecord | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadTaxClasses = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getTaxClasses({
        page,
        limit: 20,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
        search: searchQuery.trim() || undefined,
      });
      if (response.success && response.data) {
        setTaxClasses(response.data);
        const pagination = (response as any).pagination;
        if (pagination) setTotalPages(Math.max(1, pagination.pages || 1));
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not load tax classes.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchQuery]);

  useEffect(() => {
    loadTaxClasses();
  }, [loadTaxClasses]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (taxClass: TaxClassRecord) => {
    setEditing(taxClass);
    setForm({
      name: taxClass.name,
      rate: String(taxClass.rate ?? ""),
      isDefault: taxClass.isDefault,
      isActive: taxClass.isActive,
    });
    setDialogOpen(true);
  };

  const buildPayload = (): TaxClassPayload | null => {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Give the tax class a name, e.g. Standard 17%.", variant: "destructive" });
      return null;
    }
    const rate = parseFloat(form.rate);
    if (form.rate.trim() === "" || isNaN(rate) || rate < 0 || rate > 100) {
      toast({ title: "Invalid rate", description: "Enter a tax rate between 0 and 100 (percent).", variant: "destructive" });
      return null;
    }
    return {
      name: form.name.trim(),
      rate,
      isDefault: form.isDefault,
      isActive: form.isActive,
    };
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setSubmitting(true);
    try {
      const response = editing
        ? await apiService.updateTaxClass(editing.id, payload)
        : await apiService.createTaxClass(payload);
      if (response.success) {
        toast({
          title: editing ? "Tax class updated" : "Tax class created",
          description: `"${payload.name}" is saved.`,
        });
        setDialogOpen(false);
        loadTaxClasses();
      } else {
        toast({ title: "Could not save", description: response.message || "Please check the details and try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not save", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (taxClass: TaxClassRecord, next: boolean) => {
    // Retiring through the switch follows the same server rule as
    // Delete: the current default cannot be retired while other
    // active classes exist — the API answers with the reason.
    setTogglingId(taxClass.id);
    try {
      const response = next
        ? await apiService.updateTaxClass(taxClass.id, { isActive: true })
        : await apiService.deleteTaxClass(taxClass.id);
      if (response.success) {
        setTaxClasses((prev) => prev.map((t) => (t.id === taxClass.id
          ? { ...t, isActive: next, isDefault: next ? t.isDefault : false }
          : t)));
      } else {
        toast({ title: "Could not update", description: response.message || "Try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not update", description: error?.message || "Try again.", variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  const handleRetire = async () => {
    if (!retiring) return;
    try {
      const response = await apiService.deleteTaxClass(retiring.id);
      if (response.success) {
        toast({ title: "Tax class retired", description: `"${retiring.name}" will no longer be applied. Past sales keep their stored tax breakdown.` });
        setRetiring(null);
        loadTaxClasses();
      } else {
        toast({ title: "Could not retire", description: response.message || "Try again.", variant: "destructive" });
        setRetiring(null);
      }
    } catch (error: any) {
      toast({ title: "Could not retire", description: error?.message || "Try again.", variant: "destructive" });
      setRetiring(null);
    }
  };

  return (
    <div className="w-full px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
            <Percent className="h-3.5 w-3.5" /> Sales
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Tax Classes</h1>
          <p className="mt-1 max-w-[720px] text-sm text-[#8c95b0]">
            Rate groups for your products — e.g. Standard 17%, Reduced 5%, Exempt 0%. Assign a class on the
            product form; products without a class use the default class, or the Default Tax setting when
            no classes exist. Tax is always calculated by the server.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-90">
            <Plus className="mr-1.5 h-4 w-4" /> New Tax Class
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" />
          <Input
            placeholder="Search by name…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="h-10 rounded-[10px] bg-white pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-10 w-[140px] rounded-[10px] bg-white">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Retired</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={loadTaxClasses} className="h-10 rounded-[10px]">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[rgba(15,23,60,0.08)] bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8c95b0]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tax classes…
          </div>
        ) : taxClasses.length === 0 ? (
          <div className="py-16 text-center">
            <Percent className="mx-auto mb-3 h-8 w-8 text-[#c3cad9]" />
            <p className="text-sm font-semibold text-[#0a1128]">No tax classes yet</p>
            <p className="mx-auto mt-1 max-w-[520px] text-sm text-[#8c95b0]">
              {canManage
                ? "Sales currently use the single Default Tax rate from Settings. Create classes when different products need different rates."
                : "No tax classes have been created for this business yet — sales use the Default Tax rate."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] text-left text-xs uppercase tracking-wide text-[#8c95b0]">
                <th className="px-4 py-3 font-semibold">Tax class</th>
                <th className="px-4 py-3 font-semibold">Rate</th>
                <th className="px-4 py-3 font-semibold">Default</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                {canManage && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {taxClasses.map((taxClass) => (
                <tr key={taxClass.id} className="border-b border-[rgba(15,23,60,0.05)] last:border-0 hover:bg-[#f8f9fc]/60">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-[#0a1128]">{taxClass.name}</span>
                    {!taxClass.isActive && (
                      <span className="block text-xs text-[#8c95b0]">Retired — products fall back to the default</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="font-semibold">{Number(taxClass.rate)}%</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {taxClass.isDefault ? (
                      <Badge className="bg-[#1a52c5] font-semibold text-white hover:bg-[#1a52c5]">Default</Badge>
                    ) : (
                      <span className="text-xs font-medium text-[#8c95b0]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={taxClass.isActive}
                      disabled={!canManage || togglingId === taxClass.id}
                      onCheckedChange={(next) => handleToggleActive(taxClass, next)}
                    />
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(taxClass)}
                          aria-label={`Edit ${taxClass.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-[#4a5578] transition-colors hover:bg-[#f4f6fa]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRetiring(taxClass)}
                          aria-label={`Retire ${taxClass.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-red-500 transition-colors hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-[#8c95b0]">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-[480px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Tax Class" : "New Tax Class"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes apply to new sales. Past sales keep the rate snapshot they were stored with."
                : "Define a rate group, then assign it to products on the product form."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="tax-name">Name</Label>
              <Input
                id="tax-name"
                placeholder="e.g. Standard 17%, Exempt"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tax-rate">Rate (%)</Label>
              <Input
                id="tax-rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="17"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
              />
              <p className="text-xs text-[#8c95b0]">Use 0 for tax-exempt products.</p>
            </div>

            <div className="flex items-center justify-between rounded-[10px] border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] px-3 py-2.5">
              <span className="text-sm font-medium text-[#0a1128]">
                Default class
                <span className="block text-xs font-normal text-[#8c95b0]">Applies to products without a class</span>
              </span>
              <Switch checked={form.isDefault} onCheckedChange={(next) => setForm({ ...form, isDefault: next })} />
            </div>

            <div className="flex items-center justify-between rounded-[10px] border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] px-3 py-2.5">
              <span className="text-sm font-medium text-[#0a1128]">Active — new sales can use this class</span>
              <Switch checked={form.isActive} onCheckedChange={(next) => setForm({ ...form, isActive: next })} />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting} className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-90">
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create tax class"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={!!retiring}
        onClose={() => setRetiring(null)}
        onConfirm={handleRetire}
        title="Retire tax class?"
        description={retiring ? `"${retiring.name}" will stop being applied at checkout. Products still assigned to it fall back to the default handling, and past sales keep their stored tax breakdown.` : ""}
        confirmText="Retire"
      />
    </div>
  );
};

export default TaxClasses;
