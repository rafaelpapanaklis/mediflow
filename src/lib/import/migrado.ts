// Piezas PURAS de la importación clínica (expedientes, notas, presupuestos):
// sin Prisma y sin red, para poder probarlas solas. Los handlers viven en
// entities.ts y las usan.
//
// Una idea atraviesa todo el archivo: lo que llega de otro sistema es HISTORIA.
// Se guarda con su fecha original, se dice de dónde vino y jamás se hace pasar
// por algo que se firmó, se cotizó o se cobró en esta clínica.

import { createHash, randomBytes } from "crypto";
import { escapeHtml, sanitizeTemplateHtml } from "@/lib/document-templates/sanitize";
import { formatConsentDate } from "@/lib/consent/dates";
import { norm } from "./engine";

/** Estado de una nota o un presupuesto que llegó de otro sistema. Ni borrador ni firmado. */
export const MIGRATED_STATUS = "MIGRATED";

/** Cómo se nombra el origen cuando el asistente no dijo cuál era. */
export const ORIGEN_DESCONOCIDO = "otro sistema";

export function nombreOrigen(originName: string | null): string {
  return originName && originName.trim() ? originName.trim() : ORIGEN_DESCONOCIDO;
}

// ---------------------------------------------------------------------------
// Fechas de calendario.
// ---------------------------------------------------------------------------

/**
 * Una fecha de CALENDARIO (la de una nota o un presupuesto de otro sistema)
 * anclada al mediodía UTC. `parseDate` devuelve la medianoche LOCAL del
 * servidor, que en Vercel es UTC: formateada en America/Mexico_City (UTC-6)
 * caía el día ANTERIOR — el mismo defecto que el expediente en PDF tuvo con la
 * fecha de nacimiento. A las 12:00 UTC es el mismo día de UTC-11 a UTC+11.
 */
export function calendarNoonUtc(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0));
}

/** "2021-03-12" de una fecha ya anclada con calendarNoonUtc. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ¿La fecha cae después de hoy (con un día de margen por husos)? Una nota de otro sistema no viene del futuro. */
export function isFutureDay(d: Date, now: Date): boolean {
  return d.getTime() > now.getTime() + 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Texto.
// ---------------------------------------------------------------------------

/** Texto de una celda: recortado y con los saltos de línea normalizados. "" si no hay nada. */
export function cellText(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\r\n?/g, "\n").trim();
}

