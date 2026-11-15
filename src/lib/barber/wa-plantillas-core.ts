/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — plantillas de WhatsApp: qué se le ENSEÑA a la
   barbería del estado y de los fallos que manda Meta. PURO (sin red ni
   base), client-safe. Pruebas: src/lib/barber/__tests__/wa-plantillas.test.ts.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Motivos de rechazo que Meta documenta para `rejected_reason`
 * (Message Template API reference, consultada el 15-nov-2026). Cada uno
 * tiene su texto en barber.whatsapp.templates.rejected.<CÓDIGO>; el resto
 * cae en «other».
 */
export const BARBER_TEMPLATE_REJECTION_CODES = [
  "ABUSIVE_CONTENT",
  "CATEGORY_NOT_AVAILABLE",
  "INCORRECT_CATEGORY",
  "INVALID_FORMAT",
  "PROMOTIONAL",
  "SCAM",
  "TAG_CONTENT_MISMATCH",
  "NONE_OF_THE_ABOVE",
] as const;

/**
 * El motivo de rechazo que SÍ hay que enseñar, o null.
 *
 * Meta manda `rejected_reason: "NONE"` cuando NO hay rechazo (también en las
 * que están en revisión o aprobadas). En producción se pintaba «NONE» en
 * rojo bajo cada plantilla «En revisión» (15-nov-2026). Solo una plantilla
 * RECHAZADA con un motivo real lleva motivo.
 */
export function barberTemplateRejection(status: string | null | undefined, raw: unknown): string | null {
  if (String(status ?? "").toUpperCase() !== "REJECTED") return null;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!code || code === "NONE") return null;
  return code;
}

/** La llave de texto para un motivo (ya filtrado con barberTemplateRejection). */
export function barberTemplateRejectionKey(code: string): string {
  return (BARBER_TEMPLATE_REJECTION_CODES as readonly string[]).includes(code)
    ? `templates.rejected.${code}`
    : "templates.rejected.other";
}

// ── Cuando Meta NO deja dar de alta una plantilla ───────────────────────

/**
 * Lo que devuelve Meta al rechazar `POST /{waba}/message_templates`. El
 * `message` suele ser genérico («Invalid parameter»); lo que de verdad dice
 * por qué está en `error_user_title` / `error_user_msg`. Antes solo se
 * guardaba el `message`, y la pantalla ni eso enseñaba: solo el nombre.
 */
export interface BarberTemplateFailure {
  name: string;
  /** Categoría de la plantilla (UTILITY, AUTHENTICATION…). */
  category?: string | null;
  code?: number | null;
  subcode?: number | null;
  message?: string | null;
  userTitle?: string | null;
  userMsg?: string | null;
  /** true = ni siquiera hubo respuesta de Meta (red / tiempo). */
  network?: boolean;
  /**
   * Meta dijo «ya existe» y se buscó por nombre: «hidden» = no la lista (se
   * está borrando); «notUsable» = está, pero en un estado o idioma que no
   * sirve (foundStatus / foundLanguage dicen cuál).
   */
  taken?: "hidden" | "notUsable";
  foundStatus?: string | null;
  foundLanguage?: string | null;
}

/** Lee el error de Meta tal cual viene en el JSON. Nunca lanza. */
export function readBarberTemplateFailure(
  name: string,
  category: string | null,
  json: unknown,
): BarberTemplateFailure {
  const e = (json as { error?: Record<string, unknown> } | null)?.error ?? {};
  const num = (v: unknown) =>
    typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 400) : null);
  return {
    name,
    category,
    code: num(e.code),
    subcode: num(e.error_subcode),
    message: str(e.message),
    userTitle: str(e.error_user_title),
    userMsg: str(e.error_user_msg),
  };
}

export type BarberTemplateFailureKey =
  | "token"
  | "permission"
  | "rateLimit"
  | "deleting"
  | "authNotAccepted"
  | "nameHidden"
  | "notUsable"
  | "invalid"
  | "network"
  | "other";

/**
 * Qué decirle a la barbería (llave bajo barber.whatsapp.templates.failure.*)
 * y el texto CRUDO de Meta para enseñarlo en pequeño. El crudo nunca lleva
 * el token: sale solo de los campos de error de Meta.
 */
