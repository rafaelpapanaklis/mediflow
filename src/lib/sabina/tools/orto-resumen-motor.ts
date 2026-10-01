/**
 * El puente de `orto_resumen` con el motor del módulo de Ortodoncia (ws1-t9).
 *
 * 🔴 AQUÍ NO SE INVENTA NINGUNA CIFRA. Todo sale de lo que ya pintan las
 * pantallas:
 *
 *   · los casos, su estado, doctor y saldo ... `loadOrthoCases` (Casos, Cobranza, Tablero)
 *   · lo que debe cada caso ................... `deudaDelCaso` (la columna «saldo» de Casos y de Cobranza)
 *   · lo cobrado de la factura del tratamiento `Invoice.paid` (la que lee `loadOrthoCases`)
 *   · el cargo de cada control cobrado ........ `cargarCargosDeControlPorCasos` (modo «pago por control»)
 *   · el enganche / la colocación ............. las cuotas `esEnganche` de `cobranzaDelCasoUnificada`
 *   · lo cobrado EN UN PERIODO ................. `cargarPagosDeCasos` + `produccionPorDoctor`
 *                                               (la «Producción del mes» del Tablero, con otro rango)
 *   · la técnica ............................... la misma lectura y el mismo nombre que Casos
 *
 * Lo único propio es UNA lectura: los extras (reposición, retenedor…) de todos
 * los casos, con lo cobrado y lo facturado. El panel solo lee los PENDIENTES
 * (`extrasPendientesPorCasos`); aquí hacen falta también los pagados. Va con el
 * mismo criterio que allí (`appointmentId IS NULL` y sin la marca de una hoja de
 * control), el `clinicId` de la sesión y la misma tolerancia a la columna ausente.
 *
 * Se carga con `import()` desde la herramienta, igual que `orto-motor`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { visorDe } from "./base";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { deudaDelCaso, type CobranzaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { cargarCargosDeControlPorCasos } from "@/lib/orthodontics/cobranza-controles-db";
import { cargarModosDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { cargarNombresDeTecnica, type LectorRaw } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { nombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { ETIQUETA_TECNICA } from "@/lib/orthodontics/pacientes-modulo";
import { inicioDelCaso } from "@/lib/orthodontics/controles-hechos";
import { cargarCambiosDeDoctor, cargarNombresDeDoctores, cargarPagosDeCasos } from "@/lib/orthodontics/produccion-db";
import { produccionPorDoctor } from "@/lib/orthodontics/produccion";
import { zonaDe } from "./orto-motor";
import type { SabinaCtx } from "../tipos";

const aCentavos = (pesos: unknown) => Math.round((Number(pesos) || 0) * 100);
const aPesos = (centavos: number) => centavos / 100;

export interface CasoResumen {
  planId: string;
  /** `OrthodonticTreatmentPlan.status` tal cual (PLANNED, IN_PROGRESS…). */
  status: string;
  doctorId: string | null;
  doctor: string | null;
  tecnica: string;
  /** Cuándo arrancó el caso: colocación, o si no inicio planeado, o cuando se abrió. */
  inicio: Date | null;
  /** Lo que facturó el caso (tratamiento + controles + extras, sin canceladas), en pesos. */
  valor: number;
  cobrado: { total: number; colocacion: number; mensualidades: number; controles: number; extras: number };
  /** `deudaDelCaso(...).porCobrar`: la misma cifra que la columna «saldo» de Casos y de Cobranza. */
  pendiente: number;
  vencido: number;
}

export interface ResumenLeido {
  casos: CasoResumen[];
  /** La factura del tratamiento de cada caso: lo que necesita `produccionDelPeriodo`. */
  invoiceIdByPlanId: Map<string, string>;
}

interface FilaExtra {
  planId: string;
  total: unknown;
  paid: unknown;
  status: string;
}

/**
 * Los extras de todos los casos: facturas ligadas al caso, sin cita y sin la
 * marca de una hoja de control. Sin la columna (o si falla): vacío, igual que el panel.
 */
