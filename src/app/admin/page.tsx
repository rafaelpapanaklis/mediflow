export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import {
  DollarSign, TrendingUp, CheckCircle, Building2, Plus, FileText,
  CalendarCheck, Coins,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { computeMrr, includedBranchesHint, loadIncludedBranchIds, loadPlanPrices, mrrBreakdownHint } from "@/lib/admin/mrr";
import { comparePaymentDateDesc, paymentDate, importedLaterAt } from "@/lib/admin/payment-date";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { getPlanStatus, isInTrial, isPlanExpired } from "@/lib/plan-status";
import { AtencionHoy, SeparadorIndicadores } from "@/components/admin/portada/atencion-hoy";
import { ActividadPanel } from "@/components/admin/portada/actividad-panel";
import {
  construirPortada, rankingActividad, DIAS_ACTIVIDAD, MINUTOS_EN_LINEA,
  ACTIVIDAD_CERO, type ActividadClinica, type FilaPortada,
} from "@/components/admin/portada/atencion-core";
import {
  fechaConDiaSemanaAdmin, inicioDelAnio, inicioDelDia, inicioDelMes, inicioDelMesAnterior,
} from "@/lib/admin/zona-horaria";

/** Para decir en pantalla desde dónde se corta el día, sin repetir la zona. */
const ZONA_CORTA = "Mérida";

export const metadata: Metadata = { title: "Super Admin — DaleControl" };

/**
 * Celda de fecha de un pago: la del COBRO (paidAt), no la de alta de la fila.
 * Con el backfill de Stripe todos los cobros históricos entraron el mismo día,
 * así que `createdAt` mostraba la fecha de la importación. Cuando las dos
 * difieren mucho, el tooltip lo aclara.
 */
function PagoFechaCell({ inv }: { inv: { paidAt: Date | null; createdAt: Date } }) {
  const imported = importedLaterAt(inv);
  return (
    <td
      className="mono pa-num"
      style={{ color: "var(--text-3)", cursor: imported ? "help" : undefined }}
      title={imported
        ? `Importado el ${imported.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`
        : undefined}
    >
      {formatRelativeDate(paymentDate(inv))}
    </td>
  );
}

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

async function renderAdminDashboard() {
  const now = new Date();

  // ── Los CORTES, en la zona de Mérida ──────────────────────────────────────
  // Antes eran `new Date(now.getFullYear(), now.getMonth(), 1)`, que corta en
  // la zona del runtime: en producción (UTC) el día y el mes cambiaban a las
  // 18:00 de Mérida, y lo cobrado por la tarde se sumaba al periodo siguiente.
  // Ese era el descuadre. Ver @/lib/admin/zona-horaria.
  const hoy0   = inicioDelDia(now);
  const month1 = inicioDelMes(now);
  const prev1  = inicioDelMesAnterior(now);
  const anio0  = inicioDelAnio(now);

  // Ventanas de actividad, ancladas al día de Mérida para que no bailen dentro
  // del mismo día: los últimos 30 días (hoy incluido) y los 30 anteriores.
  const desdeActividad = new Date(hoy0.getTime() - (DIAS_ACTIVIDAD - 1) * DIA_MS);
  const desdePrevia    = new Date(desdeActividad.getTime() - DIAS_ACTIVIDAD * DIA_MS);
  const desdeEnLinea   = new Date(now.getTime() - MINUTOS_EN_LINEA * 60_000);

  // Tanda 1 — 5 consultas. El tope es 7 por Promise.all (el pooler se satura),
  // así que lo que necesita la portada nueva va en una segunda tanda.
  const [allClinics, newClinicsMonth, newClinicsPrev, subInvoices, planPrices] = await Promise.all([
    prisma.clinic.findMany({
      include: {
        // `lastLogin` NO se pide: está vacío en las 36 filas de la base (nadie
        // lo escribe), así que usarlo como "último acceso" marcaría a todas las
        // clínicas como que nunca entraron. El acceso real sale de
        // analytics_sessions, más abajo.
        users:  { select: { id:true, email:true, firstName:true, lastName:true } },
        _count: { select: { patients:true, appointments:true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.clinic.count({ where: { createdAt: { gte: month1 } } }),
    prisma.clinic.count({ where: { createdAt: { gte: prev1, lt: month1 } } }),
    // OR createdAt/paidAt: una factura CREADA el mes pasado pero PAGADA este
    // mes cuenta para "Cobrado este mes" (que mide por paidAt) y quedaría
    // fuera si filtráramos solo por createdAt.
    prisma.subscriptionInvoice.findMany({
      where:   { OR: [{ createdAt: { gte: prev1 } }, { paidAt: { gte: prev1 } }] },
      include: { clinic: { select: { name:true } } },
      orderBy: { createdAt: "desc" },
    }),
    loadPlanPrices(),
  ]);

  // Tanda 2 — 3 consultas, solo para "qué exige atención hoy".
  //
  // Cada una lleva su propio .catch: un timeout del pooler en una agregación
  // NO puede tumbar la portada entera, pero tampoco puede quedarse callado —
  // lo que falla se dice en pantalla (`avisos`), porque "no hay nada que
  // atender" y "no se pudo mirar" se ven igual y no son lo mismo.
  const avisos: string[] = [];
  const [ultimaCitaRows, pagadasRows, cobrosDelAnio, accesoRows] = await Promise.all([
    // Cita PASADA más reciente por clínica. `lte: now` a propósito y desde el
    // 21-sep-2026: es EXACTAMENTE la misma consulta que hace /admin/clinics, y
    // las dos alimentan el mismo cálculo (`evaluarSaludClinica`). Antes esta
    // traía la más reciente con las futuras incluidas, así que la portada y
    // Clínicas podían dar estados distintos de la misma clínica — que es el
    // descuadre que este cambio cierra. Ver `FilaPortada.ultimaCita`.
    prisma.appointment
      .groupBy({ by: ["clinicId"], where: { startsAt: { lte: now } }, _max: { startsAt: true } })
      .catch((e) => { console.error("[admin] última cita por clínica:", e); return null; }),
    // "¿Alguna vez pagó?" mira TODO el histórico a propósito: es lo que separa
    // una cuenta de pruebas vacía de una clínica que dejó de pagar.
    prisma.subscriptionInvoice
      .groupBy({ by: ["clinicId"], where: { status: "paid" }, _count: { _all: true } })
      .catch((e) => { console.error("[admin] pagos históricos por clínica:", e); return null; }),
    // Ingresos del AÑO en curso, de una sola consulta: de aquí salen las tres
    // cifras (hoy, mes, año) con los cortes de Mérida hechos en memoria. El
    // `OR` reproduce exactamente `paidAt ?? createdAt`, que es el criterio de
    // fecha de cobro que ya usa el resto del panel.
    prisma.subscriptionInvoice
      .findMany({
        where: {
          status: "paid",
          OR: [
            { paidAt: { gte: anio0 } },
            { AND: [{ paidAt: null }, { createdAt: { gte: anio0 } }] },
          ],
        },
        select: { amount: true, paidAt: true, createdAt: true },
      })
      .catch((e) => { console.error("[admin] ingresos del año:", e); return null; }),
    // Último momento en que alguien de cada clínica estuvo EN EL PANEL.
    // `surface: "dashboard"` es obligatorio: sin él entrarían las visitas a la
    // web pública (1840 filas el 20-sep-2026 contra 32 de panel), que no son
    // gente trabajando.
    prisma.analyticsSession
      .groupBy({
        by: ["clinicId"],
        where: { surface: "dashboard", clinicId: { not: null } },
        _max: { lastSeenAt: true },
      })
      .catch((e) => { console.error("[admin] accesos al panel:", e); return null; }),
  ]);

  // Tanda 3 — cuánto ha HECHO cada clínica. Se traen las filas crudas de 60
  // días y se reparten en memoria entre la ventana actual y la anterior: son
  // pocos cientos de filas, y hacerlo en la base costaría tres consultas más.
  // Y las sedes incluidas en el plan de su madre (2 consultas más: 5 en vuelo),
  // que valen $0 en el MRR con el mismo criterio que Clínicas y Clientes.
  const [citasRows, facturasRows, notasRows, sedesIncluidas] = await Promise.all([
    prisma.appointment
      .findMany({
        // `lt: now` a propósito: el rótulo dice "en los últimos 30 días" y una
        // cita agendada para dentro de dos meses no es actividad pasada.
        where: { startsAt: { gte: desdePrevia, lt: now } },
        select: { clinicId: true, startsAt: true },
      })
      .catch((e) => { console.error("[admin] citas por ventana:", e); return null; }),
    prisma.invoice
      .findMany({ where: { createdAt: { gte: desdePrevia } }, select: { clinicId: true, createdAt: true } })
      .catch((e) => { console.error("[admin] facturas por ventana:", e); return null; }),
    prisma.medicalRecord
      .findMany({ where: { createdAt: { gte: desdePrevia } }, select: { clinicId: true, createdAt: true } })
      .catch((e) => { console.error("[admin] notas por ventana:", e); return null; }),
    loadIncludedBranchIds()
      .catch((e) => { console.error("[admin] sedes incluidas:", e); return null; }),
  ]);
  if (!sedesIncluidas) {
    avisos.push("No se pudieron identificar las sedes incluidas: el MRR las cuenta a precio de lista.");
  }

  if (!ultimaCitaRows) avisos.push("No se pudo leer la última cita de cada clínica.");
  if (!pagadasRows) avisos.push("No se pudo leer el histórico de pagos por clínica.");
  if (!accesoRows) avisos.push("No se pudo leer quién ha entrado al panel.");
  if (!citasRows || !facturasRows || !notasRows) {
    avisos.push(`No se pudo medir la actividad de los últimos ${DIAS_ACTIVIDAD} días.`);
  }

  const ultimaCitaPorClinica = new Map<string, Date>();
  for (const r of ultimaCitaRows ?? []) {
    if (r._max.startsAt) ultimaCitaPorClinica.set(r.clinicId, r._max.startsAt);
  }
  // Actividad de las dos ventanas, en una pasada por cada tipo de fila.
  const actividadActual = new Map<string, ActividadClinica>();
  const actividadPrevia = new Map<string, ActividadClinica>();
  // Una pasada por tipo de fila, repartiendo entre la ventana actual y la
  // anterior según la fecha. Las filas ya están en memoria; volver a la base
  // por el periodo anterior serían tres consultas más.
  for (const c of citasRows ?? []) {
    acumula(c.startsAt >= desdeActividad ? actividadActual : actividadPrevia, c.clinicId, "citas");
  }
  for (const f of facturasRows ?? []) {
    acumula(f.createdAt >= desdeActividad ? actividadActual : actividadPrevia, f.clinicId, "facturas");
  }
  for (const n of notasRows ?? []) {
    acumula(n.createdAt >= desdeActividad ? actividadActual : actividadPrevia, n.clinicId, "notas");
  }

  // Último acceso al panel por clínica, y quién está dentro AHORA.
  const ultimoAccesoPorClinica = new Map<string, Date>();
  for (const r of accesoRows ?? []) {
    if (r.clinicId && r._max.lastSeenAt) ultimoAccesoPorClinica.set(r.clinicId, r._max.lastSeenAt);
  }
  // `null` cuando la consulta falló: ver el comentario de `algunaVezPago` en
  // atencion-core. Un timeout no puede acabar diciendo "nunca pagó".
  const clinicasQuePagaron = pagadasRows ? new Set<string>(pagadasRows.map((r) => r.clinicId)) : null;

  // ── Ingresos: hoy, este mes y este año ────────────────────────────────────
  // Por la fecha REAL del cobro (`paidAt ?? createdAt`) y con los cortes de
  // Mérida. Las tres salen de las MISMAS filas, así que no pueden contradecirse
  // entre ellas, y "este mes" es literalmente el valor del KPI de siempre.
  const fechaDeCobro = (i: { paidAt: Date | null; createdAt: Date }) => i.paidAt ?? i.createdAt;
  const cobros = cobrosDelAnio ?? [];
  if (!cobrosDelAnio) avisos.push("No se pudieron leer los ingresos del año.");
  const ingresoHoy = cobros.filter((i) => fechaDeCobro(i) >= hoy0).reduce((a, i) => a + i.amount, 0);
  const ingresoMes = cobros.filter((i) => fechaDeCobro(i) >= month1).reduce((a, i) => a + i.amount, 0);
  const ingresoAnio = cobros.reduce((a, i) => a + i.amount, 0);

  // Misma regla que el gate (src/lib/plan-status.ts): "en trial" = periodo por
  // delante SIN suscripción viva; "vencida" = isPlanExpired. Antes se comparaba
  // trialEndsAt contra hoy a ojo y una clínica AL CORRIENTE con la fecha vieja
  // salía como "Expirado" (y una que paga con fecha por delante, como "trial").
  const trialClinics   = allClinics.filter(c => isInTrial(c, now));
  const expiredClinics = allClinics.filter(c => isPlanExpired(c, now));
  const pastDueClinics = allClinics.filter(c => getPlanStatus(c, now).kind === "past_due");
  const activeClinics  = allClinics.filter(c => c.subscriptionStatus === "active");

  // MRR por la MISMA función que /admin/payments (@/lib/admin/mrr): precio
  // negociado de la clínica si lo tiene, $0 si es una sede incluida en el plan
  // de su madre, y si no el del plan en plan_configs. Reusa las filas ya
  // cargadas arriba en vez de volver a consultar.
  const conSede = <T extends { id: string }>(c: T) => ({ ...c, includedBranch: !!sedesIncluidas?.has(c.id) });
  const mrrActive    = computeMrr(activeClinics.map(conSede), planPrices);
  const mrrTrial     = computeMrr(trialClinics.map(conSede), planPrices);
  const mrr          = mrrActive.total;
  const mrrPotential = mrr + mrrTrial.total;
  // "Por cobrar" = pendientes (registradas a mano) + FALLIDAS de Stripe. Un
  // cobro rechazado es dinero que sigue debiéndose: si solo sumáramos las
  // "pending" el KPI marcaría $0 aunque haya clientes reales sin cobrar.
  const failedInv    = subInvoices.filter(i => i.status==="failed");
  const pendingPay   = subInvoices
    .filter(i => i.status==="pending" || i.status==="failed")
    .reduce((s,i)=>s+i.amount,0);
  const porCobrarStr = failedInv.length
    ? `${formatCurrency(pendingPay)} por cobrar · ${failedInv.length} fallido${failedInv.length===1?"":"s"}`
    : `${formatCurrency(pendingPay)} por cobrar`;
  const growthRate   = newClinicsPrev > 0 ? Math.round(((newClinicsMonth-newClinicsPrev)/newClinicsPrev)*100) : 0;

  // Lo que debe CADA clínica sale de las MISMAS filas que el KPI "por cobrar",
  // con su misma ventana: calcularlo con una consulta aparte daría dos números
  // distintos para lo mismo, que es el error que ya costó el MRR una vez.
  //
  // OJO con la suma: `pendingPay` incluye TODA factura pending/failed, y el
  // `dineroEnRiesgo` de la portada solo la parte atribuible a un cobro roto —
  // una `pending` de sobrecupo CFDI sobre una clínica al corriente cuenta en el
  // KPI y no es una alarma. Por eso el titular de la portada recibe `pendingPay`
  // tal cual y el subconjunto se enseña debajo, en vez de sumarlo aparte.
  const deudaPorClinica = new Map<string, { fallidos: number; monto: number }>();
  for (const inv of subInvoices) {
    if (inv.status !== "pending" && inv.status !== "failed") continue;
    const acc = deudaPorClinica.get(inv.clinicId) ?? { fallidos: 0, monto: 0 };
    if (inv.status === "failed") acc.fallidos += 1;
    acc.monto += inv.amount;
    deudaPorClinica.set(inv.clinicId, acc);
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
  const actividad = rankingActividad(filasPortada, now);

  // "Últimos pagos" se ordena por la fecha REAL del cobro (paidAt ?? createdAt),
  // que es la que se pinta. Ordenar por createdAt dejaba arriba lo último
  // IMPORTADO, no lo último cobrado.
  const ultimosPagos = subInvoices.slice().sort(comparePaymentDateDesc).slice(0, 10);

  // En la zona del panel, NO en la del runtime: ver @/lib/admin/zona-horaria.
  const fechaStr = fechaConDiaSemanaAdmin(now) ?? "";
  const apartadas = portada.totales.dePrueba + portada.totales.archivadas;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 16px" }}>
      {/* Cabecera. Los dos botones se quedan donde estaban, con el mismo texto
          y el mismo destino: son acciones que YA cambian cosas. */}
      <header className="pa-head">
        <div>
          <h1 className="pa-head__title">Panel Admin</h1>
          {/* La mayúscula inicial la pone .pa-head__sub::first-letter. */}
          <p className="pa-head__sub">Resumen de operaciones — {fechaStr}</p>
        </div>
        <div className="pa-head__actions">
          <Link href="/admin/payments" style={{ textDecoration: "none" }}>
            <ButtonNew variant="secondary" icon={<Plus size={14} />}>Registrar pago</ButtonNew>
          </Link>
          <Link href="/admin/reports" style={{ textDecoration: "none" }}>
            <ButtonNew variant="primary" icon={<FileText size={14} />}>Reporte completo</ButtonNew>
          </Link>
        </div>
      </header>

      {/* ── LO PRIMERO: qué exige atención hoy ── */}
      <AtencionHoy portada={portada} dineroSinCobrar={pendingPay} avisos={avisos} />

      {/* ── Quién está trabajando ── */}
      <SeparadorIndicadores>Quién está trabajando</SeparadorIndicadores>
      <ActividadPanel filas={actividad} enLinea={portada.totales.enLinea} />

      {/* ── Y debajo, los indicadores de siempre ── */}
      <SeparadorIndicadores>Cómo vamos</SeparadorIndicadores>

      {/* Ingresos — las tres ventanas, cortadas en el día de Mérida. "Este mes"
          es la MISMA cifra que el KPI "Cobrado este mes" de siempre: sale de la
          misma variable, no de otra suma. */}
      <div className="pa-kpis pa-kpis--3">
        <KpiCard label="Ingresos hoy" value={formatCurrency(ingresoHoy)} icon={CalendarCheck}
          hint={`Cobrado desde las 00:00 de ${ZONA_CORTA}`} />
        <KpiCard label="Ingresos este mes" value={formatCurrency(ingresoMes)} icon={CheckCircle}
          delta={{ value: porCobrarStr, direction: "down" }} />
        <KpiCard label="Ingresos este año" value={formatCurrency(ingresoAnio)} icon={Coins}
          hint={`Desde el 1 de enero, por fecha de cobro`} />
      </div>

      <div className="pa-kpis pa-kpis--3">
        <KpiCard label="MRR Activo" value={formatCurrency(mrr)} icon={DollarSign}
          hint={[mrrBreakdownHint(mrrActive), includedBranchesHint(mrrActive.includedBranches)].filter(Boolean).join(" · ")}
          delta={{ value: `${activeClinics.length} clínicas`, direction: "up" }} />
        <KpiCard label="MRR Potencial" value={formatCurrency(mrrPotential)} icon={TrendingUp}
          delta={{ value: `+${trialClinics.length} en trial`, direction: "up" }} />
        <KpiCard label="Nuevas clínicas" value={String(newClinicsMonth)} icon={Building2}
          delta={{ value: `${Math.abs(growthRate)}% vs mes anterior`, direction: growthRate >= 0 ? "up" : "down" }} />
      </div>

      {/* Contadores secundarios. Los números son los MISMOS de siempre (todas
          las clínicas, sin filtrar); lo único nuevo es el pie que dice cuántas
          de esas filas están apartadas de "atención hoy" y por qué. */}
      <div className="pa-contadores">
        <CardNew>
          <div className="pa-contador__label">Total clínicas</div>
          <div className="pa-contador__valor">{allClinics.length}</div>
          {apartadas > 0 && (
            // Se nombra solo lo que hay: con 0 de prueba y 1 archivada, decir
            // "incluye 0 de prueba" es ruido.
            <div className="pa-contador__pie">
              incluye {[
                portada.totales.dePrueba > 0 ? `${portada.totales.dePrueba} de prueba` : null,
                portada.totales.archivadas > 0
                  ? `${portada.totales.archivadas} archivada${portada.totales.archivadas === 1 ? "" : "s"}`
                  : null,
              ].filter(Boolean).join(" y ")}
              {" · "}{portada.totales.reales} reales
            </div>
          )}
        </CardNew>
        <CardNew>
          <div className="pa-contador__label">
            <span className="pa-contador__dot" style={{ background: "var(--success)" }} />
            Activas
          </div>
          <div className="pa-contador__valor">{activeClinics.length}</div>
        </CardNew>
        <CardNew>
          <div className="pa-contador__label">
            <span className="pa-contador__dot" style={{ background: "var(--warning)" }} />
            En trial
          </div>
          <div className="pa-contador__valor">{trialClinics.length}</div>
        </CardNew>
        <CardNew>
          <div className="pa-contador__label">
            <span className="pa-contador__dot" style={{ background: "var(--danger)" }} />
            Vencidas
          </div>
          <div className="pa-contador__valor">{expiredClinics.length}</div>
          <div className="pa-contador__pie">
            {pastDueClinics.length} con cobro fallido (aún con acceso)
          </div>
        </CardNew>
      </div>

      {/* Últimos pagos */}
      <div style={{ marginBottom: 20 }}>
        <CardNew
          noPad
          title="Últimos pagos"
          action={
            <Link href="/admin/payments" style={{ textDecoration: "none" }}>
              <ButtonNew size="sm" variant="ghost">Ver todos</ButtonNew>
            </Link>
          }
        >
          {subInvoices.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              Sin pagos registrados aún
            </div>
          ) : (
            <div className="pa-scroll-x">
              <table className="table-new">
                <thead>
                  <tr>
                    <th>Clínica</th>
                    <th>Monto</th>
                    <th>Método</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimosPagos.map(inv => (
                    <tr key={inv.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <AvatarNew name={inv.clinic.name} size="sm" />
                          <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{inv.clinic.name}</span>
                        </div>
                      </td>
                      <td className="mono pa-num" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                        {formatCurrency(inv.amount)}
                      </td>
                      <td style={{ color: "var(--text-3)", textTransform: "capitalize" }}>{inv.method ?? "—"}</td>
                      <td>
                        <BadgeNew tone={inv.status === "paid" ? "success" : inv.status === "failed" ? "danger" : "warning"}>
                          {inv.status === "paid" ? "Pagado" : inv.status === "failed" ? "Fallido" : "Pendiente"}
                        </BadgeNew>
                      </td>
                      <PagoFechaCell inv={inv} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardNew>
      </div>

      {/* Últimas clínicas */}
      <CardNew
        noPad
        title="Últimas clínicas registradas"
        action={
          <Link href="/admin/clinics" style={{ textDecoration: "none" }}>
            <ButtonNew size="sm" variant="ghost">Ver todas</ButtonNew>
          </Link>
        }
      >
        <div className="pa-scroll-x">
          <table className="table-new">
            <thead>
              <tr>
                <th>Clínica</th>
                <th>Plan</th>
                <th>Pacientes</th>
                <th>Estado</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {allClinics.slice(0, 10).map(clinic => {
                return (
                  <tr key={clinic.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <AvatarNew name={clinic.name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <Link href={`/admin/clinics/${clinic.id}`} style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none" }}>
                            {clinic.name}
                          </Link>
                          {/* Sin usuario no se inventa un correo: se dice que no hay. */}
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {clinic.users[0]?.email ?? "sin usuario"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <BadgeNew tone={clinic.plan === "CLINIC" ? "brand" : clinic.plan === "PRO" ? "info" : "neutral"}>
                        {clinic.plan}
                      </BadgeNew>
                      <div className="mono pa-num" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        {formatCurrency(planPrices[clinic.plan] ?? 0)}/mes
                      </div>
                    </td>
                    <td className="mono pa-num" style={{ color: "var(--text-2)" }}>{clinic._count.patients}</td>
                    <td>
                      {/* Solo los 3 campos que la regla necesita: la fila entera no viaja al navegador. */}
                      <PlanStatusBadge
                        now={now}
                        clinic={{
                          trialEndsAt: clinic.trialEndsAt,
                          subscriptionStatus: clinic.subscriptionStatus,
                          nextBillingDate: clinic.nextBillingDate,
                        }}
                      />
                    </td>
                    <td className="mono pa-num" style={{ color: "var(--text-3)" }}>
                      {formatRelativeDate(clinic.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardNew>
    </div>
  );
}
