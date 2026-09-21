export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { loadPlanPrices, computeMrr, type AdminMrr } from "@/lib/admin/mrr";
import { DIAS_VENTANA_ACTIVIDAD, MINUTOS_EN_LINEA, SUPERFICIE_PANEL } from "@/lib/admin/salud-clinica";
import { inicioDeHaceDias } from "@/lib/admin/zona-horaria";
import { AdminClinicsClient, type FilaClinica } from "./clinics-client";

export const metadata: Metadata = { title: "Clínicas — Admin DaleControl" };

/**
 * Roster de clínicas para /admin.
 *
 * COSTE: 1 consulta de precios (plan_configs, con caché) + 11 consultas de
 * datos, TODAS agregadas, en DOS tandas de 6 y 5 (el pooler se satura por
 * encima de 7 por Promise.all). Ni una consulta por clínica: con 500 clínicas
 * son las mismas 11.
 *
 * /admin es la vista del dueño de la plataforma: sus consultas son
 * deliberadamente CROSS-TENANT (no llevan clinicId) y lo que las protege es el
 * gate de sesión del layout de /admin, no un filtro de tenant.
 *
 * LAS VENTANAS CORTAN EN LA MEDIANOCHE DE MÉRIDA, no en la del servidor
 * (@/lib/admin/zona-horaria). Con el corte del servidor, a partir de las 18:00
 * de Yucatán el día ya había cambiado y la actividad se contaba en el día
 * siguiente.
 */
