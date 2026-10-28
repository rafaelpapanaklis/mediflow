/* ============================================================
   colores — de qué color se pinta cada marca (ws1-t6).

   Rojo = por hacer, azul = realizado (o previo, de otra clínica): el
   estado de la marca manda sobre el color de la especialidad. Lo que no
   tiene estado (los hallazgos, y lo guardado antes de esto) se pinta como
   siempre, con el color de su especialidad (GROUP_COLOR, data.ts).

   Los dos colores son tokens del panel (`--odo-por-hacer` y
   `--odo-realizado` en odontogram.css, que salen de `--danger` y `--info`):
   en SVG van por `style` (var() en CSS); el 3D y los lienzos los leen ya
   resueltos con `resolverColor`.
   ============================================================ */
import { GROUP_COLOR } from "./data";
import type { Condition, ToothRecord } from "./types";
import { estadoEn, tonoDeEstado } from "@/lib/odontogram/estado-marca";

export type Tono = "rojo" | "azul";

export const VAR_TONO: Record<Tono, string> = { rojo: "--odo-por-hacer", azul: "--odo-realizado" };

/** El tono de una marca (por su estado) o null si se pinta con el color de su especialidad. */
export function tonoDe(record: ToothRecord | null | undefined, cara: string | null, cond: Condition): Tono | null {
  return tonoDeEstado(estadoEn(record, cara, cond.id));
}

/** El color CSS de una marca: `var(--odo-…)` si tiene estado; si no, el de su especialidad. */
export function colorDe(record: ToothRecord | null | undefined, cara: string | null, cond: Condition): string {
  const tono = tonoDe(record, cara, cond);
  return tono ? `var(${VAR_TONO[tono]})` : GROUP_COLOR[cond.group];
}

/** El sufijo de los patrones de OdoDefs (`stipple-…`, `dots-…`, `hatch-…`): el tono o la especialidad. */
export function patronDe(record: ToothRecord | null | undefined, cara: string | null, cond: Condition): string {
  return tonoDe(record, cara, cond) ?? cond.group;
}

/**
 * Un color CSS ya resuelto, para lo que no entiende `var()` (Three.js, canvas). Lee el token en
 * `el` (dentro de `.odo-app`, donde viven); si no lo encuentra, cae al color de la especialidad
 * equivalente (diagnóstico = rojo, restauradora = azul).
 */
export function resolverColor(css: string, el: Element | null | undefined): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(css);
  if (!m) return css;
  let v = "";
  try {
    if (el && typeof getComputedStyle === "function") v = getComputedStyle(el).getPropertyValue(m[1]).trim();
  } catch { /* sin DOM (pruebas): el de respaldo */ }
  if (v) return v;
  return m[1] === VAR_TONO.rojo ? GROUP_COLOR.diagnostic : GROUP_COLOR.restorative;
}
