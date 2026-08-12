// Plantillas aprobadas de WhatsApp, por clínica (M-09 — el P0 de la auditoría).
//
// EL PROBLEMA: Meta solo deja mandar texto libre dentro de las 24 h siguientes
// al último mensaje DEL PACIENTE. Fuera de esa ventana exige una plantilla
// aprobada, y todo lo que DaleControl enviaba solo —recordatorios de cita,
// confirmaciones, reagendados— salía como texto libre. O sea: al paciente que
// nunca le había escrito a la clínica NO le llegaba nada, Meta respondía 131047
// y el panel lo pintaba como "Enviado".
//
// EL MODELO DE NEGOCIO manda en el diseño: la cuenta de WhatsApp (WABA) es de
// cada clínica y Meta le cobra a ELLA cada plantilla. DaleControl no puede dar
// de alta plantillas por ella ni pagarlas, así que lo único que se puede hacer
// es: (a) decirle EXACTAMENTE qué texto registrar, (b) guardar el nombre con el
// que la aprobaron y (c) no enviar —y decir por qué— cuando falte.
//
// PURO: sin Prisma ni React. Lo importan el helper de envío (servidor) y la
// pantalla de configuración (cliente).

import type { WhatsAppSendKind } from "./system-message";

/** Plantilla registrada por la clínica para un tipo de mensaje. */
export interface WaTemplateConfig {
  /** Nombre EXACTO con el que Meta la aprobó (minúsculas y guiones bajos). */
  name: string;
  /** Código de idioma de Meta: "es_MX", "es", "en_US"… */
  lang: string;
}

/** Mapa que se guarda en `Clinic.waTemplates`. */
export type WaTemplateMap = Partial<Record<WhatsAppSendKind, WaTemplateConfig>>;

/**
 * Especificación de la plantilla que la clínica debe dar de alta en Meta.
 *
 * El texto lo fija DaleControl, no la clínica: al enviar mandamos los valores
 * de {{1}}…{{n}} POSICIONALMENTE, así que si la clínica registra un texto con
 * otro número de variables o en otro orden, Meta rechaza con 132000 o entrega
 * el mensaje con los datos cambiados de sitio.
 */
export interface WaTemplateSpec {
  kind: WhatsAppSendKind;
  /** Clave i18n del nombre humano del tipo de mensaje. */
  labelKey: string;
  /** Nombre sugerido para darla de alta (Meta exige [a-z0-9_]). */
  suggestedName: string;
  /** Texto EXACTO a registrar en Meta, con las variables numeradas. */
  body: string;
  /** Qué es cada {{n}}, en orden. Claves i18n. */
  variableKeys: string[];
}

/**
 * Tipos que HOY salen fuera de la ventana de 24 h y por tanto necesitan
 * plantilla sí o sí. Los tres comparten las mismas cuatro variables a
 * propósito: una clínica que da de alta tres plantillas casi iguales se
 * equivoca menos que con tres formatos distintos.
 *
 * El resto de `WHATSAPP_SEND_KINDS` (review, prescription, system, manual_api)
 * queda fuera por ahora: o responden a algo que el paciente acaba de hacer
 * (dentro de ventana) o van dirigidos a la propia clínica. La pantalla los
 * muestra como "no configurables todavía" en vez de fingir que existen.
 */
export const WA_TEMPLATE_SPECS: readonly WaTemplateSpec[] = [
  {
    kind: "reminder",
    labelKey: "inbox.whatsapp.tplKindReminder",
    suggestedName: "recordatorio_cita",
    body:
      "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}. " +
      "Responde CONFIRMAR para confirmarla o CANCELAR si no puedes asistir.",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
    ],
  },
  {
    kind: "booking",
    labelKey: "inbox.whatsapp.tplKindBooking",
    suggestedName: "confirmacion_cita",
    body: "Hola {{1}}, tu cita en {{2}} quedó agendada para el {{3}} a las {{4}}. ¡Te esperamos!",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
    ],
  },
  {
    kind: "appointment_change",
    labelKey: "inbox.whatsapp.tplKindAppointmentChange",
    suggestedName: "reagendado_cita",
    body: "Hola {{1}}, tu cita en {{2}} cambió de horario: ahora es el {{3}} a las {{4}}.",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
    ],
  },
];

/** Tipos que hoy admiten plantilla. */
export const TEMPLATED_KINDS: readonly WhatsAppSendKind[] = WA_TEMPLATE_SPECS.map((s) => s.kind);

export function specForKind(kind: WhatsAppSendKind): WaTemplateSpec | null {
  return WA_TEMPLATE_SPECS.find((s) => s.kind === kind) ?? null;
}

/**
 * Texto de la plantilla con sus variables sustituidas — lo que de verdad ve el
 * paciente. Se usa para dejar en el Inbox la conversación REAL: con plantilla,
 * el cuerpo enviado no es el texto libre que se habría mandado dentro de
 * ventana, y guardar ese sería enseñarle al equipo algo que nadie recibió.
 *
 * `fallback` cubre el tipo sin especificación (no debería pasar: send-mode ya
 * bloquea ese caso antes de enviar).
 */
export function renderTemplateBody(
  spec: WaTemplateSpec | null,
  params: string[],
  fallback: string,
): string {
  if (!spec) return fallback;
  return spec.body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => {
    const idx = Number(n) - 1;
    return params[idx] ?? match;
  });
}

/** Nombre válido de plantilla en Meta: minúsculas, dígitos y guion bajo. */
export function isValidTemplateName(name: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(name);
}

/** Código de idioma de Meta: "es", "es_MX", "pt_BR"… */
export function isValidTemplateLang(lang: string): boolean {
  return /^[a-z]{2}(_[A-Z]{2})?$/.test(lang);
}

/**
 * Lee `Clinic.waTemplates` (Json libre, puede traer cualquier cosa) y devuelve
 * solo las entradas bien formadas. Una entrada corrupta se DESCARTA en vez de
 * intentar enviarse: mandar a Meta un nombre inválido gasta un intento y falla
 * con un código que no explica nada.
 */
export function parseWaTemplates(raw: unknown): WaTemplateMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WaTemplateMap = {};
  for (const spec of WA_TEMPLATE_SPECS) {
    const entry = (raw as Record<string, unknown>)[spec.kind];
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as Record<string, unknown>).name;
    const lang = (entry as Record<string, unknown>).lang;
    if (typeof name !== "string" || typeof lang !== "string") continue;
    const trimmedName = name.trim();
    const trimmedLang = lang.trim();
    if (!isValidTemplateName(trimmedName) || !isValidTemplateLang(trimmedLang)) continue;
    out[spec.kind] = { name: trimmedName, lang: trimmedLang };
  }
  return out;
}
