import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, ShoppingCart, Plus, Minus, Trash2, MonitorSmartphone, CheckCircle2, Loader2 } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Public self-ordering kiosk (Wave C9 — gap item 9, retail only).
// No login, no layout: a customer on the branch tablet opens
// /kiosk/<branchId> and orders from that ONE branch only. Prices and
// stock come from the server; the order is a real POS sale (channel
// KIOSK, PENDING) paid at the counter. Prescription-only products
// are never listed — a kiosk cannot take a prescription, so those
// stay counter sales.

type Cart = Record<string, number>;

const pkr = (n: number) => `PKR ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface KioskProduct {
  id: string;
  name: string;
  categoryId: string | null;
  price: number;
  stock: number;
  inStock: boolean;
}

const Kiosk = () => {
  const { branchId = "" } = useParams<{ branchId: string }>();
  const [info, setInfo] = useState<{ branchId: string; branchName: string; companyName: string; address: string | null; phone: string | null } | null>(null);
  const [products, setProducts] = useState<KioskProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState<{ invoiceNumber?: string | null; totalAmount?: number } | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const infoRes = await apiService.getKioskInfo(branchId);
      if (!infoRes.success || !infoRes.data) {
        if ((infoRes as any)?.code === "GIFT_CARD_KIOSK_NOT_ENABLED") setNotEnabled(true);
        else setNotFound(true);
        return;
      }
      setInfo(infoRes.data);
      const catRes = await apiService.getKioskCatalog(branchId, { inStock: true });
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, quantity]) => {
          const product = products.find((p) => p.id === productId);
          if (!product) return null;
          return { product, quantity, lineTotal: product.price * quantity };
        })
        .filter((l): l is { product: KioskProduct; quantity: number; lineTotal: number } => !!l),
    [cart, products]
  );
  const cartTotal = useMemo(() => cartLines.reduce((s, l) => s + l.lineTotal, 0), [cartLines]);
  const cartCount = useMemo(() => cartLines.reduce((s, l) => s + l.quantity, 0), [cartLines]);

  const addToCart = (product: KioskProduct) => {
    if (!product.inStock) return;
    setCart((prev) => {
      const next = { ...prev, [product.id]: Math.min((prev[product.id] || 0) + 1, product.stock) };
      return next;
    });
  };
  const setQty = (product: KioskProduct, quantity: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[product.id];
      else next[product.id] = Math.min(quantity, product.stock);
      return next;
    });
  };

  const placeOrder = async () => {
    if (cartLines.length === 0) return;
    setPlacing(true);
    try {
      const res = await apiService.checkoutKioskOrder(branchId, {
        items: cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
      });
      if (!res.success || !res.data) {
        toast({ title: "Order failed", description: res.message || "Please try again or ask a staff member.", variant: "destructive" });
        return;
      }
      setOrder({ invoiceNumber: (res.data as any).invoiceNumber ?? null, totalAmount: (res.data as any).totalAmount ?? cartTotal });
      setCart({});
    } finally {
      setPlacing(false);
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#f4f6fa] px-4 text-center">
        <MonitorSmartphone className="h-10 w-10 text-[#8c95b0]" />
        <h1 className="text-xl font-extrabold">Kiosk not found</h1>
        <p className="text-sm text-muted-foreground">This ordering screen does not exist or is switched off. Please ask a staff member.</p>
      </div>
    );
  }

  if (notEnabled) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#f4f6fa] px-4 text-center">
        <MonitorSmartphone className="h-10 w-10 text-[#8c95b0]" />
        <h1 className="text-xl font-extrabold">Self-ordering is not switched on here yet</h1>
        <p className="text-sm text-muted-foreground">Please order at the counter — a staff member will help you.</p>
      </div>
    );
  }

  if (order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f4f6fa] px-4 text-center">
        <CheckCircle2 className="h-14 w-14 text-emerald-600" />
        <h1 className="text-2xl font-extrabold">Order placed!</h1>
        <p className="text-base">
          Order <strong className="font-mono">{order.invoiceNumber || "—"}</strong> • {pkr(order.totalAmount || 0)}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Please go to the counter to pay. Show this screen or quote your order number — your items are being prepared.
        </p>
        <Button
          size="lg"
          onClick={() => {
            setOrder(null);
            setCustomerName("");
            setCustomerPhone("");
          }}
        >
          Place another order
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6fa]">
      <header className="sticky top-0 z-10 border-b bg-[#0a1128] px-4 py-4 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <MonitorSmartphone className="h-5 w-5 text-white/70" /> {info.companyName}
            </p>
            <p className="text-xs text-white/60">
              {info.branchName}
              {info.address ? ` • ${info.address}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold">
            <ShoppingCart className="h-4 w-4" /> {cartCount} item{cartCount === 1 ? "" : "s"} • {pkr(cartTotal)}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8c95b0]" />
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 rounded-[12px] bg-white pl-10 text-base"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {products.length === 0 ? "Nothing in stock to order right now — please ask at the counter." : "No products match your search."}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((product) => {
              const qty = cart[product.id] || 0;
              return (
                <div key={product.id} className="flex flex-col justify-between rounded-[14px] border bg-white p-3">
                  <div>
                    <p className="min-h-[2.5rem] text-sm font-bold leading-snug">{product.name}</p>
                    <p className="mt-1 text-lg font-extrabold tabular-nums">{pkr(product.price)}</p>
                    <p className="text-xs text-muted-foreground">{product.stock} in stock</p>
                  </div>
                  {qty === 0 ? (
                    <Button className="mt-3 h-11 text-base" onClick={() => addToCart(product)}>
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                  ) : (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Button size="icon" variant="outline" className="h-11 w-11" onClick={() => setQty(product, qty - 1)}>
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="text-lg font-extrabold tabular-nums">{qty}</span>
                      <Button size="icon" variant="outline" className="h-11 w-11" onClick={() => setQty(product, qty + 1)} disabled={qty >= product.stock}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {cartLines.length > 0 && (
          <section className="mt-6 rounded-[14px] border bg-white p-4">
            <h2 className="text-base font-bold">Your order</h2>
            <ul className="mt-2 divide-y">
              {cartLines.map(({ product, quantity, lineTotal }) => (
                <li key={product.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {quantity} × {product.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{pkr(product.price)} each</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-bold tabular-nums">{pkr(lineTotal)}</span>
                    <button type="button" onClick={() => setQty(product, 0)} aria-label={`Remove ${product.name}`} className="text-rose-600 hover:underline">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Your name (optional)</Label>
                <Input placeholder="So the counter can call you" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone (optional)</Label>
                <Input placeholder="03xx-xxxxxxx" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="h-11" />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-lg font-extrabold tabular-nums">Total {pkr(cartTotal)}</p>
              <Button size="lg" className="h-12 px-6 text-base" onClick={() => void placeOrder()} disabled={placing}>
                {placing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShoppingCart className="mr-2 h-5 w-5" />}
                Place order — pay at counter
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Medicines that need a prescription are not sold here — please ask at the counter for those.
            </p>
          </section>
        )}
      </main>
    </div>
  );
};

export default Kiosk;
