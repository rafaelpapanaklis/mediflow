/**
 * DaleControl INSTITUCIONAL — RECORDATORIOS DE CITA (capa de SERVIDOR).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTE CRON ES SOLO DEL VERTICAL. No toca ni reutiliza el del dental
 * (/api/cron/appointment-reminders, que encola en WhatsAppReminder y manda
 * con el queue-worker). Aquí no hay dos crones ni cola aparte: un solo
 * barrido RECLAMA la constancia y MANDA en el mismo tick.
 *
 * 🔴 REAGENDAR O CANCELAR CANCELA EL RECORDATORIO VIEJO, Y ESTÁ CERRADO
 * POR DOS SITIOS DISTINTOS. En el dental esto es un bug conocido y abierto,
 * así que aquí no basta con arreglarlo una vez:
 *
 *   1. LA ESCRITURA. `applyEduReminderCancel` se llama desde
 *      src/lib/edu/agenda.ts en cuanto la cita cambia de hora o se cierra:
 *      lo que estaba en cola con la hora vieja se marca CANCELLED. Lo ya
 *      enviado NO se toca: es la constancia.
 *
 *   2. LA LLAVE. `eduReminderDedupeKey` lleva dentro el `startsAt` de la
 *      cita (whatsapp-core.ts), así que mover la cita produce una llave
 *      NUEVA y el recordatorio de la hora buena pasa aunque el primer
 *      mecanismo hubiera fallado. En el dental la llave NO lleva la hora, y
 *      por eso la fila vieja tapa el aviso correcto: no es que llegue
 *      tarde, es que no llega nunca.
 *
 *   Y un tercer cinturón, que es el que aguanta si alguien cierra una cita
 *   por SQL: el barrido CADUCA lo que quedó en cola fuera de tiempo en vez
 *   de mandarlo tarde (ver `caducarPendientesViejos`).
 *
 * 🔴 UN RECORDATORIO QUE SE CREA ENVIADO Y NO SALIÓ ES PEOR QUE NINGUNO. La
 * constancia se escribe ANTES de llamar a Meta y guarda el CÓDIGO del error
 * cuando falla (ver sendEduWhatsapp).
 *
 * ⚠️ EL CRON NO ESTÁ DADO DE ALTA TODAVÍA: vercel.json está FUERA del
 * vertical (el guardia lo marca prohibido) y no se toca desde aquí. La línea
 * EXACTA que hay que pegar está en el reporte de ORQUESTA.md. Mientras
 * tanto, el botón "Correr el barrido ahora" de /instituto/whatsapp hace
 * exactamente lo mismo para ESE instituto.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/prisma";
import {
  eduFormatDayLong,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import {
  EDU_REMINDER_GRACE_MIN,
  EDU_REMINDER_LIVE_APPOINTMENT_STATUSES,
  EDU_REMINDER_LOOKAHEAD_MIN,
  eduDecideWaSend,
  eduParseWaTemplates,
  eduReminderDedupeKey,
  eduReminderMoment,
  eduWaIsOpenStatus,
  planEduReminderCancel,
} from "@/lib/edu/whatsapp-core";
import { eduWaCredentials, sendEduWhatsapp } from "@/lib/edu/whatsapp";

/** Cuántos recordatorios manda como mucho un instituto en un solo tick. */
const EDU_REMINDER_MAX_POR_TICK = 200;

export interface EduReminderSweepSummary {
  /** Institutos con el recordatorio ENCENDIDO que se miraron. */
  institutos: number;
  enviados: number;
  fallidos: number;
  /** No se intentaron (sin plantilla, sin teléfono, sin conexión). */
  bloqueados: number;
  /** Quedaron fuera de tiempo y se caducaron en vez de mandarse tarde. */
  caducados: number;
  /** Ya estaban resueltos: no se volvieron a mandar. */
  saltados: number;
  /** Institutos que no se barrieron, con el motivo. */
  omitidos: { institutionId: string; motivo: string }[];
  errores: { institutionId: string; motivo: string }[];
}

function resumenVacio(): EduReminderSweepSummary {
  return {
    institutos: 0,
    enviados: 0,
    fallidos: 0,
    bloqueados: 0,
    caducados: 0,
    saltados: 0,
    omitidos: [],
    errores: [],
  };
}

/**
 * EL BARRIDO. Recorre EduAppointment y manda el recordatorio que toque.
 *
 * `institutionId` acota el barrido a UNO (es lo que usa el botón de la
 * pantalla de configuración). Sin él, se barren todos los institutos con el
 * aviso encendido — que es lo que hace el cron.
 *
 * Tolerante a fallos POR INSTITUTO: un instituto con las credenciales rotas
 * no puede frenar a los demás. Sin transacciones largas (PgBouncer):
 * consultas cortas y escrituras sueltas.
 */
