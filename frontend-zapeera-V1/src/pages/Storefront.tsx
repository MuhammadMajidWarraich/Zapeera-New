import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Search, ShoppingCart, Plus, Minus, Trash2, Store, Truck, FileUp, CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";
import { apiService, type StoreInfo, type StoreProduct } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Public online pharmacy storefront (Wave C5 — gap item 5). No login,
// no layout: a customer opens /store/<branchId> and buys from that
// ONE branch only. Prices/stock come from the server; checkout is
// cash on delivery and creates a real sale (channel ONLINE_STORE).
// Prescription-only medicines need an approved prescription: the
// patient uploads a photo here, a pharmacist reviews it, and the
// patient checks out with the approved prescription's id.

type Cart = Record<string, number>;

const cartKey = (branchId: string) => `zapeera-store-cart-${branchId}`;
const pkr = (n: number) => `PKR ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Storefront = () => {
  const { branchId = "" } = useParams<{ branchId: string }>();
  const [info, setInfo] = useState<StoreInfo | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(true);
  const [cart, setCart] = useState<Cart>(() => {
    try {
      return JSON.parse(localStorage.getItem(cartKey(branchId)) || "{}") as Cart;
    } catch {
      return {};
    }
  });

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [prescriptionId, setPrescriptionId] = useState("");
  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState<{ invoiceNumber?: string | null; totalAmount?: number } | null>(null);

  const [upName, setUpName] = useState("");
  const [upPhone, setUpPhone] = useState("");
  const [upDoctor, setUpDoctor] = useState("");
  const [upImage, setUpImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedId, setUploadedId] = useState("");

  const [statusId, setStatusId] = useState("");
  const [statusPhone, setStatusPhone] = useState("");
  const [statusResult, setStatusResult] = useState<{ reviewStatus: string; reviewNote?: string | null; patientName: string } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const loadCatalog = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const infoRes = await apiService.getStoreInfo(branchId);
      if (!infoRes.success || !infoRes.data) {
        setNotFound(true);
        return;
      }
      setInfo(infoRes.data);
      const catRes = await apiService.getStoreCatalog(branchId, { limit: 100 });
      if (catRes.success && catRes.data) setProducts(catRes.data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    try {
      localStorage.setItem(cartKey(branchId), JSON.stringify(cart));
    } catch {
      // ignore
    }
  }, [cart, branchId]);

  const searchCatalog = useCallback(async (term: string) => {
    if (!branchId) return;
    const res = await apiService.getStoreCatalog(branchId, { search: term.trim() || undefined, limit: 100 });
    if (res.success && res.data) setProducts(res.data);
  }, [branchId]);

  useEffect(() => {
    const t = setTimeout(() => void searchCatalog(search), 300);
    return () => clearTimeout(t);
  }, [search, searchCatalog]);

  const visibleProducts = useMemo(
    () => (inStockOnly ? products.filter((p) => p.inStock) : products),
    [products, inStockOnly]
  );

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, qty]) => ({ product: products.find((p) => p.id === productId), qty }))
        .filter((l): l is { product: StoreProduct; qty: number } => !!l.product),
    [cart, products]
  );
  const cartTotal = useMemo(
    () => cartLines.reduce((sum, l) => sum + l.product.price * l.qty, 0),
    [cartLines]
  );
  const cartHasRx = useMemo(() => cartLines.some((l) => l.product.requiresPrescription), [cartLines]);

  const setQty = (product: StoreProduct, qty: number) => {
    setCart((prev) => {
      const next = { ...prev };
      const clamped = Math.max(0, Math.min(product.stock, qty));
      if (clamped <= 0) delete next[product.id];
      else next[product.id] = clamped;
      return next;
    });
  };

  const placeOrder = async () => {
    if (cartLines.length === 0) {
      toast({ title: "Cart is empty", description: "Add a medicine first.", variant: "destructive" });
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      toast({ title: "Your details are needed", description: "Name and phone are required for a delivery order.", variant: "destructive" });
      return;
    }
    if (cartHasRx && !prescriptionId.trim()) {
      toast({
        title: "Prescription needed",
        description: "Your cart has prescription-only medicines. Upload a prescription below and check out with its approved id.",
        variant: "destructive",
      });
      return;
    }
    setPlacing(true);
    try {
      const res = await apiService.checkoutStoreOrder(branchId, {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        deliveryAddress: deliveryAddress.trim() || null,
        deliveryNotes: deliveryNotes.trim() || null,
        prescriptionId: prescriptionId.trim() || null,
        items: cartLines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
      });
      if (!res.success || !res.data) {
        toast({ title: "Order could not be placed", description: res.message || "Please try again.", variant: "destructive" });
        return;
      }
      const data = res.data as { invoiceNumber?: string | null; totalAmount?: number };
      setOrder({ invoiceNumber: data.invoiceNumber, totalAmount: data.totalAmount });
      setCart({});
      toast({ title: "Order placed", description: "Pay cash on delivery. The pharmacy will confirm your order." });
    } finally {
      setPlacing(false);
    }
  };

  const onUploadFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Please use a photo under 5 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setUpImage(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const uploadPrescription = async () => {
    if (!upName.trim() || !upImage) {
      toast({ title: "Missing details", description: "Your name and a photo of the prescription are required.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const res = await apiService.uploadStorePrescription(branchId, {
        patientName: upName.trim(),
        patientPhone: upPhone.trim() || null,
        doctorName: upDoctor.trim() || null,
        imageUrl: upImage,
      });
      if (!res.success || !res.data) {
        toast({ title: "Upload failed", description: res.message || "Please try again.", variant: "destructive" });
        return;
      }
      setUploadedId(res.data.id);
      setStatusId(res.data.id);
      setStatusPhone(upPhone.trim());
      toast({ title: "Prescription uploaded", description: "A pharmacist will review it. Check its status below." });
    } finally {
      setUploading(false);
    }
  };

  const checkStatus = async () => {
    if (!statusId.trim() || !statusPhone.trim()) {
      toast({ title: "Missing details", description: "Enter the prescription id and the phone you uploaded with.", variant: "destructive" });
      return;
    }
    setCheckingStatus(true);
    try {
      const res = await apiService.getStorePrescriptionStatus(branchId, statusId.trim(), statusPhone.trim());
      if (!res.success || !res.data) {
        setStatusResult(null);
        toast({ title: "Not found", description: "Check the id and phone, then try again.", variant: "destructive" });
        return;
      }
      setStatusResult(res.data);
    } finally {
      setCheckingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fa]">
        <Loader2 className="h-8 w-8 animate-spin text-[#1a52c5]" />
      </div>
    );
  }

  if (notFound || !info) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f4f6fa] px-4 text-center">
        <Store className="h-10 w-10 text-[#8c95b0]" />
        <h1 className="text-xl font-bold text-[#0a1128]">Store not found</h1>
        <p className="max-w-md text-sm text-[#5b6b8c]">This store link is not valid, or the pharmacy has not enabled its online store yet.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6fa] pb-16">
      <header className="border-b bg-white px-4 py-5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#0a1128]">{info.business.name}</h1>
            <p className="text-sm text-[#5b6b8c]">
              {info.branch.name}
              {info.branch.address ? ` · ${info.branch.address}` : ""}
              {info.branch.phone ? ` · ${info.branch.phone}` : ""}
            </p>
          </div>
          <Badge className="bg-[#e8f5e9] text-[#1b7a2e] hover:bg-[#e8f5e9]">
            <Truck className="mr-1 h-3.5 w-3.5" /> Cash on delivery
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" />
            <Input
              placeholder="Search medicines, brands, formulas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 rounded-[10px] bg-white pl-9"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#0a1128]">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
            In stock only
          </label>
        </div>

        {visibleProducts.length === 0 ? (
          <p className="rounded-[10px] border bg-white px-4 py-8 text-center text-sm text-[#5b6b8c]">
            No medicines found{search ? ` for “${search}”` : ""}.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProducts.map((p) => {
              const qty = cart[p.id] || 0;
              return (
                <div key={p.id} className="rounded-[10px] border bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-[#0a1128]">{p.name}</h3>
                      {p.formula ? <p className="truncate text-xs text-[#8c95b0]">{p.formula}</p> : null}
                      {p.category ? <p className="text-xs text-[#5b6b8c]">{p.category.name}</p> : null}
                    </div>
                    {p.requiresPrescription ? <Badge variant="outline">Rx</Badge> : null}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-base font-bold text-[#0a1128]">{pkr(p.price)}</p>
                      <p className="text-xs text-[#5b6b8c]">{p.inStock ? `${p.stock} in stock` : "Out of stock"}</p>
                    </div>
                    {!p.inStock ? (
                      <Button disabled size="sm" variant="outline">Out of stock</Button>
                    ) : qty === 0 ? (
                      <Button size="sm" onClick={() => setQty(p, 1)}>Add</Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setQty(p, qty - 1)}><Minus className="h-3.5 w-3.5" /></Button>
                        <span className="w-6 text-center text-sm font-bold">{qty}</span>
                        <Button size="sm" variant="outline" onClick={() => setQty(p, qty + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <section className="rounded-[10px] border bg-white p-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-[#0a1128]">
            <ShoppingCart className="h-5 w-5" /> Your order
          </h2>
          {order ? (
            <div className="mt-3 rounded-[10px] bg-[#e8f5e9] px-4 py-3 text-sm text-[#1b7a2e]">
              <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Order placed</p>
              <p className="mt-1">
                {order.invoiceNumber ? `Invoice ${order.invoiceNumber} · ` : ""}
                {order.totalAmount !== undefined ? `Total ${pkr(order.totalAmount)} · ` : ""}Pay cash on delivery.
              </p>
              <Button variant="outline" size="sm" className="mt-3 bg-white" onClick={() => setOrder(null)}>Place another order</Button>
            </div>
          ) : cartLines.length === 0 ? (
            <p className="mt-2 text-sm text-[#5b6b8c]">Your cart is empty. Add medicines above to order.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {cartLines.map(({ product, qty }) => (
                <div key={product.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[#0a1128]">
                    {product.name} {product.requiresPrescription ? <Badge variant="outline" className="ml-1">Rx</Badge> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setQty(product, qty - 1)}><Minus className="h-3.5 w-3.5" /></Button>
                    <span className="w-6 text-center font-bold">{qty}</span>
                    <Button size="sm" variant="outline" onClick={() => setQty(product, qty + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                    <span className="w-20 text-right font-bold">{pkr(product.price * qty)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setQty(product, 0)}><Trash2 className="h-4 w-4" /></Button>
                  </span>
                </div>
              ))}
              <p className="border-t pt-2 text-right text-base font-bold text-[#0a1128]">Total {pkr(cartTotal)}</p>
              {cartHasRx ? (
                <p className="rounded-[10px] bg-[#fff7e0] px-3 py-2 text-xs text-[#7a5b00]">
                  Your cart has prescription-only medicines. Upload a prescription below and paste its approved id here — the pharmacy must approve it before you can check out.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label>Your name *</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Full name" className="mt-1" /></div>
                <div><Label>Phone *</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="03XX-XXXXXXX" className="mt-1" /></div>
                <div><Label>Delivery address</Label><Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="House, street, area (leave empty for pickup)" className="mt-1" /></div>
                <div><Label>Approved prescription id {cartHasRx ? "*" : "(if any)"}</Label><Input value={prescriptionId} onChange={(e) => setPrescriptionId(e.target.value)} placeholder="Paste the id from your approved upload" className="mt-1" /></div>
                <div className="sm:col-span-2"><Label>Delivery notes</Label><Textarea value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} placeholder="Anything the pharmacy should know" className="mt-1" /></div>
              </div>
              <Button className="w-full" disabled={placing} onClick={() => void placeOrder()}>
                {placing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Place order · {pkr(cartTotal)} (cash on delivery)
              </Button>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-[10px] border bg-white p-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0a1128]">
              <FileUp className="h-5 w-5" /> Upload a prescription
            </h2>
            <p className="mt-1 text-xs text-[#5b6b8c]">A pharmacist reviews your prescription before the medicines can be dispensed. You get an id to check out with once it is approved.</p>
            <div className="mt-3 space-y-3">
              <div><Label>Your name *</Label><Input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="Patient name" className="mt-1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={upPhone} onChange={(e) => setUpPhone(e.target.value)} placeholder="For status checks" className="mt-1" /></div>
                <div><Label>Doctor</Label><Input value={upDoctor} onChange={(e) => setUpDoctor(e.target.value)} placeholder="Doctor name (optional)" className="mt-1" /></div>
              </div>
              <div>
                <Label>Prescription photo *</Label>
                <Input type="file" accept="image/*" onChange={(e) => onUploadFile(e.target.files?.[0])} className="mt-1" />
                {upImage ? <img src={upImage} alt="Prescription preview" className="mt-2 max-h-48 rounded-[10px] border object-contain" /> : null}
              </div>
              <Button disabled={uploading} onClick={() => void uploadPrescription()}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Upload for review
              </Button>
              {uploadedId ? (
                <p className="rounded-[10px] bg-[#e8f0fe] px-3 py-2 text-xs text-[#1a52c5]">
                  Uploaded. Your prescription id is <span className="font-mono font-bold">{uploadedId}</span> — save it for the status check and checkout.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-[10px] border bg-white p-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0a1128]">
              <Clock className="h-5 w-5" /> Check prescription status
            </h2>
            <div className="mt-3 space-y-3">
              <div><Label>Prescription id</Label><Input value={statusId} onChange={(e) => setStatusId(e.target.value)} placeholder="Paste the id from your upload" className="mt-1" /></div>
              <div><Label>Phone used at upload</Label><Input value={statusPhone} onChange={(e) => setStatusPhone(e.target.value)} placeholder="Same phone as the upload" className="mt-1" /></div>
              <Button variant="outline" disabled={checkingStatus} onClick={() => void checkStatus()}>
                {checkingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Check status
              </Button>
              {statusResult ? (
                <div className="rounded-[10px] border px-3 py-2 text-sm">
                  <p className="flex items-center gap-2 font-bold text-[#0a1128]">
                    {statusResult.reviewStatus === "REVIEWED" ? <CheckCircle2 className="h-4 w-4 text-[#1b7a2e]" /> : null}
                    {statusResult.reviewStatus === "PENDING" ? <Clock className="h-4 w-4 text-[#7a5b00]" /> : null}
                    {statusResult.reviewStatus === "REJECTED" ? <XCircle className="h-4 w-4 text-[#b3261e]" /> : null}
                    {statusResult.reviewStatus === "REVIEWED" ? "Approved — you can check out with this prescription" : null}
                    {statusResult.reviewStatus === "PENDING" ? "Under review — please check back" : null}
                    {statusResult.reviewStatus === "REJECTED" ? "Not approved by the pharmacist" : null}
                  </p>
                  {statusResult.reviewNote ? <p className="mt-1 text-xs text-[#5b6b8c]">Pharmacist note: {statusResult.reviewNote}</p> : null}
                  {statusResult.reviewStatus === "REVIEWED" ? (
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setPrescriptionId(statusId.trim());
                        toast({ title: "Prescription attached", description: "Its id is now in the checkout form." });
                      }}
                    >
                      Use in checkout
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Storefront;
