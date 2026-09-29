import { patientIdEnCambios } from "./catalogo";
import { insertarFilaBitacora } from "./fila";

/**
 * Fila de bitácora de los módulos clínicos (ortodoncia, pediatría, periodoncia,
 * endodoncia, implantes, cobro de ortodoncia). Cada módulo tiene su helper
 * `auditXxx` y todos terminan aquí: un solo lugar que sabe guardar `patientId`.
 *
 * `patientId` explícito manda; si falta se busca en el propio cambio
 * (`_created.after.patientId`, `_meta.patientId`…). Sin paciente la fila se
 * escribe igual —es lo que hacían antes—, solo que no saldrá en Movimientos.
 * Puede tirar: los helpers de módulo ya la envuelven en su try/catch.
 */
export async function anotarFilaDeModulo(args: {
  clinicId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown> | null;
  patientId?: string | null;
}): Promise<void> {
  await insertarFilaBitacora({
    clinicId: args.clinicId,
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    changes: args.changes,
    patientId: args.patientId ?? patientIdEnCambios(args.changes),
  });
}
