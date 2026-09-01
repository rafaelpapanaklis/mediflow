import { doctorColorFor, doctorInitials, readableTextOn } from "./doctor-color";
import type {
  AgendaAppointmentDTO,
  AgendaColumnMode,
  AgendaViewMode,
  DoctorColumnDTO,
} from "./types";

/**
 * Leyenda de color por doctor — lógica PURA (sin React ni DOM).
 *
 * El rediseño de la card pinta al doctor como SUPERFICIE (banda + tinte +
 * chip de iniciales). En vista Día + Doctores eso se explica solo: cada
 * columna trae el nombre arriba. En Semana (columnas = días) y en
 * Día + Sillones (columnas = sillones) no hay nada que diga de quién es
 * cada color: hacen falta la leyenda y su lista.
 *
 * Este módulo NO resuelve colores por su cuenta —todo sale de
 * `doctor-color.ts`, la misma fuente de la card y de la cabecera de
 * columna— ni mantiene una lista propia de doctores: la arma con
 * `state.doctors` + las citas ya cargadas.
 */

/** Alto/ancho: separación entre chips. Es también el `gap` que el
 *  componente escribe inline en la tira, para que la medición y el
 *  render no puedan divergir (misma constante, un solo sitio). */
export const LEGEND_CHIP_GAP_PX = 4;

/**
 * Con un solo doctor todas las citas tienen el mismo color: la leyenda no
 * distingue nada y solo gasta ancho. A partir de dos sí.
 */
export const LEGEND_MIN_DOCTORS = 2;

export interface LegendDoctor {
  id: string;
  /** `shortName` — el mismo texto del que la card saca las iniciales. */
  name: string;
  /** `displayName` — el nombre largo, para el panel y los títulos. */
  fullName: string;
  /** Color ya resuelto (users.color si existe, si no el del hash). */
  color: string;
  /** Tinta legible encima de `color` (negro o blanco por luminancia). */
  ink: string;
  initials: string;
  /** Tiene ≥1 cita en el rango que la vista trae cargado. */
  present: boolean;
  /** Está en `filters.doctorIds` (el filtro que ya existía). */
  selected: boolean;
}

function buildLegendDoctor(
  id: string,
  name: string,
  fullName: string,
  color: string | null,
  present: boolean,
  selected: boolean,
): LegendDoctor {
  const resolved = doctorColorFor(id, color);
  return {
    id,
    name,
    fullName,
    color: resolved,
    ink: readableTextOn(resolved),
    // Desde `shortName`, igual que agenda-appointment-card: si la leyenda
    // sacara las iniciales de otro campo, el chip de la card y el de la
    // leyenda podrían no coincidir y la leyenda dejaría de servir.
    initials: doctorInitials(name),
    present,
    selected,
  };
}

/**
 * La lista de doctores que la leyenda (tira + panel) tiene que cubrir.
 *
 * Regla: **todo color pintado necesita entrada**. Por eso no basta con
 * `activeInAgenda`, que es lo que listaba el filtro:
 *
 *  1. `activeInAgenda` — el padrón de la agenda;
 *  2. + los que tienen citas en el rango cargado aunque estén dados de
 *     baja de la agenda (los mismos "huérfanos" que `computeColumns` ya
 *     añade como columna en Día + Doctores: sus citas se ven, así que su
 *     color también);
 *  3. + los que estén seleccionados en el filtro, tengan citas o no. Sin
 *     esto, filtrar por A hacía desaparecer a B de la lista mientras
 *     seguía contando en el filtro: el contador decía 2 y la lista
 *     enseñaba 1. Dos controles del mismo estado contradiciéndose.
 *
 * El orden es el del padrón, y los huérfanos al final en el orden en que
 * aparecen en las citas. Determinista.
 */
