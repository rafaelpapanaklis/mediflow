// Ortodoncia — el I/O de «Eliminar caso» (ws1-t8): lee qué tiene cada caso
// (`HistorialDelCaso`, ver `eliminar-caso.ts`, que es puro y trae los tests).
//
// `clinicId` SIEMPRE de la sesión: sin él no se consulta nada (`undefined` en
// Prisma no filtra). Una consulta por tabla y por TODOS los casos (groupBy),
// en tandas de menos de 7 (regla del pooler).
//
// `tolerante`: la lista lo usa para no caerse si una tabla nueva aún no existe
// en esta base (P2021/P2022 = «no hay nada ahí»). Dentro de una transacción
// NO se usa: un error dentro de ella la aborta, y ahí es mejor no borrar.

import { Prisma } from "@prisma/client";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { HISTORIAL_VACIO, type HistorialDelCaso } from "./eliminar-caso";

type Db = Prisma.TransactionClient;

export interface CasoParaHistorial {
  id: string;
  patientId: string;
  createdAt: Date;
  /** La factura del tratamiento (`plan.invoiceId`), si el caso ya tiene una. */
  invoiceId: string | null;
}

const ESTADOS_DE_CITA_ATENDIDA = ["COMPLETED", "CHECKED_OUT"] as const;

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function leerHistorialDeCasos(
  db: Db,
  clinicId: string,
  casos: readonly CasoParaHistorial[],
  opts: { tolerante: boolean; columnaDeFacturas: boolean },
): Promise<Map<string, HistorialDelCaso>> {
  const out = new Map<string, HistorialDelCaso>();
  if (!clinicId || casos.length === 0) return out;
  for (const c of casos) out.set(c.id, { ...HISTORIAL_VACIO, facturasSinPagos: [] });

  const planIds = casos.map((c) => c.id);
  const pacientes = Array.from(new Set(casos.map((c) => c.patientId)));
  const desde = new Date(Math.min(...casos.map((c) => c.createdAt.getTime())));

  const seguro = async <T>(p: Promise<T[]>): Promise<T[]> => {
    if (!opts.tolerante) return p;
    try {
      return await p;
    } catch (e) {
      if (!esRelacionAusente(e)) throw e;
      return [];
    }
  };
  /** Suma `n` al campo del caso. */
  const sumar = (id: string | null | undefined, campo: Exclude<keyof HistorialDelCaso, "facturasSinPagos">, n = 1) => {
    const h = id ? out.get(id) : undefined;
    if (h) h[campo] += n;
  };
  // Todas estas tablas se cuentan igual: por caso. Un solo tipo para no pelear con
  // los genéricos de `groupBy` de Prisma (uno distinto por modelo).
  type Agrupable = {
    groupBy(args: {
      by: ["treatmentPlanId"];
      where: object;
      _count: { _all: true };
    }): Promise<Array<{ treatmentPlanId: string; _count: { _all: number } }>>;
  };
  const contarPorCaso = (modelo: unknown, where: object) =>
    seguro((modelo as Agrupable).groupBy({ by: ["treatmentPlanId"], where, _count: { _all: true } }));
  const filtro = { clinicId, treatmentPlanId: { in: planIds } };

  // Tanda 1 (6): lo clínico principal.
  const [hojas, juegos, seguimiento, cefalometria, facial, bolton] = await Promise.all([
    contarPorCaso(db.orthoTreatmentCard, { ...filtro, deletedAt: null }),
    contarPorCaso(db.orthoPhotoSet, filtro),
    contarPorCaso(db.orthodonticMonitoringPhoto, filtro),
    contarPorCaso(db.orthodonticCephalometryAnalysis, { ...filtro, deletedAt: null }),
    contarPorCaso(db.orthodonticFacialAnalysis, { ...filtro, deletedAt: null }),
    contarPorCaso(db.orthodonticBoltonAnalysis, filtro),
  ]);
  for (const r of hojas) sumar(r.treatmentPlanId, "hojasDeControl", r._count._all);
  for (const r of juegos) sumar(r.treatmentPlanId, "fotos", r._count._all);
  for (const r of seguimiento) sumar(r.treatmentPlanId, "fotos", r._count._all);
  for (const r of cefalometria) sumar(r.treatmentPlanId, "analisis", r._count._all);
  for (const r of facial) sumar(r.treatmentPlanId, "analisis", r._count._all);
  for (const r of bolton) sumar(r.treatmentPlanId, "analisis", r._count._all);

  // Tanda 2 (6): alineadores, controles y el resto de registros.
  const [alineadores, controles, digitales, consentimientos, tads, arcos] = await Promise.all([
    contarPorCaso(db.orthodonticAligner, { ...filtro, deletedAt: null }),
    contarPorCaso(db.orthodonticControlAppointment, { ...filtro, attendance: "ATTENDED" }),
    contarPorCaso(db.orthodonticDigitalRecord, filtro),
    contarPorCaso(db.orthodonticConsent, filtro),
    contarPorCaso(db.orthoTAD, { ...filtro, deletedAt: null }),
    contarPorCaso(db.orthoWireStep, filtro),
  ]);
  for (const r of alineadores) sumar(r.treatmentPlanId, "alineadores", r._count._all);
  for (const r of controles) sumar(r.treatmentPlanId, "citasAtendidas", r._count._all);
  for (const r of digitales) sumar(r.treatmentPlanId, "otrosRegistros", r._count._all);
  for (const r of consentimientos) sumar(r.treatmentPlanId, "otrosRegistros", r._count._all);
  for (const r of tads) sumar(r.treatmentPlanId, "otrosRegistros", r._count._all);
  for (const r of arcos) sumar(r.treatmentPlanId, "otrosRegistros", r._count._all);

  // Tanda 3 (4): mecánica auxiliar, plan de pagos antiguo, lo que el diagnóstico
  // trae (fotos y estudios) y las citas de control atendidas.
  const [auxiliar, planesDePago, diagnosticos, citas] = await Promise.all([
    contarPorCaso(db.orthoAuxMechanics, filtro),
    seguro(db.orthoPaymentPlan.findMany({ where: { ...filtro, paidAmount: { gt: 0 } }, select: { treatmentPlanId: true } })),
    seguro(
      db.orthodonticTreatmentPlan.findMany({
        where: {
          clinicId,
          id: { in: planIds },
          diagnosis: {
            OR: [
              { initialPhotoSetId: { not: null } },
              { initialCephFileId: { not: null } },
              { initialScanFileId: { not: null } },
            ],
          },
        },
        select: { id: true },
      }),
    ),
    seguro(
      db.appointment.findMany({
        where: {
          clinicId,
          patientId: { in: pacientes },
          type: TIPO_CITA_CONTROL_ORTO,
          status: { in: [...ESTADOS_DE_CITA_ATENDIDA] },
          startsAt: { gte: desde },
        },
        select: { patientId: true, startsAt: true },
        take: 5000,
      }),
    ),
  ]);
  for (const r of auxiliar) sumar(r.treatmentPlanId, "otrosRegistros", r._count._all);
  for (const r of planesDePago) sumar(r.treatmentPlanId, "pagosDelPlanAntiguo");
  for (const r of diagnosticos) sumar(r.id, "fotos");
  // Una cita atendida cuenta para el caso que ya estaba abierto cuando fue: un
  // caso viejo con historia no impide borrar el nuevo que se abrió por error.
  for (const c of casos) {
    const n = citas.filter((a) => a.patientId === c.patientId && a.startsAt >= c.createdAt).length;
    sumar(c.id, "citasAtendidas", n);
  }

  // Facturas: la del tratamiento y las ligadas por la columna de extras/controles.
  const ligadas = new Map<string, Set<string>>(casos.map((c) => [c.id, new Set(c.invoiceId ? [c.invoiceId] : [])]));
  if (opts.columnaDeFacturas) {
    const filas = await seguro(
      db.$queryRaw<{ id: string; plan: string }[]>`
        SELECT "id", "orthodonticTreatmentPlanId" AS plan
          FROM "invoices"
         WHERE "clinicId" = ${clinicId}
           AND "orthodonticTreatmentPlanId" IN (${Prisma.join(planIds)})`,
    );
    for (const f of filas) ligadas.get(f.plan)?.add(f.id);
  }
  const idsDeFacturas = Array.from(new Set(Array.from(ligadas.values()).flatMap((s) => Array.from(s))));
  if (idsDeFacturas.length > 0) {
    const facturas = await db.invoice.findMany({
      where: { clinicId, id: { in: idsDeFacturas } },
      select: { id: true, status: true, paid: true, cfdiUuid: true, _count: { select: { payments: true } } },
    });
    const porId = new Map(facturas.map((f) => [f.id, f]));
    for (const c of casos) {
      const h = out.get(c.id)!;
      for (const id of Array.from(ligadas.get(c.id) ?? [])) {
        const f = porId.get(id);
        if (!f) continue;
        const conDinero = f.paid > 0 || f._count.payments > 0;
        // Ya cancelada y sin dinero: no es historial ni hay nada que cancelar.
        if (f.status === "CANCELLED" && !conDinero) continue;
        if (conDinero) h.facturasConPagos += 1;
        else if (f.cfdiUuid) h.facturasTimbradas += 1;
        else h.facturasSinPagos.push(f.id);
      }
    }
  }

  return out;
}
