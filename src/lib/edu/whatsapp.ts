/**
 * DaleControl INSTITUCIONAL — WhatsApp del vertical (capa de SERVIDOR).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTE ARCHIVO ES EL ÚNICO QUE MANDA WHATSAPP EN EL VERTICAL.
 *
 * Nada de aquí toca al dental. Del núcleo compartido (src/lib/whatsapp.ts)
 * solo se IMPORTAN funciones — ese archivo NO se modificó ni un carácter,
 * igual que hicieron barbería e inmuebles, porque sus exports reciben
 * credenciales sueltas y no saben nada de Clinic.
 *
 * 🔴 CADA INSTITUTO CONECTA SU PROPIA WHATSAPP. Meta le cobra cada
 * plantilla a la tarjeta de ESA WABA y no se puede mandar en nombre de otra
 * cuenta: no hay un número compartido y no lo va a haber. Si la WABA no
 * tiene método de pago, Meta rechaza con 131042 — se detecta, se marca y se
 * dice con esas palabras (ver `sendEduWhatsapp`).
 *
 * 🔴 institutionId SIEMPRE del contexto de sesión (o del barrido del cron,
 * que itera institutos), JAMÁS del body ni del query.
 *
 * Lo que NO hay aquí, y es deliberado:
 *   · NO hay webhook. Este vertical no ingiere mensajes entrantes, así que
 *     no sabe si la ventana de 24 h está abierta y NUNCA manda texto libre.
 *     Ver la regla 1 de whatsapp-core.ts.
 *   · NO hay acuses de entrega. "SENT" significa "Meta lo aceptó", y la
 *     pantalla lo dice con esas palabras.
 *   · NO hay alta de plantillas desde el panel (el equivalente de
 *     provision-templates.ts). Se registran los nombres que Meta ya aprobó
 *     y hay un botón para PREGUNTARLE a Meta en qué estado están.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduWhatsappKind, EduWhatsappStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptField, encryptField } from "@/lib/crypto/envelope";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { parseWaError, waErrorCode, isTokenRevoked, WhatsAppApiError } from "@/lib/whatsapp/errors";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { eduMoney } from "@/lib/edu/dinero-core";
import {
  eduVisibility,
  eduScopeIsEmpty,
  eduPatientScopeWhere,
  eduWhatsappScopeWhere,
  eduChargeScopeWhere,
  eduCanSendWhatsappKind,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_REMINDER_DEFAULT_HOURS,
  EDU_WA_BILLING_ERROR_CODE,
  EDU_WA_KINDS,
  EDU_WA_KIND_LABELS,
  EDU_WA_MAX_ROWS,
  eduClampReminderHours,
  eduDecideWaSend,
  eduParseWaTemplates,
  eduSanitizeWaTemplates,
  eduWaConnState,
  eduWaPhone,
  eduWaPhoneLabel,
  eduWaReadiness,
  type EduWaConnectionDTO,
  type EduWaMessageRow,
  type EduWaConnState,
  type EduWaKindReadiness,
  type EduWaTemplateMap,
  type EduWaTemplateStatus,
} from "@/lib/edu/whatsapp-core";

// Los DTO viven en whatsapp-core.ts (puro): los importa el NAVEGADOR y este
// archivo toca prisma. Se re-exportan aquí para que quien ya lee de este
// módulo no tenga que saber en cuál de los dos está cada cosa.
export type { EduWaConnectionDTO, EduWaMessageRow };

const GRAPH = "https://graph.facebook.com/v19.0";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════

const CONFIG_SELECT = {
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
} satisfies Prisma.EduWhatsappConfigSelect;

export type EduWaConfigRow = Prisma.EduWhatsappConfigGetPayload<{ select: typeof CONFIG_SELECT }>;

/**
 * La configuración del instituto. SIN ESCRIBIR NADA.
 *
 * Cuando todavía no hay fila devuelve una en memoria con los valores por
 * defecto —sin credenciales y con los tres avisos APAGADOS— para que la
 * pantalla no tenga que distinguir "todavía no hay fila" de "hay fila sin
 * conectar": son lo mismo desde fuera, y tratarlas distinto es cómo se
 * llega a una pantalla que revienta la primera vez que se abre.
 *
 * 🔴 NO CREA LA FILA, y eso importa: esta función la llama también la
 * pestaña de WhatsApp de la ficha del paciente, que abre un ALUMNO. Un GET
 * que escribe es un GET que no se puede repetir sin consecuencias — y aquí
 * la consecuencia sería una fila de configuración por cada instituto que
 * alguien miró de pasada. Quien sí la crea es `ensureEduWaConfig`, y lo
 * llaman solo los cinco caminos que GUARDAN.
 *
 * El `id` vacío de la fila fantasma no se usa nunca: los caminos que
 * escriben pasan por `ensureEduWaConfig` antes.
 */
export async function getEduWaConfig(institutionId: string): Promise<EduWaConfigRow> {
  if (!institutionId) throw new EduPadronError("Sesión de instituto no válida.", 401);

  const found = await prisma.eduWhatsappConfig.findUnique({
    where: { institutionId },
    select: CONFIG_SELECT,
  });
  if (found) return found;

  return {
    id: "",
    institutionId,
    phoneNumberId: null,
    businessAccountId: null,
    accessToken: null,
    displayPhone: null,
    connMethod: null,
    connected: false,
    connectedAt: null,
    lastErrorCode: null,
    lastErrorMsg: null,
    lastErrorAt: null,
    billingOk: false,
    billingCheckedAt: null,
    templates: null,
    remindersEnabled: false,
    reminderHoursBefore: EDU_REMINDER_DEFAULT_HOURS,
    consentEnabled: false,
    receiptEnabled: false,
  };
}

/**
 * La fila de verdad, creándola si hace falta. Solo para los caminos que
 * GUARDAN.
 *
 * `upsert` con un `update: {}` vacío: es la forma de decir "quiero la fila,
 * me da igual si existía". Idempotente ante dos peticiones simultáneas
 * porque institutionId es único — y si aun así choca (la ventana entre el
 * SELECT y el INSERT que hace Prisma por dentro), se lee la que ganó.
 */