export function legendDoctors(
  doctors: DoctorColumnDTO[],
  appointments: AgendaAppointmentDTO[],
  selectedIds: string[],
  fallbackName: string,
): LegendDoctor[] {
  const selected = new Set(selectedIds);
  const present = new Set<string>();
  const nameFromAppt = new Map<string, string>();
  for (const a of appointments) {
    const d = a.doctor;
    if (!d?.id) continue;
    present.add(d.id);
    if (!nameFromAppt.has(d.id) && d.shortName) nameFromAppt.set(d.id, d.shortName);
  }

  const out: LegendDoctor[] = [];
  const seen = new Set<string>();

  for (const d of doctors) {
    if (!d.activeInAgenda && !present.has(d.id) && !selected.has(d.id)) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(
      buildLegendDoctor(
        d.id,
        d.shortName || d.displayName || fallbackName,
        d.displayName || d.shortName || fallbackName,
        d.color,
        present.has(d.id),
        selected.has(d.id),
      ),
    );
  }

  // Array.from y no spread: el target de TS del repo no itera Sets con `...`.
  for (const id of Array.from(present).concat(Array.from(selected))) {
    if (seen.has(id)) continue;
    seen.add(id);
    const name = nameFromAppt.get(id) ?? fallbackName;
    out.push(buildLegendDoctor(id, name, name, null, present.has(id), selected.has(id)));
  }

  return out;
}

/**
 * Orden de la TIRA (no del panel): primero los filtrados, luego los que
 * tienen citas en la vista, al final el resto. Es lo que hace que en una
 * clínica de 15 doctores la tira enseñe justo los colores que están en
 * pantalla y no los cinco primeros del padrón.
 *
 * Estable en los dos sentidos: un doctor seleccionado nunca se va detrás
 * del "+N" (rango 0), y sin filtro el orden solo depende de qué citas trae
 * la vista. El panel del "+N" usa el orden del padrón a propósito: ahí no
 * hay que ahorrar ancho y reordenar bajo el cursor sería peor.
 */
export function orderLegendStrip(list: LegendDoctor[]): LegendDoctor[] {
  const rank = (d: LegendDoctor) => (d.selected ? 0 : d.present ? 1 : 2);
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .map((x) => x.d);
}

/**
 * Cuántos chips caben en `available` px. Si no caben todos, reserva el
 * ancho del botón "+N" (más su gap) para el que sí aparece.
 *
 * Es pura y toma anchos MEDIDOS (el componente mide un espejo oculto del
 * mismo DOM, así que los anchos ya incluyen lo que hayan hecho las
 * container queries). Nada de estimar por número de caracteres: `users`
 * tiene nombres de 3 y de 30 letras.
 */
export function fitLegendChips(
  available: number,
  widths: number[],
  moreWidth: number,
  gap: number = LEGEND_CHIP_GAP_PX,
): number {
  if (!(available > 0) || widths.length === 0) return 0;

  let all = 0;
  for (let i = 0; i < widths.length; i++) {
    all += widths[i]! + (i > 0 ? gap : 0);
  }
  if (all <= available) return widths.length;

  let used = 0;
  let count = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = used + (count > 0 ? gap : 0) + widths[i]!;
    // Detrás del último chip visible tiene que caber todavía el "+N".
    if (next + gap + moreWidth > available) break;
    used = next;
    count++;
  }
  return count;
}

/**
 * En qué vistas se pinta la leyenda.
 *
 *  · Semana → SÍ: las columnas son días, el color del doctor no lo explica
 *    nadie.
 *  · Día + Sillones (y la columna unificada) → SÍ: la columna dice el
 *    sillón, no el doctor.
 *  · Día + Doctores → NO: la cabecera de cada columna ya trae el chip de
 *    color, las iniciales y el nombre. Sería la misma información dos
 *    veces y ancho gastado.
 *  · Mes y Lista → NO: ahí las citas NO se pintan con el color del doctor
 *    sino con el del ESTADO (`MONTH_STATUS_COLOR` en agenda-month-view,
 *    `--mf-status-color` en la fila de la lista). Una leyenda de colores
 *    que la pantalla no usa engaña más de lo que explica.
 */
export function legendAppliesTo(
  viewMode: AgendaViewMode,
  columnMode: AgendaColumnMode,
): boolean {
  if (viewMode === "week") return true;
  if (viewMode === "day") return columnMode !== "doctor";
  return false;
}
