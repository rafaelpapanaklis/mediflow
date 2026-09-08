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
  /**
   * 🔴 OLA C · H-01 — QUIÉN CORRIÓ ESTE BARRIDO.
   *
   * `EduWhatsappMessage.sentByUserId` dice en el schema «Null = el cron», y
   * hasta ahora era mentira: el botón «Correr el barrido ahora» pasaba por
   * esta misma función y tampoco firmaba, así que las filas del cron y las
   * del botón eran indistinguibles. Con el botón firmando, un envío SIN
   * firma vuelve a significar exactamente lo que el schema promete: salió
   * solo. Es lo que le permite a la pantalla decir la verdad sobre si el
   * automático ha corrido alguna vez.
   */
  sentByUserId?: string | null;
  sentByName?: string | null;
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

        // ═══════════════════════════════════════════════════════════════
        // 🔴 OLA C · H-117 — LA CITA SE VUELVE A MIRAR JUSTO ANTES DE
        // MANDAR.
        //
        // El barrido lee hasta 200 citas de golpe y tarda en recorrerlas,
        // porque cada una es una llamada a Meta. Recepción cancela por
        // teléfono a las 09:00:12 y a las 09:00:35 le sale al paciente "le
        // recordamos su cita de mañana": `applyEduReminderCancel` solo
        // puede cancelar filas que YA EXISTEN, y ésta todavía no existía
        // cuando se canceló la cita. Los dos cinturones que documenta el
        // encabezado —el reagendado y el aviso ya encolado— no cubren esta
        // ventana.
        //
        // Una lectura por cita que de verdad va a salir, y solo del estado.
        // Es barata comparada con la llamada a Meta que viene después, y es
        // la diferencia entre un paciente que se presenta a una cita que no
        // existe y uno que no.
        // ═══════════════════════════════════════════════════════════════
        const sigueViva = await prisma.eduAppointment.findFirst({
          where: {
            id: cita.id,
            institutionId: cfg.institutionId,
            status: { in: [...EDU_REMINDER_LIVE_APPOINTMENT_STATUSES] },
          },
          select: { id: true },
        });
        if (!sigueViva) {
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
          // H-115: el estado con el que se LEYÓ la fila. Es lo que convierte
          // el reuso en una reclamación atómica: dos barridos que lean lo
          // mismo, solo uno lo reclama.
          reuseStatus: previa?.status ?? null,
          reuseAttempts: previa?.attempts ?? null,
          // H-01: si lo disparó una persona, queda su nombre. Sin firma =
          // el cron, como dice el schema.
          sentByUserId: opts.sentByUserId ?? null,
          sentByName: opts.sentByName ?? null,
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
/**
 * ═══════════════════════════════════════════════════════════════════════
 * N-15 · QUÉ PASÓ CON EL RECORDATORIO. Lo que la pantalla necesita saber.
 *
 * `cancelados` son los que se pararon a tiempo. `yaSalieron` son los que ya
 * se le entregaron al paciente y NO se tocan —son la constancia, y borrarla
 * dejaría al instituto sin poder contestar «¿le avisamos?»—.
 *
 * Los dos números viajan hasta el modal de cancelar porque prometía, sin
 * condición, que «el recordatorio automático no sale». Con recordatorio a
 * 24 h, cita del jueves a las 10:00 y cancelación el miércoles a las 18:00,
 * el aviso salió hace ocho horas: el paciente lo tiene en el teléfono,
 * nadie le manda la cancelación y se presenta.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduReminderCancelResult {
  /** Los que estaban en cola y se pararon. */
  cancelados: number;
  /** Los que YA se entregaron: al paciente hay que avisarle a mano. */
  yaSalieron: number;
}

export async function applyEduReminderCancel(args: {
  institutionId: string;
  appointmentId: string;
  /** Motivo que queda en la fila; lo lee la pantalla. */
  reason: string;
}): Promise<EduReminderCancelResult> {
  const nada: EduReminderCancelResult = { cancelados: 0, yaSalieron: 0 };
  if (!args.institutionId || !args.appointmentId) return nada;
  try {
    const filas = await prisma.eduWhatsappMessage.findMany({
      where: {
        institutionId: args.institutionId,
        appointmentId: args.appointmentId,
        kind: "RECORDATORIO",
      },
      select: { id: true, status: true, attempts: true, dedupeKey: true },
    });
    // 🔴 «Ya salió» es SENT y solo SENT. `planEduReminderCancel` mete en
    // `keepIds` todo lo que no se puede cancelar —lo entregado, pero
    // también lo que ya estaba CANCELLED de una vuelta anterior—, y contar
    // eso como «el paciente ya lo tiene» sería mentirle a quien cancela por
    // segunda vez. El plan sigue decidiendo qué se escribe; esto solo
    // cuenta lo que hay que CONTAR.
    const yaSalieron = filas.filter((f) => f.status === "SENT").length;
    const plan = planEduReminderCancel(filas);
    if (plan.cancelIds.length === 0) return { cancelados: 0, yaSalieron };

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
    return { cancelados: res.count, yaSalieron };
  } catch (e) {
    console.error("[instituto/recordatorios] no se pudieron cancelar (best-effort):", e);
    return nada;
  }
}