export default async function AdminClinicsPage() {
  const ahora = new Date();
  // Ventana de actividad y la ANTERIOR, para la tendencia.
  const desdeVentana = inicioDeHaceDias(DIAS_VENTANA_ACTIVIDAD, ahora);
  const desdePrevia  = inicioDeHaceDias(DIAS_VENTANA_ACTIVIDAD * 2, ahora);
  const desdeEnLinea = new Date(ahora.getTime() - MINUTOS_EN_LINEA * 60_000);

  // Fuera del Promise.all: loadPlanPrices ya hace su propio Promise.all de 3.
  const planPrices = await loadPlanPrices();

  const [clinics, citasPasadas, citasVentana, citasPrevias, citasFuturas, accesos] = await Promise.all([
    prisma.clinic.findMany({
      // NOM-004 / NOM-024 §7 — las clínicas archivadas (soft-delete) se ocultan del
      // roster; el expediente se conserva pero la clínica deja de operar.
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, slug: true, specialty: true, country: true,
        plan: true, trialEndsAt: true, createdAt: true,
        aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true,
        // subscriptionStatus + nextBillingDate: lo que la insignia de estado de
        // plan (plan-status) necesita para "Al corriente · renueva el …".
        subscriptionStatus: true, nextBillingDate: true,
        // monthlyPrice: el precio NEGOCIADO. Manda sobre el del plan en el MRR.
        monthlyPrice: true,
        paymentMethodCollected: true, paymentMethodType: true, paymentMethodLast4: true,
        cancelRequested: true, cancelRequestedAt: true,
        state: true, clinicSize: true,
        _count: { select: { patients: true, users: true, appointments: true } },
        users:  { take: 1, select: { email: true, firstName: true, lastName: true } },
      },
    }),
    // Citas YA pasadas: cuántas y cuándo fue la última. "Última cita" tiene que
    // ser una que ocurrió; con _max sobre todas, una cita agendada para dentro
    // de un mes haría parecer viva a una clínica apagada.
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { startsAt: { lte: ahora } },
      _count: { _all: true },
      _max: { startsAt: true },
    }),
    // Citas dentro de la ventana de actividad.
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { startsAt: { gte: desdeVentana, lte: ahora } },
      _count: { _all: true },
    }),
    // La MISMA ventana, 30 días antes: es contra esto que se mide la tendencia.
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { startsAt: { gte: desdePrevia, lt: desdeVentana } },
      _count: { _all: true },
    }),
    // Lo que tiene por delante: da contexto a una clínica sin citas recientes.
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { startsAt: { gt: ahora } },
      _count: { _all: true },
      _min: { startsAt: true },
    }),
    // Quién está TRABAJANDO en el panel, y cuándo fue la última vez.
    //
    // ⛔ NO se usa User.lastLogin: está vacío en las 36 filas de producción
    // (nadie lo escribe), así que todas las clínicas saldrían como "nadie ha
    // entrado nunca". La fuente buena es analytics_sessions con
    // surface="dashboard" — surface="public" son visitas a la web pública, no
    // gente trabajando, y mezclarlas inflaría el dato por mil.
    prisma.analyticsSession.groupBy({
      by: ["clinicId"],
      where: { surface: SUPERFICIE_PANEL, clinicId: { not: null } },
      _max: { lastSeenAt: true },
    }),
  ]);

  // ── Segunda tanda (5): lo que mide CUÁNTO trabaja cada clínica ──────────
  const [facturasVentana, facturasPrevias, notasVentana, notasPrevias, pagos] = await Promise.all([
    // prisma.invoice = lo que la clínica factura a SUS pacientes.
    prisma.invoice.groupBy({
      by: ["clinicId"],
      where: { createdAt: { gte: desdeVentana } },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["clinicId"],
      where: { createdAt: { gte: desdePrevia, lt: desdeVentana } },
      _count: { _all: true },
    }),
    // "Notas" = expedientes / notas clínicas (prisma.medicalRecord), que es lo
    // que la ficha ya enseña como "Actividad reciente".
    prisma.medicalRecord.groupBy({
      by: ["clinicId"],
      where: { createdAt: { gte: desdeVentana } },
      _count: { _all: true },
    }),
    prisma.medicalRecord.groupBy({
      by: ["clinicId"],
      where: { createdAt: { gte: desdePrevia, lt: desdeVentana } },
      _count: { _all: true },
    }),
    // Lo que la clínica NOS ha pagado. Un solo pago basta para que deje de ser
    // "una prueba".
    prisma.subscriptionInvoice.groupBy({
      by: ["clinicId"],
      where: { status: "paid" },
      _count: { _all: true },
      _max: { paidAt: true },
      _sum: { amount: true },
    }),
  ]);

  const porClinica = <T extends { clinicId: string | null }>(filas: T[]) =>
    new Map(filas.filter((f) => f.clinicId !== null).map((f) => [f.clinicId as string, f]));

  const mPasadas     = porClinica(citasPasadas);
  const mVentana     = porClinica(citasVentana);
  const mPrevias     = porClinica(citasPrevias);
  const mFuturas     = porClinica(citasFuturas);
  const mAccesos     = porClinica(accesos);
  const mFactVentana = porClinica(facturasVentana);
  const mFactPrevias = porClinica(facturasPrevias);
  const mNotaVentana = porClinica(notasVentana);
  const mNotaPrevias = porClinica(notasPrevias);
  const mPagos       = porClinica(pagos);

  const filas: FilaClinica[] = clinics.map((c) => ({
    ...c,
    citasPasadas:    mPasadas.get(c.id)?._count._all ?? 0,
    ultimaCitaAt:    mPasadas.get(c.id)?._max.startsAt ?? null,
    citasVentana:    mVentana.get(c.id)?._count._all ?? 0,
    citasFuturas:    mFuturas.get(c.id)?._count._all ?? 0,
    proximaCitaAt:   mFuturas.get(c.id)?._min.startsAt ?? null,
    citasVentanaPrevia:    mPrevias.get(c.id)?._count._all ?? 0,
    facturasVentana:       mFactVentana.get(c.id)?._count._all ?? 0,
    facturasVentanaPrevia: mFactPrevias.get(c.id)?._count._all ?? 0,
    notasVentana:          mNotaVentana.get(c.id)?._count._all ?? 0,
    notasVentanaPrevia:    mNotaPrevias.get(c.id)?._count._all ?? 0,
    ultimoAccesoAt:  mAccesos.get(c.id)?._max.lastSeenAt ?? null,
    // "En línea" = sesión de panel vista en los últimos MINUTOS_EN_LINEA.
    enLinea: (() => {
      const visto = mAccesos.get(c.id)?._max.lastSeenAt ?? null;
      return visto !== null && visto >= desdeEnLinea;
    })(),
    pagosRegistrados: mPagos.get(c.id)?._count._all ?? 0,
    ultimoPagoAt:    mPagos.get(c.id)?._max.paidAt ?? null,
    totalPagado:     mPagos.get(c.id)?._sum.amount ?? 0,
  }));

  // MRR por la FUENTE ÚNICA (@/lib/admin/mrr), no por una suma propia: sólo
  // cuentan las de subscriptionStatus "active" y manda el precio negociado
  // cuando lo hay. Antes esta pantalla sumaba el precio de lista de TODAS las
  // clínicas (trials y vencidas incluidas) desde la tabla de fallback.
  const mrr: AdminMrr = computeMrr(
    clinics.filter((c) => c.subscriptionStatus === "active"),
    planPrices,
  );

  return (
    <AdminClinicsClient
      clinics={filas}
      planPrices={planPrices}
      mrr={mrr}
      ahoraISO={ahora.toISOString()}
    />
  );
}
