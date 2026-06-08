import { prisma } from "@/lib/prisma";
import { generateAiReply } from "./ai";
import { handleBookingTurn } from "./booking";
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
export { generateAiReply, handleBookingTurn };

/** Carga la config del bot + FAQs habilitadas + timezone de la clínica. */
async function loadBotConfig(
  clinicId: string,
): Promise<{ config: BotConfigDTO; faqs: BotFaqDTO[]; timezone: string } | null> {
  const row = await prisma.whatsAppBotConfig.findUnique({
    where: { clinicId },
    include: {
      faqs: { where: { enabled: true }, orderBy: { order: "asc" } },
      clinic: { select: { timezone: true } },
    },
  });
  if (!row) return null;

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
    fallbackToHuman: row.fallbackToHuman,
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

/** Match de FAQ por contención o solapamiento de palabras clave (≥ 60%). */
function matchFaq(text: string, faqs: BotFaqDTO[]): BotFaqDTO | null {
  const n = normalize(text);
  if (!n) return null;
  let best: BotFaqDTO | null = null;
  let bestScore = 0;
  for (const faq of faqs) {
    const q = normalize(faq.question);
    if (!q) continue;
    if (n.includes(q) || q.includes(n)) return faq;
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

/** Heurística ligera de intención de agenda (T4 la refina). */
function detectBookingIntent(text: string): BotIntent | null {
  const n = normalize(text);
  if (/(reagendar|reprogramar|cambiar (de|la|mi) cita|mover (la|mi) cita)/.test(n)) {
    return BotIntent.RESCHEDULE;
  }
  if (/(agendar|reservar|sacar (una )?cita|quiero (una )?cita|nueva cita|hacer (una )?cita|pedir (una )?cita)/.test(n)) {
    return BotIntent.BOOK_APPOINTMENT;
  }
  return null;
}

/**
 * Motor híbrido del bot. Orden:
 *   1) FAQ por reglas (rápido y barato).
 *   2) Agenda (T4) si hay intención de cita y canBookAppointments.
 *   3) IA libre con Claude (T3) como respuesta general.
 *   4) Handoff a humano si nada respondió y fallbackToHuman.
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

  // Fuera de horario → mensaje de after-hours (si está configurado).
  if (config.afterHoursMsg && !isWithinBusinessHours(config.businessHours, timezone, new Date())) {
    return { reply: config.afterHoursMsg, intent: BotIntent.SMALLTALK };
  }

  // 1) FAQ por reglas.
  if (config.canAnswerFaq) {
    const faq = matchFaq(input.incomingText, faqs);
    if (faq) return { reply: faq.answer, intent: BotIntent.FAQ };
  }

  // 2) Agenda (T4) si hay intención de cita.
  if (config.canBookAppointments) {
    const intent = detectBookingIntent(input.incomingText);
    if (intent) {
      const booking = await handleBookingTurn(input, config);
      if (booking) return booking;
    }
  }

  // 3) IA libre (T3).
  const ai = await generateAiReply(input, config, faqs);
  if (ai) return ai;

  // 4) Nada respondió → derivar a humano.
  if (config.fallbackToHuman) return { intent: BotIntent.HANDOFF, handoff: true };
  return { intent: BotIntent.UNKNOWN };
}
