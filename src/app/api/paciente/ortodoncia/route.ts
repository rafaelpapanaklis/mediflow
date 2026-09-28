// GET /api/paciente/ortodoncia — Parte 8 «Alineadores y cumplimiento»
// (ws1-t8, ola 1, sep-2026). H14/H15: el paciente ve su caso de ortodoncia
// (si tiene uno) para marcar cumplimiento de elásticos y subir fotos de
// monitoreo. Mismo patrón que /api/paciente/documentos.
//
// ws1-t2 (Paciente y WhatsApp, W4) agregó `cobranza`/`proximoControl` de
// forma ADITIVA a esta misma ruta compartida — no toca aligner/compliance
// ni el flujo de subida de fotos, que siguen siendo de esta parte.
//
// Nunca confía en un patientId/clinicId del cliente — sale de ctx.links.
// Si el paciente no tiene ningún caso de ortodoncia (o el módulo no está
// activo en su clínica), responde 200 con `cases: []` — no es un error.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { summarizeElasticsCompliance } from "@/lib/orthodontics/elastics/compliance";
import { cargarCobranzaDelCaso } from "@/lib/orthodontics/cobranza-db";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

export const dynamic = "force-dynamic";

function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface PacienteOrtodonciaCobranza {
  cuotaDeHoyMxn: number | null;
  /** "YYYY-MM-DD" de la próxima cuota que aún no vence, o null. */
  proximoVencimiento: string | null;
  vencidoMxn: number;
  saldoTotalMxn: number;
}

export interface PacienteOrtodonciaCase {
  treatmentPlanId: string;
  clinicId: string;
  clinicName: string;
  aligner: {
    currentTray: number;
    totalTrays: number;
    systemName: string | null;
  } | null;
  compliance: {
    windowDays: number;
    compliancePct: number | null;
    isLow: boolean;
  };
  todayLogged: boolean;
  /** ws1-t2 (W4) — null = sin factura de tratamiento (nada que cobrar todavía). */
  cobranza: PacienteOrtodonciaCobranza | null;
  /** ws1-t2 (W4) — ISO de la próxima cita "Control de ortodoncia", o null. */
  proximoControl: string | null;
}

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();
    if (ctx.links.length === 0) {
      return NextResponse.json({ cases: [] satisfies PacienteOrtodonciaCase[] });
    }

    const patientIds = ctx.links.map((l) => l.patientId);

    const plans = await prisma.orthodonticTreatmentPlan.findMany({
      where: { patientId: { in: patientIds }, deletedAt: null },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        clinic: { select: { name: true, timezone: true } },
      },
    });

    if (plans.length === 0) {
      return NextResponse.json({ cases: [] satisfies PacienteOrtodonciaCase[] });
    }

    const today = new Date().toISOString().slice(0, 10);

    const cases = await Promise.all(
      plans.map(async (plan): Promise<PacienteOrtodonciaCase> => {
        let aligner: PacienteOrtodonciaCase["aligner"] = null;
        let compliance: PacienteOrtodonciaCase["compliance"] = { windowDays: 14, compliancePct: null, isLow: false };
        let todayLogged = false;

        try {
          const a = await prisma.orthodonticAligner.findFirst({
            where: { treatmentPlanId: plan.id, deletedAt: null },
            select: { currentTray: true, totalTrays: true, systemName: true },
          });
          if (a) aligner = a;
        } catch (e) {
          if (!isMissingRelation(e)) throw e;
        }

        try {
          const since = new Date();
          since.setUTCDate(since.getUTCDate() - 14);
          const logs = await prisma.orthodonticElasticsLog.findMany({
            where: { treatmentPlanId: plan.id, logDate: { gte: since } },
            select: { logDate: true, wornHours: true, usedElastics: true },
          });
          const summary = summarizeElasticsCompliance(
            logs.map((l) => ({
              date: l.logDate.toISOString().slice(0, 10),
              wornHours: l.wornHours,
              usedElastics: l.usedElastics,
            })),
            { windowDays: 14, targetHoursPerDay: 20 },
          );
          compliance = { windowDays: 14, compliancePct: summary.compliancePct, isLow: summary.isLow };
          todayLogged = logs.some((l) => l.logDate.toISOString().slice(0, 10) === today);
        } catch (e) {
          if (!isMissingRelation(e)) throw e;
        }

        // ws1-t2 (W4) — cobranza real (factura del tratamiento, decisión 1
        // de la arquitectura) y próximo control (Agenda, decisión 2).
        let cobranza: PacienteOrtodonciaCase["cobranza"] = null;
        try {
          const resumen = await cargarCobranzaDelCaso({
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            treatmentPlanId: plan.id,
            zonaHoraria: plan.clinic.timezone,
          });
          if (resumen) {
            cobranza = {
              cuotaDeHoyMxn: resumen.cuotaDeHoy ? Math.round(resumen.cuotaDeHoy.falta) : null,
              proximoVencimiento: resumen.proximoVencimiento,
              vencidoMxn: Math.round(resumen.vencidas.reduce((s, q) => s + q.falta, 0)),
              saldoTotalMxn: Math.round(resumen.saldoTotal),
            };
          }
        } catch (e) {
          if (!isMissingRelation(e)) throw e;
        }

        let proximoControl: string | null = null;
        try {
          const cita = await prisma.appointment.findFirst({
            where: {
              clinicId: plan.clinicId,
              patientId: plan.patientId,
              type: TIPO_CITA_CONTROL_ORTO,
              startsAt: { gte: new Date() },
              status: { not: "CANCELLED" },
            },
            orderBy: { startsAt: "asc" },
            select: { startsAt: true },
          });
          proximoControl = cita?.startsAt.toISOString() ?? null;
        } catch (e) {
          if (!isMissingRelation(e)) throw e;
        }

        return {
          treatmentPlanId: plan.id,
          clinicId: plan.clinicId,
          clinicName: plan.clinic.name,
          aligner,
          compliance,
          todayLogged,
          cobranza,
          proximoControl,
        };
      }),
    );

    return NextResponse.json({ cases });
  } catch (err) {
    console.error("[paciente/ortodoncia] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
