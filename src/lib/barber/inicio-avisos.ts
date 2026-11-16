// ═══════════════════════════════════════════════════════════════════════
// Avisos de configuración de Inicio, POR SEDE (ws6-t6, 16-nov-2026). Puro.
//
// Rafael vio «Nadie puede reservar en línea: no hay ni un horario cargado»
// justo después de guardar su horario. La causa: Inicio mira la sede de la
// cookie del selector, que puede ser una sede CERRADA (Inicio y Reportes la
// dejan ver, solo para consultar), mientras Horarios, Agenda y Caja operan
// la sede propia. El horario se guardó en la principal; Inicio miraba una
// sede cerrada y vacía, y el aviso no decía de cuál hablaba.
//
// Reglas:
//  · Cada aviso dice la SEDE.
//  · Una sede cerrada nunca dispara avisos de configuración.
//  · Sin barberos se dice eso, no «no hay horario».
//  · En «Toda la cadena» se avisa por cada sede ACTIVA, nombrándola.
// ═══════════════════════════════════════════════════════════════════════

export interface InicioBranchSetup {
  id: string;
  label: string;
  /** Para la liga pública /b/<slug>/reservar de ESA sede. */
  slug: string;
  isActive: boolean;
  hasBarbers: boolean;
  hasSchedules: boolean;
  hasServices: boolean;
  hasWeb: boolean;
}

export type BookingBlockReason = "noBarbers" | "noSchedules";

export interface BookingBlocker {
  branchId: string;
  label: string;
  slug: string;
  reason: BookingBlockReason;
}

/** «Centro» si la sede tiene nombre de sucursal; si no, el de la barbería. */
export function inicioBranchLabel(row: { name: string; branchName: string | null }): string {
  return row.branchName?.trim() || row.name;
}

/**
 * Sedes en las que NADIE puede reservar en línea. Solo sedes activas y solo si
 * la reserva en línea está encendida (feature del plan). Sin barberos activos
 * el motivo es ese (cargar horario no serviría de nada); con barberos y sin
 * un solo turno, «no hay horario».
 */
export function bookingBlockers(branches: InicioBranchSetup[], publicBookingOn: boolean): BookingBlocker[] {
  if (!publicBookingOn) return [];
  const out: BookingBlocker[] = [];
  for (const b of branches) {
    if (!b.isActive) continue;
    if (!b.hasBarbers) out.push({ branchId: b.id, label: b.label, slug: b.slug, reason: "noBarbers" });
    else if (!b.hasSchedules) out.push({ branchId: b.id, label: b.label, slug: b.slug, reason: "noSchedules" });
  }
  return out;
}

/**
 * Banderas de la lista «Primeros pasos» sobre las sedes ACTIVAS del alcance.
 * Viendo una sede cerrada no hay nada que configurar: null.
 */
export function setupFlags(branches: InicioBranchSetup[]): Pick<InicioBranchSetup, "hasBarbers" | "hasSchedules" | "hasServices" | "hasWeb"> | null {
  const activas = branches.filter((b) => b.isActive);
  if (activas.length === 0) return null;
  return {
    hasBarbers: activas.some((b) => b.hasBarbers),
    hasSchedules: activas.some((b) => b.hasSchedules),
    hasServices: activas.some((b) => b.hasServices),
    hasWeb: activas.some((b) => b.hasWeb),
  };
}
