// ═══════════════════════════════════════════════════════════════════════════
// Manager de cuenta — helpers del ADMIN (server-only).
//
// Validación del payload del catálogo + mapeo a la fila que consume /admin.
// Vive aparte de types.ts (que es isomorfo) porque aquí sí asumimos servidor.
// ═══════════════════════════════════════════════════════════════════════════

import {
  ACCOUNT_MANAGER_STATUSES,
  formatWhatsappDisplay,
  toWhatsappE164,
  type AccountManagerAdminRow,
} from "./types";

/** Payload validado y normalizado, listo para Prisma. */
export interface AccountManagerInput {
  name: string;
  photoUrl: string | null;
  whatsappE164: string;
  whatsappDisplay: string;
  days: number[];
  startMinutes: number;
  endMinutes: number;
  timezone: string;
  status: string;
}

const MAX_NAME = 80;
const MINUTES_PER_DAY = 24 * 60;

function asInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

/**
 * Sólo http(s). Bloquea `javascript:` y `data:` — la URL termina en el `src`
 * de un <img> que ven las clínicas.
 */
function safePhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const raw = value.trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return raw.slice(0, 2048);
  } catch {
    return null;
  }
}

/**
 * Valida el cuerpo de crear/editar un manager.
 *
 * `partial` = true (PATCH): sólo valida los campos presentes y devuelve un
 * parcial. Devuelve { error } con un mensaje en español si algo no cuadra.
 */
export function parseAccountManagerInput(
  body: unknown,
  partial: boolean,
): { data: Partial<AccountManagerInput> } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<AccountManagerInput> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

  // ── name ────────────────────────────────────────────────────────────────
  if (!partial || has("name")) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { error: "El nombre es obligatorio." };
    if (name.length > MAX_NAME) return { error: `El nombre no puede pasar de ${MAX_NAME} caracteres.` };
    out.name = name;
  }

  // ── whatsapp ────────────────────────────────────────────────────────────
  // Se guarda E.164 SIN "+": 10 dígitos nacionales + prefijo 52.
  if (!partial || has("whatsapp") || has("whatsappE164")) {
    const raw = typeof b.whatsapp === "string" ? b.whatsapp : (b.whatsappE164 as string) ?? "";
    const e164 = toWhatsappE164(String(raw ?? ""));
    if (!e164) return { error: "El WhatsApp debe tener exactamente 10 dígitos (prefijo +52)." };
    out.whatsappE164 = e164;
    const display = typeof b.whatsappDisplay === "string" ? b.whatsappDisplay.trim() : "";
    out.whatsappDisplay = display || formatWhatsappDisplay(e164);
  }

  // ── días ────────────────────────────────────────────────────────────────
  if (!partial || has("days")) {
    if (!Array.isArray(b.days)) return { error: "Selecciona al menos un día de atención." };
    const seen = new Set<number>();
    for (const raw of b.days) {
      const n = asInt(raw);
      if (n === null || n < 0 || n > 6) return { error: "Hay un día inválido en el horario." };
      seen.add(n);
    }
    // TS target < es2015: Array.from, nada de spread sobre Set.
    const days = Array.from(seen).sort((x, y) => x - y);
    if (days.length === 0) return { error: "Selecciona al menos un día de atención." };
    out.days = days;
  }

  // ── horario ─────────────────────────────────────────────────────────────
  if (!partial || has("startMinutes") || has("endMinutes")) {
    const start = asInt(b.startMinutes);
    const end = asInt(b.endMinutes);
    if (start === null || end === null) return { error: "El horario es obligatorio." };
    if (start < 0 || start >= MINUTES_PER_DAY || end <= 0 || end > MINUTES_PER_DAY) {
      return { error: "El horario está fuera de rango." };
    }
    if (end <= start) return { error: "La hora de cierre debe ser posterior a la de apertura." };
    out.startMinutes = start;
    out.endMinutes = end;
  }

  // ── timezone ────────────────────────────────────────────────────────────
  if (has("timezone")) {
    const tz = typeof b.timezone === "string" ? b.timezone.trim() : "";
    if (tz) {
      try {
        // Validación real: Intl lanza RangeError si la zona no existe.
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
      } catch {
        return { error: "La zona horaria no es válida." };
      }
      out.timezone = tz;
    }
  }

  // ── status ──────────────────────────────────────────────────────────────
  if (has("status")) {
    const status = typeof b.status === "string" ? b.status : "";
    if (!(ACCOUNT_MANAGER_STATUSES as readonly string[]).includes(status)) {
      return { error: "El estado debe ser 'active' o 'paused'." };
    }
    out.status = status;
  }

  // ── foto ────────────────────────────────────────────────────────────────
  if (has("photoUrl")) {
    // "" borra la foto → vuelve al respaldo de iniciales.
    out.photoUrl = b.photoUrl === null || b.photoUrl === "" ? null : safePhotoUrl(b.photoUrl);
    if (b.photoUrl && out.photoUrl === null) {
      return { error: "La URL de la foto debe empezar con http:// o https://." };
    }
  }

  return { data: out };
}

/** Fila de BD (+ _count) → fila del catálogo de /admin. */
export function toAdminRow(m: {
  id: string;
  name: string;
  photoUrl: string | null;
  whatsappE164: string;
  whatsappDisplay: string | null;
  days: number[];
  startMinutes: number;
  endMinutes: number;
  timezone: string;
  status: string;
  createdAt: Date;
  _count?: { clinics: number };
}): AccountManagerAdminRow {
  return {
    id: m.id,
    name: m.name,
    photoUrl: m.photoUrl ?? null,
    whatsappE164: m.whatsappE164,
    whatsappDisplay: m.whatsappDisplay || formatWhatsappDisplay(m.whatsappE164),
    days: m.days,
    startMinutes: m.startMinutes,
    endMinutes: m.endMinutes,
    timezone: m.timezone,
    status: m.status,
    clinicCount: m._count?.clinics ?? 0,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Mensaje para el 503 cuando la tabla todavía no existe. El admin tiene que
 * poder distinguir "no hay managers" de "falta correr el SQL".
 */
export const SQL_PENDING_MESSAGE =
  "Falta aplicar sql/account-managers.sql en Supabase para usar los managers de cuenta.";
