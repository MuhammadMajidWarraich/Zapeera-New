import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, MoonStar, LogOut, Plus, Wallet } from "lucide-react";
import {
  apiService,
  type FolioRecord,
} from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Folio detail (Wave C5 — Hotel pack), shared by the Front Desk
// board, the Folios register and the Reservations page. The folio is
// the stay's bill: charges (room nights, POS charge-to-room, desk
// charges) minus payments/advances = balance, all computed by the
// server from the rows. From here the desk adds charges and
// payments, posts tonight's room night, and checks the guest out —
// check-out settles the balance (final payment or an explicit
// manager write-off) and bills the folio-native charges as one
// invoice through the sale engine.

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "MOBILE"];

const KIND_STYLES: Record<string, string> = {
  ROOM_NIGHT: "bg-indigo-100 text-indigo-800",
  SERVICE: "bg-sky-100 text-sky-800",
  MANUAL: "bg-amber-100 text-amber-800",
};

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const dayLabel = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "—");

interface FolioDialogProps {
  folioId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

const FolioDialog: React.FC<FolioDialogProps> = ({ folioId, open, onOpenChange, onChanged }) => {
  const [folio, setFolio] = useState<FolioRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [chargeDesc, setChargeDesc] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeKind, setChargeKind] = useState<"SERVICE" | "MANUAL">("MANUAL");

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");
  const [payNote, setPayNote] = useState("");

  const [coPayAmount, setCoPayAmount] = useState("");
  const [coPayMethod, setCoPayMethod] = useState("CASH");
  const [writeOff, setWriteOff] = useState(false);
  const [writeOffNote, setWriteOffNote] = useState("");

