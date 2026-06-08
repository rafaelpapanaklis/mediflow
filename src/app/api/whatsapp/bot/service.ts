// Helpers de las rutas de configuración del bot de WhatsApp (T2).
// Multi-tenant: el clinicId SIEMPRE lo pasa el caller desde la sesión
// (getAuthContext), nunca desde el body. Estos helpers no leen la sesión.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BotConfigDTO, BotFaqDTO, BotBusinessHours } from "@/lib/whatsapp/bot/types";

type ConfigRow = {
  id: string;
  clinicId: string;
  enabled: boolean;
  botName: string;
  persona: string | null;
  greeting: string | null;
  businessHours: Prisma.JsonValue;
  afterHoursMsg: string | null;
  canAnswerFaq: boolean;
  canBookAppointments: boolean;
  fallbackToHuman: boolean;
};

type FaqRow = {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
  order: number;
};

export function toConfigDTO(row: ConfigRow): BotConfigDTO {
  return {
    id: row.id,
    clinicId: row.clinicId,
    enabled: row.enabled,
    botName: row.botName,
    persona: row.persona,
    greeting: row.greeting,
    businessHours: (row.businessHours as BotBusinessHours | null) ?? null,
    afterHoursMsg: row.afterHoursMsg,
    canAnswerFaq: row.canAnswerFaq,
    canBookAppointments: row.canBookAppointments,
    fallbackToHuman: row.fallbackToHuman,
  };
}

export function toFaqDTO(row: FaqRow): BotFaqDTO {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    enabled: row.enabled,
    order: row.order,
  };
}

/**
 * Devuelve la config del bot de la clínica; si no existe, la crea con los
 * defaults de Prisma (enabled=false, botName="Asistente", canAnswerFaq=true,
 * canBookAppointments=false, fallbackToHuman=true). clinicId de la sesión.
 */
export async function getOrCreateBotConfig(clinicId: string): Promise<ConfigRow> {
  const existing = await prisma.whatsAppBotConfig.findUnique({ where: { clinicId } });
  if (existing) return existing;
  return prisma.whatsAppBotConfig.create({ data: { clinicId } });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Limpia businessHours del body: solo días "0".."6" (0=Lunes) con
 * { enabled, open "HH:MM", close "HH:MM" }. Descarta claves/valores inválidos.
 */
export function sanitizeBusinessHours(input: unknown): BotBusinessHours {
  const out: BotBusinessHours = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    for (let d = 0; d < 7; d++) {
      const key = String(d);
      const raw = obj[key];
      if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        const open = typeof r.open === "string" && HHMM.test(r.open) ? r.open : "09:00";
        const close = typeof r.close === "string" && HHMM.test(r.close) ? r.close : "18:00";
        out[key] = { enabled: r.enabled === true, open, close };
      }
    }
  }
  return out;
}

/** Normaliza un campo de texto opcional: undefined=ignorar, ""=null, string=trim. */
function nullableText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  return undefined;
}

/**
 * Construye el `data` del update de la config a partir del body (whitelist
 * estricta). Ignora campos no provistos o de tipo inválido. NUNCA incluye
 * clinicId ni id.
 */
export function buildConfigUpdate(body: Record<string, unknown>): Prisma.WhatsAppBotConfigUpdateInput {
  const data: Prisma.WhatsAppBotConfigUpdateInput = {};

  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.canAnswerFaq === "boolean") data.canAnswerFaq = body.canAnswerFaq;
  if (typeof body.canBookAppointments === "boolean") data.canBookAppointments = body.canBookAppointments;
  if (typeof body.fallbackToHuman === "boolean") data.fallbackToHuman = body.fallbackToHuman;

  if (typeof body.botName === "string") {
    const t = body.botName.trim();
    data.botName = t.length ? t : "Asistente";
  }

  const persona = nullableText(body.persona);
  if (persona !== undefined) data.persona = persona;
  const greeting = nullableText(body.greeting);
  if (greeting !== undefined) data.greeting = greeting;
  const afterHoursMsg = nullableText(body.afterHoursMsg);
  if (afterHoursMsg !== undefined) data.afterHoursMsg = afterHoursMsg;

  if ("businessHours" in body) {
    data.businessHours =
      body.businessHours === null
        ? Prisma.DbNull
        : (sanitizeBusinessHours(body.businessHours) as Prisma.InputJsonValue);
  }

  return data;
}