export function explainBarberTemplateFailure(f: BarberTemplateFailure): {
  key: BarberTemplateFailureKey;
  raw: string;
} {
  const rawParts = [f.userTitle, f.userMsg, f.message].filter((x): x is string => !!x);
  const unique = rawParts.filter((x, i) => rawParts.indexOf(x) === i);
  const codes = [f.code != null ? `#${f.code}` : null, f.subcode != null ? `sub ${f.subcode}` : null]
    .filter(Boolean)
    .join(" · ");
  const raw = [unique.join(" — "), codes ? `(${codes})` : ""].filter(Boolean).join(" ");
  const text = unique.join(" ").toLowerCase();

  if (f.network) return { key: "network", raw: raw || "sin respuesta de Meta" };
  if (f.taken === "hidden") return { key: "nameHidden", raw };
  if (f.taken === "notUsable") {
    const where = [f.foundStatus, f.foundLanguage].filter(Boolean).join(" · ");
    return { key: "notUsable", raw: [where ? `Meta: ${where}` : "", raw].filter(Boolean).join(" — ") };
  }
  if (f.code === 190) return { key: "token", raw };
  if (f.code === 10 || f.code === 200 || f.code === 294 || (f.code !== null && f.code !== undefined && f.code >= 200 && f.code <= 299)) {
    return { key: "permission", raw };
  }
  if (f.code === 4 || f.code === 17 || f.code === 32 || f.code === 613 || f.code === 80008 || f.code === 130429) {
    return { key: "rateLimit", raw };
  }
  if (/being deleted|se est[aá] (eliminando|borrando)|deleted.*(4|four) weeks/.test(text)) {
    return { key: "deleting", raw };
  }
  if (String(f.category ?? "").toUpperCase() === "AUTHENTICATION") return { key: "authNotAccepted", raw };
  if (f.code === 100) return { key: "invalid", raw };
  return { key: "other", raw };
}

// ── «Ya existe» en el alta pero «Sin dar de alta» en la lista ───────────

/** Una plantilla tal como la lista Meta (GET /{waba}/message_templates). */
export interface MetaTemplateRow {
  name: string;
  status: string;
  language?: string | null;
  rejectedReason?: string | null;
}

/** Estados con los que la plantilla SÍ se puede mandar (o pronto podrá). */
const USABLE_STATUSES = new Set(["APPROVED", "PENDING"]);

/**
 * Estados de Meta con texto propio en la pantalla. Cualquier otro se
 * enseña tal cual (y se trata como «no se puede usar»).
 */
export const BARBER_TEMPLATE_KNOWN_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "MISSING",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "PENDING_DELETION",
  "DELETED",
  "ARCHIVED",
  "LIMIT_EXCEEDED",
] as const;

/**
 * De todas las filas de Meta con ESE nombre, la que cuenta: la del idioma
 * con el que mandamos (es_MX); si solo existe en otro idioma, esa, marcada.
 * null = Meta no la lista.
 */
export function pickBarberTemplateRow(
  rows: MetaTemplateRow[],
  name: string,
  lang: string,
): { status: string; reason: string | null; language: string | null; otherLanguage: boolean } | null {
  const same = rows.filter((r) => r.name === name);
  if (same.length === 0) return null;
  const exact = same.find((r) => (r.language ?? "") === lang);
  const row = exact ?? same[0];
  const status = String(row.status ?? "PENDING").toUpperCase();
  return {
    status,
    reason: barberTemplateRejection(status, row.rejectedReason),
    language: row.language ?? null,
    otherLanguage: !exact && !!row.language,
  };
}

/** ¿Con esta plantilla se puede mandar? (aprobada, o en revisión) */
export function barberTemplateUsable(t: { status: string; otherLanguage?: boolean }): boolean {
  return USABLE_STATUSES.has(String(t.status).toUpperCase()) && !t.otherLanguage;
}

/**
 * ¿Lo que contestó Meta al dar de alta quiere decir «ese nombre ya está
 * ocupado»? El `code` es 100 y lo que distingue va en el SUBCÓDIGO (2388023 /
 * 2388024) o en el texto (error_user_title / error_user_msg). Antes se
 * miraba `code === 2388023`, que nunca pasa, y el texto de `message`.
 */
export function isBarberTemplateNameTaken(f: BarberTemplateFailure): boolean {
  if (f.subcode === 2388023 || f.subcode === 2388024 || f.code === 2388023 || f.code === 2388024) return true;
  const text = [f.message, f.userTitle, f.userMsg].filter(Boolean).join(" ").toLowerCase();
  return /already exists|ya existe|being deleted|se est[aá] (eliminando|borrando)/.test(text);
}

/**
 * Meta dijo «ya existe»: con lo que se encontró al buscarla POR NOMBRE, ¿qué
 * se hace? Nunca un «ya existe» silencioso que deje la plantilla faltante.
 *   ok          → está y se puede usar: no hay nada que avisar (la lista la
 *                 enseña con su estado real).
 *   notUsable   → está, pero en un estado o idioma que no sirve: se avisa.
 *   hidden      → Meta dice que existe pero no la lista (casi siempre: se
 *                 está borrando y el nombre queda bloqueado semanas): se avisa.
 */
export function decideBarberTemplateNameTaken(
  found: { status: string; otherLanguage: boolean } | null,
): "ok" | "notUsable" | "hidden" {
  if (!found) return "hidden";
  return barberTemplateUsable(found) ? "ok" : "notUsable";
}
