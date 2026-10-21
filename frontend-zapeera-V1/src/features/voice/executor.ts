/**
 * Voice Assistant executor: turns parsed intents (intents.ts) into real
 * actions through the app's existing ApiService singleton — no raw fetch,
 * no new endpoints. Write actions (add product / category / sale) are only
 * PREPARED here; the component shows a confirmation card and calls
 * executePending() after the user confirms. Reads and navigation run
 * immediately.
 */

import { apiService } from '@/services/api';
import { withBusinessSlug } from '@/utils/business-routes';
import {
  describeIntent,
  EXAMPLE_COMMANDS,
  type NavTarget,
  type VoiceIntent,
} from './intents';

export interface VoiceResult {
  ok: boolean;
  title: string;
  lines: string[];
  speak: string;
}

export interface PendingAction {
  kind: 'add_product' | 'add_category' | 'create_sale';
  summary: string;
  detailLines: string[];
  speakPrompt: string;
  run: () => Promise<VoiceResult>;
}

export type ExecutionOutcome =
  | { kind: 'result'; result: VoiceResult }
  | { kind: 'confirm'; pending: PendingAction }
  | {
      kind: 'choices';
      title: string;
      speak: string;
      options: Array<{ key: string; label: string; pending: PendingAction }>;
    };

export interface VoiceContext {
  branchId?: string | null;
  businessSlug?: string | null;
  navigate: (path: string) => void;
}

