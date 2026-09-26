export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { computeMrr, loadIncludedBranchIds, loadPlanPrices } from "@/lib/admin/mrr";
import { comparePaymentDateDesc, paymentDate } from "@/lib/admin/payment-date";
import { CardNew } from "@/components/ui/design-system/card-new";
import { daysUntil, getPlanStatus, isInTrial, isPlanExpired } from "@/lib/plan-status";
import { PortadaVista, type DatosPortada, type PagoReciente } from "@/components/admin/portada/portada-vista";
import {
  construirPortada, rankingActividad, DIAS_ACTIVIDAD, MINUTOS_EN_LINEA,
  ACTIVIDAD_CERO, type ActividadClinica, type FilaPortada,
} from "@/components/admin/portada/atencion-core";
import { contarTiles, unirPendientes } from "@/components/admin/portada/pendientes";
import { medirUsoClinicas } from "@/lib/admin/uso-clinica";
import { metodoDePago, senalesDeCupo, DIAS_RENOVACION_PROXIMA, USO_VACIO, type SenalCupo } from "@/lib/admin/uso-core";
import { conteoMensual, serieNegocio, sumaPorPeriodo, ultimosMesesAdmin, type CobroCrudo } from "@/lib/admin/serie-negocio";
import { CFDI_OVERAGE_METHOD } from "@/lib/cfdi-overage";
import { listarPendientesAdmin } from "@/lib/billing/spei-directo";
import {
  fechaConDiaSemanaAdmin, inicioDeHaceDias, inicioDelAnio, inicioDelDia, inicioDelMes, inicioDelMesAnterior,
} from "@/lib/admin/zona-horaria";

export const metadata: Metadata = { title: "Super Admin — DaleControl" };

/** Meses que enseñan los sparklines de la portada. */
const MESES_SPARK = 6;
/** Métodos que cobran solos: un `pending` suyo no es un pago que alguien deba verificar a mano. */
const METODOS_AUTOMATICOS = new Set(["stripe", "mercadopago", "paypal", CFDI_OVERAGE_METHOD]);

export default async function AdminPage() {
  try {
    return await renderAdminDashboard();
  } catch (err: any) {
    console.error("Admin page error:", err);
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "48px 24px" }}>
        <CardNew>
          <div style={{ padding: 8 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--danger)", margin: 0, marginBottom: 12 }}>
              Error al cargar el panel admin
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
              {err.message ?? "Error desconocido"}
            </p>
            {err.message?.includes("column") || err.message?.includes("relation") ? (
              <div style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 16,
                fontSize: 13,
                color: "var(--text-2)",
              }}>
                <p style={{ fontWeight: 600, margin: 0, marginBottom: 6 }}>
                  La base de datos necesita ser migrada.
                </p>
                <p style={{ color: "var(--text-3)", margin: 0 }}>
                  Ve a tu Supabase SQL Editor y ejecuta el archivo{" "}
                  <code className="mono" style={{ color: "var(--brand)" }}>sql/migration_multi_category.sql</code>
                </p>
              </div>
            ) : null}
          </div>
        </CardNew>
      </div>
    );
  }
}

const DIA_MS = 86_400_000;

/**
 * Acumulador de actividad de una clínica en una ventana. Se crea a demanda para
 * no llenar el mapa de ceros de clínicas que no hicieron nada.
 */
function acumula(
  mapa: Map<string, ActividadClinica>,
  clinicId: string,
  campo: keyof ActividadClinica,
): void {
  let acc = mapa.get(clinicId);
  if (!acc) {
    acc = { ...ACTIVIDAD_CERO };
    mapa.set(clinicId, acc);
  }
  acc[campo] += 1;
}

/**
 * /admin — la portada.
 *
 * Todo lo que se pinta sale de datos reales y de cálculos que ya existían:
 *  · salud y señales de cada clínica: `evaluarSaludClinica` vía atencion-core
 *    (el mismo cálculo que Clínicas y Clientes);
 *  · MRR: `computeMrr` (@/lib/admin/mrr), precios de plan_configs;
 *  · ingresos: subscription_invoices `paid` por `paidAt ?? createdAt`, con
 *    los cortes del calendario de Mérida (@/lib/admin/zona-horaria);
 *  · cupos (almacenamiento, tokens, CFDI, usuarios, sedes, saldo IA):
 *    `medirUsoClinicas` (@/lib/admin/uso-clinica), con el mismo criterio que
 *    los gates que bloquean subidas y altas.
 *
 * Consultas: 2 de precios/sedes (con sus propias tandas), luego tandas de 2,
 * 5 y 3, y las dos tandas de uso (4 + 3). Nunca más de 7 en vuelo.
 */
