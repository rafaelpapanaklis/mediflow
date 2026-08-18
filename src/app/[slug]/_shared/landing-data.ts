/* ============================================================
   Lectura de los datos de landing v2 (sql/landing-v2.sql).

   Las plantillas NO deben tocar `landingPhotos` / `landingSections`
   crudos: son JSON libre que escribe el editor y que puede venir
   vacío, a medias o de una plantilla anterior. Aquí se normaliza
   una sola vez, con los mismos fallbacks para las ocho.

   Sin "use client": lo importan plantillas (cliente) y el editor.
   ============================================================ */
import type { LandingClinic } from "./types";

/** { idDeRanura: url } — vacío si la clínica todavía no subió nada. */
export function photoMap(clinic: LandingClinic): Record<string, string> {
  const raw = (clinic as any).landingPhotos;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * La foto de una ranura, con la cadena de respaldo que evita que una
 * plantilla nueva se vea vacía para quien ya tenía portada y galería:
 *   ranura → landingCoverUrl (solo "portada") → galería por índice → null
 */
export function photoOf(
  clinic: LandingClinic,
  slot: string,
  opts?: { galleryIndex?: number; cover?: boolean },
): string | null {
  const m = photoMap(clinic);
  if (m[slot]) return m[slot];
  if (opts?.cover && clinic.landingCoverUrl) return clinic.landingCoverUrl;
  const gal = clinic.landingGallery ?? [];
  if (typeof opts?.galleryIndex === "number" && gal[opts.galleryIndex]) return gal[opts.galleryIndex];
  return null;
}

/* ------------------------------------------------------------------
   `landingCopy`: el texto suelto de la plantilla (kickers, botones,
   leyendas, avisos). Mapa plano { clave: texto }, con las claves que
   declara el manifiesto de cada plantilla.

   Los textos por DEFECTO de la plantilla no viven aquí y no se escriben
   nunca: si la clínica vacía el campo, se borra la clave y vuelve a salir
   el literal real. Por eso `copyValue` devuelve null y no el default —
   quien pinta decide qué poner, y <Txt> ya sabe hacerlo.
   ------------------------------------------------------------------ */

/** { clave: texto } con lo que la clínica reescribió. Vacío si no tocó nada. */
export function copyMap(clinic: LandingClinic): Record<string, string> {
  const raw = (clinic as any).landingCopy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/**
 * Lo que escribió la clínica para esa clave, o null.
 *
 * Se le pasa a `<Txt valor={…} porDefecto="el literal real">`: null hace que
 * la plantilla pinte su propio literal, exactamente como antes de instrumentar.
 */
export function copyValue(copias: Record<string, string>, clave: string): string | null {
  const v = copias[clave];
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * El texto ya resuelto, para donde hace falta una cadena y no un nodo:
 * un `title`, un `alt`, el `aria-label` de un botón.
 */
export function copyText(copias: Record<string, string>, clave: string, porDefecto: string): string {
  return copyValue(copias, clave) ?? porDefecto;
}

/** Plazos de meses sin intereses. Vacío = la clínica no ofrece MSI. */
export function msiPlazos(clinic: LandingClinic): number[] {
  const raw = (clinic as any).landingMsiPlazos;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n: unknown) => Number(n))
    .filter((n: number) => Number.isFinite(n) && n >= 2 && n <= 60)
    .sort((a: number, b: number) => a - b);
}

/** Texto del bloque de urgencias. null = no se pinta el bloque. */
export function urgentText(clinic: LandingClinic): string | null {
  const t = (clinic as any).landingUrgentText;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export interface SectionState {
  id: string;
  visible: boolean;
  orden: number;
  titulo?: string | null;
  subtitulo?: string | null;
}

/** Lo que guardó el editor por sección, indexado por id. */
export function sectionMap(clinic: LandingClinic): Record<string, SectionState> {
  const raw = (clinic as any).landingSections;
  if (!Array.isArray(raw)) return {};
  const out: Record<string, SectionState> = {};
  raw.forEach((s: any, i: number) => {
    const id = typeof s?.id === "string" ? s.id : null;
    if (!id) return;
    out[id] = {
      id,
      visible: s?.visible !== false,
      orden: Number.isFinite(Number(s?.orden)) ? Number(s.orden) : i,
      titulo: typeof s?.titulo === "string" && s.titulo.trim() ? s.titulo.trim() : null,
      subtitulo: typeof s?.subtitulo === "string" && s.subtitulo.trim() ? s.subtitulo.trim() : null,
    };
  });
  return out;
}

/**
 * ¿Se pinta esta sección?
 *
 * Dos condiciones, y las dos mandan: que el editor no la haya apagado Y que
 * tenga datos que mostrar. Una sección encendida pero vacía deja un hueco con
 * título y nada debajo — que es exactamente lo que hay que evitar para que la
 * plantilla se vea terminada sin datos.
 */
export function showSection(
  secciones: Record<string, SectionState>,
  id: string,
  hasData: boolean,
): boolean {
  if (!hasData) return false;
  const s = secciones[id];
  return s ? s.visible : true; // sin configuración guardada: visible
}

/** El título que puso la clínica, o el que trae la plantilla por defecto. */
export function sectionTitle(
  secciones: Record<string, SectionState>,
  id: string,
  porDefecto: string,
): string {
  return secciones[id]?.titulo || porDefecto;
}

export function sectionSubtitle(
  secciones: Record<string, SectionState>,
  id: string,
  porDefecto?: string,
): string | null {
  return secciones[id]?.subtitulo || porDefecto || null;
}

/** Servicio de landing ya normalizado por normalizeServices, con desc. */
export interface LandingServiceItem {
  name: string;
  desc?: string | null;
  price?: string | null;
  durationMin?: number | null;
  icon?: string | null;
  /**
   * Posición en el array GUARDADO, no en el pintado.
   *
   * Estas listas filtran los elementos vacíos, así que el índice del map
   * de la plantilla no sirve como dirección: el editor visual escribiría
   * en el servicio equivocado. Ver @/lib/landing-address.
   */
  i: number;
}

/** landingServices tal cual lo pintan las plantillas (incluye desc). */
export function serviceList(clinic: LandingClinic): LandingServiceItem[] {
  const raw = Array.isArray(clinic.landingServices) ? clinic.landingServices : [];
  const out: LandingServiceItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    const name = typeof s?.name === "string" ? s.name.trim() : "";
    if (!name) continue;
    const dur = Number(s?.durationMin);
    out.push({
      i,
      name,
      desc: typeof s?.desc === "string" && s.desc.trim() ? s.desc.trim() : null,
      price: typeof s?.price === "string" && s.price.trim() ? s.price.trim() : null,
      durationMin: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
      icon: typeof s?.icon === "string" && s.icon.trim() ? s.icon.trim() : null,
    });
  }
  return out;
}

/** Testimonios normalizados: {name, text, rating}. `i` = posición guardada. */
export function testimonialList(clinic: LandingClinic): { i: number; name: string; text: string; rating: number; meta?: string | null }[] {
  const raw = Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : [];
  const out: { i: number; name: string; text: string; rating: number; meta?: string | null }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const text = typeof t?.text === "string" ? t.text.trim() : "";
    if (!text) continue;
    const r = Number(t?.rating);
    out.push({
      i,
      name: typeof t?.name === "string" && t.name.trim() ? t.name.trim() : "Paciente",
      text,
      rating: Number.isFinite(r) && r >= 1 && r <= 5 ? r : 5,
      meta: typeof t?.meta === "string" && t.meta.trim() ? t.meta.trim() : null,
    });
  }
  return out;
}

