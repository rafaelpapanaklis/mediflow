// Orthodontics rediseño — helpers de formato (ES MX, sin emojis).
//
// ws1-t6: un INSTANTE (la hora de una cita, cuándo entró el paciente) se pinta en la zona de la CLÍNICA, no en la
// del navegador: quien abre la ficha desde otra zona veía «11:00 a.m.» en una cita de las 10:00 (la Agenda y Caja
// ya usaban la de la clínica). Estos helpers se usan en decenas de pantallas, así que la zona se fija UNA vez
// (`fijarZonaDeLaClinica`, la pestaña de Ortodoncia lo hace al montarse) en vez de pasarla por cada componente.
// Sin zona fijada (o inválida) se comportan como siempre.

let zonaDeLaClinica: string | undefined;

/** Fija (o, con `null`, quita) la zona de la clínica para los formateadores de esta pestaña. Solo en el cliente. */
export function fijarZonaDeLaClinica(zona: string | null | undefined): void {
  if (!zona) {
    zonaDeLaClinica = undefined;
    return;
  }
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: zona });
    zonaDeLaClinica = zona;
  } catch {
    zonaDeLaClinica = undefined;
  }
}

function zona(): { timeZone?: string } {
  return zonaDeLaClinica ? { timeZone: zonaDeLaClinica } : {};
}

/** Un día de calendario suelto («2026-10-05», sin hora): no tiene zona, es ese día en cualquier sitio. */
const SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;
function comoInstante(iso: string | Date): { d: Date; opciones: { timeZone?: string } } {
  if (typeof iso === "string") {
    return { d: new Date(iso), opciones: SOLO_DIA.test(iso) ? { timeZone: "UTC" } : zona() };
  }
  return { d: iso, opciones: zona() };
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("es-MX")}`;
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const { d, opciones } = comoInstante(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opciones,
  });
}

export function fmtDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const { d, opciones } = comoInstante(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", ...opciones });
}

/**
 * Un DÍA de calendario («2026-10-05», p. ej. el vencimiento de una
 * mensualidad) sin pasar por la zona horaria: `new Date("2026-10-05")` es
 * medianoche UTC y en México se pintaba como el 4 de octubre.
 *
 * H8 (QA ws1-t9): `installedAt`/`estimatedEndDate` y otros campos que en el
 * schema son `DateTime` pero solo capturan un DÍA (un `<input type="date">`
 * convertido con `new Date(v).toISOString()`) llegan aquí como
 * "2026-07-28T00:00:00.000Z", no como "2026-07-28" a secas. El regex toma
 * solo el PREFIJO Y-M-D e ignora la hora: la colocación del 28-jul ya no
 * sale como "27 jul".
 */
function diaLocalSeguro(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtDay(day: string | null | undefined): string {
  if (!day) return "—";
  const d = diaLocalSeguro(day);
  if (!d) return fmtDateShort(day);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/** Como `fmtDay`, pero con el año — para fechas de calendario que se
 * muestran lejos unas de otras (Inicio / Fin estimado del caso). */
export function fmtDayLong(day: string | null | undefined): string {
  if (!day) return "—";
  const d = diaLocalSeguro(day);
  if (!d) return fmtDate(day);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const { d, opciones } = comoInstante(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", ...opciones });
}

/** «martes, 6 de octubre, 10:00 a.m.»: día y hora de una cita, en la zona de la clínica. */
export function fmtFechaHoraLarga(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const { d, opciones } = comoInstante(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...opciones });
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}

export function fmtMm(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} mm`;
}

export function avatarInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function clinicalSeverityColor(pct: number): "emerald" | "amber" | "rose" {
  if (pct < 20) return "emerald";
  if (pct < 30) return "amber";
  return "rose";
}
