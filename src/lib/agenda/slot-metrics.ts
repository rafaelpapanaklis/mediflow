import type { AgendaDensity } from "./types";

/**
 * Métrica vertical de la grilla Día/Semana — ÚNICA FUENTE del alto de slot.
 *
 * El provider calcula `slotHpx` con `slotHeightFor()` y con ese MISMO número
 * (a) escribe `--mf-agenda-slot-h` inline en `.scrollGrid`, de donde deriva
 * toda la geometría CSS (top/height de cards, bandas de hora, eje horario,
 * alto de columna), y (b) alimenta por contexto a los consumidores de
 * píxeles en JS (`recomputeTimes` del drag y el badge de hora durante el
 * arrastre). CSS y JS no pueden divergir porque ambos leen este número.
 * NO reintroducir constantes tipo `SLOT_HPX = 30`: ese duplicado movía las
 * citas arrastradas a la hora equivocada en cuanto el CSS cambiaba.
 */

/**
 * Alto de slot que pinta el SSR antes de poder medir el viewport. DEBE ser
 * igual al fallback `--mf-agenda-slot-h` de agenda.module.css (el test
 * slot-metrics.test.ts los compara leyendo el .css).
 */
export const DEFAULT_SLOT_HPX = 30;

/**
 * Densidades fijas (con slots de 15 min):
 *  - medium: 20px/slot = 80px por hora — una cita de 15 min mide ~20px, aún
 *    legible en una línea; un día de 12h son 960px (~1.3 pantallas en 1080p).
 *  - spacious: 30px/slot = 120px por hora — exactamente la densidad única
 *    que existía antes de este cambio, para quien quiere el detalle máximo.
 */
export const DENSITY_SLOT_HPX: Record<Exclude<AgendaDensity, "fit">, number> = {
  medium: 20,
  spacious: 30,
};

/**
 * Piso del modo "fit": con 10px/slot un día de 12h (48 slots de 15 min)
 * mide 480px y cabe hasta en una laptop de 768p descontando topbar del
 * panel (52) + topbar agenda (~48) + sub-toolbar (40) + cabecera de
 * columnas (52). Por debajo de 10px el texto de las cards ya no es legible
 * y preferimos que reaparezca el scroll.
 */
export const FIT_MIN_SLOT_HPX = 10;

/**
 * Alto de slot para una densidad dada. En "fit" reparte el alto disponible
 * entre los slots del horario configurado, con `floor` para que las líneas
 * de slot (background-size) caigan en píxeles enteros y no se emborronen;
 * el residuo (< slotsTotal px) queda como aire al fondo, nunca como scroll.
 * Sin tope superior: en un monitor alto el día simplemente llena la
 * pantalla con más aire.
 */
export function slotHeightFor(
  density: AgendaDensity,
  viewportHpx: number | null,
  slotsTotal: number,
): number {
  if (density !== "fit") return DENSITY_SLOT_HPX[density];
  if (viewportHpx == null || viewportHpx <= 0 || slotsTotal <= 0) {
    return DEFAULT_SLOT_HPX;
  }
  return Math.max(FIT_MIN_SLOT_HPX, Math.floor(viewportHpx / slotsTotal));
}

/**
 * Umbral para rotular las medias horas en el eje: solo cuando la media hora
 * ocupa ≥28px (rótulo de 10px + aire real); por debajo los rótulos
 * intermedios se apilan y son ruido, no información.
 */
export const HALF_HOUR_LABEL_MIN_PX = 28;

export function showHalfHourLabels(slotMinutes: number, slotHpx: number): boolean {
  if (slotMinutes <= 0 || slotMinutes > 30) return false;
  if (30 % slotMinutes !== 0) return false; // sin frontera exacta en :30
  return (30 / slotMinutes) * slotHpx >= HALF_HOUR_LABEL_MIN_PX;
}

/**
 * Una card muestra su segunda fila (tratamiento) solo si su alto real en
 * píxeles se lo permite: fila 1 (~16px) + fila 2 (~13px) + padding y borde
 * (~10px) + margen de respiro. Antes el corte era por slots (`span <= 1.5`),
 * que con alto de slot dinámico dejaba de significar píxeles.
 */
export const CARD_TWO_ROW_MIN_PX = 44;