  const load = useCallback(async () => {
    if (!folioId) return;
    setLoading(true);
    try {
      const response = await apiService.getFolio(folioId);
      if (response.success && response.data) {
        setFolio(response.data);
        const balance = response.data.summary?.balance || 0;
        setCoPayAmount(balance > 0 ? String(balance) : "");
      }
    } catch {
      toast({ title: "Could not load the folio", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [folioId]);

  useEffect(() => {
    if (open && folioId) {
      setFolio(null);
      setChargeDesc("");
      setChargeAmount("");
      setPayAmount("");
      setPayNote("");
      setWriteOff(false);
      setWriteOffNote("");
      load();
    }
  }, [open, folioId, load]);

  const act = async (fn: () => Promise<any>, successMessage: string) => {
    setBusy(true);
    try {
      const response = await fn();
      if (response?.success) {
        toast({ title: successMessage });
        await load();
        onChanged?.();
        return true;
      }
      toast({ title: response?.message || "Something went wrong", variant: "destructive" });
      return false;
    } catch (err: any) {
      toast({ title: err?.message || "Something went wrong", variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addCharge = () =>
    act(
      () =>
        apiService.addFolioCharge(folio!.id, {
          description: chargeDesc.trim(),
          amount: Number(chargeAmount),
          kind: chargeKind,
        }),
      "Charge added"
    ).then((ok) => {
      if (ok) {
        setChargeDesc("");
        setChargeAmount("");
      }
    });

  const addPayment = () =>
    act(
      () =>
        apiService.addFolioPayment(folio!.id, {
          amount: Number(payAmount),
          method: payMethod,
          note: payNote.trim() || null,
        }),
      Number(payAmount) < 0 ? "Refund recorded" : "Payment recorded"
    ).then((ok) => {
      if (ok) {
        setPayAmount("");
        setPayNote("");
      }
    });

  const postNight = () => act(() => apiService.postNightCharge(folio!.id), "Room night posted");

  const checkOut = async () => {
    if (!folio) return;
    const balance = folio.summary?.balance || 0;
    const data: any = {};
    const pay = Number(coPayAmount);
    if (balance > 0.01 && pay > 0) {
      data.payment = { amount: pay, method: coPayMethod };
    }
    if (writeOff) {
      data.writeOff = true;
      data.writeOffNote = writeOffNote.trim();
    }
    setBusy(true);
    try {
      const response = await apiService.checkOutFolio(folio.id, data);
      if (response.success) {
        const sale = (response.data as any)?.sale;
        toast({
          title: "Checked out",
          description: sale?.invoiceNumber
            ? `Checkout invoice ${sale.invoiceNumber} — ${money(sale.totalAmount)}`
            : "Folio closed",
        });
        await load();
        onChanged?.();
      } else {
        toast({ title: (response as any)?.message || "Check-out failed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Check-out failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const isOpen = folio?.status === "OPEN";
  const balance = folio?.summary?.balance || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Folio — Room {folio?.room?.number || "—"}
            {folio ? ` · ${folio.guestName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {folio
              ? `${folio.room?.roomType?.name || "Room"} at ${money(folio.rateSnapshot)}/night · opened ${dayLabel(folio.openedAt)} · ${folio.status}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {loading || !folio ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Total charges</div>
                <div className="font-semibold">{money(folio.summary?.totalCharges)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Paid / advances</div>
                <div className="font-semibold">{money(folio.summary?.totalPayments)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Room nights posted</div>
                <div className="font-semibold">
                  {folio.summary?.roomNightCount || 0} · {money(folio.summary?.roomNightTotal)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Balance</div>
                <div className={`font-semibold ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                  {money(balance)}
                </div>
              </div>
            </div>
            {(folio.summary?.chargedToRoomTotal || 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Includes {money(folio.summary?.chargedToRoomTotal)} of POS sales charged to the room —
                those are already invoices and are not re-billed at check-out. The checkout invoice
                covers the folio's own charges ({money(folio.summary?.nativeTotal)}).
              </p>
            )}
            {folio.status === "CLOSED" && (
              <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
                <div>
                  Closed {dayLabel(folio.closedAt)}
                  {folio.checkoutSale?.invoiceNumber
                    ? ` · checkout invoice ${folio.checkoutSale.invoiceNumber} (${money(folio.checkoutSale.totalAmount)})`
                    : ""}
                </div>
                {folio.writeOffAmount ? (
                  <div>
                    Written off: {money(folio.writeOffAmount)}
                    {folio.writeOffNote ? ` — ${folio.writeOffNote}` : ""}
                  </div>
                ) : null}
              </div>
            )}

            <div>
              <h4 className="font-medium mb-2">Charges</h4>
              <div className="rounded-lg border divide-y">
                {(folio.charges || []).length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No charges yet.</div>
                )}
                {(folio.charges || []).map((charge) => (
                  <div key={charge.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge className={KIND_STYLES[charge.kind] || ""}>{charge.kind}</Badge>
                      <span>{charge.description}</span>
                      <span className="text-muted-foreground">{dayLabel(charge.chargeDate)}</span>
                      {charge.saleId && <span className="text-muted-foreground">(POS sale)</span>}
                    </div>
                    <span className="font-medium">{money(charge.amount)}</span>
                  </div>
                ))}
              </div>
              {isOpen && (
                <div className="flex flex-wrap items-end gap-2 mt-3">
                  <div className="flex-1 min-w-[180px]">
                    <Label>Description</Label>
                    <Input
                      value={chargeDesc}
                      onChange={(e) => setChargeDesc(e.target.value)}
                      placeholder="Laundry, airport pickup…"
                    />
                  </div>
                  <div className="w-32">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      value={chargeAmount}
                      onChange={(e) => setChargeAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="w-36">
                    <Label>Kind</Label>
                    <Select value={chargeKind} onValueChange={(v) => setChargeKind(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANUAL">Manual</SelectItem>
                        <SelectItem value="SERVICE">Service</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={addCharge}
                    disabled={busy || !chargeDesc.trim() || !(Number(chargeAmount) > 0)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add charge
                  </Button>
                  <Button variant="outline" onClick={postNight} disabled={busy}>
                    <MoonStar className="h-4 w-4 mr-1" /> Post tonight's room night
                  </Button>
                </div>
              )}
            </div>

            <div>
              <h4 className="font-medium mb-2">Payments & advances</h4>
              <div className="rounded-lg border divide-y">
                {(folio.payments || []).length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No payments yet.</div>
                )}
                {(folio.payments || []).map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{payment.method}</Badge>
                      <span>{dayLabel(payment.paidAt)}</span>
                      {payment.note && <span className="text-muted-foreground">{payment.note}</span>}
                      {payment.amount < 0 && <span className="text-red-600">(refund)</span>}
                    </div>
                    <span className="font-medium">{money(payment.amount)}</span>
                  </div>
                ))}
              </div>
              {isOpen && (
                <div className="flex flex-wrap items-end gap-2 mt-3">
                  <div className="w-32">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="0 (negative = refund)"
                    />
                  </div>
                  <div className="w-40">
                    <Label>Method</Label>
                    <Select value={payMethod} onValueChange={setPayMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <Label>Note</Label>
                    <Input
                      value={payNote}
                      onChange={(e) => setPayNote(e.target.value)}
                      placeholder="Advance, refund reason…"
                    />
                  </div>
                  <Button
                    onClick={addPayment}
                    disabled={busy || !payAmount || Number(payAmount) === 0}
                  >
                    <Wallet className="h-4 w-4 mr-1" /> Record payment
                  </Button>
                </div>
              )}
            </div>

            {isOpen && (
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <LogOut className="h-4 w-4" /> Check out
                </h4>
                {balance < -0.01 && (
                  <p className="text-sm text-amber-700">
                    This folio is {money(Math.abs(balance))} in credit. Refund the guest first
                    (a negative payment above) so the folio closes at zero.
                  </p>
                )}
                {balance > 0.01 && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-36">
                      <Label>Final payment</Label>
                      <Input
                        type="number"
                        min="0"
                        value={coPayAmount}
                        onChange={(e) => setCoPayAmount(e.target.value)}
                      />
                    </div>
                    <div className="w-40">
                      <Label>Method</Label>
                      <Select value={coPayMethod} onValueChange={setCoPayMethod}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm pb-2">
                      <input
                        type="checkbox"
                        checked={writeOff}
                        onChange={(e) => setWriteOff(e.target.checked)}
                      />
                      Write off the rest (manager)
                    </label>
                    {writeOff && (
                      <div className="flex-1 min-w-[200px]">
                        <Label>Write-off reason</Label>
                        <Input
                          value={writeOffNote}
                          onChange={(e) => setWriteOffNote(e.target.value)}
                          placeholder="Why is the balance forgiven?"
                        />
                      </div>
                    )}
                  </div>
                )}
                <Button
                  onClick={checkOut}
                  disabled={
                    busy ||
                    balance < -0.01 ||
                    (balance > 0.01 &&
                      !(Number(coPayAmount) > 0) &&
                      !writeOff) ||
                    (writeOff && !writeOffNote.trim())
                  }
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Check out & close folio
                </Button>
                {balance > 0.01 && (
                  <p className="text-xs text-muted-foreground">
                    Check-out needs the balance settled: take a final payment covering it,
                    or write the remainder off with a reason.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FolioDialog;
