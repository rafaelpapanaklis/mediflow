import { prisma } from "@/lib/prisma";
import { generateAiReply } from "./ai";
import { handleBookingTurn, isBookingInProgress } from "./booking";
import { detectaIntencionDeAgenda } from "./booking-parse";
import { handleSaldoTurn, isSaldoInProgress } from "./saldo";
import { getCobranzaSettings } from "@/lib/reminders/config";
import { loadOrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { calendarDayRangeUtc, todayInTz } from "@/lib/agenda/time-utils";
import { HANDOFF_AVISO, marcaDeHandoff, type MotivoHandoff } from "./handoff";
import { BotIntent } from "./types";
import type {
  BotBusinessHours,
  BotConfigDTO,
  BotFaqDTO,
  BotTurnInput,
  BotTurnResult,
} from "./types";

// Re-exporta los stubs para que el resto del código (y T3/T4) los importe desde
// el motor. T3 implementa generateAiReply en ai.ts; T4, handleBookingTurn en
// booking.ts. runBotTurn no se toca.
export { generateAiReply, handleBookingTurn, handleSaldoTurn };

/** Carga la config del bot + FAQs habilitadas + timezone de la clínica. */
async function loadBotConfig(
  clinicId: string,
): Promise<{ config: BotConfigDTO; faqs: BotFaqDTO[]; timezone: string } | null> {
  const row = await prisma.whatsAppBotConfig.findUnique({
    where: { clinicId },
    include: {
      faqs: { where: { enabled: true }, orderBy: { order: "asc" } },
      // `reminderSettings` trae el interruptor del saldo (ws1-t3): vive en el
      // Json de la clínica, no en una columna de whatsapp_bot_configs.
      clinic: { select: { timezone: true, reminderSettings: true } },
    },
  });
  if (!row) return null;

  // ws1-t1 ronda 2 — interruptor separado del de dinero. Una consulta más
  // por turno (findUnique por clinicId, indexado), tolerante a que la tabla
  // ni siquiera exista todavía (loadOrthoClinicSettings ya lo resuelve a
  // "encendido", su default de fábrica).
  const proximoControlBotEnabled = (await loadOrthoClinicSettings(row.clinicId)).proximoControlBotEnabled;

  const config: BotConfigDTO = {
    id: row.id,
    clinicId: row.clinicId,
    enabled: row.enabled,
    botName: row.botName,
    persona: row.persona,
    greeting: row.greeting,
    businessHours: (row.businessHours as unknown as BotBusinessHours) ?? null,
    afterHoursMsg: row.afterHoursMsg,
    canAnswerFaq: row.canAnswerFaq,
    canBookAppointments: row.canBookAppointments,
    canAnswerBalance: getCobranzaSettings(row.clinic).bot,
    canAnswerOrthoControl: proximoControlBotEnabled,
    fallbackToHuman: row.fallbackToHuman,
    timezone: row.clinic.timezone,
  };
  const faqs: BotFaqDTO[] = row.faqs.map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    enabled: f.enabled,
    order: f.order,
  }));
  return { config, faqs, timezone: row.clinic.timezone };
}

/** Normaliza texto para matching: minúsculas, sin acentos ni puntuación. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Un texto así de corto NO puede «estar contenido» en una pregunta: «a», «de»
 * o «ta» caben dentro de casi cualquier FAQ («¿Aceptan **ta**rjeta…?») y el
 * paciente recibía una respuesta sin relación (#14 de la auditoría).
 */
function esConsultaSuficiente(n: string): boolean {
  return n.split(" ").length >= 2 || n.length >= 6;
}