/** FAQs normalizadas: {q, a}. `i` = posición guardada. */
export function faqList(clinic: LandingClinic): { i: number; q: string; a: string }[] {
  const raw = Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : [];
  const out: { i: number; q: string; a: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    const q = typeof f?.q === "string" ? f.q.trim() : (typeof f?.question === "string" ? f.question.trim() : "");
    const a = typeof f?.a === "string" ? f.a.trim() : (typeof f?.answer === "string" ? f.answer.trim() : "");
    if (q && a) out.push({ i, q, a });
  }
  return out;
}

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Horario de la semana listo para pintar, con el día de hoy marcado. */
export function weekSchedule(clinic: LandingClinic): { label: string; open: string | null; hoy: boolean }[] {
  const map = new Map((clinic.schedules ?? []).map(s => [s.dayOfWeek, s]));
  // getDay(): 0=domingo … 6=sábado. El schema usa 0=lunes … 6=domingo.
  const js = new Date().getDay();
  const hoyIdx = js === 0 ? 6 : js - 1;
  return DIAS.map((label, i) => {
    const s = map.get(i);
    return {
      label,
      open: s?.enabled ? `${hhmm(s.openTime)} – ${hhmm(s.closeTime)}` : null,
      hoy: i === hoyIdx,
    };
  });
}

/** "09:00" → "9:00 am" (como lo lee un paciente, no como lo guarda la base). */
function hhmm(t: string): string {
  const [h, m] = (t ?? "").split(":").map(Number);
  if (!Number.isFinite(h)) return t;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
}
