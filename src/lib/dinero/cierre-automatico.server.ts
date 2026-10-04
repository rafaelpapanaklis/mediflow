// Cierre automático de caja a medianoche (ws1-t5, F7). OPCIÓN por clínica,
// APAGADA de fábrica (clinic_dinero_ajustes."cajaCierreAutomatico").
//
// Lo corre /api/cron/caja-cierre cada 15 min. Una caja abierta ANTES de la
// última medianoche de la clínica se cierra con `closedAt` = esa medianoche y
// un «corte automático sin conteo»: congela el resumen del turno (ingresos,
// retiros, efectivo esperado…) como el cierre a mano, pero sin efectivo
// contado ni diferencia (null): nadie contó el cajón. Lo cobrado después de
// medianoche y antes de abrir la caja nueva sale en «cobros fuera de corte»
// y se puede pasar a la caja siguiente.
//
// Idempotente: el UPDATE va condicionado a `status = OPEN`; dos corridas a la
// vez (o un cierre a mano en el mismo minuto) cierran una sola vez.

import { prisma } from "@/lib/prisma";
import { buildCloseSummary, deriveWindow, money } from "@/lib/caja";
import { logAudit } from "@/lib/audit";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";
import { clinicasConCierreAutomatico, cobrosAsignados } from "./ajustes.server";
import { cierreAutomaticoDe } from "./caja-core";
import { textosDinero } from "./textos";

export interface ResumenCierreAutomatico {
  clinicas: number;
  cerradas: number;
  errores: number;
}

export async function cerrarCajasAMedianoche(now: Date = new Date()): Promise<ResumenCierreAutomatico> {
  const resumen: ResumenCierreAutomatico = { clinicas: 0, cerradas: 0, errores: 0 };
  const ids = await clinicasConCierreAutomatico();
  resumen.clinicas = ids.length;
  for (const clinicId of ids) {
    try {
      const [clinic, abiertas] = await Promise.all([
        prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }),
        prisma.cashRegister.findMany({
          where:   { clinicId, status: "OPEN" },
          include: { withdrawals: { select: { amount: true } } },
        }),
      ]);
      const tz = clinic?.timezone || DEFAULT_INVOICE_TZ;
      for (const reg of abiertas) {
        const { cerrar, closedAt } = cierreAutomaticoDe(reg.openedAt, now, tz);
        if (!cerrar) continue;
        const asignados = await cobrosAsignados(clinicId, { cashRegisterId: reg.id });
        const derived = await deriveWindow(clinicId, reg.openedAt, closedAt, { asignados });
        const retiros = reg.withdrawals.reduce((s, w) => s + (w.amount ?? 0), 0);
        const s = buildCloseSummary({
          openedAt: reg.openedAt, closedAt, openingBalance: reg.openingBalance,
          withdrawals: retiros, counted: 0, derived,
        });
        const r = await prisma.cashRegister.updateMany({
          where: { id: reg.id, clinicId, status: "OPEN" },
          data: {
            status: "CLOSED",
            closedAt,
            countedClosingBalance: null,
            closingNotes: textosDinero("es").caja.cierreAutoNota,
            snapshotCashIncome:   money(derived.cashIncome),
            snapshotOtherIncome:  money(derived.otherIncome),
            snapshotDiscounts:    money(derived.discounts),
            snapshotTax:          money(derived.tax),
            snapshotWithdrawals:  money(retiros),
            snapshotExpectedCash: s.expectedCash,
            snapshotVariance:     null,
          },
        });
        if (r.count === 0) continue;
        resumen.cerradas++;
        await logAudit({
          clinicId, userId: reg.operatorId, entityType: "cash-register", entityId: reg.id, action: "update",
          texto: "Corte automático de caja a medianoche (sin conteo)",
          changes: { cierreAutomatico: { before: null, after: { closedAt: closedAt.toISOString(), expectedCash: s.expectedCash } } },
        });
      }
    } catch (e) {
      resumen.errores++;
      console.error(`[caja:cierre-automatico] clínica ${clinicId}:`, (e as Error)?.message);
    }
  }
  return resumen;
}