async function extrasDeLosCasos(clinicId: string, planIds: string[]): Promise<Map<string, { total: number; paid: number }>> {
  const out = new Map<string, { total: number; paid: number }>();
  if (!clinicId || planIds.length === 0) return out;
  try {
    const filas = await prisma.$queryRaw<FilaExtra[]>`
      /* orto-resumen-extras */
      SELECT "orthodonticTreatmentPlanId" AS "planId", "total", "paid", "status"::text AS "status"
        FROM "invoices"
       WHERE "clinicId" = ${clinicId}
         AND "orthodonticTreatmentPlanId" IN (${Prisma.join(planIds)})
         AND "status"::text NOT IN ('CANCELLED')
         AND "appointmentId" IS NULL
         AND ("notes" IS NULL OR "notes" NOT LIKE '[control-hoja:%')`;
    for (const f of filas) {
      const previo = out.get(f.planId) ?? { total: 0, paid: 0 };
      out.set(f.planId, {
        total: aPesos(aCentavos(previo.total) + aCentavos(f.total)),
        paid: aPesos(aCentavos(previo.paid) + aCentavos(f.paid)),
      });
    }
  } catch (e) {
    console.warn("[sabina:orto_resumen] no se pudieron leer los extras:", e);
  }
  return out;
}

/** Cuánto de lo pagado de la factura del tratamiento fue el enganche (la colocación), por las cuotas del plan. */
function engancheCobrado(cobranza: CobranzaDelCaso | null): number {
  if (!cobranza) return 0;
  const cuotas = [...cobranza.pagadas, ...cobranza.vencidas, ...cobranza.proximas];
  return aPesos(cuotas.filter((q) => q.esEnganche).reduce((s, q) => s + aCentavos(q.abonado), 0));
}

/** Todos los casos que esta persona puede ver, con su dinero ya resuelto. Solo lee. */
export async function leerResumen(ctx: SabinaCtx, ahora: Date = new Date()): Promise<ResumenLeido> {
  const zona = zonaDe(ctx);
  const clinicId = ctx.clinicId;
  const { cases, invoiceIdByPlanId, invoicesById } = await loadOrthoCases(clinicId, zona, visorDe(ctx), ahora);
  if (cases.length === 0) return { casos: [], invoiceIdByPlanId };

  const planIds = cases.map((c) => c.planId);
  const [planes, nombresDeTecnica, modos] = await Promise.all([
    prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, id: { in: planIds } },
      select: { id: true, technique: true, createdAt: true, installedAt: true, startDate: true },
    }),
    cargarNombresDeTecnica(clinicId, planIds, prisma as unknown as LectorRaw),
    cargarModosDeCobro(clinicId, planIds),
  ]);
  const cargos = await cargarCargosDeControlPorCasos(clinicId, planIds);
  const extras = await extrasDeLosCasos(clinicId, planIds);
  const planPorId = new Map(planes.map((p) => [p.id, p]));

  const casos: CasoResumen[] = cases.map((c) => {
    const plan = planPorId.get(c.planId);
    const factura = invoicesById.get(invoiceIdByPlanId.get(c.planId) ?? "");
    const vigente = factura && factura.status !== "CANCELLED" ? factura : null;
    const porControl = normalizarOrthoBillingMode(modos.get(c.planId) ?? null) === "PAGO_POR_CONTROL";
    const deuda = deudaDelCaso(c.cobranza, c.extrasPendientes);

    const principalPagado = aCentavos(vigente?.paid ?? 0);
    const principalTotal = aCentavos(vigente?.total ?? 0);
    const cargosDelCaso = (cargos.get(c.planId) ?? []).filter((x) => x.status !== "CANCELLED");
    const controlesPagado = cargosDelCaso.reduce((s, x) => s + aCentavos(x.pagado), 0);
    const controlesTotal = cargosDelCaso.reduce((s, x) => s + aCentavos(x.total), 0);
    const ex = extras.get(c.planId) ?? { total: 0, paid: 0 };

    // En «pago por control» la factura principal ES la colocación; en un plan a plazos,
    // la colocación es el enganche y lo demás son mensualidades.
    const colocacionC = porControl ? principalPagado : Math.min(principalPagado, aCentavos(engancheCobrado(c.cobranza)));
    const mensualidadesC = porControl ? 0 : principalPagado - colocacionC;
    const totalC = principalPagado + controlesPagado + aCentavos(ex.paid);

    const base = plan?.technique ?? null;
    return {
      planId: c.planId,
      status: String(c.status),
      doctorId: c.treatingDoctorId,
      doctor: c.treatingDoctorName,
      tecnica: base
        ? nombreDeTecnica(base, nombresDeTecnica.get(c.planId) ?? null, ETIQUETA_TECNICA[base] ?? base)
        : "Sin técnica registrada",
      inicio: plan ? inicioDelCaso({ installedAt: c.installedAt, startDate: plan.startDate, createdAt: plan.createdAt }) : c.installedAt,
      valor: aPesos(principalTotal + controlesTotal + aCentavos(ex.total)),
      cobrado: {
        total: aPesos(totalC),
        colocacion: aPesos(colocacionC),
        mensualidades: aPesos(mensualidadesC),
        controles: aPesos(controlesPagado),
        extras: aPesos(aCentavos(ex.paid)),
      },
      pendiente: deuda.porCobrar,
      vencido: deuda.vencido,
    };
  });

  return { casos, invoiceIdByPlanId };
}

