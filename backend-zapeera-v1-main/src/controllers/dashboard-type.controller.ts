import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import { DAY_MS, normalizeHotelDate, round2 } from '../utils/hotel.util';

// ─── Type-specific workspace dashboards (2026-10-22) ─────────────────
// One aggregate payload per canonical business type, composed ONLY from
// that industry's own domain tables. The generic retail dashboard
// (GET /reports/dashboard + GET /dashboard/stats) mis-served hotels and
// clinics: folio checkout invoices surfaced as "sales" and the folio
// engine's "Room Night — …" service product showed up as a low-stock /
// most-selling PRODUCT. These endpoints never touch product-selling
// widgets for types that have no product-selling system.
//
// Scoping: identical to getDashboardStats — buildBranchWhereClause
// (membership business + role-aware branch filter). Every figure is
// computed from rows of the caller's business (and branch context)
// only. Type guard: when the business carries one of the four
// canonical types, an endpoint for a DIFFERENT type answers 400
// DASHBOARD_TYPE_MISMATCH instead of misleading numbers; custom /
// unknown types fall through (legacy behaviour for backoffice-defined
// types), mirroring module-applicability.util.

const CANONICAL_TYPES = ['PHARMACY', 'RETAIL_STORE', 'HOTEL', 'CLINIC'];

const localDayRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
};

/** Returns true when the request may proceed; writes the 400 itself otherwise. */
const enforceType = async (req: AuthRequest, res: Response, expected: string): Promise<boolean> => {
  const prisma = await getPrisma();
  const companyId = req.membership?.business_id || (req.headers['x-business-id'] as string) || (req.headers['x-company-id'] as string);
  if (!companyId) return true; // buildBranchWhereClause already fails closed downstream
  const business = await prisma.business.findUnique({
    where: { id: companyId },
    select: { businessType: true }
  });
  const actual = String(business?.businessType || '').trim().toUpperCase();
  if (CANONICAL_TYPES.includes(actual) && actual !== expected) {
    res.status(400).json({
      success: false,
      code: 'DASHBOARD_TYPE_MISMATCH',
      message: `This dashboard is for ${expected} businesses; the selected business is ${actual}.`
    });
    return false;
  }
  return true;
};

