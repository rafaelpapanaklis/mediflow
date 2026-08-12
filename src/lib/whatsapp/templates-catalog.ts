// Catálogo ÚNICO de plantillas de WhatsApp: la redacción se escribe AQUÍ una
// sola vez y DaleControl la replica dentro de la cuenta (WABA) de cada clínica.
//
// POR QUÉ EXISTE: las plantillas son POR WABA — no se comparten entre cuentas.
// Hasta ahora la pantalla de Plantillas le dictaba el texto a la clínica y le
// pedía que lo diera de alta a mano en el administrador de Meta; nadie lo hizo,
// así que `waTemplates` estaba vacío en todas y fuera de la ventana de 24 h no
// salía NINGÚN mensaje. Con este catálogo la clínica no tiene que entrar a Meta:
// nosotros creamos las plantillas en su cuenta con su propio token.
//
// PURO: sin Prisma, sin red y sin React. Lo importan el creador (servidor), la
// pantalla del panel (cliente) y los tests. Quien habla con Meta es
// `provision-templates.ts`.

import type { WhatsAppSendKind } from "./system-message";

/** Categoría de Meta. Manda en el precio y en cómo puede bloquearlas el paciente. */
export type WaTemplateCategory = "UTILITY" | "MARKETING";

/** Estado de una plantilla, ya reducido a lo que le importa a la clínica. */
export type WaTemplateStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Idioma de todas las plantillas del catálogo. */
export const WA_TEMPLATE_LANG = "es_MX";

/** Versión de la Graph API que usan las llamadas de plantillas. */
export const WA_TEMPLATES_GRAPH_VERSION = "v19.0";

export interface WaCatalogEntry {
  /** Tipo de mensaje de DaleControl al que responde esta plantilla. */
  kind: WhatsAppSendKind;
  /** Nombre con el que se da de alta en Meta (solo [a-z0-9_]). */
  name: string;
  category: WaTemplateCategory;
  /** Código de idioma de Meta. */
  lang: string;
  /** Cuerpo EXACTO, con las variables numeradas. */
  body: string;
  /** Clave i18n del nombre humano del tipo de mensaje. */
  labelKey: string;
  /** Qué es cada {{n}}, en orden. Claves i18n. */
  variableKeys: string[];
  /**
   * Valores de ejemplo para {{1}}…{{n}}. Meta EXIGE un ejemplo por variable al
   * crear la plantilla: sin él responde "example is missing" y la rechaza.
   */
  sample: string[];
  /**
   * `true` = no se crea sola. Solo la de MARKETING: cuesta más que las de
   * utilidad y el paciente puede bloquear ese tipo de mensajes, así que la
   * clínica la activa a mano sabiendo lo que activa.
   */
  optional: boolean;
}

/**
 * Las CINCO de utilidad + la de marketing.
 *
 * Reglas de Meta que respeta cada cuerpo (las verifica `checkTemplateBody`, y
 * el test las comprueba sobre todo el catálogo para que nadie las rompa al
 * cambiar una redacción):
 *   · el cuerpo no puede empezar ni terminar con una variable;
 *   · no puede llevar dos variables seguidas.
 *
 * El ORDEN de las variables es contrato con quien envía: Meta las sustituye por
 * POSICIÓN, no por nombre, así que cambiar el orden aquí sin cambiar el array
 * de `templateParams` del caller entrega el mensaje con los datos cambiados de
 * sitio. El test de send-mode cubre el desajuste de cantidad; el orden se
 * documenta en cada caller.
 */
