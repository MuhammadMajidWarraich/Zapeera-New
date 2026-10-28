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
  TicketPercent,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  apiService,
  fetchAllPaged,
  type PromotionRecord,
  type PromotionPayload,
  type PromotionType,
  type PromotionScope,
} from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

// Promotions & coupons management (Wave B4). The offers managed here
// are evaluated SERVER-SIDE by the promotions engine at checkout —
// this page only defines them. Writes are OWNER/MANAGER (the API
// enforces the same gate); cashiers can view the list and validate
// codes at the POS.

interface PromotionFormState {
  name: string;
  type: PromotionType;
  value: string;
  buyQty: string;
  getQty: string;
  scope: PromotionScope;
  categoryId: string;
  productId: string;
  code: string;
  minBill: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  isActive: boolean;
}

const emptyForm: PromotionFormState = {
  name: "",
  type: "PERCENT",
  value: "",
  buyQty: "",
  getQty: "",
  scope: "ALL",
  categoryId: "",
  productId: "",
  code: "",
  minBill: "",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  isActive: true,
};

const toLocalInputValue = (iso?: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const describeOffer = (promo: PromotionRecord): string => {
  if (promo.type === "PERCENT") return `${promo.value}% off`;
  if (promo.type === "FLAT") return `PKR ${Number(promo.value).toFixed(0)} off`;
  return `Buy ${promo.buyQty ?? "?"} Get ${promo.getQty ?? "?"} free`;
};

const describeScope = (promo: PromotionRecord): string => {
  if (promo.scope === "CATEGORY") return promo.category?.name || "Category";
  if (promo.scope === "PRODUCT") return promo.product?.name || "Product";
  return "All items";
};

const describeWindow = (promo: PromotionRecord): string => {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (promo.startsAt && promo.endsAt) return `${fmt(promo.startsAt)} → ${fmt(promo.endsAt)}`;
  if (promo.startsAt) return `From ${fmt(promo.startsAt)}`;
  if (promo.endsAt) return `Until ${fmt(promo.endsAt)}`;
  return "Always";
};

const Promotions = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user);
  const canManage = role === "OWNER" || role === "MANAGER" || role === "ADMIN";

  const [promotions, setPromotions] = useState<PromotionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PromotionRecord | null>(null);
  const [form, setForm] = useState<PromotionFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [deactivating, setDeactivating] = useState<PromotionRecord | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getPromotions({
        page,
        limit: 20,
        type: typeFilter !== "all" ? typeFilter : undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
        search: searchQuery.trim() || undefined,
      });
      if (response.success && response.data) {
        // Defensive shape handling (2026-10-24): the web contract is
        // data = Promotion[] with pagination as a sibling, but an older
        // desktop embedded stub returned data = { promotions: [] } —
        // setPromotions(object) then crashed the render at
        // promotions.map. Normalize ANY shape to an array so this page
        // can never throw on a malformed list response again.
        const raw: any = response.data as any;
        const list: PromotionRecord[] = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.promotions)
            ? raw.promotions
            : [];
        setPromotions(list);
        const pagination = (response as any).pagination || raw?.pagination;
        if (pagination) setTotalPages(Math.max(1, pagination.pages || 1));
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not load promotions.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, statusFilter, searchQuery]);

  useEffect(() => {
    loadPromotions();
  }, [loadPromotions]);

  // Scope pickers for the form
  // H3 truncation family (2026-10-28): the old limit:200 page left
  // categories/products past the first 200 untargetable in promotions.
  useEffect(() => {
    fetchAllPaged(
      (page, limit) => apiService.getCategories({ page, limit }),
      (data: any) => data.categories || data
    )
      .then((list) => {
        if (Array.isArray(list)) setCategories(list.map((c: any) => ({ id: c.id, name: c.name })));
      })
      .catch(() => { /* scope picker simply stays empty */ });
    fetchAllPaged(
      (page, limit) => apiService.getProducts({ page, limit }),
      (data: any) => data.products || data
    )
      .then((list) => {
        if (Array.isArray(list)) setProducts(list.map((p: any) => ({ id: p.id, name: p.name })));
      })
      .catch(() => { /* scope picker simply stays empty */ });
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (promo: PromotionRecord) => {
    setEditing(promo);
    setForm({
      name: promo.name,
      type: promo.type,
      value: promo.type === "BUY_X_GET_Y" ? "" : String(promo.value ?? ""),
      buyQty: promo.buyQty ? String(promo.buyQty) : "",
      getQty: promo.getQty ? String(promo.getQty) : "",
      scope: promo.scope,
      categoryId: promo.categoryId || "",
      productId: promo.productId || "",
      code: promo.code || "",
      minBill: promo.minBill != null ? String(promo.minBill) : "",
      startsAt: toLocalInputValue(promo.startsAt),
      endsAt: toLocalInputValue(promo.endsAt),
      usageLimit: promo.usageLimit != null ? String(promo.usageLimit) : "",
      isActive: promo.isActive,
    });
    setDialogOpen(true);
  };

  const buildPayload = (): PromotionPayload | null => {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Give the promotion a name.", variant: "destructive" });
      return null;
    }
    const payload: PromotionPayload = {
      name: form.name.trim(),
      type: form.type,
      scope: form.scope,
      categoryId: form.scope === "CATEGORY" ? form.categoryId || null : null,
      productId: form.scope === "PRODUCT" ? form.productId || null : null,
      code: form.code.trim() ? form.code.trim().toUpperCase() : null,
      minBill: form.minBill ? parseFloat(form.minBill) : null,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      usageLimit: form.usageLimit ? parseInt(form.usageLimit, 10) : null,
      isActive: form.isActive,
    };
    if (form.type === "BUY_X_GET_Y") {
      payload.buyQty = parseInt(form.buyQty, 10) || null;
      payload.getQty = parseInt(form.getQty, 10) || null;
      if (!payload.buyQty || !payload.getQty) {
        toast({ title: "Quantities required", description: "Buy X Get Y needs both quantities.", variant: "destructive" });
        return null;
      }
    } else {
      payload.value = parseFloat(form.value);
      if (!payload.value || payload.value <= 0) {
        toast({ title: "Value required", description: "Enter the percentage or amount for this offer.", variant: "destructive" });
        return null;
      }
      if (form.type === "PERCENT" && payload.value > 100) {
        toast({ title: "Invalid percentage", description: "A percentage discount cannot exceed 100.", variant: "destructive" });
        return null;
      }
    }
    if (form.scope === "CATEGORY" && !form.categoryId) {
      toast({ title: "Category required", description: "Pick the category this offer applies to.", variant: "destructive" });
      return null;
    }
    if (form.scope === "PRODUCT" && !form.productId) {
      toast({ title: "Product required", description: "Pick the product this offer applies to.", variant: "destructive" });
      return null;
    }
    return payload;
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setSubmitting(true);
    try {
      const response = editing
        ? await apiService.updatePromotion(editing.id, payload)
        : await apiService.createPromotion(payload);
      if (response.success) {
        toast({
          title: editing ? "Promotion updated" : "Promotion created",
          description: `"${payload.name}" is saved.`,
        });
        setDialogOpen(false);
        loadPromotions();
      } else {
        toast({ title: "Could not save", description: response.message || "Please check the details and try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not save", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (promo: PromotionRecord, next: boolean) => {
    setTogglingId(promo.id);
    try {
      const response = await apiService.updatePromotion(promo.id, { isActive: next });
      if (response.success) {
        setPromotions((prev) => prev.map((p) => (p.id === promo.id ? { ...p, isActive: next } : p)));
      } else {
        toast({ title: "Could not update", description: response.message || "Try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not update", description: error?.message || "Try again.", variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating) return;
    try {
      const response = await apiService.deletePromotion(deactivating.id);
      if (response.success) {
        toast({ title: "Promotion deactivated", description: `"${deactivating.name}" will no longer be offered. Its redemption history is kept.` });
        setDeactivating(null);
        loadPromotions();
      } else {
        toast({ title: "Could not deactivate", description: response.message || "Try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not deactivate", description: error?.message || "Try again.", variant: "destructive" });
    }
  };

  return (
    <div className="w-full px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
            <TicketPercent className="h-3.5 w-3.5" /> Sales
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Promotions & Coupons</h1>
          <p className="mt-1 text-sm text-[#8c95b0]">
            Offers are applied automatically at checkout — or unlocked with a coupon code. Discounts are always calculated by the server.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-90">
            <Plus className="mr-1.5 h-4 w-4" /> New Promotion
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" />
          <Input
            placeholder="Search by name or coupon code…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="h-10 rounded-[10px] bg-white pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="h-10 w-[170px] rounded-[10px] bg-white">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="PERCENT">Percentage off</SelectItem>
            <SelectItem value="FLAT">Flat amount off</SelectItem>
            <SelectItem value="BUY_X_GET_Y">Buy X Get Y</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-10 w-[140px] rounded-[10px] bg-white">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={loadPromotions} className="h-10 rounded-[10px]">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[rgba(15,23,60,0.08)] bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8c95b0]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading promotions…
          </div>
        ) : promotions.length === 0 ? (
          <div className="py-16 text-center">
            <TicketPercent className="mx-auto mb-3 h-8 w-8 text-[#c3cad9]" />
            <p className="text-sm font-semibold text-[#0a1128]">No promotions yet</p>
            <p className="mt-1 text-sm text-[#8c95b0]">
              {canManage ? "Create your first offer — a coupon code, a percentage deal, or Buy X Get Y." : "No offers have been created for this business yet."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] text-left text-xs uppercase tracking-wide text-[#8c95b0]">
                <th className="px-4 py-3 font-semibold">Promotion</th>
                <th className="px-4 py-3 font-semibold">Offer</th>
                <th className="px-4 py-3 font-semibold">Applies to</th>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Validity</th>
                <th className="px-4 py-3 font-semibold">Used</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                {canManage && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {promotions.map((promo) => (
                <tr key={promo.id} className="border-b border-[rgba(15,23,60,0.05)] last:border-0 hover:bg-[#f8f9fc]/60">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-[#0a1128]">{promo.name}</span>
                    {promo.minBill != null && (
                      <span className="block text-xs text-[#8c95b0]">Min bill PKR {Number(promo.minBill).toFixed(0)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="font-semibold">{describeOffer(promo)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[#4a5578]">{describeScope(promo)}</td>
                  <td className="px-4 py-3">
                    {promo.code ? (
                      <span className="rounded-md bg-[#1a52c5]/[0.07] px-2 py-1 font-mono text-xs font-bold tracking-wide text-[#1a52c5]">{promo.code}</span>
                    ) : (
                      <span className="text-xs font-medium text-[#8c95b0]">Automatic</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#4a5578]">{describeWindow(promo)}</td>
                  <td className="px-4 py-3 tabular-nums text-[#4a5578]">
                    {promo.usedCount}{promo.usageLimit != null ? ` / ${promo.usageLimit}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={promo.isActive}
                      disabled={!canManage || togglingId === promo.id}
                      onCheckedChange={(next) => handleToggleActive(promo, next)}
                    />
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(promo)}
                          aria-label={`Edit ${promo.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-[#4a5578] transition-colors hover:bg-[#f4f6fa]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeactivating(promo)}
                          aria-label={`Deactivate ${promo.name}`}
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
        <DialogContent className="max-h-[90vh] max-w-[560px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Promotion" : "New Promotion"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes apply to new sales. Past redemptions keep the discount they were given."
                : "Define the offer — the checkout applies it automatically, or when the customer gives the code."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="promo-name">Name</Label>
              <Input
                id="promo-name"
                placeholder="e.g. Eid Sale, Welcome Offer"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as PromotionType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Percentage off</SelectItem>
                    <SelectItem value="FLAT">Flat amount off</SelectItem>
                    <SelectItem value="BUY_X_GET_Y">Buy X Get Y free</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.type !== "BUY_X_GET_Y" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="promo-value">{form.type === "PERCENT" ? "Percentage (%)" : "Amount (PKR)"}</Label>
                  <Input
                    id="promo-value"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={form.type === "PERCENT" ? "10" : "200"}
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="promo-buy">Buy (X)</Label>
                    <Input
                      id="promo-buy"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="2"
                      value={form.buyQty}
                      onChange={(e) => setForm({ ...form, buyQty: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="promo-get">Get free (Y)</Label>
                    <Input
                      id="promo-get"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="1"
                      value={form.getQty}
                      onChange={(e) => setForm({ ...form, getQty: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Applies to</Label>
                <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as PromotionScope })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All items</SelectItem>
                    <SelectItem value="CATEGORY">One category</SelectItem>
                    <SelectItem value="PRODUCT">One product</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.scope === "CATEGORY" && (
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.scope === "PRODUCT" && (
                <div className="space-y-1.5">
                  <Label>Product</Label>
                  <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promo-code">Coupon code <span className="font-normal text-[#8c95b0]">(optional — blank means automatic)</span></Label>
              <Input
                id="promo-code"
                placeholder="e.g. EID10"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="font-mono uppercase"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-minbill">Minimum bill (PKR) <span className="font-normal text-[#8c95b0]">(optional)</span></Label>
                <Input
                  id="promo-minbill"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="No minimum"
                  value={form.minBill}
                  onChange={(e) => setForm({ ...form, minBill: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-limit">Usage limit <span className="font-normal text-[#8c95b0]">(optional)</span></Label>
                <Input
                  id="promo-limit"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Unlimited"
                  value={form.usageLimit}
                  onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-starts">Starts at <span className="font-normal text-[#8c95b0]">(optional)</span></Label>
                <Input
                  id="promo-starts"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-ends">Ends at <span className="font-normal text-[#8c95b0]">(optional)</span></Label>
                <Input
                  id="promo-ends"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-[10px] border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] px-3 py-2.5">
              <span className="text-sm font-medium text-[#0a1128]">Active — customers can use this offer</span>
              <Switch checked={form.isActive} onCheckedChange={(next) => setForm({ ...form, isActive: next })} />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting} className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-90">
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create promotion"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={handleDeactivate}
        title="Deactivate promotion?"
        description={deactivating ? `"${deactivating.name}" will stop being offered at checkout. Its ${deactivating.usedCount} past redemption(s) stay on record.` : ""}
        confirmText="Deactivate"
      />
    </div>
  );
};

export default Promotions;
