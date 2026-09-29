// «Quitar» un procedimiento del catálogo (ws1-t8). PURO: la base entra por
// `deps`, así que la regla se prueba sin Prisma.
//
// Regla: si el procedimiento nunca se usó, se ELIMINA; si ya se usó (hojas de
// control, procedimientos de visita, facturas, presupuestos, extras, planes,
// sesiones), se ARCHIVA (`isActive = false`) para no romper el historial. Si no
// se puede saber si se usó, se archiva: archivar nunca pierde nada.

import { esFilaDelControl, type FilaExistente } from "@/lib/orthodontics/procedimiento-ortodoncia-reglas";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

export type FilaAQuitar = FilaExistente & { id: string; isActive: boolean };

export interface QuitarDeps {
  buscar(clinicId: string, id: string): Promise<FilaAQuitar | null>;
  /** Registros que usan el procedimiento; `null` = no se pudo saber. */
  contarUsos(clinicId: string, id: string): Promise<number | null>;
  eliminar(clinicId: string, id: string): Promise<void>;
  archivar(clinicId: string, id: string): Promise<void>;
}

export type ResultadoQuitar =
  | { ok: true; accion: "eliminado"; usos: 0 }
  | { ok: true; accion: "archivado"; usos: number | null }
  | { ok: false; status: 400 | 404; error: string };

export async function quitarProcedimiento(deps: QuitarDeps, args: { clinicId: string; id: string }): Promise<ResultadoQuitar> {
  // ⛔ Sin tenant no se consulta: `clinicId: undefined` no filtra nada en Prisma.
  if (!args.clinicId || !args.id) return { ok: false, status: 404, error: "No encontrado" };
  const fila = await deps.buscar(args.clinicId, args.id);
  if (!fila) return { ok: false, status: 404, error: "No encontrado" };
  if (esFilaDelControl(fila)) {
    return { ok: false, status: 400, error: `«${TIPO_CITA_CONTROL_ORTO}» es fijo y no se puede quitar.` };
  }
  const usos = await deps.contarUsos(args.clinicId, args.id).catch(() => null);
  if (usos === 0) {
    await deps.eliminar(args.clinicId, args.id);
    return { ok: true, accion: "eliminado", usos: 0 };
  }
  await deps.archivar(args.clinicId, args.id);
  return { ok: true, accion: "archivado", usos };
}

/** El aviso que ve la usuaria tras quitar. */
export function mensajeDeQuitar(nombre: string, r: { accion: "eliminado" | "archivado"; usos: number | null }): string {
  if (r.accion === "eliminado") return `«${nombre}» eliminado.`;
  if (r.usos && r.usos > 0) {
    return `Ya se usó en ${r.usos} ${r.usos === 1 ? "registro" : "registros"}: lo quitamos de la lista, el historial lo conserva.`;
  }
  return "Ya tiene historial: lo quitamos de la lista, el historial lo conserva.";
}

/** Lo que dice la confirmación antes de quitar (aún no sabemos si tiene uso). */
export function textoConfirmarQuitar(nombre: string): string {
  return `¿Quitar «${nombre}»? Si nunca se usó se elimina; si ya se usó, sale de la lista y el historial lo conserva. Puedes volver a activarlo desde «Ver quitados».`;
}

/** La lista visible solo lleva los ACTIVOS; los quitados van aparte, tras «Ver quitados (N)». */
export function separarActivosYQuitados<T extends { isActive: boolean }>(filas: T[]): { activos: T[]; quitados: T[] } {
  return { activos: filas.filter((f) => f.isActive), quitados: filas.filter((f) => !f.isActive) };
}