export const WA_TEMPLATE_CATALOG: readonly WaCatalogEntry[] = [
  {
    kind: "reminder",
    name: "dc_recordatorio_cita",
    category: "UTILITY",
    lang: WA_TEMPLATE_LANG,
    body:
      "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}} con {{5}}. " +
      "Si necesitas cambiarla, respóndenos por aquí.",
    labelKey: "inbox.whatsapp.tplKindReminder",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
      "inbox.whatsapp.tplVarDoctor",
    ],
    sample: ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00", "Dra. Ana Ruiz"],
    optional: false,
  },
  {
    kind: "booking",
    name: "dc_confirmacion_cita",
    category: "UTILITY",
    lang: WA_TEMPLATE_LANG,
    body:
      "Hola {{1}}, tu cita en {{2}} quedó registrada para el {{3}} a las {{4}} con {{5}}. " +
      "Te esperamos.",
    labelKey: "inbox.whatsapp.tplKindBooking",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
      "inbox.whatsapp.tplVarDoctor",
    ],
    sample: ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00", "Dra. Ana Ruiz"],
    optional: false,
  },
  {
    kind: "appointment_change",
    name: "dc_reagendado_cita",
    category: "UTILITY",
    lang: WA_TEMPLATE_LANG,
    body:
      "Hola {{1}}, tu cita en {{2}} cambió al {{3}} a las {{4}} con {{5}}. " +
      "Si no te queda bien, escríbenos por aquí.",
    labelKey: "inbox.whatsapp.tplKindAppointmentChange",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
      "inbox.whatsapp.tplVarDoctor",
    ],
    sample: ["María", "Clínica Sonrisa", "martes 12 de agosto", "16:30", "Dra. Ana Ruiz"],
    optional: false,
  },
  {
    kind: "prescription",
    name: "dc_receta_lista",
    category: "UTILITY",
    lang: WA_TEMPLATE_LANG,
    body:
      "Hola {{1}}, {{2}} te comparte la receta de tu consulta del {{3}}. " +
      "Si tienes dudas sobre las indicaciones, escríbenos por aquí.",
    labelKey: "inbox.whatsapp.tplKindPrescription",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarConsultDate",
    ],
    sample: ["María", "Clínica Sonrisa", "8 de agosto de 2026"],
    optional: false,
  },
  {
    kind: "manual_api",
    name: "dc_mensaje_clinica",
    category: "UTILITY",
    lang: WA_TEMPLATE_LANG,
    body:
      "Hola {{1}}, te escribimos de {{2}} sobre tu cita del {{3}} a las {{4}}. " +
      "Respóndenos por aquí si necesitas algo.",
    labelKey: "inbox.whatsapp.tplKindManual",
    variableKeys: [
      "inbox.whatsapp.tplVarPatient",
      "inbox.whatsapp.tplVarClinic",
      "inbox.whatsapp.tplVarDate",
      "inbox.whatsapp.tplVarTime",
    ],
    sample: ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00"],
    optional: false,
  },
  {
    kind: "review",
    name: "dc_invitacion_resena",
    category: "MARKETING",
    lang: WA_TEMPLATE_LANG,
    body:
      "Hola {{1}}, gracias por tu visita a {{2}}. ¿Nos ayudas con una reseña? " +
      "Te toma menos de un minuto.",
    labelKey: "inbox.whatsapp.tplKindReview",
    variableKeys: ["inbox.whatsapp.tplVarPatient", "inbox.whatsapp.tplVarClinic"],
    sample: ["María", "Clínica Sonrisa"],
    optional: true,
  },
];

/** Los tipos que se crean solos al conectar (todo menos la de marketing). */
export const DEFAULT_CATALOG_KINDS: readonly WhatsAppSendKind[] = WA_TEMPLATE_CATALOG
  .filter((e) => !e.optional)
  .map((e) => e.kind);

export function catalogEntryFor(kind: WhatsAppSendKind): WaCatalogEntry | null {
  return WA_TEMPLATE_CATALOG.find((e) => e.kind === kind) ?? null;
}

/** Entrada por nombre de Meta — así llega la del webhook y la del cron. */
export function catalogEntryByName(name: string): WaCatalogEntry | null {
  const needle = (name ?? "").trim().toLowerCase();
  if (!needle) return null;
  return WA_TEMPLATE_CATALOG.find((e) => e.name === needle) ?? null;
}

/** Cuántas variables tiene un cuerpo (`{{1}}`, `{{2}}`…). Cuenta las distintas. */
export function countTemplateVariables(body: string): number {
  // Array.from y no `for…of` sobre el iterador: el target de TS del repo no
  // permite recorrer un RegExpStringIterator directamente.
  const nums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1]));
  return new Set(nums).size;
}

/** Nombre válido en Meta: minúsculas, dígitos y guion bajo. */
export function isValidTemplateName(name: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(name);
}

/** Código de idioma de Meta: "es", "es_MX", "pt_BR"… */
export function isValidTemplateLang(lang: string): boolean {
  return /^[a-z]{2}(_[A-Z]{2})?$/.test(lang);
}

/**
 * Reglas de Meta sobre el cuerpo. Devuelve el motivo del rechazo, o null si
 * pasa. Se comprueban ANTES de llamar a Meta porque un cuerpo mal formado
 * gasta una llamada y vuelve con un error genérico que no dice cuál de las
 * seis plantillas falló.
 */
export function checkTemplateBody(body: string): string | null {
  const text = (body ?? "").trim();
  if (!text) return "El cuerpo no puede estar vacío.";
  if (/^\{\{\d+\}\}/.test(text)) return "El cuerpo no puede empezar con una variable.";
  if (/\{\{\d+\}\}$/.test(text)) return "El cuerpo no puede terminar con una variable.";
  // Dos variables seguidas: entre ellas solo hay espacios (o nada).
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(text)) return "No puede haber dos variables seguidas.";
  // Numeración: {{1}}…{{n}} sin huecos. Meta rechaza un salto de índice.
  const nums = Array.from(text.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1]));
  const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) return "Las variables deben ir numeradas desde {{1}} sin saltos.";
  }
  return null;
}

