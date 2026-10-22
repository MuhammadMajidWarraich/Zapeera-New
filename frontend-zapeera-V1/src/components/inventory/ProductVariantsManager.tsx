import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Sparkles, PowerOff, RotateCcw } from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { buildVariantMatrix, type ProductVariantLite } from "@/utils/variants";

// Wave C6 — Product variants manager.
// A product's variants are its size x colour matrix. This dialog:
//   • generates the matrix from comma-separated sizes x colours
//     (the server skips combinations that already exist),
//   • edits each variant's SKU / barcode / price delta inline,
//   • deactivates a variant (soft — its batches and sale history
//     keep pointing at it; the POS stops offering it),
//   • adds a single custom variant by name.
// Stock is NOT edited here — it lives on batches of the variant
// (Batches page, variant picker).

interface ProductVariantsManagerProps {
  product: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

interface VariantDraft {
  sku: string;
  barcode: string;
  priceDelta: string;
}

const ProductVariantsManager: React.FC<ProductVariantsManagerProps> = ({
  product,
  open,
  onOpenChange,
  onChanged,
}) => {
  const [variants, setVariants] = useState<ProductVariantLite[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VariantDraft>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [sizesText, setSizesText] = useState("");
  const [colorsText, setColorsText] = useState("");
  const [customName, setCustomName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!product) return;
    setIsLoading(true);
    try {
      const response = await apiService.getProductVariants(product.id);
      if (response.success && Array.isArray(response.data)) {
        setVariants(response.data as ProductVariantLite[]);
        const next: Record<string, VariantDraft> = {};
        for (const v of response.data as ProductVariantLite[]) {
          next[v.id] = {
            sku: v.sku || "",
            barcode: v.barcode || "",
            priceDelta: String(v.priceDelta ?? 0),
          };
        }
        setDrafts(next);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load variants", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [product]);

  useEffect(() => {
    if (open && product) {
      void load();
    }
  }, [open, product, load]);

  if (!product) return null;

  const splitList = (text: string) =>
    text.split(",").map((s) => s.trim()).filter(Boolean);

  const previewCount = buildVariantMatrix(splitList(sizesText), splitList(colorsText)).length;

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await apiService.generateProductVariants(product.id, {
        sizes: splitList(sizesText),
        colors: splitList(colorsText),
      });
      if (response.success) {
        toast({
          title: "Variants generated",
          description: `${response.data?.created?.length ?? 0} created, ${response.data?.skipped ?? 0} already existed`,
        });
        setSizesText("");
        setColorsText("");
        await load();
        onChanged?.();
      } else {
        toast({ title: "Could not generate", description: (response as any)?.message || "Please add at least one size or colour", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not generate", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddCustom = async () => {
    const name = customName.trim();
    if (!name) return;
    setBusyId("__custom__");
    try {
      const response = await apiService.createProductVariant(product.id, { name });
      if (response.success) {
        setCustomName("");
        await load();
        onChanged?.();
      } else {
        toast({ title: "Could not add variant", description: (response as any)?.message || "Failed", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not add variant", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveDraft = async (variant: ProductVariantLite) => {
    const draft = drafts[variant.id];
    if (!draft) return;
    setBusyId(variant.id);
    try {
      const response = await apiService.updateProductVariant(product.id, variant.id, {
        sku: draft.sku.trim() || null,
        barcode: draft.barcode.trim() || null,
        priceDelta: parseFloat(draft.priceDelta) || 0,
      });
      if (response.success) {
        toast({ title: "Variant saved", description: variant.name });
        await load();
        onChanged?.();
      } else {
        toast({ title: "Could not save", description: (response as any)?.message || "Failed", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not save", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (variant: ProductVariantLite) => {
    setBusyId(variant.id);
    try {
      const response = variant.isActive
        ? await apiService.deactivateProductVariant(product.id, variant.id)
        : await apiService.updateProductVariant(product.id, variant.id, { isActive: true });
      if (response.success) {
        await load();
        onChanged?.();
      } else {
        toast({ title: "Could not update", description: (response as any)?.message || "Failed", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not update", description: error?.message || "Request failed", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Variants — {product.name}</DialogTitle>
          <DialogDescription>
            Variants are sold by name at the POS and each carries its own stock
            (on its batches) and an optional price difference from the base price.
          </DialogDescription>
        </DialogHeader>

        {/* Matrix generator */}
        <div className="rounded-xl border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#1a52c5]" />
            <h4 className="text-sm font-bold text-[#0a1128]">Generate size × colour matrix</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Sizes (comma separated)</label>
              <Input value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="Small, Medium, Large" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Colours (comma separated)</label>
              <Input value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="Red, Blue, Black" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#8c95b0]">
              {previewCount > 0 ? `${previewCount} combination${previewCount === 1 ? "" : "s"} will be created (existing ones are skipped)` : "Add sizes and/or colours to preview the matrix"}
            </p>
            <Button size="sm" onClick={handleGenerate} disabled={isGenerating || previewCount === 0}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="ml-1.5">Generate</span>
            </Button>
          </div>
        </div>

        {/* Variant list */}
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-[#8c95b0]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : variants.length === 0 ? (
            <p className="py-4 text-center text-sm text-[#8c95b0]">
              No variants yet. Generate a matrix above or add a custom variant below —
              the product sells as a single item until it has variants.
            </p>
          ) : (
            variants.map((variant) => {
              const draft = drafts[variant.id] || { sku: "", barcode: "", priceDelta: "0" };
              const dirty =
                draft.sku !== (variant.sku || "") ||
                draft.barcode !== (variant.barcode || "") ||
                (parseFloat(draft.priceDelta) || 0) !== (variant.priceDelta ?? 0);
              return (
                <div
                  key={variant.id}
                  className={`rounded-xl border p-3 ${variant.isActive ? "border-[rgba(15,23,60,0.08)] bg-white" : "border-[rgba(15,23,60,0.06)] bg-[#f4f6fa] opacity-70"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#0a1128]">{variant.name}</span>
                    {!variant.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                    <span className="text-xs text-[#8c95b0]">Stock: {variant.stock ?? 0}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!dirty || busyId === variant.id}
                        onClick={() => handleSaveDraft(variant)}
                      >
                        {busyId === variant.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={busyId === variant.id}
                        onClick={() => handleToggleActive(variant)}
                        title={variant.isActive ? "Deactivate variant" : "Reactivate variant"}
                      >
                        {variant.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Input
                      value={draft.sku}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [variant.id]: { ...draft, sku: e.target.value } }))}
                      placeholder="SKU"
                      className="h-9 text-sm"
                    />
                    <Input
                      value={draft.barcode}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [variant.id]: { ...draft, barcode: e.target.value } }))}
                      placeholder="Barcode"
                      className="h-9 text-sm"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      value={draft.priceDelta}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [variant.id]: { ...draft, priceDelta: e.target.value } }))}
                      placeholder="Price Δ (e.g. 200 or -50)"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Custom variant */}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Custom variant name</label>
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. XL / Camouflage"
              onKeyDown={(e) => { if (e.key === "Enter") void handleAddCustom(); }}
            />
          </div>
          <Button onClick={handleAddCustom} disabled={!customName.trim() || busyId === "__custom__"}>
            {busyId === "__custom__" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1.5">Add variant</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductVariantsManager;