/**
 * La frase que lee quien acaba de cancelar la cita (N-15).
 *
 * Pura y aquí —no en el componente— para que el modal, la agenda general y
 * cualquier pantalla que cancele digan LO MISMO, y para que se pruebe sin
 * base de datos. Tres casos y ni uno de más:
 *   · ya salió       → hay que avisarle a mano, y eso es lo único que
 *                      importa de las tres frases;
 *   · se paró a tiempo → no le llega nada;
 *   · no había nada   → tampoco le llega nada, pero por otra razón (no
 *                      tiene WhatsApp, o la cita era de hoy). Se dice
 *                      igual, sin prometer que «se canceló» algo que nunca
 *                      existió.
 */
export function eduReminderCancelLabel(res: EduReminderCancelResult): string {
  if (res.yaSalieron > 0) {
    return "El recordatorio automático YA le había salido al paciente: avísale tú de que la cita se canceló.";
  }
  if (res.cancelados > 0) {
    return "El recordatorio automático estaba en cola y se canceló: al paciente no le llega nada.";
  }
  return "No había ningún recordatorio automático en cola para esta cita.";
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 OLA C · H-01 — ¿EL BARRIDO AUTOMÁTICO HA CORRIDO ALGUNA VEZ?
//
// La pantalla de WhatsApp decía «Encendido · Sale 24 h antes de la cita» y
// «Lo manda solo el sistema… Nadie lo dispara a mano» mientras el cron
// (/api/instituto/cron/recordatorios) NO estaba dado de alta en
// `vercel.json` — un archivo que está FUERA del guardia de este vertical y
// que esta rama no puede tocar. La dirección conectaba su WABA, registraba
// la plantilla, la veía aprobada, encendía el interruptor y leía que los
// avisos salen solos. No salía ni uno, durante meses.
//
// Esto no arregla el cron: lo hace VISIBLE. La única constancia que existe
// sin columnas nuevas son las propias filas de envío, y desde este mismo
// arreglo vuelven a distinguirse (el botón manual firma con su usuario, el
// cron no firma). Así que «el último run real» es el último recordatorio
// que salió SIN firma.
//
// ⚠️ Lo que esto NO puede saber: un cron que corrió y no encontró ninguna
// cita que avisar no deja fila. Por eso la pantalla dice «no hay constancia
// de que haya salido ninguno», que es exactamente lo que se sabe, y no «el
// cron no está dado de alta», que sería inventar. Un instituto recién
// conectado y sin citas mañana lee lo mismo, y en su caso también es cierto.
// ═══════════════════════════════════════════════════════════════════════

export interface EduReminderAutomationStatus {
  /** El último recordatorio que salió SIN firma de persona (= el cron). */
  lastAutomaticAt: string | null;
  /** Ese mismo instante, ya escrito en la zona del instituto. Se formatea
   *  en el servidor: un `Intl` en el cliente pintaría la hora de quien
   *  mira, y encima no cuadraría con el render del servidor. */
  lastAutomaticLabel: string | null;
  /** El último que salió porque alguien pulsó «Correr el barrido ahora». */
  lastManualAt: string | null;
  lastManualLabel: string | null;
  /** Quién pulsó ese último manual, para que la frase tenga nombre. */
  lastManualBy: string | null;
}

export async function getEduReminderAutomationStatus(
  institutionId: string,
  timeZone?: string,
): Promise<EduReminderAutomationStatus> {
  const vacio: EduReminderAutomationStatus = {
    lastAutomaticAt: null,
    lastAutomaticLabel: null,
    lastManualAt: null,
    lastManualLabel: null,
    lastManualBy: null,
  };
  if (!institutionId) return vacio;
  const zona = eduSafeTimeZone(timeZone);
  const escrito = (at: Date): string =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: zona,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);

  const [automatico, manual] = await Promise.all([
    prisma.eduWhatsappMessage.findFirst({
      where: {
        institutionId,
        kind: "RECORDATORIO",
        status: "SENT",
        sentByUserId: null,
      },
      orderBy: [{ createdAt: "desc" }],
      select: { createdAt: true },
    }),
    prisma.eduWhatsappMessage.findFirst({
      where: {
        institutionId,
        kind: "RECORDATORIO",
        status: "SENT",
        sentByUserId: { not: null },
      },
      orderBy: [{ createdAt: "desc" }],
      select: { createdAt: true, sentByName: true },
    }),
  ]);

  return {
    lastAutomaticAt: automatico ? automatico.createdAt.toISOString() : null,
    lastAutomaticLabel: automatico ? escrito(automatico.createdAt) : null,
    lastManualAt: manual ? manual.createdAt.toISOString() : null,
    lastManualLabel: manual ? escrito(manual.createdAt) : null,
    lastManualBy: manual?.sentByName ?? null,
  };
}