/**
 * Lo cobrado (menos reembolsos) en `[desde, hasta]` —días de la clínica— de los
 * casos dados, por el doctor que los llevaba el día del pago. Es la «Producción
 * del mes» del Tablero con otro rango: mismas tres lecturas, misma función.
 */
export async function produccionDelPeriodo(
  ctx: SabinaCtx,
  casos: ReadonlyArray<{ planId: string; doctorId: string | null; doctor: string | null }>,
  invoiceIdByPlanId: ReadonlyMap<string, string>,
  rango: { desde: string; hasta: string },
): Promise<{ neto: number; porDoctor: Array<{ doctor: string; importe: number }> }> {
  const zona = zonaDe(ctx);
  const clinicId = ctx.clinicId;
  if (casos.length === 0) return { neto: 0, porDoctor: [] };
  const instantes = {
    desde: calendarDayRangeUtc(rango.desde, zona).startUtc,
    hasta: calendarDayRangeUtc(rango.hasta, zona).endUtc,
  };
  const pagos = await cargarPagosDeCasos(
    clinicId,
    casos.map((c) => ({ planId: c.planId, invoiceId: invoiceIdByPlanId.get(c.planId) ?? null, treatingDoctorId: c.doctorId })),
    instantes,
  );
  const cambios = pagos.length > 0
    ? await cargarCambiosDeDoctor(clinicId, Array.from(new Set(pagos.map((p) => p.planId))), instantes.desde)
    : [];
  const nombres = new Map<string, string>();
  for (const c of casos) if (c.doctorId && c.doctor) nombres.set(c.doctorId, c.doctor);
  const sinNombre = cambios.flatMap((c) => [c.de, c.a]).filter((id): id is string => !!id && !nombres.has(id));
  if (sinNombre.length > 0) for (const [id, n] of await cargarNombresDeDoctores(clinicId, sinNombre)) nombres.set(id, n);
  const filas = produccionPorDoctor({
    pagos,
    doctorActualPorCaso: new Map(casos.map((c) => [c.planId, c.doctorId])),
    cambios,
    nombres,
    zonaHoraria: zona,
  });
  return {
    neto: aPesos(filas.reduce((s, f) => s + aCentavos(f.amountMxn), 0)),
    porDoctor: filas.map((f) => ({ doctor: f.doctorName, importe: f.amountMxn })),
  };
}