/** Motivo por el que una entrada del catálogo no se puede crear, o null. */
export function checkCatalogEntry(entry: WaCatalogEntry): string | null {
  if (!isValidTemplateName(entry.name)) {
    return "El nombre solo admite minúsculas, números y guion bajo.";
  }
  if (!isValidTemplateLang(entry.lang)) return "El idioma no tiene el formato de Meta.";
  const bodyError = checkTemplateBody(entry.body);
  if (bodyError) return bodyError;
  if (entry.sample.length !== countTemplateVariables(entry.body)) {
    return "Faltan valores de ejemplo para las variables del cuerpo.";
  }
  if (entry.variableKeys.length !== countTemplateVariables(entry.body)) {
    return "La descripción de las variables no coincide con el cuerpo.";
  }
  return null;
}

/** Cuerpo del POST a `/{waba-id}/message_templates`. */
export interface TemplateCreatePayload {
  name: string;
  language: string;
  category: WaTemplateCategory;
  components: Array<{
    type: "BODY";
    text: string;
    example?: { body_text: string[][] };
  }>;
}

/**
 * Arma el alta de una plantilla tal como la pide la Graph API.
 *
 * `example.body_text` es un array de arrays a propósito: Meta espera UNA lista
 * de ejemplos por cada grupo de variables del componente, y para el body ese
 * grupo es uno solo. Sin ejemplos, una plantilla con variables no se aprueba.
 */
export function buildTemplateCreatePayload(entry: WaCatalogEntry): TemplateCreatePayload {
  const varCount = countTemplateVariables(entry.body);
  return {
    name: entry.name,
    language: entry.lang,
    category: entry.category,
    components: [
      {
        type: "BODY",
        text: entry.body,
        ...(varCount > 0 ? { example: { body_text: [entry.sample.slice(0, varCount)] } } : {}),
      },
    ],
  };
}

/**
 * Estado de Meta → el nuestro.
 *
 * Meta maneja más estados de los que la clínica necesita distinguir. Todo lo
 * que NO se puede enviar hoy pero podría volver (PENDING, IN_APPEAL) es
 * "en revisión"; todo lo que no se puede enviar y exige actuar (REJECTED,
 * PAUSED, DISABLED…) es "rechazada" con su motivo. Lo desconocido cae a
 * PENDING: es el lado seguro, porque el cron lo vuelve a consultar en vez de
 * darlo por bueno y gastar un envío que Meta rechazaría.
 */
export function mapMetaTemplateStatus(raw: string | null | undefined): WaTemplateStatus {
  const s = (raw ?? "").trim().toUpperCase();
  if (s === "APPROVED") return "APPROVED";
  if (
    s === "REJECTED" ||
    s === "PAUSED" ||
    s === "DISABLED" ||
    s === "DELETED" ||
    s === "PENDING_DELETION" ||
    s === "LIMIT_EXCEEDED" ||
    s === "FLAGGED"
  ) {
    return "REJECTED";
  }
  return "PENDING";
}

/**
 * `rejected_reason` de Meta → español. Meta manda una constante en inglés
 * (ABUSIVE_CONTENT, INVALID_FORMAT…) que no le dice nada a la clínica; lo que
 * no se reconoce se devuelve tal cual, que es más honesto que inventar un
 * motivo. Cadena vacía cuando Meta no da ninguno.
 */
export function describeRejectionReason(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s || s === "NONE") return "";
  const MAP: Record<string, string> = {
    ABUSIVE_CONTENT: "Meta considera que el contenido incumple sus políticas.",
    INCORRECT_CATEGORY: "La categoría no corresponde al contenido del mensaje.",
    INVALID_FORMAT: "El formato de la plantilla no es válido para Meta.",
    PROMOTIONAL: "Meta la considera promocional y no de utilidad.",
    SCAM: "Meta la marcó como posible fraude.",
    TAG_CONTENT_MISMATCH: "El contenido no corresponde a la etiqueta elegida.",
    NONE_OF_THE_ABOVE: "Meta la rechazó sin dar un motivo concreto.",
  };
  return MAP[s] ?? raw!.trim();
}

/** Lo que la pantalla pinta para un tipo de mensaje. */
export type WaTemplateUiState = "approved" | "pending" | "rejected" | "missing";

/**
 * Estado visible a partir de lo guardado en `waTemplates`.
 *
 * Una entrada SIN `status` es de las que la clínica registró a mano en la
 * pantalla vieja: si la escribió ahí es porque Meta ya se la había aprobado,
 * así que cuenta como aprobada. Tratarla como "en revisión" apagaría envíos
 * que hoy funcionan.
 */
export function templateUiState(
  cfg: { status?: WaTemplateStatus | null } | null | undefined,
): WaTemplateUiState {
  if (!cfg) return "missing";
  if (!cfg.status) return "approved";
  if (cfg.status === "APPROVED") return "approved";
  if (cfg.status === "REJECTED") return "rejected";
  return "pending";
}
