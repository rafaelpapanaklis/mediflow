import { NextRequest, NextResponse } from "next/server";
import { Prisma, type AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import {
  CITA_CERRADA,
  CITA_LIBERA,
  DIAS_ENTRE_AVISOS,
  DIAS_SIN_CITA_PARA_AVISAR,
  DIAS_VENTANA_PLAN_VIEJO,
  MAX_AVISOS_POR_PLAN,
  decidirSeguimiento,
  diasSinActividad,
} from "@/lib/treatments/citas-del-plan";
import { citasDelPlanDisponible, filasParaSeguimiento, type FilaParaSeguimiento } from "@/lib/treatments/citas-del-plan-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DIA_MS = 24 * 60 * 60 * 1000;
/** Planes por consulta de filas (IN de ids): el pooler agradece lotes. */
const LOTE = 200;

// GET /api/cron/treatment-followup
// Called daily by Vercel Cron (configured in vercel.json).
// Encola el WhatsApp de seguimiento del plan de tratamiento y deja que
// /api/cron/whatsapp-queue lo envíe en batches (ahí viven la ventana de 24 h y
// las plantillas). Marca lastFollowUpSent en la MISMA transacción que el
// encolado (dedupe 7 días), sin sleep serial ni techo por corrida.
//
// ws1-t1 (plan fase 2 · P8) — CUÁNDO SE AVISA:
//  · plan CON filas (treatment_plan_items + sql/plan-tratamiento-citas.sql): cuando
//    tiene procedimientos pendientes SIN cita y pasaron DIAS_SIN_CITA_PARA_AVISAR
//    desde lo último que pasó en el plan. No por intervalo (`decidirSeguimiento`).
//    Y solo si el plan ya empezó o se aceptó (alguna fila hecha o en su nota de cobro).
//  · plan de siempre (texto, sin filas): como hoy, por `nextExpectedDate` vencida,
//    pero solo si se venció en los últimos DIAS_VENTANA_PLAN_VIEJO días.
//  · en los dos: si el paciente ya tiene CUALQUIER cita viva por delante en la
//    clínica, no se le escribe (ya viene); ni a un paciente archivado o borrado;
//    a lo más MAX_AVISOS_POR_PLAN avisos por plan; UN mensaje por paciente por
//    corrida aunque tenga dos planes; y el plan se RECLAMA (UPDATE condicionado)
//    antes de encolar, así que dos corridas a la vez no mandan dos.
// `status` de treatment_plans es TEXT en la base real y enum en schema.prisma:
// filtrarlo en el `where` revienta (42883). Se lee y se filtra en JS.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/treatment-followup] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const avisadoAntesDe = new Date(now.getTime() - DIAS_ENTRE_AVISOS * DIA_MS);
  const ventanaPlanViejo = new Date(now.getTime() - DIAS_VENTANA_PLAN_VIEJO * DIA_MS);

  // Candidatos: no avisados en los últimos 7 días. El estado se filtra en JS (ver arriba).
  const candidatos = (
    await prisma.treatmentPlan.findMany({
      where: {
        OR: [{ lastFollowUpSent: null }, { lastFollowUpSent: { lt: avisadoAntesDe } }],
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        name: true,
        status: true,
        totalSessions: true,
        nextExpectedDate: true,
        lastFollowUpSent: true,
        createdAt: true,
      },
    })
  ).filter((p) => String(p.status) === "ACTIVE");

  // Filas de los planes que las tienen (solo si la tabla y la columna de la cita existen).
  const conFilas = (await citasDelPlanDisponible()) ? await filasEnLotes(candidatos.map((p) => p.id)) : new Map<string, FilaParaSeguimiento[]>();

  // Primer corte sin tocar más la base: qué planes podrían tocar hoy.
  const porFecha = candidatos.filter((p) => {
    const filas = conFilas.get(p.id);
    if (filas && filas.length > 0) {
      // Sin mirar aún las citas del paciente ni el tope (eso va después, en una consulta cada uno).
      return decidirSeguimiento({ filas, citaPorDelante: false, creadoEn: p.createdAt, lastFollowUpSent: p.lastFollowUpSent }, now).avisar;
    }
    return p.nextExpectedDate != null && p.nextExpectedDate < now && p.nextExpectedDate >= ventanaPlanViejo;
  });

  // Tope de avisos por plan y ¿quién ya tiene una cita viva por delante?
  const avisos = await avisosPrevios(porFecha.map((p) => p.id));
  const posibles = porFecha.filter((p) => (avisos.get(p.id) ?? 0) < MAX_AVISOS_POR_PLAN);
  const conCita = await pacientesConCitaPorDelante(posibles.map((p) => ({ clinicId: p.clinicId, patientId: p.patientId })), now);

  let skipped = candidatos.length - posibles.length;
  // Un mensaje por paciente: si tiene dos planes que tocan, se avisa del más reciente y el otro se
  // marca igual (así mañana no le llega el segundo).
  const porPaciente = new Map<string, typeof posibles>();
  for (const p of posibles) {
    if (conCita.has(`${p.clinicId}:${p.patientId}`)) { skipped++; continue; }
    const k = `${p.clinicId}:${p.patientId}`;
    porPaciente.set(k, [...(porPaciente.get(k) ?? []), p]);
  }
  const elegidos: typeof posibles = [];
  const acompanantes = new Map<string, string[]>();
  porPaciente.forEach((lista) => {
    const [primero, ...resto] = lista.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    elegidos.push(primero!);
    if (resto.length) { acompanantes.set(primero!.id, resto.map((r) => r.id)); skipped += resto.length; }
  });

  const detalles = elegidos.length
    ? await prisma.treatmentPlan.findMany({
        where: { id: { in: elegidos.map((p) => p.id) } },
        select: {
          id: true,
          clinicId: true,
          patient: { select: { firstName: true, phone: true, status: true, deletedAt: true, clinicId: true } },
          doctor: { select: { firstName: true, lastName: true } },
          clinic: { select: { name: true, phone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true } },
          sessions: { where: { completedAt: { not: null } }, select: { id: true } },
        },
      })
    : [];
  const detallePorId = new Map(detalles.map((d) => [d.id, d]));

  const rows: Prisma.WhatsAppReminderCreateManyInput[] = [];
  const claimedPlanIds: string[] = [];

  for (const plan of elegidos) {
    const d = detallePorId.get(plan.id);
    if (!d) { skipped++; continue; }
    // Skip if no WhatsApp
    if (!d.clinic.waConnected || !d.clinic.waPhoneNumberId || !d.clinic.waAccessToken) { skipped++; continue; }
    // Skip if no patient phone, or the patient is archived / deleted / of another clinic
    if (!d.patient.phone || d.patient.deletedAt || String(d.patient.status) === "ARCHIVED" || d.patient.clinicId !== plan.clinicId) {
      skipped++; continue;
    }

    const filas = conFilas.get(plan.id);
    let progreso: { hechos: number; total: number; restantes: number; dias: number; unidad: "procedimientos" | "sesiones" };
    if (filas && filas.length > 0) {
      const dec = decidirSeguimiento({ filas, citaPorDelante: false, creadoEn: plan.createdAt, lastFollowUpSent: plan.lastFollowUpSent }, now);
      progreso = {
        hechos: dec.hechas,
        total: dec.vivas,
        restantes: dec.vivas - dec.hechas,
        dias: diasSinActividad({ filas, creadoEn: plan.createdAt }, now),
        unidad: "procedimientos",
      };
    } else {
      // nextExpectedDate is confirmed non-null by the first cut, but TS can't narrow it.
      if (!plan.nextExpectedDate) { skipped++; continue; }
      const completed = d.sessions.length;
      progreso = {
        hechos: completed,
        total: plan.totalSessions,
        restantes: Math.max(0, plan.totalSessions - completed),
        dias: Math.floor((now.getTime() - plan.nextExpectedDate.getTime()) / DIA_MS),
        unidad: "sesiones",
      };
    }

    const message = buildFollowUpMessage({
      patientName:   d.patient.firstName,
      clinicName:    d.clinic.name,
      clinicPhone:   d.clinic.phone ?? "",
      doctorName:    `Dr/a. ${d.doctor.firstName} ${d.doctor.lastName}`,
      treatmentName: plan.name,
      completed:     progreso.hechos,
      total:         progreso.total,
      remaining:     progreso.restantes,
      daysOverdue:   progreso.dias,
      unit:          progreso.unidad,
    });

    rows.push({
      clinicId:     plan.clinicId,
      patientPhone: d.patient.phone,
      type:         "TREATMENT_FOLLOWUP",
      message,
      status:       WA_REMINDER_STATUS.PENDING,
      scheduledFor: now,
      // El tope de avisos por plan se cuenta con esto.
      payload:      { planId: plan.id },
    });
    claimedPlanIds.push(plan.id, ...(acompanantes.get(plan.id) ?? []));
  }

  let queued = 0;
  if (rows.length > 0) {
    // RECLAMA y encola en la MISMA transacción (dedupe 7 días): el UPDATE solo marca los planes que
    // siguen sin aviso reciente, y solo se encola lo reclamado. Dos corridas a la vez (reintento de
    // Vercel, una manual) no mandan dos mensajes: la segunda no reclama nada.
    queued = await prisma.$transaction(async (tx) => {
      const reclamados = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "treatment_plans" SET "lastFollowUpSent" = ${now}
         WHERE "id" IN (${Prisma.join(claimedPlanIds)})
           AND ("lastFollowUpSent" IS NULL OR "lastFollowUpSent" < ${avisadoAntesDe})
        RETURNING "id"`;
      const ids = new Set(reclamados.map((r) => r.id));
      const data = rows.filter((r) => ids.has(String((r.payload as { planId?: string } | null)?.planId ?? "")));
      if (data.length > 0) await tx.whatsAppReminder.createMany({ data });
      return data.length;
    });
  }

  return NextResponse.json({
    ok:        true,
    processed: candidatos.length,
    queued,
    skipped,
    diasSinCita: DIAS_SIN_CITA_PARA_AVISAR,
    timestamp: now.toISOString(),
  });
}

/** Cuántos avisos de seguimiento se encolaron ya para cada plan (`payload.planId`). */
async function avisosPrevios(planIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < planIds.length; i += LOTE) {
    const parte = planIds.slice(i, i + LOTE);
    const filas = await prisma.$queryRaw<{ planId: string; n: number }[]>`
      SELECT "payload"->>'planId' AS "planId", count(*)::int AS "n"
        FROM "whatsapp_reminders"
       WHERE "type" = 'TREATMENT_FOLLOWUP' AND "payload"->>'planId' IN (${Prisma.join(parte)})
       GROUP BY 1`;
    for (const f of filas) out.set(f.planId, Number(f.n) || 0);
  }
  return out;
}

async function filasEnLotes(planIds: string[]): Promise<Map<string, FilaParaSeguimiento[]>> {
  const out = new Map<string, FilaParaSeguimiento[]>();
  for (let i = 0; i < planIds.length; i += LOTE) {
    const parte = await filasParaSeguimiento(planIds.slice(i, i + LOTE));
    parte.forEach((v, k) => out.set(k, v));
  }
  return out;
}

/** «clinicId:patientId» de los pacientes con una cita viva (no cancelada, no atendida) que todavía no termina. */
async function pacientesConCitaPorDelante(pares: Array<{ clinicId: string; patientId: string }>, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  const pacientes = Array.from(new Set(pares.map((p) => p.patientId)));
  for (let i = 0; i < pacientes.length; i += LOTE) {
    const citas = await prisma.appointment.findMany({
      where: {
        patientId: { in: pacientes.slice(i, i + LOTE) },
        endsAt: { gt: now },
        status: { notIn: [...CITA_LIBERA, ...CITA_CERRADA] as AppointmentStatus[] },
      },
      select: { clinicId: true, patientId: true },
    });
    // La cita cuenta solo en la MISMA clínica del plan.
    for (const c of citas) out.add(`${c.clinicId}:${c.patientId}`);
  }
  return out;
}

function buildFollowUpMessage(p: {
  patientName: string; clinicName: string; clinicPhone: string;
  doctorName: string; treatmentName: string;
  completed: number; total: number;
  remaining: number; daysOverdue: number;
  unit: "procedimientos" | "sesiones";
}) {
  // Progress bar: 10 chars wide
  const filled      = p.total > 0 ? Math.round((p.completed / p.total) * 10) : 0;
  const progressBar = "▓".repeat(filled) + "░".repeat(10 - filled);
  const pct         = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;

  let urgency: string;
  if (p.daysOverdue > 30)      urgency = "⚠️ Llevas más de un mes sin continuar tu tratamiento.";
  else if (p.daysOverdue > 14) urgency = "Ya pasó un tiempo desde tu última sesión.";
  else                          urgency = "Es momento de continuar con tu tratamiento.";

  const contactLine = p.clinicPhone ? `\nPara agendar: ${p.clinicPhone}` : "";

  return `Hola ${p.patientName} 👋\n\n`
    + `${urgency}\n\n`
    + `📋 *Tratamiento:* ${p.treatmentName}\n`
    + `🏥 *Clínica:* ${p.clinicName}\n`
    + `👨‍⚕️ ${p.doctorName}\n\n`
    + `*Tu progreso:* ${progressBar} ${pct}%\n`
    + `${p.completed} de ${p.total} ${p.unit} · ${p.remaining} restantes\n`
    + `${contactLine}\n\n`
    + `¡Tu salud nos importa! 💙`;
}