export async function runEduReminderSweep(opts: {
  now?: Date;
  institutionId?: string;
} = {}): Promise<EduReminderSweepSummary> {
  const now = opts.now ?? new Date();
  const summary = resumenVacio();

  // 0. Lo que quedó en cola fuera de tiempo se CADUCA antes de nada: un
  //    recordatorio "de 24 h antes" entregado cuatro horas antes de la cita
  //    es una llamada que se paga y un mensaje que confunde.
  summary.caducados += await caducarPendientesViejos(now, opts.institutionId);

  const configs = await prisma.eduWhatsappConfig.findMany({
    where: {
      remindersEnabled: true,
      ...(opts.institutionId ? { institutionId: opts.institutionId } : {}),
    },
    select: {
      id: true,
      institutionId: true,
      phoneNumberId: true,
      businessAccountId: true,
      accessToken: true,
      displayPhone: true,
      connMethod: true,
      connected: true,
      connectedAt: true,
      lastErrorCode: true,
      lastErrorMsg: true,
      lastErrorAt: true,
      billingOk: true,
      billingCheckedAt: true,
      templates: true,
      remindersEnabled: true,
      reminderHoursBefore: true,
      consentEnabled: true,
      receiptEnabled: true,
      institution: { select: { name: true, timezone: true, isActive: true } },
    },
  });

  for (const cfg of configs) {
    try {
      summary.institutos++;

      if (!cfg.institution.isActive) {
        summary.omitidos.push({ institutionId: cfg.institutionId, motivo: "Instituto inactivo." });
        continue;
      }
      if (!cfg.connected || !eduWaCredentials(cfg)) {
        summary.omitidos.push({
          institutionId: cfg.institutionId,
          motivo: "El WhatsApp del instituto no está conectado.",
        });
        continue;
      }

      // 🔴 SIN PLANTILLA APROBADA, NO SE ENCOLA NADA. Se comprueba UNA vez
      // por instituto y no una por cita: no es un problema de un paciente,
      // es un problema de configuración, y repetirlo cien veces en el
      // registro taparía justo lo que hay que leer. La pantalla lo dice con
      // su nombre.
      const decision = eduDecideWaSend({
        kind: "RECORDATORIO",
        templates: eduParseWaTemplates(cfg.templates),
        // Cuatro huecos de mentira solo para preguntar por la
        // CONFIGURACIÓN: los valores reales dependen de cada cita.
        params: ["paciente", "instituto", "fecha", "hora"],
      });
      if (decision.mode === "blocked") {
        summary.omitidos.push({ institutionId: cfg.institutionId, motivo: decision.reason });
        continue;
      }

      const horas = cfg.reminderHoursBefore;
      const tz = eduSafeTimeZone(cfg.institution.timezone);

      // El momento de aviso M = startsAt − horas tiene que caer en
      // [now − gracia, now + adelanto]; despejando, la cita cae en:
      const crudo = now.getTime() + (horas * 60 - EDU_REMINDER_GRACE_MIN) * 60_000;
      // 🔴 …PERO NUNCA ANTES DE AHORA. Con la anticipación en 1 h y dos
      // horas de gracia, ese despeje se va una hora al PASADO: si el cron
      // estuvo caído, mandaría "le recordamos su cita" una hora DESPUÉS de
      // que empezara. Un recordatorio tarde no es tarde, es falso.
      const desde = new Date(Math.max(crudo, now.getTime()));
      const hasta = new Date(now.getTime() + (horas * 60 + EDU_REMINDER_LOOKAHEAD_MIN) * 60_000);

      const citas = await prisma.eduAppointment.findMany({
        where: {
          institutionId: cfg.institutionId,
          startsAt: { gte: desde, lte: hasta },
          // 🔴 Solo las que todavía esperan al paciente. Una cancelada, una
          // terminada o un "no llegó" no reciben recordatorio, y esto es la
          // segunda mitad de "cancelar cancela el recordatorio": aunque la
          // fila en cola sobreviviera, esta consulta no la volvería a
          // encontrar.
          status: { in: [...EDU_REMINDER_LIVE_APPOINTMENT_STATUSES] },
        },
        orderBy: [{ startsAt: "asc" }],
        take: EDU_REMINDER_MAX_POR_TICK,
        select: {
          id: true,
          startsAt: true,
          patientId: true,
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      });
      if (citas.length === 0) continue;

      // Las constancias que YA existen para estas citas, en UNA consulta.
      const previas = await prisma.eduWhatsappMessage.findMany({
        where: {
          institutionId: cfg.institutionId,
          kind: "RECORDATORIO",
          appointmentId: { in: citas.map((c) => c.id) },
        },
        select: { id: true, status: true, attempts: true, dedupeKey: true },
      });
      const porLlave = new Map<string, (typeof previas)[number]>();
      for (const p of previas) {
        if (p.dedupeKey) porLlave.set(p.dedupeKey, p);
      }

      for (const cita of citas) {
        const llave = eduReminderDedupeKey(cita.id, horas, cita.startsAt);
        const previa = porLlave.get(llave);

        if (previa && !eduWaIsOpenStatus(previa.status, previa.attempts)) {
          // Ya salió, ya se canceló, ya se bloqueó, o se agotaron los
          // reintentos. En los cuatro casos: no se vuelve a intentar.
          summary.saltados++;
          continue;
        }

        const z = eduUtcToZoned(cita.startsAt, tz);
        const res = await sendEduWhatsapp({
          institutionId: cfg.institutionId,
          cfg,
          kind: "RECORDATORIO",
          patientId: cita.patient.id,
          toName: [cita.patient.firstName, cita.patient.lastName].filter(Boolean).join(" ").trim(),
          rawPhone: cita.patient.phone,
          params: [
            cita.patient.firstName,
            cfg.institution.name,
            eduFormatDayLong(z.dayISO),
            eduFormatTime(cita.startsAt, tz),
          ],
          appointmentId: cita.id,
          dedupeKey: llave,
          scheduledFor: eduReminderMoment(cita.startsAt, horas),
          reuseId: previa?.id ?? null,
          now,
        });

        if (res.status === "SENT") summary.enviados++;
        else if (res.status === "BLOCKED") summary.bloqueados++;
        else if (res.status === "FAILED") summary.fallidos++;
        else summary.saltados++;
      }
    } catch (e) {
      summary.errores.push({
        institutionId: cfg.institutionId,
        motivo: e instanceof Error ? e.message : "error desconocido",
      });
      continue;
    }
  }

  return summary;
}

/**
 * Lo que quedó en cola y ya no puede salir a tiempo se marca CANCELLED.
 *
 * Es el cinturón de los caminos que este código no controla: una cita que
 * alguien cierra por SQL, un instituto que apaga el aviso a media tarde, un
 * cron que estuvo caído medio día. Sin esto, esas filas se quedarían
 * PENDING para siempre y la pantalla diría "en curso" sobre algo que no va a
 * ocurrir — que es exactamente la clase de mentira que esta ola existe para
 * no repetir.
 *
 * `updateMany` acotado por estado: dos barridos simultáneos no se pisan.
 */
async function caducarPendientesViejos(now: Date, institutionId?: string): Promise<number> {
  const limite = new Date(now.getTime() - EDU_REMINDER_GRACE_MIN * 60_000);
  const res = await prisma.eduWhatsappMessage.updateMany({
    where: {
      kind: "RECORDATORIO",
      status: { in: ["PENDING", "FAILED"] },
      scheduledFor: { lt: limite },
      ...(institutionId ? { institutionId } : {}),
    },
    data: {
      status: "CANCELLED",
      errorMsg:
        "Se canceló sin mandarse: quedó fuera de tiempo (la cita se movió o se cerró, se apagó el aviso, o el barrido no corrió a tiempo).",
    },
  });
  return res.count;
}

// ═══════════════════════════════════════════════════════════════════════
// CANCELAR AL REAGENDAR O AL CERRAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cancela los recordatorios de una cita que todavía no han salido.
 *
 * La llama src/lib/edu/agenda.ts en los DOS caminos que dejan obsoleto un
 * recordatorio: cambiar la hora (`updateEduAppointment`) y cerrar la cita
 * —cancelada, no llegó, terminada— (`setEduAppointmentStatus`).
 *
 * QUÉ se cancela y qué no lo decide `planEduReminderCancel`, que es puro y
 * está probado sin base de datos:
 *   · PENDING y FAILED  → CANCELLED. Llevan la hora vieja dentro del texto.
 *   · SENT y los demás  → intactos. Ya salieron: son la constancia, y
 *     borrarla dejaría al instituto sin poder contestar "¿le avisamos?".
 *
 * Best-effort a propósito: NUNCA lanza. Mover una cita no puede fallar
 * porque el registro de WhatsApp esté caído — la cita es lo importante, el
 * recordatorio caducado lo recoge después el barrido.
 *
 * Multi-tenant: la lectura y la escritura van acotadas por institutionId.
 */
export async function applyEduReminderCancel(args: {
  institutionId: string;
  appointmentId: string;
  /** Motivo que queda en la fila; lo lee la pantalla. */
  reason: string;
}): Promise<number> {
  if (!args.institutionId || !args.appointmentId) return 0;
  try {
    const filas = await prisma.eduWhatsappMessage.findMany({
      where: {
        institutionId: args.institutionId,
        appointmentId: args.appointmentId,
        kind: "RECORDATORIO",
      },
      select: { id: true, status: true, attempts: true, dedupeKey: true },
    });
    const plan = planEduReminderCancel(filas);
    if (plan.cancelIds.length === 0) return 0;

    const res = await prisma.eduWhatsappMessage.updateMany({
      // El estado se repite en el `where` para que dos caminos simultáneos
      // (reagendar y cancelar a la vez) no reescriban una fila que el otro
      // ya movió a SENT entre la lectura y la escritura.
      where: {
        id: { in: plan.cancelIds },
        institutionId: args.institutionId,
        status: { in: ["PENDING", "FAILED"] },
      },
      data: { status: "CANCELLED", errorMsg: args.reason.slice(0, 500) },
    });
    return res.count;
  } catch (e) {
    console.error("[instituto/recordatorios] no se pudieron cancelar (best-effort):", e);
    return 0;
  }
}
