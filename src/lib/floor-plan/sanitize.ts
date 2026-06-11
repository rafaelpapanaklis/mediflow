/**
 * Saneadores defensivos para datos de layout persistidos en ClinicLayout.
 *
 * El JSON de `elements`/`metadata` pudo guardarse hace semanas con un schema
 * anterior (o quedar a medias por un guardado fallido). Tanto la vista pública
 * /live/[slug] como el editor /dashboard/clinic-layout deben renderizar con lo
 * que haya, descartando entradas malformadas en lugar de crashear con el
 * "Application error" pelón de Next. Estas funciones normalizan cualquier
 * `unknown` a una forma garantizada y segura.
 *
 * Framework-agnóstico a propósito (sin "use client" / "server-only") para
 * reusarse tanto en el route handler (server) como en los componentes cliente.
 */

import type { LayoutElement, LayoutMetadata, Rotation } from "./element-types";

const VALID_ROTATIONS: ReadonlySet<number> = new Set([0, 90, 180, 270]);

/** Coerce a número finito; acepta strings numéricos (datos legacy). null si no. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normaliza rotation a 0/90/180/270; cualquier otra cosa → 0. */
function normalizeRotation(v: unknown): Rotation {
  const n = toFiniteNumber(v);
  if (n !== null && VALID_ROTATIONS.has(n)) return n as Rotation;
  return 0;
}

/**
 * Normaliza el JSON de `ClinicLayout.elements` a un `LayoutElement[]` seguro.
 * - Si `raw` no es array (objeto legacy, string JSON, null) → [].
 * - Cada entrada debe ser objeto con `type` string no vacío y `col`/`row`
 *   numéricos finitos; si no, se descarta (no se renderiza, pero NO crashea).
 * - `id` se coerce a número (fallback al índice para una key estable).
 * - `rotation` se fuerza a una rotación válida; `resourceId`/`name` a string|null.
 */
export function sanitizeElements(raw: unknown): LayoutElement[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutElement[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    const type = typeof e.type === "string" ? e.type.trim() : "";
    if (!type) return;
    const col = toFiniteNumber(e.col);
    const row = toFiniteNumber(e.row);
    if (col === null || row === null) return;
    const idNum = toFiniteNumber(e.id);
    out.push({
      id: idNum !== null ? idNum : i + 1,
      type,
      col,
      row,
      rotation: normalizeRotation(e.rotation),
      resourceId:
        typeof e.resourceId === "string" && e.resourceId.length > 0
          ? e.resourceId
          : null,
      name: typeof e.name === "string" ? e.name : null,
    });
  });
  return out;
}

/**
 * Normaliza `ClinicLayout.metadata` a una forma con defaults seguros. Nunca
 * devuelve null — el editor lee `.zoom` / `.panOffset` directamente.
 */
export function sanitizeMetadata(raw: unknown): LayoutMetadata {
  const out: LayoutMetadata = {};
  if (!raw || typeof raw !== "object") return out;
  const m = raw as Record<string, unknown>;
  const zoom = toFiniteNumber(m.zoom);
  if (zoom !== null && zoom > 0) out.zoom = zoom;
  if (m.panOffset && typeof m.panOffset === "object") {
    const p = m.panOffset as Record<string, unknown>;
    const x = toFiniteNumber(p.x);
    const y = toFiniteNumber(p.y);
    if (x !== null && y !== null) out.panOffset = { x, y };
  }
  if (m.gridSize && typeof m.gridSize === "object") {
    const g = m.gridSize as Record<string, unknown>;
    const cols = toFiniteNumber(g.cols);
    const rows = toFiniteNumber(g.rows);
    if (cols !== null && rows !== null) out.gridSize = { cols, rows };
  }
  if (typeof m.lastEditAt === "string") out.lastEditAt = m.lastEditAt;
  return out;
}

/** Sillón normalizado para el modo En Vivo (subset de Resource). */
export interface SafeChair {
  id: string;
  name: string;
  color: string | null;
}

/** Normaliza la lista de sillones (Resources) a {id,name,color}. */
export function sanitizeChairs(raw: unknown): SafeChair[] {
  if (!Array.isArray(raw)) return [];
  const out: SafeChair[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.id !== "string" || c.id.length === 0) continue;
    out.push({
      id: c.id,
      name: typeof c.name === "string" && c.name.length > 0 ? c.name : "Sillón",
      color: typeof c.color === "string" ? c.color : null,
    });
  }
  return out;
}