/** Match de FAQ por contención o solapamiento de palabras clave (≥ 60%). */
export function matchFaq(text: string, faqs: BotFaqDTO[]): BotFaqDTO | null {
  const n = normalize(text);
  if (!n) return null;
  let best: BotFaqDTO | null = null;
  let bestScore = 0;
  for (const faq of faqs) {
    const q = normalize(faq.question);
    if (!q) continue;
    if (n.includes(q) || (esConsultaSuficiente(n) && q.includes(n))) return faq;
    const words = q.split(" ").filter((w) => w.length >= 4);
    if (words.length === 0) continue;
    const hits = words.filter((w) => n.includes(w)).length;
    const score = hits / words.length;
    if (score > bestScore) {
      bestScore = score;
      best = faq;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

// Intl en en-US emite weekday corto estable ("Mon".."Sun"); lo mapeamos al
// índice de ClinicSchedule (0=Lunes … 6=Domingo).
const WEEKDAY_TO_DOW: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** ¿`now` cae dentro del horario configurado, en la TZ de la clínica? */
function isWithinBusinessHours(
  hours: BotBusinessHours | null,
  timezone: string,
  now: Date,
): boolean {
  if (!hours || Object.keys(hours).length === 0) return true; // sin config → siempre disponible
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const dow = WEEKDAY_TO_DOW[map.weekday] ?? 0;
  const slot = hours[String(dow)];
  if (!slot || !slot.enabled) return false;
  const cur = (parseInt(map.hour, 10) || 0) * 60 + (parseInt(map.minute, 10) || 0);
  return cur >= hhmmToMinutes(slot.open) && cur < hhmmToMinutes(slot.close);
}

/** Heurística de intención de agenda (pura, en booking-parse: tiene pruebas). */
function detectBookingIntent(text: string): BotIntent | null {
  const modo = detectaIntencionDeAgenda(text);
  if (modo === "reschedule") return BotIntent.RESCHEDULE;
  if (modo === "book") return BotIntent.BOOK_APPOINTMENT;
  return null;
}

/**
 * Motor híbrido del bot. Orden:
 *   1) Saldo (ws1-t3) si preguntan por dinero y canAnswerBalance.
 *   2) FAQ por reglas (rápido y barato).
 *   3) Agenda (T4) si hay intención de cita y canBookAppointments.
 *   3b) Fuera de horario: el aviso de la clínica, una vez por hilo y día (#9).
 *   4) IA libre con Claude (T3) como respuesta general; si detecta que el
 *      paciente quiere cita, pasa a (3) en vez de contestar (ws1-t5).
 *   5) Handoff a humano si nada respondió y fallbackToHuman.
 *
 * Booking va ANTES que la IA libre para que una petición de cita use el flujo
 * especializado (T4) y no la charla genérica (T3). En la fundación, (2) y (3)
 * son stubs que devuelven null, así que el motor cae al handoff.
 */
export async function runBotTurn(input: BotTurnInput): Promise<BotTurnResult> {
  const loaded = await loadBotConfig(input.clinicId);
  if (!loaded || !loaded.config.enabled) return { intent: BotIntent.UNKNOWN };
  const { config, faqs, timezone } = loaded;

  // El staff tomó el control del hilo → el bot calla.
  const thread = await prisma.inboxThread.findUnique({
    where: { id: input.threadId },
    select: { botActive: true },
  });
  if (thread && thread.botActive === false) return { intent: BotIntent.UNKNOWN };

  // 0) Flujo de agenda en progreso (multi-turno): continúa antes que after-hours,
  //    FAQ e IA, aunque el texto del paso no dispare detectBookingIntent. Un
  //    agendado a medias debe poder terminarse aunque el cliente escriba tarde.
  if (config.canBookAppointments && isBookingInProgress(input.botState)) {
    const booking = await handleBookingTurn(input, config);
    if (booking) return conMarcaDeHandoff(booking, "agenda");
  }

  // 0b) Saldo a medias en un número compartido: igual que el agendado, se
  //     continúa antes que nada. El paciente ya recibió «¿de quién me
  //     preguntas? dime su fecha de nacimiento» y lo que escriba ahora es la
  //     respuesta a ESO; si cayera en FAQ o en la IA, se quedaría sin respuesta.
  if ((config.canAnswerBalance || config.canAnswerOrthoControl) && isSaldoInProgress(input.botState)) {
    const saldo = await handleSaldoTurn(input, config);
    if (saldo) return conMarcaDeHandoff(saldo, "sin_respuesta");
  }

  // ws1-t5 (#9) — Fuera de horario YA NO corta aquí: saldo, FAQ y agenda
  // funcionan igual que de día (la agenda real solo ofrece huecos reales). El
  // aviso de horario sustituye a la IA libre, una vez por hilo y día (abajo).

  // 1) ¿Preguntan por dinero? Va ANTES que la FAQ a propósito: una FAQ de
  //    precios («¿cuánto cuesta una limpieza?») puede solapar con «¿cuánto
  //    debo?» y contestar una tarifa genérica a quien pregunta por SU deuda.
  //    Si el interruptor está apagado o no es una pregunta de saldo, devuelve
  //    null y el motor sigue exactamente como hoy.
  {
    const saldo = await handleSaldoTurn(input, config);
    if (saldo) return conMarcaDeHandoff(saldo, "sin_respuesta");
  }

  // 2) FAQ por reglas.
  if (config.canAnswerFaq) {
    const faq = matchFaq(input.incomingText, faqs);
    if (faq) return { reply: faq.answer, intent: BotIntent.FAQ };
  }

  // 3) Agenda (T4) si hay intención de cita.
  if (config.canBookAppointments) {
    const intent = detectBookingIntent(input.incomingText);
    if (intent) {
      const booking = await handleBookingTurn(input, config);
      if (booking) return conMarcaDeHandoff(booking, "agenda");
    }
  }

  // 3b) Fuera de horario (#9): el aviso de la clínica, UNA vez por hilo y por
  //     día de la clínica. Va en lugar de la IA libre (no gasta IA). Si ya
  //     salió hoy, se sigue como de día: la IA contesta o se deriva.
  if (config.afterHoursMsg && !isWithinBusinessHours(config.businessHours, timezone, new Date())) {
    if (!(await avisoDeHorarioYaSalioHoy(input.threadId, config.afterHoursMsg, timezone))) {
      return { reply: config.afterHoursMsg, intent: BotIntent.SMALLTALK };
    }
  }

  // 4) IA libre (T3).
  const ai = await generateAiReply(input, config, faqs);
  // ws1-t5 — la IA libre no ve la agenda. Si entendió que el paciente quiere
  // cita (aunque lo dijera con palabras que la heurística de (3) no caza),
  // devuelve BOOK_APPOINTMENT sin texto y aquí pasa al flujo de agenda real.
  // Nunca se manda un horario inventado por el modelo.
  if (ai && ai.intent === BotIntent.BOOK_APPOINTMENT && !ai.reply) {
    if (config.canBookAppointments) {
      const booking = await handleBookingTurn(input, config);
      if (booking) return conMarcaDeHandoff(booking, "agenda");
    }
  } else if (ai && ai.handoff) {
    // El modelo pidió una persona (tema médico, dato que no tiene, «quiero
    // hablar con alguien»).
    if (config.fallbackToHuman) return derivar("modelo");
    return { intent: BotIntent.UNKNOWN };
  } else if (ai) {
    return ai;
  }

  // 5) Nada respondió (IA apagada, sin saldo, timeout, error) → derivar a una
  //    persona CON aviso al paciente (#4). La pausa no es para siempre: el
  //    webhook reactiva el bot si nadie del equipo contesta en 12 h (handoff.ts).
  if (config.fallbackToHuman) return derivar("sin_respuesta");
  return { intent: BotIntent.UNKNOWN };
}

/**
 * #4 — handoff con aviso: el paciente sabe que lo atiende una persona y el
 * hilo queda con la marca que permite reactivarlo a las 12 h.
 */
function derivar(motivo: MotivoHandoff): BotTurnResult {
  return {
    reply: HANDOFF_AVISO,
    intent: BotIntent.HANDOFF,
    handoff: true,
    newBotState: marcaDeHandoff(new Date(), motivo),
  };
}

/**
 * Un handoff que viene de la agenda o del saldo conserva SU texto (ya le dice
 * al paciente que lo atiende una persona) y suma la marca. Si no trae texto,
 * se usa el aviso estándar: nunca más un handoff mudo.
 */
function conMarcaDeHandoff(r: BotTurnResult, motivo: MotivoHandoff): BotTurnResult {
  if (!r.handoff) return r;
  return {
    ...r,
    reply: r.reply?.trim() ? r.reply : HANDOFF_AVISO,
    newBotState: marcaDeHandoff(new Date(), motivo),
  };
}

/** ¿El aviso de fuera de horario ya salió hoy (día de la clínica) en este hilo? */
async function avisoDeHorarioYaSalioHoy(threadId: string, body: string, timezone: string): Promise<boolean> {
  try {
    const { startUtc } = calendarDayRangeUtc(todayInTz(timezone), timezone);
    const ya = await prisma.inboxMessage.findFirst({
      where: { threadId, direction: "OUT", body, sentAt: { gte: startUtc } },
      select: { id: true },
    });
    return !!ya;
  } catch {
    // Sin poder comprobarlo, mejor no repetirlo en cada mensaje.
    return true;
  }
}