const fmtRs = (n: number): string =>
  `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

const fmtDate = (iso?: string | null): string => {
  if (!iso) return 'no expiry';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no expiry';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const errResult = (title: string, message?: string | null): VoiceResult => ({
  ok: false,
  title,
  lines: [message || 'Something went wrong. Please try again.'],
  speak: title,
});

const batchQty = (b: any): number => Number(b?.quantity ?? b?.stockQuantity ?? b?.totalStock ?? 0) || 0;

type ProductLite = {
  id: string;
  name: string;
  sellingPrice?: number;
  stock?: number;
};

async function searchProducts(query: string): Promise<{ products: ProductLite[]; error?: string }> {
  try {
    const res: any = await apiService.getProducts({ search: query, limit: 25 } as any);
    if (!res?.success) return { products: [], error: res?.message || 'Product search failed.' };
    return { products: (res.data?.products || []) as ProductLite[] };
  } catch (e: any) {
    return { products: [], error: e?.message || 'Product search failed.' };
  }
}

/** Exact name match wins; otherwise all "contains" matches. */
function rankMatches(products: ProductLite[], query: string): ProductLite[] {
  const q = query.toLowerCase();
  const exact = products.filter((p) => p.name.toLowerCase() === q);
  if (exact.length) return exact;
  return products.filter((p) => p.name.toLowerCase().includes(q));
}

async function prepareSaleForProduct(
  product: ProductLite,
  quantity: number,
  unitPriceOverride: number | undefined,
  ctx: VoiceContext,
): Promise<ExecutionOutcome> {
  if (!ctx.branchId) {
    return {
      kind: 'result',
      result: errResult(
        'No branch selected',
        'Please select a branch first, then say the command again.',
      ),
    };
  }

  let batches: any[] = [];
  try {
    const res: any = await apiService.getBatches({
      productId: product.id,
      branchId: ctx.branchId,
      limit: 100,
    });
    if (res?.success) batches = res.data?.batches || [];
  } catch {
    batches = [];
  }

  // FEFO: earliest expiry first (batches without expiry go last), in stock only.
  const inStock = batches
    .filter((b) => batchQty(b) > 0)
    .sort((a, b) => {
      const ta = a.expireDate ? new Date(a.expireDate).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.expireDate ? new Date(b.expireDate).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

  const batch = inStock[0];
  if (!batch) {
    return {
      kind: 'result',
      result: errResult(
        `${product.name} is out of stock`,
        `No batch with stock was found for ${product.name} in the selected branch.`,
      ),
    };
  }

  const available = batchQty(batch);
  const qty = Math.min(quantity, available);
  const unitPrice =
    unitPriceOverride ??
    Number(batch.sellingPricePerUnit ?? batch.sellingPrice ?? product.sellingPrice ?? 0);
  const total = qty * unitPrice;
  const branchId = ctx.branchId;

  const detailLines = [
    `Product: ${product.name}`,
    `Batch: ${batch.batchNo} · expires ${fmtDate(batch.expireDate)}`,
    `Quantity: ${qty} × ${fmtRs(unitPrice)}`,
    `Total: ${fmtRs(total)} · Cash · Paid in full`,
  ];
  if (qty < quantity) {
    detailLines.push(`Note: you asked for ${quantity}, but this batch only has ${available} in stock.`);
  }

  const pending: PendingAction = {
    kind: 'create_sale',
    summary: `Sell ${qty} × ${product.name} — ${fmtRs(total)}`,
    detailLines,
    speakPrompt: `Sale ready: ${qty} ${product.name}, total ${Math.round(total)} rupees. Say confirm to complete the sale.`,
    run: async () => {
      // Payload mirrors CreateInvoice.tsx (POS) exactly.
      const saleData = {
        items: [
          {
            productId: product.id,
            quantity: qty,
            saleType: 'UNIT',
            unitsPerBox: 1,
            unitsDeducted: qty,
            unitPrice,
            batchId: batch.id || undefined,
            batchNumber: batch.batchNo || undefined,
            expiryDate: batch.expireDate || undefined,
            totalPrice: total,
          },
        ],
        branchId: branchId as string,
        paymentMethod: 'CASH' as const,
        paymentStatus: 'COMPLETED' as const,
        discountAmount: 0,
        discountPercentage: 0,
        paidAmount: total,
        returnedAmount: 0,
        saleDate: new Date().toISOString(),
      };
      try {
        const res: any = await apiService.createSale(saleData as any);
        if (!res?.success) {
          return errResult('Sale failed', res?.message || 'The server rejected the sale.');
        }
        const sale = res.data || {};
        const serverTotal = Number(sale.totalAmount ?? total);
        return {
          ok: true,
          title: 'Sale created',
          lines: [
            `Invoice: ${sale.receiptNumber || sale.id}`,
            `${qty} × ${product.name}`,
            `Total: ${fmtRs(serverTotal)}`,
          ],
          speak: `Sale created. Invoice ${sale.receiptNumber || ''}. Total ${Math.round(serverTotal)} rupees.`,
        };
      } catch (e: any) {
        return errResult('Sale failed', e?.message);
      }
    },
  };

  return { kind: 'confirm', pending };
}

async function handleCreateSale(
  intent: Extract<VoiceIntent, { type: 'create_sale' }>,
  ctx: VoiceContext,
): Promise<ExecutionOutcome> {
  const { products, error } = await searchProducts(intent.productQuery);
  if (error) return { kind: 'result', result: errResult('Product search failed', error) };
  const matches = rankMatches(products, intent.productQuery);
  if (!matches.length) {
    return {
      kind: 'result',
      result: errResult(
        'Product not found',
        `No product matches "${intent.productQuery}". Check the name and try again.`,
      ),
    };
  }
  if (matches.length === 1) {
    return prepareSaleForProduct(matches[0], intent.quantity, intent.unitPrice, ctx);
  }
  // Multiple matches: prepare a pending sale per option (FEFO resolved lazily
  // is overkill here — prepare now, it's a read-only call).
  const options: Array<{ key: string; label: string; pending: PendingAction }> = [];
  for (const p of matches.slice(0, 5)) {
    const outcome = await prepareSaleForProduct(p, intent.quantity, intent.unitPrice, ctx);
    if (outcome.kind === 'confirm') {
      options.push({ key: p.id, label: outcome.pending.summary, pending: outcome.pending });
    }
  }
  if (!options.length) {
    return {
      kind: 'result',
      result: errResult(
        'No stock available',
        `None of the matches for "${intent.productQuery}" have stock in this branch.`,
      ),
    };
  }
  if (options.length === 1) return { kind: 'confirm', pending: options[0].pending };
  return {
    kind: 'choices',
    title: `Which "${intent.productQuery}"?`,
    speak: `I found ${options.length} matching products. Please pick one.`,
    options,
  };
}

export async function executePending(pending: PendingAction): Promise<VoiceResult> {
  return pending.run();
}

export async function runIntent(
  intent: VoiceIntent,
  ctx: VoiceContext,
): Promise<ExecutionOutcome> {
  switch (intent.type) {
    case 'help':
      return {
        kind: 'result',
        result: {
          ok: true,
          title: 'Things you can say',
          lines: EXAMPLE_COMMANDS,
          speak: 'Here are some commands you can try.',
        },
      };

    case 'unknown':
      return {
        kind: 'result',
        result: {
          ok: false,
          title: "I didn't understand that",
          lines: ['Try one of these:', ...EXAMPLE_COMMANDS.slice(0, 4)],
          speak: "Sorry, I didn't understand. Try: sell 2 paracetamol, or, show low stock.",
        },
      };

    case 'navigate': {
      const flatPaths: Record<NavTarget, string> = {
        dashboard: '/dashboard',
        pos: '/pos',
        products: '/inventory',
        sales: '/invoices',
        reports: '/reports',
        inventory: '/inventory',
        categories: '/inventory/categories',
        customers: '/customers',
      };
      const slugPaths: Partial<Record<NavTarget, string>> = {
        dashboard: '/dashboard',
        pos: '/pos',
        products: '/products',
        sales: '/invoices',
        reports: '/reports',
        categories: '/categories',
        customers: '/customers',
      };
      const slugPath = ctx.businessSlug ? slugPaths[intent.target] : undefined;
      const path = slugPath
        ? withBusinessSlug(ctx.businessSlug, slugPath)
        : flatPaths[intent.target];
      ctx.navigate(path);
      return {
        kind: 'result',
        result: {
          ok: true,
          title: `Opening ${intent.target}`,
          lines: [path],
          speak: `Opening ${intent.target}.`,
        },
      };
    }

    case 'add_category': {
      const name = intent.name;
      const pending: PendingAction = {
        kind: 'add_category',
        summary: `Add category "${name}"`,
        detailLines: [`Category name: ${name}`],
        speakPrompt: `Ready to add the category ${name}. Say confirm to create it.`,
        run: async () => {
          try {
            const res: any = await apiService.createCategory({
              name,
              branchId: ctx.branchId || undefined,
            });
            if (!res?.success) return errResult('Could not add category', res?.message);
            return {
              ok: true,
              title: 'Category added',
              lines: [`${res.data?.name || name} is now available.`],
              speak: `Category ${name} added.`,
            };
          } catch (e: any) {
            return errResult('Could not add category', e?.message);
          }
        },
      };
      return { kind: 'confirm', pending };
    }

    case 'add_product': {
      const { name, price, category } = intent;
      // The products API requires name + categoryId + branchId (and
      // rejects unknown keys — a price is NOT a product field; prices
      // live on batches). Resolve both ids up front so the confirm
      // card shows exactly what will be created.
      let branchId = ctx.branchId || null;
      let branchName = '';
      try {
        const bres: any = await apiService.getBranches();
        const branches: any[] = bres?.data?.branches || bres?.data || [];
        if (!branchId && branches.length) branchId = branches[0].id;
        branchName = branches.find((b) => b.id === branchId)?.name || '';
      } catch {
        /* keep the context branch */
      }
      if (!branchId) {
        return {
          kind: 'result',
          result: errResult(
            'No branch available',
            'No branch was found for this business, so the product cannot be created.',
          ),
        };
      }
      let categories: any[] = [];
      try {
        const cres: any = await apiService.getCategories({ branchId, limit: 100 });
        categories =
          cres?.data?.categories ||
          cres?.data?.items ||
          (Array.isArray(cres?.data) ? cres.data : []);
      } catch {
        categories = [];
      }
      const wanted = (category || '').toLowerCase();
      const matched = wanted
        ? categories.find((c) => String(c.name || '').toLowerCase() === wanted) ||
          categories.find((c) => String(c.name || '').toLowerCase().includes(wanted))
        : categories[0];
      const categoryName = matched?.name || category || 'General';
      const existingCategoryId: string | null = matched?.id || null;
      const resolvedBranchId = branchId;
      const pending: PendingAction = {
        kind: 'add_product',
        summary: `Add product "${name}"`,
        detailLines: [
          `Name: ${name}`,
          `Category: ${categoryName}${existingCategoryId ? '' : ' (will be created)'}`,
          ...(branchName ? [`Branch: ${branchName}`] : []),
          ...(price !== undefined
            ? [`Price noted: ${fmtRs(price)} — selling prices live on batches, so it is set when stock is added.`]
            : []),
          'Stock starts at 0 — add a batch/purchase to stock it.',
        ],
        speakPrompt: `Ready to add the product ${name} in category ${categoryName}. Say confirm to create it.`,
        run: async () => {
          try {
            let categoryId = existingCategoryId;
            if (!categoryId) {
              const cres: any = await apiService.createCategory({
                name: categoryName,
                branchId: resolvedBranchId,
              });
              categoryId = cres?.data?.id || cres?.data?.category?.id || null;
              if (!categoryId) {
                return errResult('Could not add product', 'The category could not be created.');
              }
            }
            const res: any = await apiService.createProduct({
              name,
              categoryId,
              branchId: resolvedBranchId,
            });
            if (!res?.success) return errResult('Could not add product', res?.message);
            return {
              ok: true,
              title: 'Product added',
              lines: [`${res.data?.name || name} created in ${categoryName}.`],
              speak: `Product ${name} added.`,
            };
          } catch (e: any) {
            return errResult('Could not add product', e?.message);
          }
        },
      };
      return { kind: 'confirm', pending };
    }

    case 'find_product': {
      const { products, error } = await searchProducts(intent.query);
      if (error) return { kind: 'result', result: errResult('Search failed', error) };
      if (!products.length) {
        return {
          kind: 'result',
          result: errResult('No matches', `No product matches "${intent.query}".`),
        };
      }
      return {
        kind: 'result',
        result: {
          ok: true,
          title: `Found ${products.length} product${products.length > 1 ? 's' : ''}`,
          lines: products.slice(0, 6).map(
            (p) => `${p.name} — ${fmtRs(Number(p.sellingPrice || 0))} · stock ${p.stock ?? '—'}`,
          ),
          speak: `Found ${products.length} product${products.length > 1 ? 's' : ''} matching ${intent.query}.`,
        },
      };
    }

    case 'check_stock': {
      const { products, error } = await searchProducts(intent.query);
      if (error) return { kind: 'result', result: errResult('Search failed', error) };
      const matches = rankMatches(products, intent.query);
      const product = matches[0];
      if (!product) {
        return {
          kind: 'result',
          result: errResult('Product not found', `No product matches "${intent.query}".`),
        };
      }
      let batches: any[] = [];
      try {
        const res: any = await apiService.getBatches({
          productId: product.id,
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
          limit: 100,
        });
        if (res?.success) batches = res.data?.batches || [];
      } catch {
        batches = [];
      }
      const total = batches.length
        ? batches.reduce((sum, b) => sum + batchQty(b), 0)
        : Number(product.stock ?? 0);
      const lines = [`${product.name}: ${total} units in stock`];
      for (const b of batches.slice(0, 5)) {
        lines.push(`Batch ${b.batchNo} · ${batchQty(b)} units · exp ${fmtDate(b.expireDate)}`);
      }
      if (matches.length > 1) {
        lines.push(`Also matched: ${matches.slice(1, 4).map((p) => p.name).join(', ')}`);
      }
      return {
        kind: 'result',
        result: {
          ok: true,
          title: 'Stock check',
          lines,
          speak: `${product.name}: ${total} units in stock.`,
        },
      };
    }

    case 'low_stock': {
      try {
        const res: any = await apiService.getLowStockProducts(ctx.branchId || undefined);
        if (!res?.success) {
          return { kind: 'result', result: errResult('Low stock unavailable', res?.message) };
        }
        const list = res.data?.products || [];
        if (!list.length) {
          return {
            kind: 'result',
            result: {
              ok: true,
              title: 'Low stock',
              lines: ['Nothing is low on stock.'],
              speak: 'No products are low on stock.',
            },
          };
        }
        return {
          kind: 'result',
          result: {
            ok: true,
            title: `${list.length} low-stock product${list.length > 1 ? 's' : ''}`,
            lines: list
              .slice(0, 10)
              .map((p: any) => `${p.name} — ${p.stock} left (min ${p.minStock})`),
            speak: `${list.length} products are low on stock. First: ${list[0].name}, ${list[0].stock} left.`,
          },
        };
      } catch (e: any) {
        return { kind: 'result', result: errResult('Low stock unavailable', e?.message) };
      }
    }

    case 'expiring': {
      try {
        const res: any = await apiService.getNearExpiryBatches(30);
        if (!res?.success) {
          return { kind: 'result', result: errResult('Expiry report unavailable', res?.message) };
        }
        const list: any[] = Array.isArray(res.data) ? res.data : [];
        if (!list.length) {
          return {
            kind: 'result',
            result: {
              ok: true,
              title: 'Expiring soon',
              lines: ['No batches expire within the next 30 days.'],
              speak: 'No batches are expiring in the next 30 days.',
            },
          };
        }
        const lines = list.slice(0, 10).map((b) => {
          const days = Math.ceil(
            (new Date(b.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );
          return `${b.product?.name || 'Product'} · Batch ${b.batchNo} · ${batchQty(b)} units · ${fmtDate(b.expireDate)} (${days}d)`;
        });
        return {
          kind: 'result',
          result: {
            ok: true,
            title: `${list.length} batch${list.length > 1 ? 'es' : ''} expiring within 30 days`,
            lines,
            speak: `${list.length} batches expire within 30 days. Nearest: ${list[0].product?.name || 'a batch'} on ${fmtDate(list[0].expireDate)}.`,
          },
        };
      } catch (e: any) {
        return { kind: 'result', result: errResult('Expiry report unavailable', e?.message) };
      }
    }

    case 'today_report': {
      const today = new Date().toISOString().slice(0, 10);
      try {
        const res: any = await apiService.getSalesReport({
          startDate: today,
          endDate: today,
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        });
        let count: number | undefined;
        let revenue: number | undefined;
        let discount: number | undefined;
        if (res?.success && res.data?.summary) {
          count = Number(res.data.summary.totalSales ?? 0);
          revenue = Number(res.data.summary.totalRevenue ?? 0);
          discount = Number(res.data.summary.totalDiscount ?? 0);
        } else {
          const stats: any = await apiService.getDashboardStats(ctx.branchId || undefined);
          if (!stats?.success) {
            return {
              kind: 'result',
              result: errResult("Today's report unavailable", res?.message || stats?.message),
            };
          }
          count = Number(stats.data?.todayStats?.sales ?? 0);
          revenue = Number(stats.data?.todayStats?.revenue ?? 0);
        }
        // Profit is included only when the advanced report actually returns it.
        let profit: number | undefined;
        try {
          const pres: any = await (apiService as any).getAdvancedProfitReport({
            startDate: today,
            endDate: today,
            ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
          });
          const p =
            pres?.data?.summary?.totalProfit ??
            pres?.data?.summary?.grossProfit ??
            pres?.data?.totalProfit;
          if (typeof p === 'number') profit = p;
        } catch {
          profit = undefined;
        }
        const lines = [
          `Sales today: ${count}`,
          `Revenue: ${fmtRs(revenue)}`,
          ...(discount ? [`Discounts given: ${fmtRs(discount)}`] : []),
          ...(profit !== undefined ? [`Profit: ${fmtRs(profit)}`] : []),
        ];
        return {
          kind: 'result',
          result: {
            ok: true,
            title: "Today's sales",
            lines,
            speak: `Today: ${count} sales, revenue ${Math.round(revenue)} rupees${profit !== undefined ? `, profit ${Math.round(profit)} rupees` : ''}.`,
          },
        };
      } catch (e: any) {
        return { kind: 'result', result: errResult("Today's report unavailable", e?.message) };
      }
    }

    case 'create_sale':
      return handleCreateSale(intent, ctx);

    default:
      return {
        kind: 'result',
        result: {
          ok: false,
          title: 'Not available',
          lines: [`"${describeIntent(intent)}" can't be done by voice yet.`],
          speak: 'That command is not available yet.',
        },
      };
  }
}
