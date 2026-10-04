export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OverviewClient } from "./overview-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";
import { ModuleLocked } from "@/components/dashboard/module-locked";
import { ModuloFueraDelPlan } from "@/components/dashboard/marketplace-oculto/modulo-fuera-del-plan";
import { marketplaceOcultoPara } from "@/components/dashboard/marketplace-oculto/servidor";
import { getServerT } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { zonaDeClinica } from "@/lib/inventory/zona-clinica.server";
import { citasDelPeriodoWhere, diaDeLaClinica, mesDeLaClinica } from "@/lib/agenda/citas-del-periodo";
import { SinAcceso, TITULO_SIN_ACCESO } from "@/components/dashboard/sin-permiso-rediseno/sin-acceso";

export const metadata: Metadata = { title: "Analytics — DaleControl" };

const MIN_APPTS_FOR_INSIGHTS = 30;

export default async function AnalyticsOverviewPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "analytics.view");

  // Gating por PLAN (no solo por rol): si el plan de la clínica no incluye
  // Analytics, no se puede abrir por URL. Mismo criterio que el sidebar
  // (getActiveClinicModuleKeys): fail-open en trial / error, oculta en BASIC.
  const activeModules = await getActiveClinicModuleKeys(user.clinicId);
  if (!activeModules.includes("analytics")) {
    // Marketplace oculto por ahora (ws1-t6): en el camino nuevo «Ver planes»
    // lleva al plan de la clínica. Con la bandera apagada, el ModuleLocked de siempre.
    if (await marketplaceOcultoPara(user.clinicId)) return <ModuloFueraDelPlan name="Analytics" />;
    return <ModuleLocked name="Analytics" />;
  }

  const clinicId = user.clinicId;
  const { t } = await getServerT();

  // Solo admin/owner ven analytics.
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    // C-109: el mismo «sin acceso» que el resto del panel.
    return <SinAcceso titulo={TITULO_SIN_ACCESO[(await getServerT()).locale.startsWith("en") ? "en" : "es"]} texto={t("analytics.overviewPage.adminOnly")} volver={t("menuDosNiveles.cajaSinPermisoVolver")} />;
  }

  // Conteo de citas históricas para detectar "Recolectando datos…".
  // REDISEÑO DE ANALÍTICA — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // El layout del panel ya lo resolvió en este mismo request y la respuesta
  // vive 60 s en memoria por clínica: aquí no hay viaje a la base. Falla
  // cerrado: apagado, la pantalla se pinta exactamente como hoy.
  const [totalAppts, rediseno, zona] = await Promise.all([
    prisma.appointment.count({ where: { clinicId } }),
    menuDosNivelesEncendido(clinicId),
    zonaDeClinica(clinicId),
  ]);
  const insufficientData = totalAppts < MIN_APPTS_FOR_INSIGHTS;
  const dataProgress = Math.min(100, Math.round((totalAppts / MIN_APPTS_FOR_INSIGHTS) * 100));

  // KPIs del mes actual + comparativa mes anterior. Calculamos server-side
  // para evitar flash en el primer render. El cliente luego refresca el
  // efficiency score (que necesita hora-por-hora) vía API.
  //
  // ws1-t2 (auditoría de uso C-11): el mes es el de CALENDARIO de la clínica,
  // ENTERO y con fin (lib/agenda/citas-del-periodo.ts). Antes empezaba el día
  // 1 del mes del SERVIDOR y no tenía fin: contaba también las citas de los
  // meses siguientes (85 aquí contra 76 en Inicio).
  const now = new Date();
  const mes = mesDeLaClinica(zona, now);
  const mesAnterior = mesDeLaClinica(zona, now, -1);
  const dia = diaDeLaClinica(zona, now);
  const enMes = { gte: mes.desde, lt: mes.hasta };
  const enMesAnterior = { gte: mesAnterior.desde, lt: mesAnterior.hasta };

  // Dos tandas (menos de 7 consultas por Promise.all: el pooler se satura).
  const [
    monthAppts, prevAppts,
    completedMonth, prevCompletedMonth,
    noShowMonth, prevNoShowMonth,
  ] = await Promise.all([
    prisma.appointment.count({ where: citasDelPeriodoWhere(clinicId, mes.desde, mes.hasta) }),
    prisma.appointment.count({ where: citasDelPeriodoWhere(clinicId, mesAnterior.desde, mesAnterior.hasta) }),
    prisma.appointment.count({ where: { clinicId, startsAt: enMes, status: { in: ["COMPLETED", "CHECKED_OUT"] } } }),
    prisma.appointment.count({ where: { clinicId, startsAt: enMesAnterior, status: { in: ["COMPLETED", "CHECKED_OUT"] } } }),
    prisma.appointment.count({ where: { clinicId, startsAt: enMes, status: "NO_SHOW" } }),
    prisma.appointment.count({ where: { clinicId, startsAt: enMesAnterior, status: "NO_SHOW" } }),
  ]);
  const [avgWaitMin, todayCount] = await Promise.all([
    prisma.appointmentTimeline.aggregate({
      where: {
        appointment: { clinicId, startsAt: enMes },
        totalWaitMin: { not: null },
      },
      _avg: { totalWaitMin: true },
    }),
    prisma.appointment.count({ where: citasDelPeriodoWhere(clinicId, dia.desde, dia.hasta) }),
  ]);

  const noShowRate = monthAppts > 0 ? (noShowMonth / monthAppts) * 100 : 0;
  const prevNoShowRate = prevAppts > 0 ? (prevNoShowMonth / prevAppts) * 100 : 0;

  return (
    <OverviewClient
      key={clinicId}
      data={{
        monthAppts,
        prevAppts,
        apptsDeltaPct: pct(monthAppts, prevAppts),
        completedMonth,
        prevCompletedMonth,
        completedDeltaPct: pct(completedMonth, prevCompletedMonth),
        noShowMonth,
        noShowRate: Math.round(noShowRate * 10) / 10,
        noShowDeltaPct: prevNoShowRate > 0 ? Math.round(((noShowRate - prevNoShowRate) / prevNoShowRate) * 100) : 0,
        avgWaitMin: avgWaitMin._avg.totalWaitMin ?? null,
        todayCount,
        insufficientData,
        dataProgress,
        totalAppts,
      }}
      rediseno={rediseno}
    />
  );
}

function pct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}
