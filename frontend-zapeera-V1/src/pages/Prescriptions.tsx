import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Eye,
  Ban,
  Loader2,
  RefreshCw,
  Stethoscope,
  Trash2,
  X,
  ImagePlus,
} from "lucide-react";
import {
  apiService,
  type PrescriptionRecord,
  type PrescriptionPayload,
  type PrescriptionItemPayload,
} from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

// Prescriptions register (Wave C1 — Pharmacy pack). The register of
// paper prescriptions the pharmacy received: patient, doctor, the
// medicines written on it (with dosage + duration), and the sales
// that dispensed against each record. It is a legal record — entries
// are never deleted; a mistaken record is VOIDED with a reason
// (owner/manager only) and stays readable, but can no longer be
// edited or attached to a sale. Whether the POS *requires* a
// prescription for prescription-only items is the
// requirePrescriptionAtPos setting (Business Settings → POS).

interface ItemFormRow {
  productId: string;
  productName: string;
  quantity: string;
  dosage: string;
  durationDays: string;
}

interface PrescriptionFormState {
  patientName: string;
  patientPhone: string;
  doctorName: string;
  doctorReg: string;
  notes: string;
  imageUrl: string;
  issuedDate: string;
  items: ItemFormRow[];
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const emptyForm: PrescriptionFormState = {
  patientName: "",
  patientPhone: "",
  doctorName: "",
  doctorReg: "",
  notes: "",
  imageUrl: "",
  issuedDate: todayInputValue(),
  items: [{ productId: "", productName: "", quantity: "1", dosage: "", durationDays: "" }],
};

/** Product search-select used by each medicine row of the form. */
const ProductPicker: React.FC<{
  value: { productId: string; productName: string };
  onChange: (productId: string, productName: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (term: string) => {
    setSearching(true);
    try {
      const response = await apiService.getProducts({ page: 1, limit: 10, search: term } as any);
      const products = (response as any)?.data?.products;
      setResults(Array.isArray(products) ? products.map((p: any) => ({ id: p.id, name: p.name })) : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, runSearch]);

  if (value.productId) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0a1128]">{value.productName}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onChange("", ""); setQuery(""); setOpen(true); }}
          className="text-xs font-bold text-[#1a52c5] hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        placeholder="Search medicine…"
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 rounded-[10px] bg-white"
      />
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-y-auto rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white shadow-lg">
          {searching ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-[#8c95b0]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-[#8c95b0]">No products found</div>
          ) : (
            results.map((product) => (
              <button
                key={product.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-[#0a1128] hover:bg-[#f4f6fa]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(product.id, product.name); setOpen(false); }}
              >
                {product.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const Prescriptions = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user);
  const canManage = role === "OWNER" || role === "MANAGER" || role === "ADMIN";

  const [records, setRecords] = useState<PrescriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [productFilter, setProductFilter] = useState<{ productId: string; productName: string }>({ productId: "", productName: "" });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PrescriptionRecord | null>(null);
  const [form, setForm] = useState<PrescriptionFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [detail, setDetail] = useState<PrescriptionRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [voiding, setVoiding] = useState<PrescriptionRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getPrescriptions({
        page,
        limit: 20,
        search: searchQuery.trim() || undefined,
        productId: productFilter.productId || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
      });
      if (response.success && response.data) {
        setRecords(response.data);
        const pagination = (response as any).pagination;
        if (pagination) setTotalPages(Math.max(1, pagination.pages || 1));
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not load prescriptions.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, productFilter, fromDate, toDate, statusFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, issuedDate: todayInputValue(), items: [{ productId: "", productName: "", quantity: "1", dosage: "", durationDays: "" }] });
    setDialogOpen(true);
  };

  const openEdit = (record: PrescriptionRecord) => {
    setEditing(record);
    setForm({
      patientName: record.patientName || "",
      patientPhone: record.patientPhone || "",
      doctorName: record.doctorName || "",
      doctorReg: record.doctorReg || "",
      notes: record.notes || "",
      imageUrl: record.imageUrl || "",
      issuedDate: record.issuedDate ? record.issuedDate.slice(0, 10) : todayInputValue(),
      items: (record.items && record.items.length > 0 ? record.items : []).map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: String(item.quantity ?? 1),
        dosage: item.dosage || "",
        durationDays: item.durationDays != null ? String(item.durationDays) : "",
      })),
    });
    setDialogOpen(true);
  };

  const openDetail = async (record: PrescriptionRecord) => {
    setDetail(record);
    setDetailLoading(true);
    try {
      const response = await apiService.getPrescription(record.id);
      if (response.success && response.data) setDetail(response.data);
    } catch {
      // The list payload is already a usable fallback.
    } finally {
      setDetailLoading(false);
    }
  };

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image of the prescription.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Prescription image must be under 2MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, imageUrl: reader.result as string }));
    reader.onerror = () => toast({ title: "Could not read file", description: "Please try another image.", variant: "destructive" });
    reader.readAsDataURL(file);
  };

  const updateItem = (index: number, patch: Partial<ItemFormRow>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const buildPayload = (): PrescriptionPayload | null => {
    if (!form.patientName.trim()) {
      toast({ title: "Patient name required", description: "Every prescription record needs the patient's name.", variant: "destructive" });
      return null;
    }
    if (!form.issuedDate) {
      toast({ title: "Date required", description: "Enter the date written on the paper prescription.", variant: "destructive" });
      return null;
    }
    const items: PrescriptionItemPayload[] = [];
    for (const row of form.items) {
      if (!row.productId) {
        toast({ title: "Medicine missing", description: "Pick a product for every medicine row (or remove the row).", variant: "destructive" });
        return null;
      }
      const quantity = parseFloat(row.quantity);
      if (isNaN(quantity) || quantity <= 0) {
        toast({ title: "Invalid quantity", description: `Enter a quantity above zero for ${row.productName}.`, variant: "destructive" });
        return null;
      }
      const duration = row.durationDays.trim() === "" ? null : parseInt(row.durationDays, 10);
      if (duration !== null && (isNaN(duration) || duration < 1)) {
        toast({ title: "Invalid duration", description: `Duration for ${row.productName} must be a whole number of days.`, variant: "destructive" });
        return null;
      }
      items.push({
        productId: row.productId,
        quantity,
        dosage: row.dosage.trim() || null,
        durationDays: duration,
      });
    }
    if (items.length === 0) {
      toast({ title: "No medicines", description: "Add at least one medicine from the prescription.", variant: "destructive" });
      return null;
    }
    return {
      patientName: form.patientName.trim(),
      patientPhone: form.patientPhone.trim() || null,
      doctorName: form.doctorName.trim() || null,
      doctorReg: form.doctorReg.trim() || null,
      notes: form.notes.trim() || null,
      imageUrl: form.imageUrl || null,
      issuedDate: new Date(form.issuedDate).toISOString(),
      items,
    };
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setSubmitting(true);
    try {
      const response = editing
        ? await apiService.updatePrescription(editing.id, payload)
        : await apiService.createPrescription(payload);
      if (response.success) {
        toast({
          title: editing ? "Prescription updated" : "Prescription recorded",
          description: `For ${payload.patientName}.`,
        });
        setDialogOpen(false);
        loadRecords();
      } else {
        toast({ title: "Could not save", description: response.message || "Please check the details and try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not save", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async () => {
    if (!voiding) return;
    if (voidReason.trim().length < 3) {
      toast({ title: "Reason required", description: "Say why this record is being voided — it stays on the record permanently.", variant: "destructive" });
      return;
    }
    setVoidSubmitting(true);
    try {
      const response = await apiService.voidPrescription(voiding.id, voidReason.trim());
      if (response.success) {
        toast({ title: "Prescription voided", description: `The record for ${voiding.patientName} is void and can no longer be used for a sale.` });
        setVoiding(null);
        setVoidReason("");
        setDetail(null);
        loadRecords();
      } else {
        toast({ title: "Could not void", description: response.message || "Try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not void", description: error?.message || "Try again.", variant: "destructive" });
    } finally {
      setVoidSubmitting(false);
    }
  };

  const formatDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
            <Stethoscope className="h-3.5 w-3.5" /> Pharmacy
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Prescriptions</h1>
          <p className="mt-1 max-w-[720px] text-sm text-[#8c95b0]">
            The register of paper prescriptions received — patient, doctor and the medicines prescribed.
            Sales of prescription-only items attach to a record here. Records are never deleted; a mistaken
            record is voided with a reason and stays readable.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-90">
          <Plus className="mr-1.5 h-4 w-4" /> New Prescription
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" />
          <Input
            placeholder="Search patient name or phone…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="h-10 rounded-[10px] bg-white pl-9"
          />
        </div>
        <div className="w-[200px]">
          <ProductPicker
            value={productFilter}
            onChange={(productId, productName) => { setProductFilter({ productId, productName }); setPage(1); }}
          />
        </div>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
          className="h-10 w-[150px] rounded-[10px] bg-white"
          aria-label="Issued from"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(e) => { setToDate(e.target.value); setPage(1); }}
          className="h-10 w-[150px] rounded-[10px] bg-white"
          aria-label="Issued to"
        />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-10 w-[130px] rounded-[10px] bg-white">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={loadRecords} className="h-10 rounded-[10px]">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[rgba(15,23,60,0.08)] bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8c95b0]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading prescriptions…
          </div>
        ) : records.length === 0 ? (
          <div className="py-16 text-center">
            <Stethoscope className="mx-auto mb-3 h-8 w-8 text-[#c3cad9]" />
            <p className="text-sm font-semibold text-[#0a1128]">No prescriptions found</p>
            <p className="mx-auto mt-1 max-w-[520px] text-sm text-[#8c95b0]">
              Record the paper prescriptions customers bring in — the POS can then attach sales of
              prescription-only medicines to them.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] text-left text-xs uppercase tracking-wide text-[#8c95b0]">
                <th className="px-4 py-3 font-semibold">Issued</th>
                <th className="px-4 py-3 font-semibold">Patient</th>
                <th className="px-4 py-3 font-semibold">Doctor</th>
                <th className="px-4 py-3 font-semibold">Medicines</th>
                <th className="px-4 py-3 font-semibold">Sales</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b border-[rgba(15,23,60,0.05)] last:border-0 hover:bg-[#f8f9fc]/60">
                  <td className="whitespace-nowrap px-4 py-3 text-[#4a5578]">{formatDate(record.issuedDate)}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-[#0a1128]">{record.patientName}</span>
                    {record.patientPhone && <span className="block text-xs text-[#8c95b0]">{record.patientPhone}</span>}
                  </td>
                  <td className="px-4 py-3 text-[#4a5578]">
                    {record.doctorName ? `Dr. ${record.doctorName}` : "—"}
                    {record.doctorReg && <span className="block text-xs text-[#8c95b0]">{record.doctorReg}</span>}
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-[#4a5578]">
                    <span className="block truncate">
                      {(record.items || []).map((item) => `${item.productName} ×${item.quantity}`).join(", ") || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#4a5578]">{record._count?.sales ?? 0}</td>
                  <td className="px-4 py-3">
                    {record.isActive ? (
                      <Badge className="bg-emerald-600 font-semibold text-white hover:bg-emerald-600">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-semibold text-red-600">Voided</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openDetail(record)}
                        aria-label={`View prescription for ${record.patientName}`}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-[#4a5578] transition-colors hover:bg-[#f4f6fa]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {record.isActive && (
                        <button
                          type="button"
                          onClick={() => openEdit(record)}
                          aria-label={`Edit prescription for ${record.patientName}`}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-[#4a5578] transition-colors hover:bg-[#f4f6fa]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {record.isActive && canManage && (
                        <button
                          type="button"
                          onClick={() => { setVoiding(record); setVoidReason(""); }}
                          aria-label={`Void prescription for ${record.patientName}`}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-red-500 transition-colors hover:bg-red-50"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
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
        <DialogContent className="max-h-[90vh] max-w-[720px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Prescription" : "New Prescription"}</DialogTitle>
            <DialogDescription>
              Record the paper prescription exactly as written. The medicines below are what this
              record can cover at the POS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rx-patient">Patient name *</Label>
                <Input
                  id="rx-patient"
                  placeholder="e.g. Ahmed Raza"
                  value={form.patientName}
                  onChange={(e) => setForm({ ...form, patientName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-phone">Patient phone</Label>
                <Input
                  id="rx-phone"
                  placeholder="03xx xxxxxxx"
                  value={form.patientPhone}
                  onChange={(e) => setForm({ ...form, patientPhone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-doctor">Doctor name</Label>
                <Input
                  id="rx-doctor"
                  placeholder="e.g. Dr. Sara Khan"
                  value={form.doctorName}
                  onChange={(e) => setForm({ ...form, doctorName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-reg">Doctor registration no.</Label>
                <Input
                  id="rx-reg"
                  placeholder="e.g. PMDC 12345-P"
                  value={form.doctorReg}
                  onChange={(e) => setForm({ ...form, doctorReg: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-date">Date on the prescription *</Label>
                <Input
                  id="rx-date"
                  type="date"
                  value={form.issuedDate}
                  onChange={(e) => setForm({ ...form, issuedDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Prescription image</Label>
                {form.imageUrl ? (
                  <div className="flex items-center gap-3">
                    <img src={form.imageUrl} alt="Prescription" className="h-11 w-11 rounded-[8px] border border-[rgba(15,23,60,0.1)] object-cover" />
                    <span className="flex-1 text-xs text-[#8c95b0]">Image attached</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, imageUrl: "" })}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-red-500 hover:bg-red-50"
                      aria-label="Remove prescription image"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[rgba(15,23,60,0.2)] px-3 text-sm text-[#4a5578] hover:bg-[#f8f9fc]">
                    <ImagePlus className="h-4 w-4 text-[#1a52c5]" />
                    <span>Attach a photo / scan (max 2MB)</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { handleImageFile(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rx-notes">Notes</Label>
              <Textarea
                id="rx-notes"
                rows={2}
                placeholder="Anything else written on the prescription…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Medicines *</Label>
              {form.items.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_70px_110px_90px_32px] items-start gap-2">
                  <ProductPicker
                    value={row}
                    onChange={(productId, productName) => updateItem(index, { productId, productName })}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Qty"
                    value={row.quantity}
                    onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    className="h-9 rounded-[10px] bg-white"
                    aria-label="Quantity"
                  />
                  <Input
                    placeholder="Dosage 1+0+1"
                    value={row.dosage}
                    onChange={(e) => updateItem(index, { dosage: e.target.value })}
                    className="h-9 rounded-[10px] bg-white"
                    aria-label="Dosage"
                  />
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Days"
                    value={row.durationDays}
                    onChange={(e) => updateItem(index, { durationDays: e.target.value })}
                    className="h-9 rounded-[10px] bg-white"
                    aria-label="Duration in days"
                  />
                  <button
                    type="button"
                    disabled={form.items.length <= 1}
                    onClick={() => setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))}
                    className="flex h-9 w-8 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                    aria-label="Remove medicine row"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, { productId: "", productName: "", quantity: "1", dosage: "", durationDays: "" }] }))}
                className="flex items-center gap-1 rounded-[8px] border border-dashed border-[#1a52c5]/40 px-2.5 py-1.5 text-xs font-bold text-[#1a52c5] transition-colors hover:bg-[#1a52c5]/5"
              >
                <Plus className="h-3.5 w-3.5" /> Add medicine
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting} className="bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white hover:opacity-90">
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Record prescription"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-h-[90vh] max-w-[640px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prescription — {detail?.patientName}</DialogTitle>
            <DialogDescription>
              Issued {formatDate(detail?.issuedDate)}
              {detailLoading && " · loading…"}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 pt-1 text-sm">
              {!detail.isActive && (
                <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-red-700">
                  <span className="font-bold">Voided</span>
                  {detail.voidedAt && <span> on {formatDate(detail.voidedAt)}</span>}
                  {detail.voidReason && <span className="block text-xs">Reason: {detail.voidReason}</span>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Patient</span>
                  <span className="font-medium text-[#0a1128]">{detail.patientName}</span>
                  {detail.patientPhone && <span className="block text-xs text-[#8c95b0]">{detail.patientPhone}</span>}
                </div>
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Doctor</span>
                  <span className="font-medium text-[#0a1128]">{detail.doctorName ? `Dr. ${detail.doctorName}` : "—"}</span>
                  {detail.doctorReg && <span className="block text-xs text-[#8c95b0]">{detail.doctorReg}</span>}
                </div>
              </div>
              {detail.notes && (
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Notes</span>
                  <p className="text-[#4a5578]">{detail.notes}</p>
                </div>
              )}
              {detail.imageUrl && (
                <div>
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Prescription image</span>
                  <img src={detail.imageUrl} alt={`Prescription for ${detail.patientName}`} className="max-h-64 rounded-[10px] border border-[rgba(15,23,60,0.1)] object-contain" />
                </div>
              )}
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Medicines</span>
                <div className="overflow-hidden rounded-[10px] border border-[rgba(15,23,60,0.08)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f8f9fc] text-left text-xs uppercase tracking-wide text-[#8c95b0]">
                        <th className="px-3 py-2 font-semibold">Medicine</th>
                        <th className="px-3 py-2 font-semibold">Qty</th>
                        <th className="px-3 py-2 font-semibold">Dosage</th>
                        <th className="px-3 py-2 font-semibold">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((item) => (
                        <tr key={item.id} className="border-t border-[rgba(15,23,60,0.05)]">
                          <td className="px-3 py-2 font-medium text-[#0a1128]">{item.productName}</td>
                          <td className="px-3 py-2 text-[#4a5578]">{item.quantity}</td>
                          <td className="px-3 py-2 text-[#4a5578]">{item.dosage || "—"}</td>
                          <td className="px-3 py-2 text-[#4a5578]">{item.durationDays != null ? `${item.durationDays} days` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Sales against this prescription</span>
                {(detail.sales || []).length === 0 ? (
                  <p className="text-[#8c95b0]">No sales yet.</p>
                ) : (
                  <div className="space-y-1">
                    {(detail.sales || []).map((sale) => (
                      <div key={sale.id} className="flex items-center justify-between rounded-[8px] bg-[#f8f9fc] px-3 py-2">
                        <span className="font-medium text-[#0a1128]">{sale.invoiceNumber || sale.id.slice(-8)}</span>
                        <span className="text-xs text-[#8c95b0]">{formatDate(sale.createdAt)}</span>
                        <span className="font-semibold tabular-nums text-[#0a1128]">PKR {Number(sale.totalAmount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={!!voiding} onOpenChange={(open) => { if (!open) setVoiding(null); }}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Void this prescription?</DialogTitle>
            <DialogDescription>
              The record stays in the register with your reason attached — it just can no longer be
              edited or used for a sale. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="rx-void-reason">Reason *</Label>
              <Textarea
                id="rx-void-reason"
                rows={3}
                placeholder="e.g. Recorded against the wrong patient"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVoiding(null)} disabled={voidSubmitting}>Cancel</Button>
              <Button onClick={handleVoid} disabled={voidSubmitting} className="bg-red-600 text-white hover:bg-red-700">
                {voidSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Void prescription
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Prescriptions;
