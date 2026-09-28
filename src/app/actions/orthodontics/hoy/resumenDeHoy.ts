"use server";
// Ortodoncia en la pantalla «Hoy» (ws1-t5, 28-sep-2026; fila 8 del mapa de la
// revisión de lógica de uso). UNA sola lectura para los dos avisos:
//
//  · Controles de hoy — de la Agenda (`Appointment.type ===
//    TIPO_CITA_CONTROL_ORTO`), con su hoja de control si ya la tienen. Un
//    doctor ve los SUYOS; el dueño y el administrador, los de la clínica.
//  · Mensualidades vencidas — la MISMA lectura que Caja y que el aviso de
//    siempre (`listarMensualidadesPorCobrar`), para que Hoy y Caja nunca
//    digan un número distinto.
//
// Solo lectura. `clinicId`, zona horaria, rol y permisos salen de la sesión.
// Sin módulo contratado o sin permiso, responde vacío y el aviso se calla.

import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { hasPermission } from "@/lib/auth/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { queEnsenarEnHoy, type ControlDeHoy } from "@/lib/orthodontics/hoy";
import { ok, fail, type ActionResult } from "../result";
import { listarMensualidadesPorCobrar } from "../recepcion/listarMensualidadesPorCobrar";

export interface ResumenOrtodonciaDeHoy {
  /** Puede entrar al módulo (sede dental, módulo contratado y permiso). */
  puedeVerModulo: boolean;
  controles: ControlDeHoy[];
  /** `null` = a esta persona no le toca ver dinero. */
  vencidas: { count: number; total: number } | null;
}

const VACIO: ResumenOrtodonciaDeHoy = { puedeVerModulo: false, controles: [], vencidas: null };

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function resumenOrtodonciaDeHoy(): Promise<ActionResult<ResumenOrtodonciaDeHoy>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // `clinicId: undefined` en Prisma no filtra: sin clínica no se consulta nada.
  if (!ctx.clinicId) return ok(VACIO);

  const esDental = ctx.clinicCategory === "DENTAL";
  const quien = { role: ctx.role as any, permissionsOverride: ctx.permissionsOverride };
  const moduloActivo = esDental && !ctx.isPlanExpired
    ? await hasActiveOrthodonticsModule(ctx.clinicId).catch(() => false)
    : false;
  const ver = queEnsenarEnHoy({
    esDental,
    moduloActivo,
    tienePermisoModulo: hasPermission(quien, "specialties.orthodontics"),
    tienePermisoCobro: hasPermission(quien, "billing.view"),
  });
  if (!ver.controles && !ver.mensualidades) return ok(VACIO);

  let controles: ControlDeHoy[] = [];
  if (ver.controles) {
    const clinica = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { timezone: true },
    });
    const zona = clinica?.timezone || "America/Mexico_City";
    const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(new Date(), zona), zona);
    const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };

    const citas = await prisma.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: { gte: startUtc, lt: endUtc },
        // El doctor ve SUS controles, como el resto de su Hoy.
        ...(ctx.canViewAllData ? {} : { doctorId: ctx.userId }),
        AND: relatedPatientVisibilityAnd(viewer),
      },
      select: {
        id: true,
        patientId: true,
        startsAt: true,
        status: true,
        patient: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 200,
    });

    const hojas = new Map<string, "DRAFT" | "SIGNED">();
    if (citas.length > 0) {
      try {
        const filas = await prisma.orthoTreatmentCard.findMany({
          where: { clinicId: ctx.clinicId, appointmentId: { in: citas.map((c) => c.id) } },
          select: { appointmentId: true, status: true },
        });
        for (const f of filas) if (f.appointmentId) hojas.set(f.appointmentId, f.status);
      } catch (e) {
        // Sin la columna o la tabla, el aviso sale igual, sin saber de hojas.
        if (!esRelacionAusente(e)) throw e;
      }
    }

    controles = citas.map((c) => ({
      appointmentId: c.id,
      patientId: c.patientId,
      patientName: `${c.patient.firstName} ${c.patient.lastName}`.trim(),
      startsAt: c.startsAt.toISOString(),
      hora: timeHHMMInTz(c.startsAt, zona),
      status: c.status,
      hoja: hojas.get(c.id) ?? null,
    }));
  }

  let vencidas: ResumenOrtodonciaDeHoy["vencidas"] = null;
  if (ver.mensualidades) {
    const r = await listarMensualidadesPorCobrar().catch(() => null);
    if (r && r.ok) {
      const items = r.data.items.filter((it) => it.estado === "vencida");
      // ws1-t4 #84: se cuentan CUOTAS (mensualidades), no casos: Caja rotula «3 vencidas»
      // por las cuotas de la fila, y Hoy decía «1 mensualidad vencida» por el mismo caso.
      vencidas = { count: items.reduce((s, it) => s + Math.max(1, it.cantidadVencidas), 0), total: items.reduce((s, it) => s + it.monto, 0) };
    } else {
      vencidas = { count: 0, total: 0 };
    }
  }

  return ok({ puedeVerModulo: ver.puedeVerModulo, controles, vencidas });
}
