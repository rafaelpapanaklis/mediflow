/**
 * Asistente IA Clínico — reglas PURAS del historial de conversaciones.
 *
 * Aquí no se importa Prisma ni nada de servidor: son los límites, los
 * saneadores y los normalizadores que comparten la API, la migración desde
 * localStorage y los tests. Todo lo que toque la base vive en
 * `./conversations.ts`.
 */

/** Secciones de la barra lateral. El orden es el que se pinta. */
export const AI_CONVERSATION_GROUPS = ["clinico", "admin", "pacientes"] as const;
export type AiConversationGroup = (typeof AI_CONVERSATION_GROUPS)[number];

export const AI_DEFAULT_GROUP: AiConversationGroup = "clinico";

/** Roles válidos de un turno. */
export const AI_MESSAGE_ROLES = ["user", "assistant"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

// ── Límites ────────────────────────────────────────────────────────────
// No son cosmética: son el techo del payload que un cliente puede escribir en
// la base. Sin ellos, el historial es un cubo de basura sin fondo con el que
// cualquiera puede llenar el disco de la clínica.

/** Título derivado del primer mensaje (lo que la UI ya hacía: 60 chars). */
export const AI_TITLE_DERIVED_MAX = 60;
/** Título escrito a mano al renombrar. */
export const AI_TITLE_MAX = 120;
/** Un turno: ni el más largo de Claude se acerca a esto. */
export const AI_MESSAGE_MAX_CHARS = 20_000;
/** Conversaciones que devuelve el listado de la barra lateral. */
export const AI_LIST_MAX = 200;
/** Turnos que devuelve la lectura de UNA conversación. */
export const AI_MESSAGES_MAX = 500;
/** Turnos que se aceptan de golpe en un POST de mensajes. */
export const AI_APPEND_MAX = 10;
/** Techo de la migración de una sola vez desde localStorage. */
export const AI_MIGRATION_MAX_CONVERSATIONS = 100;
export const AI_MIGRATION_MAX_MESSAGES = 200;

/**
 * Recorta un título a su máximo, colapsando espacios. Devuelve `null` si no
 * queda nada: el caller decide el fallback (la API rechaza, la migración
 * inventa uno del primer mensaje).
 */
export function normalizeTitle(raw: unknown, max = AI_TITLE_MAX): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

/** Título derivado del primer mensaje, con el mismo corte que usaba la UI. */
export function titleFromMessage(text: string): string {
  return normalizeTitle(text, AI_TITLE_DERIVED_MAX) ?? "Conversación";
}

export function isGroup(value: unknown): value is AiConversationGroup {
  return typeof value === "string" && (AI_CONVERSATION_GROUPS as readonly string[]).includes(value);
}

/** Grupo válido o el default. Un grupo desconocido NO rompe: cae en clinico. */
export function normalizeGroup(raw: unknown): AiConversationGroup {
  return isGroup(raw) ? raw : AI_DEFAULT_GROUP;
}

export function isRole(value: unknown): value is AiMessageRole {
  return typeof value === "string" && (AI_MESSAGE_ROLES as readonly string[]).includes(value);
}

/**
 * Contenido de un turno, recortado al máximo. Devuelve `null` si está vacío
 * tras recortar — un turno sin texto no se guarda.
 *
 * NO colapsa espacios: el markdown de una nota SOAP depende de sus saltos de
 * línea. Solo se quitan los extremos.
 */
export function normalizeContent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AI_MESSAGE_MAX_CHARS);
}

/**
 * Limpia el término de búsqueda ANTES de metérselo a `contains` de Prisma.
 *
 * `contains` pasa el texto tal cual al ILIKE de Postgres: no escapa `%` ni `_`
 * ni `\`. Aquí el daño es menor que en otros buscadores (el where ya está
 * clavado a clinicId + userId, así que un `%` solo volcaría el historial de
 * quien busca), pero se limpia igual porque es la regla de la casa y porque
 * un `_` suelto devolvería resultados que nadie pidió.
 *
 * Devuelve `null` cuando no queda término útil → el caller lista sin filtro.
 */
export function sanitizeSearchTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 120) : null;
}

/** Entero dentro de [min, max]; cualquier basura cae en `fallback`. */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Reparte N elementos en tandas de `size`.
 *
 * Existe por el pooler: más de ~7 consultas en el mismo `Promise.all` lo
 * saturan y empiezan los timeouts. La migración puede traer 100 conversaciones
 * y se escriben de 5 en 5.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk(size) debe ser >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
