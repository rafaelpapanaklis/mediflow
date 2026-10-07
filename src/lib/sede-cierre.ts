/**
 * M3 — reglas puras de «Cerrar sede» (archivado lógico hecho por el dueño).
 * Archivar NO borra nada: el expediente se conserva (NOM-004/024); la sede deja de
 * existir para la sesión, el selector y los cupos (`archivedAt != null`).
 */
export type MotivoNoSePuedeCerrar = "NO_ES_TUYA" | "ES_LA_ACTIVA" | "ES_LA_UNICA" | "ES_LA_PRINCIPAL" | "YA_CERRADA";

export interface SedeDelDueno { id: string; createdAt: Date; archivedAt: Date | null }

export function puedeCerrarSede(input: { clinicId: string; clinicIdActiva: string; sedes: SedeDelDueno[] }): { ok: true } | { ok: false; motivo: MotivoNoSePuedeCerrar } {
  const objetivo = input.sedes.find((s) => s.id === input.clinicId);
  if (!objetivo) return { ok: false, motivo: "NO_ES_TUYA" };
  if (objetivo.archivedAt) return { ok: false, motivo: "YA_CERRADA" };
  // La sede en la que estás parado no se cierra: cámbiate primero a otra.
  if (input.clinicId === input.clinicIdActiva) return { ok: false, motivo: "ES_LA_ACTIVA" };
  const vivas = input.sedes.filter((s) => !s.archivedAt);
  if (vivas.length <= 1) return { ok: false, motivo: "ES_LA_UNICA" };
  // La sede principal (la más antigua) es la que paga: las demás siguen su estado de cobro.
  const principal = [...vivas].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (principal.id === input.clinicId) return { ok: false, motivo: "ES_LA_PRINCIPAL" };
  return { ok: true };
}

export const MENSAJE_NO_SE_PUEDE_CERRAR: Record<MotivoNoSePuedeCerrar, string> = {
  NO_ES_TUYA: "Esa sede no es tuya.",
  ES_LA_ACTIVA: "No puedes cerrar la sede en la que estás. Cámbiate a otra sede primero.",
  ES_LA_UNICA: "No puedes cerrar tu única sede.",
  ES_LA_PRINCIPAL: "No puedes cerrar la sede principal (la que lleva la suscripción).",
  YA_CERRADA: "Esa sede ya estaba cerrada.",
};
