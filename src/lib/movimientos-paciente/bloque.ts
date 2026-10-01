import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { anotarAccionDeSuplantacion, suplantacionDeEstaPeticion } from "@/lib/admin/suplantacion";
import type { CategoriaMovimiento } from "./catalogo";
import { armarCambiosDelMovimiento } from "./registrar";
import {
  columnaProbablementeAusente,
  esColumnaPatientIdAusente,
  marcarColumnaAusente,
  marcarColumnaPresente,
} from "./fila";

/**
 * Movimientos del paciente EN BLOQUE: una sola inserción para muchas filas (una importación
 * deja un movimiento por paciente y por archivo; 300 pacientes no son 300 viajes a la base).
 *
 * Mismas reglas que `registrarMovimientoDelPaciente`: NUNCA tira (si falla se anota y la
 * importación sigue), clinicId y userId salen de la sesión, y una fila sin paciente no se
 * escribe. Devuelve cuántas filas quedaron escritas.
 */
export interface MovimientoEnBloque {
  patientId: string;
  entityType: string;
  entityId: string;
  action: string;
  texto: string;
  categoria: CategoriaMovimiento;
}

const LOTE = 500;

export async function registrarMovimientosEnBloque(args: {
  clinicId: string;
  userId: string;
  movimientos: MovimientoEnBloque[];
}): Promise<number> {
  const { clinicId, userId } = args;
  if (!clinicId || !userId) return 0;
  // «Ver como clínica» (decisión A): una importación hecha por el admin no deja
  // movimientos en la clínica; se anota una sola acción en la bitácora de admin.
  const suplantacion = await suplantacionDeEstaPeticion();
  if (suplantacion) {
    await anotarAccionDeSuplantacion(suplantacion, {
      clinicId,
      entityType: "movimientos-en-bloque",
      entityId: args.movimientos[0]?.entityId ?? "n/a",
      action: "create",
      changes: { filas: args.movimientos.length, muestra: args.movimientos.slice(0, 20) },
    });
    return 0;
  }
  const filas = args.movimientos
    .filter((m) => m.patientId && m.entityId && m.texto)
    .map((m) => ({
      id: randomUUID(),
      patientId: m.patientId,
      entityType: m.entityType,
      entityId: m.entityId,
      action: m.action,
      changes: armarCambiosDelMovimiento({ texto: m.texto, categoria: m.categoria }) ?? {},
    }));
  if (filas.length === 0) return 0;

  let escritas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const trozo = filas.slice(i, i + LOTE);
    try {
      escritas += await insertarTrozo(clinicId, userId, trozo);
    } catch (e) {
      console.error("registrarMovimientosEnBloque error:", e);
    }
  }
  return escritas;
}

type Fila = { id: string; patientId: string; entityType: string; entityId: string; action: string; changes: Record<string, unknown> };

/** Sin la columna `patientId` (falta el SQL), el paciente viaja dentro de `changes._mov.after.patientId`. */
function conPacienteEnCambios(f: Fila): Record<string, unknown> {
  const mov = (f.changes._mov ?? {}) as { before?: unknown; after?: Record<string, unknown> };
  return { ...f.changes, _mov: { before: mov.before ?? null, after: { ...(mov.after ?? {}), patientId: f.patientId } } };
}

async function insertarPorPrisma(clinicId: string, userId: string, trozo: Fila[]): Promise<number> {
  const r = await prisma.auditLog.createMany({
    data: trozo.map((f) => ({
      id: f.id,
      clinicId,
      userId,
      entityType: f.entityType,
      entityId: f.entityId,
      action: f.action,
      changes: conPacienteEnCambios(f) as object,
    })),
  });
  return r.count;
}

async function insertarTrozo(clinicId: string, userId: string, trozo: Fila[]): Promise<number> {
  const db = prisma as unknown as { $executeRaw?: unknown };
  if (typeof db.$executeRaw !== "function" || columnaProbablementeAusente()) {
    return insertarPorPrisma(clinicId, userId, trozo);
  }
  const json = JSON.stringify(trozo);
  try {
    // Una sola sentencia; sin `createdAt` (lo pone el DEFAULT), igual que las filas de un movimiento suelto.
    const n = await prisma.$executeRaw`
      INSERT INTO "audit_logs"
        ("id", "clinicId", "userId", "entityType", "entityId", "action", "changes", "actorType", "patientId")
      SELECT x."id", ${clinicId}, ${userId}, x."entityType", x."entityId", x."action", x."changes", 'staff', x."patientId"
      FROM jsonb_to_recordset(${json}::jsonb)
        AS x("id" text, "patientId" text, "entityType" text, "entityId" text, "action" text, "changes" jsonb)
    `;
    marcarColumnaPresente();
    return Number(n) || 0;
  } catch (e) {
    if (!esColumnaPatientIdAusente(e)) throw e;
    marcarColumnaAusente();
    return insertarPorPrisma(clinicId, userId, trozo);
  }
}
