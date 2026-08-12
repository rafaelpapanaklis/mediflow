// Plantillas aprobadas de WhatsApp, por clínica (M-09 — el P0 de la auditoría).
//
// EL PROBLEMA: Meta solo deja mandar texto libre dentro de las 24 h siguientes
// al último mensaje DEL PACIENTE. Fuera de esa ventana exige una plantilla
// aprobada, y todo lo que DaleControl enviaba solo —recordatorios de cita,
// confirmaciones, reagendados— salía como texto libre. O sea: al paciente que
// nunca le había escrito a la clínica NO le llegaba nada, Meta respondía 131047
// y el panel lo pintaba como "Enviado".
//
// QUIÉN DA DE ALTA LAS PLANTILLAS: la cuenta de WhatsApp (WABA) es de cada
// clínica y Meta le cobra a ELLA cada plantilla, pero DaleControl sí puede
// crearlas DENTRO de su cuenta usando el token que la clínica nos dio al
// conectar. Eso es lo que hace `provision-templates.ts` con la redacción de
// `templates-catalog.ts`. Este archivo se queda con lo que sabe la clínica de
// esas plantillas: nombre, idioma y en qué estado las tiene Meta.
//
// PURO: sin Prisma ni React. Lo importan el helper de envío (servidor) y la
// pantalla de configuración (cliente).

import type { WhatsAppSendKind } from "./system-message";
import {
  WA_TEMPLATE_CATALOG,
  isValidTemplateLang,
  isValidTemplateName,
  type WaCatalogEntry,
  type WaTemplateStatus,
} from "./templates-catalog";

export { isValidTemplateLang, isValidTemplateName };
export type { WaTemplateStatus };

/** Plantilla registrada por la clínica para un tipo de mensaje. */
export interface WaTemplateConfig {
  /** Nombre EXACTO con el que Meta la aprobó (minúsculas y guiones bajos). */
  name: string;
  /** Código de idioma de Meta: "es_MX", "es", "en_US"… */
  lang: string;
  /**
   * En qué estado la tiene Meta. AUSENTE = aprobada: las entradas sin estado
   * son las que la clínica escribió a mano en la pantalla vieja, y si las
   * escribió ahí era porque ya se las habían aprobado.
   */
  status?: WaTemplateStatus;
  /** Motivo de Meta cuando la rechaza (o por qué no se pudo crear). */
  reason?: string;
  /** Id de la plantilla en Meta: identifica la fila en el webhook y el cron. */
  metaId?: string;
  /** Cuándo se actualizó este registro (ISO). Lo usa el cron de respaldo. */
  updatedAt?: string;
}

/** Mapa que se guarda en `Clinic.waTemplates`. */
export type WaTemplateMap = Partial<Record<WhatsAppSendKind, WaTemplateConfig>>;

/**
 * Especificación de la plantilla de cada tipo de mensaje.
 *
 * Es EL CATÁLOGO: una sola redacción para todas las clínicas. Se mantiene el
 * nombre `WA_TEMPLATE_SPECS` porque lo usan la pantalla, el guardado manual y
 * los comentarios de los envíos; la fuente está en `templates-catalog.ts`.
 *
 * El texto lo fija DaleControl, no la clínica: al enviar mandamos los valores
 * de {{1}}…{{n}} POSICIONALMENTE, así que una plantilla con otro número de
 * variables o en otro orden hace que Meta rechace con 132000 o que el mensaje
 * llegue con los datos cambiados de sitio.
 */
export type WaTemplateSpec = WaCatalogEntry;
export const WA_TEMPLATE_SPECS: readonly WaTemplateSpec[] = WA_TEMPLATE_CATALOG;

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

/**
 * Lee `Clinic.waTemplates` (Json libre, puede traer cualquier cosa) y devuelve
 * solo las entradas bien formadas. Una entrada corrupta se DESCARTA en vez de
 * intentar enviarse: mandar a Meta un nombre inválido gasta un intento y falla
 * con un código que no explica nada.
 *
 * El estado se conserva tal cual salvo que sea basura, en cuyo caso se deja sin
 * estado (= aprobada, el comportamiento de las entradas manuales de siempre).
 */
export function parseWaTemplates(raw: unknown): WaTemplateMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WaTemplateMap = {};
  for (const spec of WA_TEMPLATE_SPECS) {
    const entry = (raw as Record<string, unknown>)[spec.kind];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = row.name;
    const lang = row.lang;
    if (typeof name !== "string" || typeof lang !== "string") continue;
    const trimmedName = name.trim();
    const trimmedLang = lang.trim();
    if (!isValidTemplateName(trimmedName) || !isValidTemplateLang(trimmedLang)) continue;

    const cfg: WaTemplateConfig = { name: trimmedName, lang: trimmedLang };
    if (row.status === "PENDING" || row.status === "APPROVED" || row.status === "REJECTED") {
      cfg.status = row.status;
    }
    if (typeof row.reason === "string" && row.reason.trim() !== "") {
      cfg.reason = row.reason.trim().slice(0, 500);
    }
    if (typeof row.metaId === "string" && row.metaId.trim() !== "") {
      cfg.metaId = row.metaId.trim();
    }
    if (typeof row.updatedAt === "string" && row.updatedAt.trim() !== "") {
      cfg.updatedAt = row.updatedAt.trim();
    }
    out[spec.kind] = cfg;
  }
  return out;
}
