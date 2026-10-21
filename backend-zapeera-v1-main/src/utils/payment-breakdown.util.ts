/**
 * Allocation-aware sales-by-payment-method breakdown (Wave B1).
 *
 * Before B1 a sale had exactly one tender, so reports grouped sales by
 * `Sale.paymentMethod` and summed `totalAmount`. With split tender a
 * sale's money lives in its SalePayment allocations, so the breakdown
 * is now merged from two sources:
 *
 *  - Sales WITH allocations contribute each allocation's amount to its
 *    method's bucket (a split sale counts under every method it used).
 *  - Sales WITHOUT allocations (pre-B1 history, unpaid sales) keep the
 *    old attribution: their full totalAmount under the headline
 *    paymentMethod.
 *
 * The merged rows keep the exact pre-B1 response shape
 * ({ paymentMethod, _sum: { totalAmount }, _count: { id } }), sorted by
 * amount descending. If the sale_payments table/client model is not
 * available yet (a database that has not taken the B1 schema), the
 * breakdown degrades to the pre-B1 grouping instead of failing the
 * whole report.
 */
export interface PaymentMethodBucket {
  paymentMethod: string;
  _sum: { totalAmount: number };
  _count: { id: number };
}

export async function getPaymentMethodBreakdown(
  prisma: any,
  saleWhere: any
): Promise<PaymentMethodBucket[]> {
  try {
    const [legacy, allocations] = await Promise.all([
      prisma.sale.groupBy({
        by: ['paymentMethod'],
        where: { ...saleWhere, payments: { none: {} } },
        _sum: { totalAmount: true },
        _count: { id: true }
      }),
      prisma.salePayment.groupBy({
        by: ['method'],
        where: { sale: saleWhere },
        _sum: { amount: true },
        _count: { id: true }
      })
    ]);

    const buckets = new Map<string, PaymentMethodBucket>();
    for (const row of legacy as any[]) {
      buckets.set(row.paymentMethod, {
        paymentMethod: row.paymentMethod,
        _sum: { totalAmount: Number(row._sum?.totalAmount || 0) },
        _count: { id: Number(row._count?.id || 0) }
      });
    }
    for (const row of allocations as any[]) {
      const existing = buckets.get(row.method);
      if (existing) {
        existing._sum.totalAmount += Number(row._sum?.amount || 0);
        existing._count.id += Number(row._count?.id || 0);
      } else {
        buckets.set(row.method, {
          paymentMethod: row.method,
          _sum: { totalAmount: Number(row._sum?.amount || 0) },
          _count: { id: Number(row._count?.id || 0) }
        });
      }
    }
    return [...buckets.values()].sort((a, b) => b._sum.totalAmount - a._sum.totalAmount);
  } catch (error: any) {
    console.warn('[Reports] Allocation-aware payment breakdown unavailable, falling back to headline methods:', error?.message);
    const rows = await prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: saleWhere,
      _sum: { totalAmount: true },
      _count: { id: true }
    });
    return (rows as any[])
      .map(row => ({
        paymentMethod: row.paymentMethod,
        _sum: { totalAmount: Number(row._sum?.totalAmount || 0) },
        _count: { id: Number(row._count?.id || 0) }
      }))
      .sort((a, b) => b._sum.totalAmount - a._sum.totalAmount);
  }
}