async function ensureEduWaConfig(institutionId: string): Promise<EduWaConfigRow> {
  if (!institutionId) throw new EduPadronError("Sesión de instituto no válida.", 401);
  try {
    return await prisma.eduWhatsappConfig.upsert({
      where: { institutionId },
      create: { institutionId },
      update: {},
      select: CONFIG_SELECT,
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      const again = await prisma.eduWhatsappConfig.findUnique({
        where: { institutionId },
        select: CONFIG_SELECT,
      });
      if (again) return again;
    }
    throw e;
  }
}

// ── Credenciales ────────────────────────────────────────────────────────

export interface EduWaCredentials {
  institutionId: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string | null;
}

/**
 * Con qué credenciales sale un mensaje de este instituto, o null.
 *
 * PUNTO ÚNICO: ninguna pantalla ni ruta arma esto por su cuenta. El token
 * puede estar cifrado ("v1:…") o en claro (una fila anterior al cifrado):
 * `decryptField` devuelve el claro tal cual, igual que en el dental.
 */
export function eduWaCredentials(cfg: EduWaConfigRow): EduWaCredentials | null {
  if (!cfg.phoneNumberId || !cfg.accessToken) return null;

  // ⚠️ `decryptField` LANZA si falta DATA_ENCRYPTION_KEY o si el texto
  // cifrado está corrupto, y esta función la llaman el barrido y el envío,
  // que prometen no lanzar nunca. Un token que no se puede descifrar es, a
  // todos los efectos, un instituto sin conexión: se devuelve null y el
  // llamador lo cuenta como "no se intentó", con su motivo escrito.
  let token: string | null;
  try {
    token = decryptField(cfg.accessToken) ?? cfg.accessToken;
  } catch (e) {
    console.error(
      `[instituto/wa] no se pudo descifrar el token del instituto ${cfg.institutionId}:`,
      e,
    );
    return null;
  }
  if (!token) return null;
  return {
    institutionId: cfg.institutionId,
    phoneNumberId: cfg.phoneNumberId,
    accessToken: token,
    businessAccountId: cfg.businessAccountId,
  };
}

// ── Lo que ve la pantalla ───────────────────────────────────────────────

export function eduWaConnectionDTO(cfg: EduWaConfigRow): EduWaConnectionDTO {
  const templates = eduParseWaTemplates(cfg.templates);
  const state = eduWaConnState({
    connected: cfg.connected,
    phoneNumberId: cfg.phoneNumberId,
    hasToken: Boolean(cfg.accessToken),
    billingOk: cfg.billingOk,
    lastErrorCode: cfg.lastErrorCode,
  });

  return {
    state,
    phoneNumberId: cfg.phoneNumberId,
    businessAccountId: cfg.businessAccountId,
    displayPhone: cfg.displayPhone,
    connMethod: cfg.connMethod,
    connectedAt: iso(cfg.connectedAt),
    billingOk: cfg.billingOk,
    billingCheckedAt: iso(cfg.billingCheckedAt),
    lastErrorCode: cfg.lastErrorCode,
    lastErrorMsg: cfg.lastErrorMsg,
    lastErrorAt: iso(cfg.lastErrorAt),
    remindersEnabled: cfg.remindersEnabled,
    reminderHoursBefore: cfg.reminderHoursBefore,
    consentEnabled: cfg.consentEnabled,
    receiptEnabled: cfg.receiptEnabled,
    templates,
    readiness: eduWaReadiness({
      conn: state,
      templates,
      enabled: {
        RECORDATORIO: cfg.remindersEnabled,
        CONSENTIMIENTO: cfg.consentEnabled,
        RECIBO: cfg.receiptEnabled,
      },
    }),
  };
}

// ── Conectar / desconectar ──────────────────────────────────────────────

export interface EduWaConnectInput {
  phoneNumberId?: unknown;
  businessAccountId?: unknown;
  token?: unknown;
  displayPhone?: unknown;
}

/**
 * Guarda las credenciales de la WABA del instituto.
 *
 * 🔴 El token se guarda CIFRADO. Un token de WhatsApp en claro es la cuenta
 * de Meta entera de la escuela: quien lea esa fila puede mandar mensajes en
 * su nombre y gastarle la tarjeta.
 *
 * 🔴 `connected` se pone en true aquí y se APAGA SOLA al primer 190 / 401
 * (ver `sendEduWhatsapp`). No se comprueba contra Meta al guardar a
 * propósito: una comprobación que pasa hoy no dice nada de mañana, y el
 * único momento en que la verdad importa es el del envío.
 */
export async function saveEduWaConnection(
  institutionId: string,
  input: EduWaConnectInput,
): Promise<EduWaConnectionDTO> {
  // Fail-closed y con un mensaje que se puede leer: sin la clave maestra,
  // `encryptField` revienta con un error de librería y el panel lo enseña
  // como un 500 genérico. Guardar el token EN CLARO no es una alternativa.
  if (!process.env.DATA_ENCRYPTION_KEY) {
    throw new EduPadronError(
      "Este entorno no tiene configurada la clave de cifrado (DATA_ENCRYPTION_KEY), y el token de WhatsApp no se guarda sin cifrar. Avisa a soporte.",
      503,
    );
  }
  const cfg = await ensureEduWaConfig(institutionId);

  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  const token = String(input.token ?? "").trim();
  const businessAccountId = String(input.businessAccountId ?? "").trim();
  const displayPhone = String(input.displayPhone ?? "").trim();

  if (!/^\d{5,32}$/.test(phoneNumberId)) {
    throw new EduPadronError(
      "El identificador del número (phone number ID) de Meta son solo dígitos. Se copia del Administrador de WhatsApp, no es el teléfono.",
    );
  }
  if (token.length < 20) {
    throw new EduPadronError("Ese token es demasiado corto para ser el de Meta. Cópialo completo.");
  }
  if (businessAccountId && !/^\d{5,32}$/.test(businessAccountId)) {
    throw new EduPadronError(
      "El identificador de la cuenta de WhatsApp Business (WABA ID) son solo dígitos.",
    );
  }

  // 🔴 Un mismo número no puede estar en dos institutos. Se comprueba antes
  // para poder decirlo en español: el P2002 del índice único sale como un
  // 500 que nadie sabe leer.
  const ocupado = await prisma.eduWhatsappConfig.findFirst({
    where: { phoneNumberId, NOT: { institutionId } },
    select: { institutionId: true },
  });
  if (ocupado) {
    throw new EduPadronError(
      "Ese número de WhatsApp ya está conectado en otro instituto. Cada escuela conecta el suyo.",
      409,
    );
  }

  await prisma.eduWhatsappConfig.update({
    where: { id: cfg.id },
    data: {
      phoneNumberId,
      businessAccountId: businessAccountId || null,
      accessToken: encryptField(token),
      displayPhone: displayPhone ? displayPhone.slice(0, 40) : null,
      connMethod: "manual",
      connected: true,
      connectedAt: new Date(),
      // Se limpia el último error: la conexión es nueva y arrastrar el
      // "sin método de pago" de hace un mes sería mentir en la pantalla.
      lastErrorCode: null,
      lastErrorMsg: null,
      lastErrorAt: null,
    },
  });

  return eduWaConnectionDTO(await getEduWaConfig(institutionId));
}

/**
 * Desconecta: borra las credenciales y APAGA los tres avisos.
 *
 * Apagarlos es la parte que importa. Si se quedaran encendidos, el día que
 * alguien vuelva a conectar el número empezarían a salir mensajes a
 * pacientes sin que nadie lo pidiera — y con cargo a la tarjeta de la
 * escuela.
 */
export async function disconnectEduWa(institutionId: string): Promise<EduWaConnectionDTO> {
  const cfg = await ensureEduWaConfig(institutionId);
  await prisma.eduWhatsappConfig.update({
    where: { id: cfg.id },
    data: {
      phoneNumberId: null,
      businessAccountId: null,
      accessToken: null,
      displayPhone: null,
      connMethod: null,
      connected: false,
      connectedAt: null,
      billingOk: false,
      remindersEnabled: false,
      consentEnabled: false,
      receiptEnabled: false,
    },
  });
  return eduWaConnectionDTO(await getEduWaConfig(institutionId));
}

// ── Avisos encendidos / horas antes ─────────────────────────────────────

export interface EduWaSettingsInput {
  remindersEnabled?: unknown;
  reminderHoursBefore?: unknown;
  consentEnabled?: unknown;
  receiptEnabled?: unknown;
}

function parseBool(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/**
 * Enciende y apaga avisos, y fija la anticipación del recordatorio.
 *
 * 🔴 NO SE PUEDE ENCENDER UN AVISO QUE NO PUEDE SALIR. Si falta la conexión
 * o la plantilla de ese tipo, el interruptor se rebota con el motivo. Un
 * interruptor encendido sobre algo que no funciona es la peor pantalla
 * posible: la escuela cree que sus pacientes reciben recordatorios y nadie
 * recibe nada.
 */
export async function saveEduWaSettings(
  institutionId: string,
  input: EduWaSettingsInput,
): Promise<EduWaConnectionDTO> {
  const cfg = await ensureEduWaConfig(institutionId);
  const dto = eduWaConnectionDTO(cfg);
  const data: Prisma.EduWhatsappConfigUpdateInput = {};

  const pares: { field: "remindersEnabled" | "consentEnabled" | "receiptEnabled"; kind: EduWhatsappKind }[] = [
    { field: "remindersEnabled", kind: "RECORDATORIO" },
    { field: "consentEnabled", kind: "CONSENTIMIENTO" },
    { field: "receiptEnabled", kind: "RECIBO" },
  ];

  for (const { field, kind } of pares) {
    const value = parseBool(input[field]);
    if (value === undefined) continue;
    if (value) {
      if (dto.state !== "CONECTADO") {
        throw new EduPadronError(
          `No se puede encender "${EDU_WA_KIND_LABELS[kind]}": ${dto.state === "SIN_METODO_DE_PAGO" ? "la cuenta de WhatsApp del instituto no tiene método de pago." : "todavía no hay una conexión de WhatsApp utilizable."}`,
        );
      }
      const listo = dto.readiness.find((r) => r.kind === kind);
      if (listo && !listo.templateOk) {
        throw new EduPadronError(
          `No se puede encender "${EDU_WA_KIND_LABELS[kind]}": ${listo.problem ?? "falta su plantilla aprobada."}`,
        );
      }
    }
    data[field] = value;
  }

  if (input.reminderHoursBefore !== undefined) {
    const horas = eduClampReminderHours(input.reminderHoursBefore);
    if (horas === null) {
      throw new EduPadronError(
        "La anticipación del recordatorio va en horas enteras, entre 1 y 168 (una semana).",
      );
    }
    data.reminderHoursBefore = horas;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduWhatsappConfig.update({ where: { id: cfg.id }, data });
  return eduWaConnectionDTO(await getEduWaConfig(institutionId));
}

// ── Plantillas ──────────────────────────────────────────────────────────

/** Guarda los NOMBRES con los que Meta aprobó las plantillas del instituto. */
export async function saveEduWaTemplates(
  institutionId: string,
  raw: unknown,
): Promise<EduWaConnectionDTO> {
  const cfg = await ensureEduWaConfig(institutionId);
  const previo = eduParseWaTemplates(cfg.templates);
  const res = eduSanitizeWaTemplates(raw, previo);
  if (!res.ok) throw new EduPadronError(res.error ?? "No se pudieron leer las plantillas.");

  await prisma.eduWhatsappConfig.update({
    where: { id: cfg.id },
    // Prisma Json: un objeto vacío es `{}`, no DbNull — desregistrar todas
    // las plantillas tiene que quedar como un mapa vacío, no como "nunca se
    // configuró", que es lo que significaría null.
    data: { templates: res.templates as unknown as Prisma.InputJsonValue },
  });

  // 🔴 Un aviso encendido cuya plantilla se acaba de desregistrar tiene que
  // apagarse en el mismo acto. Si no, el interruptor se quedaría en verde
  // sobre algo que ya no puede salir — y el cron lo descubriría en silencio.
  const dto = eduWaConnectionDTO(await getEduWaConfig(institutionId));
  const apagar: Prisma.EduWhatsappConfigUpdateInput = {};
  for (const r of dto.readiness) {
    if (!r.enabled || r.templateOk) continue;
    if (r.kind === "RECORDATORIO") apagar.remindersEnabled = false;
    if (r.kind === "CONSENTIMIENTO") apagar.consentEnabled = false;
    if (r.kind === "RECIBO") apagar.receiptEnabled = false;
  }
  if (Object.keys(apagar).length > 0) {
    await prisma.eduWhatsappConfig.update({ where: { id: cfg.id }, data: apagar });
    return eduWaConnectionDTO(await getEduWaConfig(institutionId));
  }
  return dto;
}

/**
 * Le PREGUNTA a Meta en qué estado tiene las plantillas del instituto y
 * guarda la respuesta.
 *
 * Se guarda —y no se consulta en cada envío— porque el cron manda decenas de
 * mensajes por tick y una llamada extra a Meta por cada uno es latencia que
 * nadie necesita. Pero se guarda con su `checkedAt` a la vista: una copia
 * envejece, y la pantalla dice CUÁNDO se preguntó.
 *
 * Nunca lanza por culpa de Meta: devuelve el motivo para pintarlo. Que la
 * revisión falle no puede tumbar la pantalla de configuración.
 */
export async function refreshEduWaTemplateStatus(
  institutionId: string,
): Promise<{ ok: boolean; reason?: string; connection: EduWaConnectionDTO }> {
  const cfg = await ensureEduWaConfig(institutionId);
  const creds = eduWaCredentials(cfg);

  if (!creds) {
    return {
      ok: false,
      reason: "Conecta el WhatsApp del instituto para poder preguntarle a Meta.",
      connection: eduWaConnectionDTO(cfg),
    };
  }
  if (!creds.businessAccountId) {
    return {
      ok: false,
      reason:
        "Falta el identificador de la cuenta de WhatsApp Business (WABA ID). Sin él, Meta no deja consultar las plantillas.",
      connection: eduWaConnectionDTO(cfg),
    };
  }

  const templates = eduParseWaTemplates(cfg.templates);
  if (Object.keys(templates).length === 0) {
    return {
      ok: false,
      reason: "Todavía no has registrado el nombre de ninguna plantilla.",
      connection: eduWaConnectionDTO(cfg),
    };
  }

  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(creds.businessAccountId)}/message_templates?limit=200`,
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw parseWaError(json, res.status);

    const live = Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: unknown[] }).data as Record<string, unknown>[])
      : [];

    const ahora = new Date().toISOString();
    const siguiente: EduWaTemplateMap = {};
    for (const kind of EDU_WA_KINDS) {
      const tpl = templates[kind];
      if (!tpl) continue;
      const hit = live.find(
        (t) => String(t?.name ?? "") === tpl.name && String(t?.language ?? tpl.lang) === tpl.lang,
      );
      const bruto = hit ? String(hit.status ?? "PENDING").toUpperCase() : "";
      // Meta usa más estados de los que el producto distingue (PAUSED,
      // DISABLED, PENDING_DELETION…). Todo lo que no sea APPROVED se trata
      // como no enviable: mejor bloquear de más que gastar intentos.
      const status: EduWaTemplateStatus = !hit
        ? "REJECTED"
        : bruto === "APPROVED"
          ? "APPROVED"
          : bruto === "REJECTED" || bruto === "DISABLED" || bruto === "PAUSED"
            ? "REJECTED"
            : "PENDING";
      const reason = !hit
        ? "Meta no encuentra una plantilla con ese nombre y ese idioma en la cuenta del instituto."
        : typeof hit.rejected_reason === "string" && hit.rejected_reason.trim() !== ""
          ? hit.rejected_reason
          : bruto !== "APPROVED" && bruto !== "PENDING"
            ? `Meta la tiene en estado ${bruto}.`
            : undefined;

      siguiente[kind] = { ...tpl, status, checkedAt: ahora, ...(reason ? { reason } : {}) };
    }

    await prisma.eduWhatsappConfig.update({
      where: { id: cfg.id },
      data: { templates: siguiente as unknown as Prisma.InputJsonValue },
    });

    // Si alguna dejó de servir, el aviso correspondiente se apaga: mismo
    // criterio que al guardar los nombres.
    const dto = await apagarAvisosSinPlantilla(institutionId);
    return { ok: true, connection: dto };
  } catch (e) {
    if (isTokenRevoked(e)) await markEduWaDisconnected(institutionId, "Meta rechazó el token");
    console.error(`[instituto/wa] no se pudieron leer las plantillas (${institutionId}):`, e);
    return {
      ok: false,
      reason: e instanceof WhatsAppApiError ? e.message : "Meta no contestó.",
      connection: eduWaConnectionDTO(await getEduWaConfig(institutionId)),
    };
  }
}

async function apagarAvisosSinPlantilla(institutionId: string): Promise<EduWaConnectionDTO> {
  const dto = eduWaConnectionDTO(await getEduWaConfig(institutionId));
  const apagar: Prisma.EduWhatsappConfigUpdateInput = {};
  for (const r of dto.readiness) {
    if (!r.enabled || r.templateOk) continue;
    if (r.kind === "RECORDATORIO") apagar.remindersEnabled = false;
    if (r.kind === "CONSENTIMIENTO") apagar.consentEnabled = false;
    if (r.kind === "RECIBO") apagar.receiptEnabled = false;
  }
  if (Object.keys(apagar).length === 0) return dto;
  await prisma.eduWhatsappConfig.update({ where: { institutionId }, data: apagar });
  return eduWaConnectionDTO(await getEduWaConfig(institutionId));
}

/**
 * Apaga `connected` cuando Meta dice que la sesión murió (190 / HTTP 401).
 *
 * Sin esto, el cron sigue intentando con un token revocado en cada tick:
 * cada recordatorio se marca FAILED, nadie se entera y el instituto cree que
 * sus mensajes salen. Espejo de markWhatsAppDisconnected del dental.
 *
 * Best-effort: nunca lanza. Se llama desde caminos (cron, envío) donde un
 * fallo aquí no debe tumbar lo que ya se estaba haciendo.
 */
export async function markEduWaDisconnected(institutionId: string, reason: string): Promise<void> {
  try {
    const res = await prisma.eduWhatsappConfig.updateMany({
      where: { institutionId, connected: true },
      data: { connected: false, lastErrorMsg: reason.slice(0, 500), lastErrorAt: new Date() },
    });
    if (res.count > 0) {
      console.warn(`[instituto/wa] connected=false en el instituto ${institutionId}: ${reason}`);
    }
  } catch (e) {
    console.error("[instituto/wa] no se pudo apagar la conexión:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · MANDAR Y REGISTRAR
// ═══════════════════════════════════════════════════════════════════════

export interface EduWaSendArgs {
  institutionId: string;
  cfg: EduWaConfigRow;
  kind: EduWhatsappKind;
  /** A quién, con su nombre CONGELADO para la constancia. */
  patientId: string | null;
  toName: string;
  /** El teléfono tal como está en la ficha; aquí se normaliza. */
  rawPhone: string | null;
  /** Valores de {{1}}…{{n}}, EN ORDEN. */
  params: string[];
  appointmentId?: string | null;
  consentId?: string | null;
  chargeId?: string | null;
  /** Llave de idempotencia (solo los recordatorios la usan). */
  dedupeKey?: string | null;
  scheduledFor?: Date | null;
  /** Quién lo mandó. Null = el cron. */
  sentByUserId?: string | null;
  sentByName?: string | null;
  /** Fila ya reclamada que se reintenta (el cron la trae de un tick anterior). */
  reuseId?: string | null;
  now?: Date;
}

export interface EduWaSendResult {
  ok: boolean;
  messageId: string | null;
  status: EduWhatsappStatus;
  /** Motivo en español, listo para pintarse. Null si salió. */
  error: string | null;
  code?: number | null;
}

/**
 * MANDA Y REGISTRA. Es el ÚNICO camino: ninguna pantalla ni ningún cron
 * llama a Meta por su cuenta, y por eso ni la plantilla ni la constancia se
 * pueden saltar.
 *
 * El orden importa y cada paso tiene su porqué:
 *   1. conexión utilizable — la pantalla puede mentir, esto no;
 *   2. teléfono a 10 dígitos — sin él Meta contesta 131026 y esa fila roja
 *      se lee como un problema de Meta cuando es un dato de la ficha;
 *   3. plantilla y parámetros (eduDecideWaSend) — SIN plantilla aprobada NO
 *      se intenta;
 *   4. se ESCRIBE la constancia (PENDING), luego se manda, y solo entonces
 *      se sella el resultado.
 *
 * 🔴 EL PASO 4 ES EL QUE HACE QUE LA CONSTANCIA SEA VERDAD. Escribir después
 * de mandar significa que un proceso que muere a mitad de la llamada deja un
 * mensaje entregado sin constancia — y al siguiente tick se manda otra vez.
 *
 * Nunca lanza: devuelve el motivo en español. Un fallo de WhatsApp no puede
 * tumbar la pantalla ni el barrido que lo llamó.
 */
export async function sendEduWhatsapp(args: EduWaSendArgs): Promise<EduWaSendResult> {
  try {
    return await enviarYRegistrar(args);
  } catch (e) {
    // 🔴 EL CONTRATO ES QUE ESTO NO LANZA. Lo llaman el barrido —donde una
    // excepción se llevaría por delante los recordatorios de las demás
    // citas de ese instituto— y dos pantallas. Un fallo raro (la fila que
    // se iba a reintentar ya no existe, la base que se cayó a media
    // escritura) sale como resultado, no como excepción.
    console.error("[instituto/wa] envío no realizado:", e);
    return {
      ok: false,
      messageId: null,
      status: "FAILED",
      error: "No se pudo mandar el mensaje. Vuelve a intentarlo.",
    };
  }
}

async function enviarYRegistrar(args: EduWaSendArgs): Promise<EduWaSendResult> {
  const now = args.now ?? new Date();

  const bloquear = async (reason: string): Promise<EduWaSendResult> => {
    // 🔴 Se deja constancia del BLOQUEO igual que del envío. "No se intentó"
    // con su motivo es una respuesta; el silencio no lo es — y sin fila,
    // nadie puede contestar por qué ese paciente no recibió nada.
    const id = await registrarBloqueo(args, reason, now);
    return { ok: false, messageId: id, status: "BLOCKED", error: reason };
  };

  const creds = eduWaCredentials(args.cfg);
  if (!creds || !args.cfg.connected) {
    return bloquear(
      "El instituto no tiene una conexión de WhatsApp utilizable, así que este aviso no se intentó.",
    );
  }

  const phone = eduWaPhone(args.rawPhone);
  if (!phone) {
    return bloquear(
      "El teléfono de la ficha no tiene 10 dígitos, así que WhatsApp no lo podría entregar.",
    );
  }

  const decision = eduDecideWaSend({
    kind: args.kind,
    templates: eduParseWaTemplates(args.cfg.templates),
    params: args.params,
  });
  if (decision.mode === "blocked") return bloquear(decision.reason);

  // ── Se reclama la fila ANTES de llamar a Meta ─────────────────────────
  let rowId: string;
  if (args.reuseId) {
    const previa = await prisma.eduWhatsappMessage.update({
      where: { id: args.reuseId },
      data: {
        status: "PENDING",
        body: decision.body,
        templateName: decision.template.name,
        templateLang: decision.template.lang,
        attempts: { increment: 1 },
        errorCode: null,
        errorMsg: null,
      },
      select: { id: true },
    });
    rowId = previa.id;
  } else {
    try {
      const creada = await prisma.eduWhatsappMessage.create({
        data: {
          institutionId: args.institutionId,
          kind: args.kind,
          status: "PENDING",
          patientId: args.patientId ?? null,
          toName: args.toName.slice(0, 160),
          toPhone: phone,
          appointmentId: args.appointmentId ?? null,
          consentId: args.consentId ?? null,
          chargeId: args.chargeId ?? null,
          body: decision.body,
          templateName: decision.template.name,
          templateLang: decision.template.lang,
          dedupeKey: args.dedupeKey ?? null,
          scheduledFor: args.scheduledFor ?? null,
          attempts: 1,
          sentByUserId: args.sentByUserId ?? null,
          sentByName: args.sentByName ?? null,
        },
        select: { id: true },
      });
      rowId = creada.id;
    } catch (e) {
      // El único (institutionId, dedupeKey) es el seguro contra dos crones
      // simultáneos: el segundo choca y se va sin mandar nada.
      if ((e as { code?: string })?.code === "P2002") {
        return {
          ok: false,
          messageId: null,
          status: "CANCELLED",
          error: "Ese aviso ya se había registrado.",
        };
      }
      throw e;
    }
  }

  // ── Se manda ──────────────────────────────────────────────────────────
  try {
    const res = await sendWhatsAppTemplate(
      creds.phoneNumberId,
      creds.accessToken,
      // Se le pasan los 10 dígitos nacionales —lo mismo que se guardó en la
      // constancia— y `sendWhatsAppTemplate` les pone el 52 delante con
      // normalizeMxWhatsAppPhone. Normalizar aquí también sería inofensivo
      // (es idempotente) pero dejaría dos sitios donde cambiar la regla.
      phone,
      { name: decision.template.name, lang: decision.template.lang },
      decision.params,
    );
    const wamid: string | null =
      typeof res?.messages?.[0]?.id === "string" ? res.messages[0].id : null;

    await prisma.eduWhatsappMessage.update({
      where: { id: rowId },
      data: { status: "SENT", sentAt: new Date(), wamid },
    });

    // 🔴 Meta ACEPTÓ una plantilla: eso demuestra que la WABA tiene método
    // de pago. Es la única señal fiable que hay —no existe endpoint que lo
    // pregunte— y por eso se guarda aquí y no en la pantalla.
    if (!args.cfg.billingOk) {
      await prisma.eduWhatsappConfig
        .updateMany({
          where: { institutionId: args.institutionId },
          data: { billingOk: true, billingCheckedAt: new Date(), lastErrorCode: null },
        })
        .catch(() => {});
    }

    return { ok: true, messageId: rowId, status: "SENT", error: null };
  } catch (e) {
    const code = waErrorCode(e);
    const mensaje = e instanceof Error ? e.message : "WhatsApp no pudo entregar el mensaje";

    await prisma.eduWhatsappMessage
      .update({
        where: { id: rowId },
        data: { status: "FAILED", errorCode: code, errorMsg: mensaje.slice(0, 500) },
      })
      .catch(() => {});

    await prisma.eduWhatsappConfig
      .updateMany({
        where: { institutionId: args.institutionId },
        data: {
          lastErrorCode: code,
          lastErrorMsg: mensaje.slice(0, 500),
          lastErrorAt: new Date(),
          // 🔴 131042: la WABA del instituto no tiene método de pago válido.
          // Se marca aquí para que la pantalla lo diga CON ESAS PALABRAS y
          // no parezca un bug del panel. No se deja de intentar: el día que
          // la escuela ponga la tarjeta, los avisos vuelven solos.
          ...(code === EDU_WA_BILLING_ERROR_CODE
            ? { billingOk: false, billingCheckedAt: new Date() }
            : {}),
        },
      })
      .catch(() => {});

    if (isTokenRevoked(e)) {
      await markEduWaDisconnected(args.institutionId, "Meta rechazó el token al enviar");
    }

    return { ok: false, messageId: rowId, status: "FAILED", error: mensaje, code };
  }
}

/**
 * Deja constancia de un aviso que NO se intentó, sin llamar a Meta.
 *
 * 🔴 UNA FILA POR AVISO, NO UNA POR TICK. El barrido vuelve a mirar los
 * bloqueados en cada corrida (el motivo puede dejar de ser verdad: se
 * corrige el teléfono, se aprueba la plantilla), así que si esto creara una
 * fila cada quince minutos, un solo paciente sin teléfono llenaría el
 * registro de noventa y seis renglones al día y taparía justo lo que hay
 * que leer. Con llave de reintento se ACTUALIZA la que ya existe; sin ella
 * —los documentos que manda una persona— cada intento SÍ es un evento
 * distinto y merece su fila.
 */
async function registrarBloqueo(
  args: EduWaSendArgs,
  reason: string,
  now: Date,
): Promise<string | null> {
  const phone = eduWaPhone(args.rawPhone) ?? String(args.rawPhone ?? "").replace(/\D/g, "").slice(0, 20);

  if (args.reuseId) {
    const actualizada = await prisma.eduWhatsappMessage
      .update({
        where: { id: args.reuseId },
        data: { status: "BLOCKED", errorMsg: reason.slice(0, 500), errorCode: null },
        select: { id: true },
      })
      .catch(() => null);
    if (actualizada) return actualizada.id;
  }

  try {
    const creada = await prisma.eduWhatsappMessage.create({
      data: {
        institutionId: args.institutionId,
        kind: args.kind,
        status: "BLOCKED",
        patientId: args.patientId ?? null,
        toName: args.toName.slice(0, 160),
        toPhone: phone || "—",
        appointmentId: args.appointmentId ?? null,
        consentId: args.consentId ?? null,
        chargeId: args.chargeId ?? null,
        body: "",
        dedupeKey: args.dedupeKey ?? null,
        scheduledFor: args.scheduledFor ?? null,
        errorMsg: reason.slice(0, 500),
        attempts: 0,
        sentByUserId: args.sentByUserId ?? null,
        sentByName: args.sentByName ?? null,
        createdAt: now,
      },
      select: { id: true },
    });
    return creada.id;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return null;
    console.error("[instituto/wa] no se pudo registrar el bloqueo:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL REGISTRO DE ENVÍOS (lectura)
// ═══════════════════════════════════════════════════════════════════════

const MESSAGE_SELECT = {
  id: true,
  kind: true,
  status: true,
  patientId: true,
  toName: true,
  toPhone: true,
  appointmentId: true,
  consentId: true,
  chargeId: true,
  body: true,
  templateName: true,
  scheduledFor: true,
  sentAt: true,
  errorCode: true,
  errorMsg: true,
  attempts: true,
  sentByName: true,
  createdAt: true,
} satisfies Prisma.EduWhatsappMessageSelect;

function toMessageRow(
  m: Prisma.EduWhatsappMessageGetPayload<{ select: typeof MESSAGE_SELECT }>,
): EduWaMessageRow {
  return {
    id: m.id,
    kind: m.kind,
    kindLabel: EDU_WA_KIND_LABELS[m.kind],
    status: m.status,
    patientId: m.patientId,
    toName: m.toName,
    toPhone: m.toPhone,
    toPhoneLabel: eduWaPhoneLabel(m.toPhone),
    appointmentId: m.appointmentId,
    consentId: m.consentId,
    chargeId: m.chargeId,
    body: m.body,
    templateName: m.templateName,
    scheduledFor: iso(m.scheduledFor),
    sentAt: iso(m.sentAt),
    errorCode: m.errorCode,
    errorMsg: m.errorMsg,
    attempts: m.attempts,
    sentByName: m.sentByName,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * El registro de envíos, RECORTADO.
 *
 * 🔴 El recorte lo arma `eduWhatsappScopeWhere` (visibility.ts) y hace DOS
 * cosas, no una: recorta por paciente Y descarta los avisos de RECIBO para
 * quien no ve dinero. Sin lo segundo, un alumno leería en el cuerpo del
 * aviso el folio, el total y el saldo de su propio paciente — justo lo que
 * la Ola 5 cerró por partida doble.
 */
export async function listEduWaMessages(
  ctx: EduClinicaContext,
  opts: { patientId?: string | null; take?: number; now?: Date } = {},
): Promise<EduWaMessageRow[]> {
  const institutionId = requireInstitution(ctx);
  const now = opts.now ?? new Date();

  const patientScope = eduVisibility(ctx, "patients");
  const chargeScope = eduVisibility(ctx, "charges");
  if (eduScopeIsEmpty(patientScope)) return [];

  const allPatients = patientScope.kind === "all";
  const filtroPaciente = opts.patientId ? eduCleanId(opts.patientId) : null;
  if (opts.patientId && !filtroPaciente) return [];

  let patientIds: string[] = [];
  if (!allPatients) {
    if (filtroPaciente) {
      // 🔴 UN SOLO PACIENTE SE COMPRUEBA CONTRA LA BASE, NO CONTRA LA LISTA
      // DE ABAJO. La lista está topada, y con un docente de muchos alumnos
      // el paciente número 201 caería fuera: su pestaña de WhatsApp saldría
      // vacía sin que nada lo explicara. Aquí se pregunta por ÉL, con el
      // mismo `where` de alcance.
      const uno = await prisma.eduPatient.findFirst({
        where: {
          ...eduPatientScopeWhere({ institutionId, scope: patientScope, now }),
          id: filtroPaciente,
        },
        select: { id: true },
      });
      if (!uno) return [];
      patientIds = [uno.id];
    } else {
      // Los ids se resuelven ANTES porque el mensaje no cuelga de
      // EduPatient en Prisma (guarda el nombre congelado, ver la nota del
      // modelo).
      //
      // ⚠️ Topado a EDU_WA_MAX_ROWS pacientes. Solo afecta al listado
      // GENERAL (el de /instituto/whatsapp) de alguien cuyo alcance no es
      // "todos" —que por defecto no es nadie: la key whatsapp.view es de
      // dirección—, y en ese caso enseñaría los envíos de sus primeros 200
      // pacientes. La ficha de un paciente concreto no pasa por aquí.
      const pacientes = await prisma.eduPatient.findMany({
        where: eduPatientScopeWhere({ institutionId, scope: patientScope, now }),
        select: { id: true },
        take: EDU_WA_MAX_ROWS,
      });
      patientIds = pacientes.map((p) => p.id);
    }
    if (patientIds.length === 0) return [];
  }

  const where = eduWhatsappScopeWhere({
    institutionId,
    patientScope,
    chargeScope,
    allPatients,
    patientIds,
    now,
  });

  if (filtroPaciente) where.patientId = filtroPaciente;

  const rows = await prisma.eduWhatsappMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(opts.take ?? 50, EDU_WA_MAX_ROWS),
    select: MESSAGE_SELECT,
  });
  return rows.map(toMessageRow);
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · MANDAR DOCUMENTOS DESDE LA FICHA
// ═══════════════════════════════════════════════════════════════════════

/** Base pública para armar la liga del consentimiento. */
function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com").replace(/\/+$/, "");
}

/**
 * Dos envíos idénticos seguidos casi siempre son un doble clic, no dos
 * decisiones. Se rebota el segundo dentro de esta ventana.
 */
const EDU_WA_REPEAT_WINDOW_MS = 2 * 60 * 1000;

async function seMandoHaceNada(
  institutionId: string,
  kind: EduWhatsappKind,
  field: "consentId" | "chargeId",
  id: string,
  now: Date,
): Promise<boolean> {
  const reciente = await prisma.eduWhatsappMessage.findFirst({
    where: {
      institutionId,
      kind,
      [field]: id,
      status: "SENT",
      createdAt: { gte: new Date(now.getTime() - EDU_WA_REPEAT_WINDOW_MS) },
    },
    select: { id: true },
  });
  return Boolean(reciente);
}

/**
 * El paciente, buscado DENTRO del alcance de "patients".
 *
 * Mismo criterio que los consentimientos de la Ola 3B: un paciente fuera de
 * alcance da 404, igual que uno que no existe. Un 403 confirmaría que ese
 * folio existe.
 */
async function pacienteEnAlcance(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date,
): Promise<{ id: string; folio: string; firstName: string; lastName: string; phone: string | null } | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;
  return prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, folio: true, firstName: true, lastName: true, phone: true },
  });
}

function nombrePaciente(p: { firstName: string; lastName: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}

export interface EduWaDocumentResult {
  ok: boolean;
  error: string | null;
  message: EduWaMessageRow | null;
}

async function leerFila(id: string | null): Promise<EduWaMessageRow | null> {
  if (!id) return null;
  const row = await prisma.eduWhatsappMessage.findUnique({ where: { id }, select: MESSAGE_SELECT });
  return row ? toMessageRow(row) : null;
}

/**
 * Manda la CARTA DE CONSENTIMIENTO para que el paciente la firme.
 *
 * Lo que viaja es la LIGA por token que ya existía desde la Ola 3B, no un
 * adjunto: el token ES la credencial, la página es pública y firmar desde el
 * teléfono es justo para lo que se hizo. Mandar un PDF exigiría una
 * plantilla de Meta con cabecera de documento y no aportaría la firma.
 *
 * 🔴 Solo se manda una carta que TODAVÍA SE PUEDE FIRMAR. Mandar la liga de
 * una firmada, revocada o vencida le pone delante al paciente un documento
 * que no puede tocar, y le dice que tiene algo pendiente que no tiene.
 */
export async function sendEduConsentWhatsapp(
  ctx: EduClinicaContext,
  consentId: string,
  /** El paciente de la URL. Tiene que ser el DUEÑO de la carta. */
  patientIdEnLaUrl: string | null,
  now: Date = new Date(),
): Promise<EduWaDocumentResult> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(consentId);
  if (!id) throw new EduPadronError("Esa carta no es de este instituto.", 404);

  const cfg = await getEduWaConfig(institutionId);
  if (!cfg.consentEnabled) {
    throw new EduPadronError(
      'El envío de consentimientos por WhatsApp está apagado. Se enciende en Ajustes → WhatsApp.',
      409,
    );
  }

  const consent = await prisma.eduConsent.findFirst({
    where: { id, institutionId },
    select: {
      id: true,
      patientId: true,
      procedure: true,
      token: true,
      expiresAt: true,
      signedAt: true,
      revokedAt: true,
    },
  });
  if (!consent) throw new EduPadronError("Esa carta no es de este instituto.", 404);

  const paciente = await pacienteEnAlcance(ctx, consent.patientId, now);
  if (!paciente) throw new EduPadronError("Esa carta no es de este instituto.", 404);
  // La URL dice de qué paciente es la ficha; el documento dice de quién es
  // de verdad. Si no coinciden, la petición está mal armada — y aceptarla
  // dejaría una ruta cuyo `[id]` no significa nada.
  if (patientIdEnLaUrl && eduCleanId(patientIdEnLaUrl) !== paciente.id) {
    throw new EduPadronError("Esa carta no es de este paciente.", 404);
  }

  if (consent.revokedAt) {
    throw new EduPadronError("Esa carta está revocada: ya no se puede firmar.", 409);
  }
  if (consent.signedAt) {
    throw new EduPadronError("Esa carta ya está firmada. No hace falta volver a mandarla.", 409);
  }
  if (consent.expiresAt.getTime() <= now.getTime()) {
    throw new EduPadronError("Esa carta ya venció. Emite una nueva y mándala.", 409);
  }

  if (await seMandoHaceNada(institutionId, "CONSENTIMIENTO", "consentId", consent.id, now)) {
    throw new EduPadronError("Esa carta se acaba de mandar hace un momento.", 409);
  }

  const res = await sendEduWhatsapp({
    institutionId,
    cfg,
    kind: "CONSENTIMIENTO",
    patientId: paciente.id,
    toName: nombrePaciente(paciente),
    rawPhone: paciente.phone,
    params: [
      paciente.firstName,
      ctxInstitutionName(ctx),
      consent.procedure,
      `${siteBase()}/instituto/consentimiento/${consent.token}`,
    ],
    consentId: consent.id,
    sentByUserId: ctx.eduUserId,
    sentByName: eduActorName(ctx),
    now,
  });

  return { ok: res.ok, error: res.error, message: await leerFila(res.messageId) };
}

/**
 * Manda el RECIBO de un cobro.
 *
 * 🔴 DOS CERRADURAS, NO UNA. El permiso del endpoint es "caja.view", y
 * además el cobro se busca con el alcance de "charges", que para DOCENTE y
 * ALUMNO devuelve el `where` que no trae ni una fila. Encenderle "caja.view"
 * a un alumno por error sigue sin dejarle mandar un peso — que es la misma
 * regla que sostiene la Ola 5.
 *
 * ⚠️ Va el RESUMEN (folio, total y saldo), no un PDF ni una liga pública. Un
 * adjunto exigiría una plantilla de Meta con cabecera de documento; una liga
 * pública sería una URL permanente con el nombre del paciente y su cuenta,
 * y no hace falta: lo que el paciente necesita del recibo cabe en el
 * mensaje. Lo demás está en el panel.
 */
export async function sendEduReceiptWhatsapp(
  ctx: EduClinicaContext,
  chargeId: string,
  /** El paciente de la URL. Tiene que ser el DUEÑO del cobro. */
  patientIdEnLaUrl: string | null,
  now: Date = new Date(),
): Promise<EduWaDocumentResult> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(chargeId);
  if (!id) throw new EduPadronError("Ese cobro no es de este instituto.", 404);

  const chargeScope = eduVisibility(ctx, "charges");
  if (!eduCanSendWhatsappKind("RECIBO", chargeScope)) {
    throw new EduPadronError(
      "Tu rol no manda recibos: en el piso clínico se atiende, y en el mostrador se cobra.",
      403,
    );
  }

  const cfg = await getEduWaConfig(institutionId);
  if (!cfg.receiptEnabled) {
    throw new EduPadronError(
      "El envío de recibos por WhatsApp está apagado. Se enciende en Ajustes → WhatsApp.",
      409,
    );
  }

  // 🔴 El `where` sale del ALCANCE y no se escribe a mano. Hoy
  // `eduChargeScopeWhere` con "all" es exactamente `{ institutionId }` y el
  // `eduCanSendWhatsappKind` de arriba ya cerró el paso a docente y alumno —
  // pero un cobro que se busca sin pasar por el punto único es el patrón que
  // deja de estar bien el día que el punto único cambie.
  const charge = await prisma.eduCharge.findFirst({
    where: { ...eduChargeScopeWhere({ institutionId, scope: chargeScope }), id },
    select: {
      id: true,
      folio: true,
      patientId: true,
      totalCents: true,
      balanceCents: true,
      status: true,
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  });
  if (!charge) throw new EduPadronError("Ese cobro no es de este instituto.", 404);
  if (patientIdEnLaUrl && eduCleanId(patientIdEnLaUrl) !== charge.patient.id) {
    throw new EduPadronError("Ese cobro no es de este paciente.", 404);
  }
  if (charge.status === "CANCELLED") {
    throw new EduPadronError("Ese cobro está cancelado: su recibo ya no vale.", 409);
  }

  if (await seMandoHaceNada(institutionId, "RECIBO", "chargeId", charge.id, now)) {
    throw new EduPadronError("Ese recibo se acaba de mandar hace un momento.", 409);
  }

  const res = await sendEduWhatsapp({
    institutionId,
    cfg,
    kind: "RECIBO",
    patientId: charge.patient.id,
    toName: nombrePaciente(charge.patient),
    rawPhone: charge.patient.phone,
    params: [
      charge.patient.firstName,
      ctxInstitutionName(ctx),
      charge.folio,
      eduMoney(charge.totalCents),
      eduMoney(charge.balanceCents),
    ],
    chargeId: charge.id,
    sentByUserId: ctx.eduUserId,
    sentByName: eduActorName(ctx),
    now,
  });

  return { ok: res.ok, error: res.error, message: await leerFila(res.messageId) };
}

// ── Nombre del instituto y de quien manda ───────────────────────────────
//
// El contexto de negocio (EduClinicaContext) solo trae rol + ids: es el
// subconjunto que las pruebas pueden fabricar sin un EduInstitution entero.
// Estas dos leen los campos EXTRA cuando el llamador pasó el contexto
// completo de sesión, y caen a un texto genérico si no — nunca revientan.

interface PosibleContextoCompleto {
  institution?: { name?: string } | null;
  user?: { firstName?: string; lastName?: string; email?: string } | null;
}

function ctxInstitutionName(ctx: EduClinicaContext): string {
  const nombre = (ctx as unknown as PosibleContextoCompleto).institution?.name;
  return typeof nombre === "string" && nombre.trim() !== "" ? nombre.trim() : "tu instituto";
}

function eduActorName(ctx: EduClinicaContext): string | null {
  const u = (ctx as unknown as PosibleContextoCompleto).user;
  if (!u) return null;
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email || null;
}