/** Una línea (sin saltos ni caracteres de control), recortada a `max`. */
export function oneLine(v: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return cellText(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/**
 * Texto plano de una nota → el HTML de la hoja. Párrafos por línea en blanco y
 * `<br>` por salto simple, con el texto ESCAPADO, y después el MISMO saneado de
 * lista blanca que la nota que se escribe en el editor (cinturón y tirantes: si
 * el export trae etiquetas, salen como texto, nunca como marcado).
 */
export function textToNoteHtml(text: string): string {
  const paragraphs = cellText(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split("\n").map((l) => escapeHtml(l.trim())).join("<br>")}</p>`);
  return sanitizeTemplateHtml(paragraphs.join(""));
}

/**
 * La huella de una nota migrada: paciente + día + texto normalizado. Es lo que
 * hace idempotente la importación: el mismo archivo subido dos veces no duplica
 * notas, y dos notas distintas del mismo día sí entran las dos.
 */
export function noteFingerprint(patientId: string, day: string, text: string): string {
  const cuerpo = cellText(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  return createHash("sha256").update(`${patientId}|${day}|${cuerpo}`).digest("hex").slice(0, 32);
}

/** Lo que una nota migrada guarda de su procedencia, dentro de `encabezado.migracion`. */
export interface MarcaMigracion {
  origen: string;
  /** Día original, "AAAA-MM-DD". */
  fechaOriginal: string;
  /** El autor tal como venía en el archivo (vacío si no venía). */
  doctorOriginal: string;
  /** Cuándo se importó (ISO) y quién. */
  importadoEl: string;
  importadoPor: string;
  archivo: string;
  huella: string;
}

/** Lee la huella de un `encabezado` guardado (o null si no es una nota migrada). */
export function huellaDe(encabezado: unknown): string | null {
  const o = encabezado && typeof encabezado === "object" ? (encabezado as Record<string, unknown>) : null;
  const m = o?.migracion && typeof o.migracion === "object" ? (o.migracion as Record<string, unknown>) : null;
  return m && typeof m.huella === "string" ? m.huella : null;
}

/**
 * El párrafo con el que ABRE toda nota migrada. Es lo primero que se lee en la
 * pantalla, en el PDF suelto y en cualquier copia: de dónde viene, de cuándo es,
 * quién la escribió allí y que aquí no la firmó nadie.
 */
export function migrationBannerHtml(args: {
  origen: string;
  fecha: Date;
  timezone: string;
  doctor: string;
  importadoEl: Date;
}): string {
  const fecha = formatConsentDate(args.fecha, "UTC"); // día de calendario: ya viene anclado
  const importado = formatConsentDate(args.importadoEl, args.timezone);
  const autor = args.doctor ? ` por ${escapeHtml(args.doctor)}` : "";
  return (
    `<p><b>Nota migrada de ${escapeHtml(args.origen)}.</b> ` +
    `Escrita el ${escapeHtml(fecha)}${autor} en el sistema anterior e importada el ${escapeHtml(importado)}. ` +
    `No se firmó en esta clínica: se conserva tal como venía.</p>`
  );
}

/** "Evolución · migrada de Dentalink", sin pasarse del tope del título. */
export function migratedTitle(title: string, origen: string, max: number, genero: "a" | "o"): string {
  const sufijo = ` · migrad${genero} de ${origen}`;
  const base = title.slice(0, Math.max(1, max - sufijo.length)).trim();
  return `${base}${sufijo}`.slice(0, max);
}

// ---------------------------------------------------------------------------
// Listas de antecedentes (alergias, padecimientos, medicamentos).
// ---------------------------------------------------------------------------

/**
 * "Penicilina; Látex, Nueces" → ["Penicilina", "Látex", "Nueces"]. La coma entre
 * dígitos NO separa: "Losartán 0,5 mg" es un medicamento, no dos.
 */
export function splitList(v: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of cellText(v).split(/[;|\n•]+|(?<!\d),|,(?!\d)/)) {
    const item = oneLine(part, 200);
    const key = norm(item);
    if (!item || !key || seen.has(key)) continue;
    // "Ninguna", "Niega alergias", "Sin antecedentes", "N/A": el otro sistema
    // dice que NO hay; guardarlo como una alergia más sería decir lo contrario.
    if (SIN_ANTECEDENTE.has(key) || NEGACION.test(sinAcentos(item))) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sinAcentos(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/** Frases que NIEGAN el antecedente: "niega…", "sin…", "negada(s)", "ninguna conocida", "no refiere…". */
const NEGACION = /^(niega|negad[oa]s?\b|negativ[oa]s?\b|sin\b|ningun[oa]?s?\b|no\s+(refiere|presenta|conocid|tiene|aplica|hay))/;

const SIN_ANTECEDENTE = new Set([
  "ninguna", "ninguno", "ningunas", "ningunos", "niega", "negado", "negada", "negativo", "negativa",
  "no", "na", "n/a", "noaplica", "sindatos", "sd", "none", "-", "—", ".",
]);

/** Suma listas sin repetir (sin distinguir mayúsculas ni acentos). Devuelve lo nuevo. */
export function mergeList(existing: string[], incoming: string[]): { merged: string[]; added: string[] } {
  const keys = new Set(existing.map(norm));
  const merged = [...existing];
  const added: string[] = [];
  for (const item of incoming) {
    const k = norm(item);
    if (keys.has(k)) continue;
    keys.add(k);
    merged.push(item);
    added.push(item);
  }
  return { merged, added };
}

/**
 * Añade un texto libre (antecedentes) sin pisar lo que la clínica ya capturó:
 * si ya está contenido, no cambia nada; si hay algo distinto, se agrega debajo.
 */
export function mergeText(existing: string | null, incoming: string): { value: string | null; changed: boolean } {
  const nuevo = cellText(incoming);
  if (!nuevo) return { value: existing, changed: false };
  const actual = cellText(existing ?? "");
  if (!actual) return { value: nuevo, changed: true };
  const plano = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  if (plano(actual).includes(plano(nuevo))) return { value: existing, changed: false };
  return { value: `${actual}\n\n${nuevo}`, changed: true };
}

// ---------------------------------------------------------------------------
// Presupuestos.
// ---------------------------------------------------------------------------

/** Dientes FDI "11, 12 y 21" → "11,12,21" (mismo criterio que el editor de presupuestos). */
export function sanitizeFdi(v: unknown): string | null {
  const s = cellText(v);
  if (!s) return null;
  const teeth = s
    .split(/[^0-9]+/)
    .filter((x) => /^\d{1,2}$/.test(x))
    .slice(0, 32);
  return teeth.length ? teeth.join(",") : null;
}

const FOLIO_ORIGINAL = "Folio original: ";

/**
 * Las notas con las que queda un presupuesto migrado. La primera línea dice que
 * es historia; la del folio original es la que se vuelve a leer (folioDeNotas)
 * para no duplicarlo al subir el mismo archivo otra vez.
 */
export function migratedQuoteNotes(args: {
  origen: string;
  importadoEl: Date;
  timezone: string;
  folio: string;
  estado: string;
  doctor: string;
}): string {
  const lineas = [
    `Presupuesto migrado de ${args.origen} el ${formatConsentDate(args.importadoEl, args.timezone)}. ` +
      `Es historia del paciente: no genera factura, cobro ni movimiento de caja.`,
  ];
  if (args.folio) lineas.push(`${FOLIO_ORIGINAL}${args.folio}`);
  if (args.estado) lineas.push(`Estado en el sistema anterior: ${args.estado}`);
  if (args.doctor) lineas.push(`Doctor: ${args.doctor}`);
  return lineas.join("\n");
}

/** El folio original de un presupuesto migrado, leído de sus notas (o null). */
export function folioDeNotas(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const line of notes.split("\n")) {
    if (line.startsWith(FOLIO_ORIGINAL)) return line.slice(FOLIO_ORIGINAL.length).trim() || null;
  }
  return null;
}

/** Id con la forma de los cuid de Prisma (c + 24 minúsculas/dígitos), para insertar cabecera y líneas en lote. */
export function newId(): string {
  const bytes = randomBytes(24);
  let s = "c";
  for (let i = 0; i < 24; i++) s += "0123456789abcdefghijklmnopqrstuvwxyz"[bytes[i] % 36];
  return s;
}