async function renderAdminDashboard() {
  const now = new Date();

  // ── Los CORTES, en la zona de Mérida (ver @/lib/admin/zona-horaria) ──────
  const hoy0   = inicioDelDia(now);
  const month1 = inicioDelMes(now);
  const prev1  = inicioDelMesAnterior(now);
  const anio0  = inicioDelAnio(now);
  // Un año largo hacia atrás: de aquí salen la serie anual, los sparklines y
  // las tres cifras de facturación, todas de LAS MISMAS filas.
  const desde12m = inicioDeHaceDias(370, now);

  const desdeActividad = new Date(hoy0.getTime() - (DIAS_ACTIVIDAD - 1) * DIA_MS);
  const desdePrevia    = new Date(desdeActividad.getTime() - DIAS_ACTIVIDAD * DIA_MS);
  const desdeEnLinea   = new Date(now.getTime() - MINUTOS_EN_LINEA * 60_000);
  const periodosSpark  = ultimosMesesAdmin(now, MESES_SPARK).map((m) => m.clave);

  // Fuera de las tandas: cada uno abre las suyas (3 y 2).
  const [planPrices, sedesIncluidas] = await Promise.all([
    loadPlanPrices(),
    loadIncludedBranchIds().catch((e) => { console.error("[admin] sedes incluidas:", e); return null; }),
  ]);

  // Tanda 1 — 2 consultas: las clínicas y las facturas de suscripción recientes.
  const [allClinics, subInvoices] = await Promise.all([
    prisma.clinic.findMany({
      select: {
        id: true, name: true, plan: true, createdAt: true, trialEndsAt: true, subscriptionStatus: true,
        nextBillingDate: true, archivedAt: true, cancelRequested: true, cancelRequestedAt: true, timezone: true,
        monthlyPrice: true, aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true,
        paymentMethodType: true, paymentMethodLast4: true, preferredPaymentMethod: true,
        stripeCustomerId: true, stripeSubscriptionId: true, paypalSubscriptionId: true,
        _count: { select: { patients: true, appointments: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // OR createdAt/paidAt: una factura CREADA el mes pasado pero PAGADA este
    // mes cuenta para «por cobrar» y para «últimos pagos».
    prisma.subscriptionInvoice.findMany({
      where:   { OR: [{ createdAt: { gte: prev1 } }, { paidAt: { gte: prev1 } }] },
      include: { clinic: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Tanda 2 — 6 consultas agregadas. Cada una con su .catch: un timeout no
  // tumba la portada, pero lo que falla se dice (`avisos`).
  const avisos: string[] = [];
  const [ultimaCitaRows, pagadasRows, cobros12mRows, accesoRows, cfdiRows, pendientesRows] = await Promise.all([
    prisma.appointment
      .groupBy({ by: ["clinicId"], where: { startsAt: { lte: now } }, _max: { startsAt: true } })
      .catch((e) => { console.error("[admin] última cita por clínica:", e); return null; }),
    prisma.subscriptionInvoice
      .groupBy({ by: ["clinicId"], where: { status: "paid" }, _count: { _all: true }, _max: { paidAt: true } })
      .catch((e) => { console.error("[admin] pagos históricos por clínica:", e); return null; }),
    prisma.subscriptionInvoice
      .findMany({
        where: {
          status: "paid",
          OR: [{ paidAt: { gte: desde12m } }, { AND: [{ paidAt: null }, { createdAt: { gte: desde12m } }] }],
        },
        select: { amount: true, paidAt: true, createdAt: true },
      })
      .catch((e) => { console.error("[admin] cobros del año:", e); return null; }),
    prisma.analyticsSession
      .groupBy({
        by: ["clinicId"],
        where: { surface: "dashboard", clinicId: { not: null } },
        _max: { lastSeenAt: true },
      })
      .catch((e) => { console.error("[admin] accesos al panel:", e); return null; }),
    prisma.cfdiUsage
      .findMany({ where: { period: { in: periodosSpark } }, select: { period: true, stamped: true } })
      .catch((e) => { console.error("[admin] CFDI por mes:", e); return null; }),
    // TODOS los pagos de suscripción en «pendiente», sin ventana: la misma lista
    // que /admin/payments verifica. Los de la ventana de dos meses (subInvoices)
    // no bastan: una transferencia registrada en julio seguía sin verificar.
    prisma.subscriptionInvoice
      .findMany({ where: { status: "pending" }, select: { clinicId: true, amount: true, method: true } })
      .catch((e) => { console.error("[admin] pagos pendientes:", e); return null; }),
  ]);

  // Tanda 3 — cuánto ha HECHO cada clínica (filas crudas de 60 días).
  const [citasRows, facturasRows, notasRows] = await Promise.all([
    prisma.appointment
      .findMany({ where: { startsAt: { gte: desdePrevia, lt: now } }, select: { clinicId: true, startsAt: true } })
      .catch((e) => { console.error("[admin] citas por ventana:", e); return null; }),
    prisma.invoice
      .findMany({ where: { createdAt: { gte: desdePrevia } }, select: { clinicId: true, createdAt: true } })
      .catch((e) => { console.error("[admin] facturas por ventana:", e); return null; }),
    prisma.medicalRecord
      .findMany({ where: { createdAt: { gte: desdePrevia } }, select: { clinicId: true, createdAt: true } })
      .catch((e) => { console.error("[admin] notas por ventana:", e); return null; }),
  ]);

  // Tanda 4 (dos internas) — cupos y saldo IA de las clínicas vivas.
  const vivas = allClinics.filter((c) => !c.archivedAt);
  const uso = await medirUsoClinicas(vivas, now);

  // Transferencias SPEI directas por confirmar (spei_transfer_requests, de
  // ws1-t3): la misma lista que /admin/payments. `listarPendientesAdmin`
  // devuelve [] si la tabla aún no existe; el catch cubre cualquier otra cosa.
  const speiPendientes = await listarPendientesAdmin()
    .catch((e) => { console.error("[admin] SPEI por confirmar:", e); return null; });

  if (!sedesIncluidas) avisos.push("sedes incluidas (el MRR las cuenta a precio de lista)");
  if (!ultimaCitaRows) avisos.push("última cita de cada clínica");
  if (!pagadasRows) avisos.push("histórico de pagos por clínica");
  if (!accesoRows) avisos.push("accesos al panel");
  if (!cobros12mRows) avisos.push("ingresos del año");
  if (!cfdiRows) avisos.push("CFDI por mes");
  if (!pendientesRows) avisos.push("pagos pendientes de verificar");
  if (!speiPendientes) avisos.push("transferencias SPEI por confirmar");
  if (!citasRows || !facturasRows || !notasRows) avisos.push(`actividad de los últimos ${DIAS_ACTIVIDAD} días`);
  avisos.push(...uso.avisos);

  const ultimaCitaPorClinica = new Map<string, Date>();
  for (const r of ultimaCitaRows ?? []) if (r._max.startsAt) ultimaCitaPorClinica.set(r.clinicId, r._max.startsAt);

  const actividadActual = new Map<string, ActividadClinica>();
  const actividadPrevia = new Map<string, ActividadClinica>();
  for (const c of citasRows ?? []) acumula(c.startsAt >= desdeActividad ? actividadActual : actividadPrevia, c.clinicId, "citas");
  for (const f of facturasRows ?? []) acumula(f.createdAt >= desdeActividad ? actividadActual : actividadPrevia, f.clinicId, "facturas");
  for (const n of notasRows ?? []) acumula(n.createdAt >= desdeActividad ? actividadActual : actividadPrevia, n.clinicId, "notas");

  const ultimoAccesoPorClinica = new Map<string, Date>();
  for (const r of accesoRows ?? []) if (r.clinicId && r._max.lastSeenAt) ultimoAccesoPorClinica.set(r.clinicId, r._max.lastSeenAt);
  // `null` = no se pudo mirar: un timeout no puede acabar diciendo «nunca pagó».
  const clinicasQuePagaron = pagadasRows ? new Set<string>(pagadasRows.map((r) => r.clinicId)) : null;

  // ── Ingresos: hoy, mes, año y las series, de LAS MISMAS filas ─────────────
  const cobros: CobroCrudo[] = (cobros12mRows ?? []).map((i) => ({ monto: i.amount, cuando: i.paidAt ?? i.createdAt }));
  const suma = (desde: Date) => cobros.filter((c) => c.cuando >= desde).reduce((a, c) => a + c.monto, 0);
  const facturacion = {
    hoy: suma(hoy0),
    mes: suma(month1),
    anio: suma(anio0),
    porCobrar: subInvoices.filter((i) => i.status === "pending" || i.status === "failed").reduce((s, i) => s + i.amount, 0),
    fallidos: subInvoices.filter((i) => i.status === "failed").length,
    medido: cobros12mRows !== null,
  };
  const altas = allClinics.map((c) => c.createdAt);
  const bajas = allClinics.flatMap((c) => (c.archivedAt ? [c.archivedAt] : []));
  const series = {
    semana: serieNegocio(cobros, altas, now, "semana"),
    mes: serieNegocio(cobros, altas, now, "mes"),
    anio: serieNegocio(cobros, altas, now, "anio"),
  };
  const sparks = {
    meses: MESES_SPARK,
    altas: conteoMensual(altas, now, MESES_SPARK),
    bajas: conteoMensual(bajas, now, MESES_SPARK),
    cfdi: sumaPorPeriodo((cfdiRows ?? []).map((r) => ({ period: r.period, valor: r.stamped })), now, MESES_SPARK),
    pagos: conteoMensual(cobros.map((c) => c.cuando), now, MESES_SPARK),
    cfdiMedido: cfdiRows !== null,
  };

  // ── Estado de plan y MRR (mismas reglas que siempre) ──────────────────────
  const trialClinics   = allClinics.filter((c) => isInTrial(c, now));
  const expiredClinics = allClinics.filter((c) => isPlanExpired(c, now));
  const activeClinics  = allClinics.filter((c) => c.subscriptionStatus === "active");
  const conSede = <T extends { id: string }>(c: T) => ({ ...c, includedBranch: !!sedesIncluidas?.has(c.id) });
  const mrrActive = computeMrr(activeClinics.map(conSede), planPrices);
  const mrrTrial  = computeMrr(trialClinics.map(conSede), planPrices);

  // ── Deuda por clínica, de las mismas filas que el KPI «por cobrar» ─────────
  const deudaPorClinica = new Map<string, { fallidos: number; monto: number }>();
  for (const inv of subInvoices) {
    if (inv.status !== "pending" && inv.status !== "failed") continue;
    const acc = deudaPorClinica.get(inv.clinicId) ?? { fallidos: 0, monto: 0 };
    if (inv.status === "failed") acc.fallidos += 1;
    acc.monto += inv.amount;
    deudaPorClinica.set(inv.clinicId, acc);
  }
  // ── Pagos por verificar: pendientes con método manual (sin ventana) ────────
  const porVerificar = new Map<string, { cuantos: number; monto: number }>();
  for (const inv of pendientesRows ?? []) {
    if (METODOS_AUTOMATICOS.has(inv.method ?? "")) continue;
    const v = porVerificar.get(inv.clinicId) ?? { cuantos: 0, monto: 0 };
    v.cuantos += 1;
    v.monto += inv.amount;
    porVerificar.set(inv.clinicId, v);
  }

  // Las SPEI directas pendientes se suman a «pagos por verificar» de su clínica.
  for (const t of speiPendientes ?? []) {
    const v = porVerificar.get(t.clinicId) ?? { cuantos: 0, monto: 0 };
    v.cuantos += 1;
    v.monto += t.amountCents / 100;
    porVerificar.set(t.clinicId, v);
  }

  const filasPortada: FilaPortada[] = allClinics.map((c) => {
    const deuda = deudaPorClinica.get(c.id);
    const acceso = ultimoAccesoPorClinica.get(c.id);
    return {
      id: c.id,
      nombre: c.name,
      plan: c.plan,
      createdAt: c.createdAt,
      trialEndsAt: c.trialEndsAt,
      subscriptionStatus: c.subscriptionStatus,
      nextBillingDate: c.nextBillingDate,
      archivedAt: c.archivedAt,
      pacientes: c._count.patients,
      citasTotales: c._count.appointments,
      ultimaCita: ultimaCitaPorClinica.get(c.id) ?? null,
      actividad: actividadActual.get(c.id) ?? { ...ACTIVIDAD_CERO },
      actividadPrevia: actividadPrevia.get(c.id) ?? { ...ACTIVIDAD_CERO },
      ultimoAcceso: acceso ?? null,
      enLinea: acceso !== undefined && acceso >= desdeEnLinea,
      cobrosFallidos: deuda?.fallidos ?? 0,
      montoPorCobrar: deuda?.monto ?? 0,
      algunaVezPago: clinicasQuePagaron ? clinicasQuePagaron.has(c.id) : null,
    };
  });
  const portada = construirPortada(filasPortada, now);
  const trabajando = rankingActividad(filasPortada, now);

  // ── Señales de cupo y cobro ───────────────────────────────────────────────
  // De las clínicas reales, todas. De las apartadas (cuentas de prueba y
  // archivadas), SÓLO el pago por verificar: una clínica recién registrada que
  // manda su transferencia tiene 0 pacientes y 0 citas —es «de prueba» para
  // salud-clinica— y aun así su pago es lo primero que hay que atender.
  const apartadas = new Set([...portada.cuentasDePrueba, ...portada.archivadas].map((c) => c.id));
  const cupos: SenalCupo[] = [];
  let renovacionesStripe = 0;
  for (const c of allClinics) {
    if (apartadas.has(c.id)) {
      const v = porVerificar.get(c.id);
      if (v && v.cuantos > 0) {
        cupos.push(...senalesDeCupo({
          id: c.id, nombre: c.name, uso: USO_VACIO, diasHastaRenovacion: null, suscripcionActiva: false, metodoManual: true,
          pagosPorVerificar: v,
        }));
      }
      continue;
    }
    const u = uso.porClinica.get(c.id);
    if (!u) continue;
    const { manual } = metodoDePago(c);
    const dias = daysUntil(c.nextBillingDate, now);
    const activa = getPlanStatus(c, now).kind === "active" && c.subscriptionStatus === "active";
    if (activa && !manual && dias !== null && dias >= 0 && dias <= DIAS_RENOVACION_PROXIMA) renovacionesStripe += 1;
    cupos.push(...senalesDeCupo({
      id: c.id, nombre: c.name, uso: u,
      diasHastaRenovacion: dias, suscripcionActiva: activa, metodoManual: manual,
      pagosPorVerificar: porVerificar.get(c.id) ?? { cuantos: 0, monto: 0 },
    }));
  }
  const pendientes = unirPendientes(portada, cupos);
  const tiles = contarTiles(pendientes, renovacionesStripe);

  // Con el estado de plan de la clínica (la MISMA insignia que Clínicas:
  // PlanStatusBadge sobre plan-status), para saber si ese pago la dejó al día.
  const clinicaPorId = new Map(allClinics.map((c) => [c.id, c]));
  const ultimosPagos: PagoReciente[] = subInvoices.slice().sort(comparePaymentDateDesc).slice(0, 6).map((inv) => {
    const c = clinicaPorId.get(inv.clinicId);
    return {
      id: inv.id, clinicaId: inv.clinicId, clinicaNombre: inv.clinic.name, monto: inv.amount,
      metodo: inv.method, status: inv.status, fecha: new Date(paymentDate(inv)),
      clinica: c ? { trialEndsAt: c.trialEndsAt, subscriptionStatus: c.subscriptionStatus, nextBillingDate: c.nextBillingDate } : null,
    };
  });

  const datos: DatosPortada = {
    fechaStr: fechaConDiaSemanaAdmin(now) ?? "",
    tiles,
    series,
    sparks,
    facturacion,
    negocio: {
      mrr: mrrActive,
      mrrPotencial: mrrActive.total + mrrTrial.total,
      activas: activeClinics.length,
      enTrial: trialClinics.length,
      vencidas: expiredClinics.length,
      total: allClinics.length,
      dePrueba: portada.totales.dePrueba,
      archivadas: portada.totales.archivadas,
      altasMes: allClinics.filter((c) => c.createdAt >= month1).length,
      altasMesAnterior: allClinics.filter((c) => c.createdAt >= prev1 && c.createdAt < month1).length,
      bajasMes: bajas.filter((b) => b >= month1).length,
      cancelacionesPedidas: allClinics.filter((c) => c.cancelRequested && c.cancelRequestedAt && c.cancelRequestedAt >= month1).length,
    },
    pendientes,
    clinicasConPendiente: new Set(pendientes.map((p) => p.clinicaId)).size,
    reales: portada.totales.reales,
    ultimosPagos,
    trabajando,
    enLinea: portada.totales.enLinea,
    avisos,
  };

  return <PortadaVista datos={datos} now={now} />;
}
