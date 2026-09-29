// ─────────────────────────────────────────────────────────────────────────────
// Formato de los PDF de ortodoncia (ws1-t4, 29-sep-2026) — puro, sin React,
// sin Prisma y sin red. Lo importan el membrete común, las plantillas y las
// pruebas.
//
// POR QUÉ EXISTE: cada PDF del módulo formateaba las fechas a su manera
// (`toLocaleDateString("es-MX")` en la zona del SERVIDOR, que en Vercel es
// UTC; «23-sep» sin año en el convenio impreso; «12 de marzo de 2024» en
// otros). Aquí hay UNA regla para todos: dd/mm/aaaa, siempre con año, en la
// zona horaria de la CLÍNICA.
// ─────────────────────────────────────────────────────────────────────────────

import { consentTimeZone } from "@/lib/consent/dates";

/** Lo que se imprime cuando no hay fecha. */
export const SIN_FECHA = "—";

const SOLO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * dd/mm/aaaa, con año SIEMPRE.
 *
 * Dos clases de entrada:
 *   · "YYYY-MM-DD" (un día del calendario: el vencimiento de una cuota). Se
 *     imprime tal cual, sin pasar por ninguna zona — convertirlo a instante lo
 *     movería un día hacia atrás en México.
 *   · un instante (ISO con hora, o `Date`): se lleva a la zona de la clínica.
 */
export function fechaDMA(
  valor: Date | string | null | undefined,
  zonaHoraria?: string | null,
): string {
  if (!valor) return SIN_FECHA;
  if (typeof valor === "string") {
    const m = SOLO_DIA.exec(valor.trim());
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return SIN_FECHA;
  const partes = new Intl.DateTimeFormat("es-MX", {
    timeZone: consentTimeZone(zonaHoraria),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")}`;
}

/** "$12,345.50" — pesos con centavos solo si los hay. */
export function dinero(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const conCentavos = Math.round(v * 100) % 100 !== 0;
  return `$${v.toLocaleString("es-MX", {
    minimumFractionDigits: conCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Años cumplidos a `ahora`, o null si no hay fecha de nacimiento válida. */
export function edadEnAnios(nacimiento: Date | string | null | undefined, ahora: Date): number | null {
  if (!nacimiento) return null;
  const d = nacimiento instanceof Date ? nacimiento : new Date(nacimiento);
  if (Number.isNaN(d.getTime())) return null;
  // La fecha de nacimiento es un DÍA: se lee en UTC, que es como la guarda Prisma.
  let edad = ahora.getUTCFullYear() - d.getUTCFullYear();
  const antesDelCumple =
    ahora.getUTCMonth() < d.getUTCMonth() ||
    (ahora.getUTCMonth() === d.getUTCMonth() && ahora.getUTCDate() < d.getUTCDate());
  if (antesDelCumple) edad -= 1;
  return edad >= 0 ? edad : null;
}

/** Fecha de nacimiento (día de calendario, guardado a medianoche UTC) → dd/mm/aaaa sin correrse de día. */
export function fechaDeNacimiento(nacimiento: Date | string | null | undefined): string {
  if (!nacimiento) return SIN_FECHA;
  const d = nacimiento instanceof Date ? nacimiento : new Date(nacimiento);
  if (Number.isNaN(d.getTime())) return SIN_FECHA;
  return fechaDMA(d.toISOString().slice(0, 10));
}