// ─── HOTEL ────────────────────────────────────────────────────────────
// Reservations → check-in → folio → checkout. Figures mirror the
// night-audit definitions (folio.controller getNightAudit) so the
// dashboard and the audit never disagree: today's charges/payments are
// summed from the folio ledger rows, occupancy tonight is the count of
// OCCUPIED rooms on the front-desk board, outstanding is Σ(charges −
// payments) over OPEN folios (the folio money truth — never stored).
export const getHotelDashboard = async (req: AuthRequest, res: Response) => {
  try {
    if (!(await enforceType(req, res, 'HOTEL'))) return;
    const prisma = await getPrisma();
    const scope: any = buildBranchWhereClause(req, {});
    const companyId = scope.companyId;
    const branchCond = scope.branchId ? { branchId: scope.branchId } : {};
    const folioScope: any = { companyId, ...branchCond };

    const day = normalizeHotelDate(new Date());
    const dayEnd = new Date(day.getTime() + DAY_MS);

    const roomSelect = { id: true, number: true, roomType: { select: { id: true, name: true } } };

    const [
      rooms,
      arrivals,
      departuresDue,
      checkedIn,
      openFolios,
      chargesTodayAgg,
      paymentsTodayAgg,
      checkedOutToday,
      upcoming,
      recentCharges,
      recentPayments
    ] = await Promise.all([
      prisma.room.findMany({
        where: { ...scope, isActive: true },
        select: { id: true, status: true }
      }),
      prisma.reservation.findMany({
        // Today's arrivals = expected (BOOKED) + in-house (CHECKED_IN) +
        // already-arrived-and-left (COMPLETED) — the same population the
        // night audit counts as arrivals, so the two never disagree.
        where: { ...scope, checkInDate: { gte: day, lt: dayEnd }, status: { in: ['BOOKED', 'CHECKED_IN', 'COMPLETED'] } },
        include: { room: { select: roomSelect } },
        orderBy: { createdAt: 'asc' },
        take: 6
      }),
      prisma.reservation.findMany({
        where: { ...scope, checkOutDate: { gte: day, lt: dayEnd }, status: 'CHECKED_IN' },
        include: { room: { select: roomSelect } },
        orderBy: { createdAt: 'asc' },
        take: 6
      }),
      prisma.reservation.findMany({
        where: { ...scope, status: 'CHECKED_IN' },
        select: { id: true, adults: true, children: true }
      }),
      prisma.folio.findMany({
        where: { ...scope, status: 'OPEN' },
        select: {
          id: true,
          charges: { select: { amount: true } },
          payments: { select: { amount: true } }
        }
      }),
      prisma.folioCharge.aggregate({
        where: { folio: folioScope, chargeDate: { gte: day, lt: dayEnd } },
        _sum: { amount: true }
      }),
      prisma.folioPayment.aggregate({
        where: { folio: folioScope, paidAt: { gte: day, lt: dayEnd } },
        _sum: { amount: true }
      }),
      prisma.folio.count({
        where: { ...scope, closedAt: { gte: day, lt: dayEnd } }
      }),
      prisma.reservation.findMany({
        where: { ...scope, status: 'BOOKED', checkInDate: { gte: dayEnd } },
        include: { room: { select: roomSelect } },
        orderBy: { checkInDate: 'asc' },
        take: 5
      }),
      prisma.folioCharge.findMany({
        where: { folio: folioScope },
        include: { folio: { select: { guestName: true, room: { select: { number: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.folioPayment.findMany({
        where: { folio: folioScope },
        include: { folio: { select: { guestName: true, room: { select: { number: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 6
      })
    ]);

    const roomStatus = { AVAILABLE: 0, OCCUPIED: 0, DIRTY: 0, MAINTENANCE: 0 };
    for (const room of rooms as any[]) {
      const key = String(room.status || 'AVAILABLE').toUpperCase();
      if (key in roomStatus) (roomStatus as any)[key] += 1;
    }
    const roomsTotal = rooms.length;
    const occupied = roomStatus.OCCUPIED;

    let outstanding = 0;
    for (const folio of openFolios as any[]) {
      const charged = (folio.charges || []).reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0);
      const paid = (folio.payments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
      outstanding += charged - paid;
    }

    const guestsInHouse = (checkedIn as any[]).reduce(
      (s, r) => s + (Number(r.adults) || 0) + (Number(r.children) || 0),
      0
    );

    const activity = [
      ...(recentCharges as any[]).map((c) => ({
        kind: 'CHARGE',
        chargeKind: c.kind,
        description: c.description,
        amount: Number(c.amount) || 0,
        guestName: c.folio?.guestName || null,
        roomNumber: c.folio?.room?.number || null,
        at: c.createdAt
      })),
      ...(recentPayments as any[]).map((p) => ({
        kind: 'PAYMENT',
        chargeKind: null,
        description: `Payment (${p.method})`,
        amount: Number(p.amount) || 0,
        guestName: p.folio?.guestName || null,
        roomNumber: p.folio?.room?.number || null,
        at: p.createdAt
      }))
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);

    const serializeReservation = (r: any) => ({
      id: r.id,
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      status: r.status,
      checkInDate: r.checkInDate,
      checkOutDate: r.checkOutDate,
      adults: r.adults,
      children: r.children,
      room: r.room ? { id: r.room.id, number: r.room.number, roomType: r.room.roomType?.name || null } : null
    });

    return res.json({
      success: true,
      data: {
        businessType: 'HOTEL',
        date: day.toISOString().slice(0, 10),
        stats: {
          roomsTotal,
          occupiedTonight: occupied,
          occupancyPct: roomsTotal > 0 ? Math.round((occupied / roomsTotal) * 1000) / 10 : 0,
          arrivalsToday: arrivals.length,
          departuresDueToday: departuresDue.length,
          checkedOutToday,
          inHouseStays: checkedIn.length,
          guestsInHouse,
          openFolios: openFolios.length,
          outstandingBalance: round2(outstanding),
          chargesToday: round2(chargesTodayAgg._sum.amount || 0),
          paymentsToday: round2(paymentsTodayAgg._sum.amount || 0)
        },
        roomStatus,
        arrivals: (arrivals as any[]).map(serializeReservation),
        departuresDue: (departuresDue as any[]).map(serializeReservation),
        upcoming: (upcoming as any[]).map(serializeReservation),
        recentActivity: activity
      }
    });
  } catch (error) {
    console.error('Hotel dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── CLINIC ───────────────────────────────────────────────────────────
// Appointments / OPD queue / visit money. Appointment dates are stored
// normalized to UTC midnight (clinic pack rule), so the day window is
// the hotel-style UTC day. Money comes from the completion snapshots
// (feeCharged / doctorShareAmount), never from current doctor rates.
// Outstanding doctor share = all-time earned (snapshots on COMPLETED
// visits) − all-time settlements paid — the settlement report's own
// documented semantics applied to the full history.
export const getClinicDashboard = async (req: AuthRequest, res: Response) => {
  try {
    if (!(await enforceType(req, res, 'CLINIC'))) return;
    const prisma = await getPrisma();
    const scope: any = buildBranchWhereClause(req, {});
    const companyId = scope.companyId;

    const day = normalizeHotelDate(new Date());
    const dayEnd = new Date(day.getTime() + DAY_MS);
    const { today, tomorrow } = localDayRange();

    const [todaysAppointments, patientsToday, earnedAgg, settledAgg, nextAppointments] = await Promise.all([
      prisma.appointment.findMany({
        where: { ...scope, appointmentDate: { gte: day, lt: dayEnd } },
        select: { status: true, feeCharged: true, doctorShareAmount: true }
      }),
      prisma.patient.count({
        where: { ...scope, createdAt: { gte: today, lt: tomorrow } }
      }),
      prisma.appointment.aggregate({
        where: { ...scope, status: 'COMPLETED' },
        _sum: { doctorShareAmount: true }
      }),
      prisma.doctorSettlement.aggregate({
        where: { companyId },
        _sum: { amount: true }
      }),
      prisma.appointment.findMany({
        where: {
          ...scope,
          appointmentDate: { gte: day },
          status: { in: ['BOOKED', 'CHECKED_IN', 'IN_VISIT'] }
        },
        include: {
          patient: { select: { id: true, name: true, phone: true } },
          doctor: { select: { id: true, name: true, specialization: true } }
        },
        orderBy: [{ appointmentDate: 'asc' }, { tokenNumber: 'asc' }],
        take: 6
      })
    ]);

    const byStatus: Record<string, number> = {};
    let visitRevenue = 0;
    let completedVisits = 0;
    for (const appt of todaysAppointments as any[]) {
      byStatus[appt.status] = (byStatus[appt.status] || 0) + 1;
      if (appt.status === 'COMPLETED') {
        completedVisits += 1;
        visitRevenue += Number(appt.feeCharged) || 0;
      }
    }
    const scheduledToday = (todaysAppointments as any[]).filter(
      (a) => !['CANCELLED', 'NO_SHOW'].includes(a.status)
    ).length;

    const earned = Number(earnedAgg._sum.doctorShareAmount) || 0;
    const settled = Number(settledAgg._sum.amount) || 0;

    return res.json({
      success: true,
      data: {
        businessType: 'CLINIC',
        date: day.toISOString().slice(0, 10),
        stats: {
          appointmentsToday: scheduledToday,
          waitingNow: byStatus['CHECKED_IN'] || 0,
          inConsultationNow: byStatus['IN_VISIT'] || 0,
          completedVisitsToday: completedVisits,
          patientsRegisteredToday: patientsToday,
          visitRevenueToday: round2(visitRevenue),
          doctorShareOutstanding: round2(earned - settled)
        },
        byStatus,
        nextAppointments: (nextAppointments as any[]).map((a) => ({
          id: a.id,
          appointmentDate: a.appointmentDate,
          tokenNumber: a.tokenNumber,
          status: a.status,
          reason: a.reason,
          patient: a.patient ? { id: a.patient.id, name: a.patient.name, phone: a.patient.phone } : null,
          doctor: a.doctor ? { id: a.doctor.id, name: a.doctor.name, specialization: a.doctor.specialization } : null
        }))
      }
    });
  } catch (error) {
    console.error('Clinic dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── PHARMACY extras ──────────────────────────────────────────────────
// The sales core stays on the proven generic dashboard; this endpoint
// carries only the pharmacy-specific figures: prescriptions, batch
// expiry and reorder suggestions. Stock math matches the codebase's
// own definitions — low stock per getDashboardStats (live, non-expired
// batch quantity vs Product.minStock); reorder per the C3 suggestions
// engine (products that opted in with reorderLevel, stock ≤ level,
// suggested = reorderQuantity ?? max(1, 2 × level − stock)).
export const getPharmacyDashboard = async (req: AuthRequest, res: Response) => {
  try {
    if (!(await enforceType(req, res, 'PHARMACY'))) return;
    const prisma = await getPrisma();
    const scope: any = buildBranchWhereClause(req, {});
    const { today, tomorrow } = localDayRange();
    const expiryHorizon = new Date(today);
    expiryHorizon.setDate(expiryHorizon.getDate() + 30);
    const now = new Date();

    const [prescriptionsToday, unfilledToday, recentPrescriptions, expiringBatches, expiringCount, expiredCount, products] =
      await Promise.all([
        prisma.prescription.count({
          where: { ...scope, isActive: true, createdAt: { gte: today, lt: tomorrow } }
        }),
        prisma.prescription.count({
          where: { ...scope, isActive: true, createdAt: { gte: today, lt: tomorrow }, sales: { none: {} } }
        }),
        prisma.prescription.findMany({
          where: { ...scope, isActive: true },
          include: { _count: { select: { items: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
        prisma.batch.findMany({
          where: {
            ...scope,
            isActive: true,
            quantity: { gt: 0 },
            expireDate: { gte: today, lt: expiryHorizon }
          },
          include: { product: { select: { id: true, name: true } } },
          orderBy: { expireDate: 'asc' },
          take: 5
        }),
        prisma.batch.count({
          where: { ...scope, isActive: true, quantity: { gt: 0 }, expireDate: { gte: today, lt: expiryHorizon } }
        }),
        prisma.batch.count({
          where: { ...scope, isActive: true, quantity: { gt: 0 }, expireDate: { lt: today } }
        }),
        prisma.product.findMany({
          where: { ...scope, isActive: true },
          select: {
            id: true,
            name: true,
            minStock: true,
            reorderLevel: true,
            reorderQuantity: true,
            batches: {
              where: { isActive: true },
              select: { quantity: true, expireDate: true }
            }
          }
        })
      ]);

    const lowStock: Array<{ id: string; name: string; stock: number; minStock: number }> = [];
    const reorderLines: Array<{ id: string; name: string; currentStock: number; reorderLevel: number; suggestedQty: number }> = [];
    for (const product of products as any[]) {
      const liveStock = (product.batches || [])
        .filter((b: any) => !b.expireDate || new Date(b.expireDate) > now)
        .reduce((s: number, b: any) => s + (Number(b.quantity) || 0), 0);
      const totalStock = (product.batches || []).reduce((s: number, b: any) => s + (Number(b.quantity) || 0), 0);
      if (totalStock <= (product.minStock || 0)) {
        lowStock.push({ id: product.id, name: product.name, stock: totalStock, minStock: product.minStock || 0 });
      }
      if (product.reorderLevel !== null && product.reorderLevel !== undefined && liveStock <= product.reorderLevel) {
        reorderLines.push({
          id: product.id,
          name: product.name,
          currentStock: liveStock,
          reorderLevel: product.reorderLevel,
          suggestedQty: product.reorderQuantity
            ? product.reorderQuantity
            : Math.max(1, product.reorderLevel * 2 - liveStock)
        });
      }
    }
    lowStock.sort((a, b) => a.stock - b.stock);
    reorderLines.sort((a, b) => a.currentStock - b.currentStock);

    return res.json({
      success: true,
      data: {
        businessType: 'PHARMACY',
        stats: {
          prescriptionsToday,
          prescriptionsAwaiting: unfilledToday,
          expiringSoonCount: expiringCount,
          expiredCount,
          lowStockCount: lowStock.length,
          reorderCount: reorderLines.length
        },
        recentPrescriptions: (recentPrescriptions as any[]).map((p) => ({
          id: p.id,
          patientName: p.patientName,
          doctorName: p.doctorName,
          itemsCount: p._count?.items || 0,
          issuedDate: p.issuedDate,
          createdAt: p.createdAt
        })),
        expiringSoon: (expiringBatches as any[]).map((b) => ({
          id: b.id,
          productName: b.product?.name || 'Unknown Product',
          batchNo: b.batchNo,
          expireDate: b.expireDate,
          quantity: b.quantity,
          daysToExpiry: b.expireDate
            ? Math.ceil((new Date(b.expireDate).getTime() - today.getTime()) / DAY_MS)
            : null
        })),
        lowStock: lowStock.slice(0, 5),
        reorderSuggestions: reorderLines.slice(0, 5)
      }
    });
  } catch (error) {
    console.error('Pharmacy dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── RETAIL extras ────────────────────────────────────────────────────
// Sales core stays on the generic dashboard; extras are the C6 retail
// figures the product-level widgets cannot express: top-selling
// VARIANTS (from SaleItem.variantId snapshots) and stock-take status
// (last take + its frozen variance lines, OPEN takes in progress).
export const getRetailDashboard = async (req: AuthRequest, res: Response) => {
  try {
    if (!(await enforceType(req, res, 'RETAIL_STORE'))) return;
    const prisma = await getPrisma();
    const scope: any = buildBranchWhereClause(req, {});

    const [variantLines, lastTake, openTakes] = await Promise.all([
      prisma.saleItem.findMany({
        where: {
          variantId: { not: null },
          sale: { ...scope, status: { not: 'REFUNDED' } }
        },
        select: { variantId: true, variantName: true, productId: true, quantity: true, totalPrice: true },
        // sale_items have no createdAt column — no item-level ordering.
        take: 5000
      }),
      prisma.stockTake.findFirst({
        where: { ...scope },
        include: {
          branch: { select: { id: true, name: true } },
          lines: { select: { variance: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.stockTake.count({ where: { ...scope, status: 'OPEN' } })
    ]);

    // Aggregate variant lines in JS (bounded fetch above) — the
    // groupBy-with-relation typing is fragile on this Prisma version.
    const variantAgg = new Map<string, { variantId: string; variantName: string | null; productId: string; unitsSold: number; revenue: number }>();
    for (const line of variantLines as any[]) {
      const key = String(line.variantId);
      const entry = variantAgg.get(key) || {
        variantId: line.variantId,
        variantName: line.variantName || null,
        productId: line.productId,
        unitsSold: 0,
        revenue: 0
      };
      entry.unitsSold += Number(line.quantity) || 0;
      entry.revenue += Number(line.totalPrice) || 0;
      variantAgg.set(key, entry);
    }
    const variantGroups = Array.from(variantAgg.values())
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 5);

    const productIds = Array.from(new Set(variantGroups.map((g) => g.productId).filter(Boolean)));
    const products = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const productName = new Map((products as any[]).map((p) => [p.id, p.name]));

    let lastStockTake: any = null;
    if (lastTake) {
      const lines = (lastTake as any).lines || [];
      const countedLines = lines.filter((l: any) => l.variance !== null && l.variance !== undefined);
      lastStockTake = {
        id: (lastTake as any).id,
        status: (lastTake as any).status,
        branchName: (lastTake as any).branch?.name || null,
        startedAt: (lastTake as any).createdAt,
        completedAt: (lastTake as any).completedAt,
        linesCount: lines.length,
        varianceLines: countedLines.filter((l: any) => l.variance !== 0).length,
        totalVarianceUnits: countedLines.reduce((s: number, l: any) => s + (Number(l.variance) || 0), 0)
      };
    }

    return res.json({
      success: true,
      data: {
        businessType: 'RETAIL_STORE',
        topVariants: variantGroups.map((g) => ({
          variantId: g.variantId,
          variantName: g.variantName || 'Variant',
          productId: g.productId,
          productName: productName.get(g.productId) || 'Unknown Product',
          unitsSold: g.unitsSold,
          revenue: round2(g.revenue)
        })),
        stockTakes: {
          openCount: openTakes,
          last: lastStockTake
        }
      }
    });
  } catch (error) {
    console.error('Retail dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
