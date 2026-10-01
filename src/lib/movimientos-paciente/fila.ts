import { randomUUID } from "node:crypto";
import { desviarSiSuplantacion } from "@/lib/admin/suplantacion";
import { prisma } from "@/lib/prisma";
import { retenerSiHayAlcance } from "./una-accion";

/**
 * Escritura de una fila de `audit_logs` que puede llevar `patientId`.
 *
 * `patientId` es una columna NUEVA (sql/audit-logs-patient-id.sql, la aplica
 * Rafael a mano) y NO está en `model AuditLog` a propósito: si estuviera, el
 * cliente de Prisma la pediría en TODA lectura y en el RETURNING de todo
 * `create`, y hasta que el SQL corra fallaría la bitácora entera (paneles de
 * auditoría, Sabina, cobranza, el export nocturno…). Fuera del modelo, esos
 * caminos no cambian ni un byte. Solo este archivo y `consultar.ts` la tocan,
 * con SQL crudo.
 *
 * Sin la columna, la fila se guarda igual por Prisma y el paciente queda dentro
 * de `changes._mov.after.patientId`: `consultar.ts` sabe leerla de ahí.
 */

/** Cuánto se recuerda «la columna no existe» antes de volver a intentar. */
export const REINTENTO_COLUMNA_MS = 2 * 60 * 1000;

let sinColumnaHasta = 0;

/** Solo para pruebas. */
export function _reiniciarEstadoDeColumna() {
  sinColumnaHasta = 0;
}

export function columnaProbablementeAusente(ahora: number = Date.now()): boolean {
  return ahora < sinColumnaHasta;
}

export function marcarColumnaAusente(ahora: number = Date.now()) {
  sinColumnaHasta = ahora + REINTENTO_COLUMNA_MS;
}

export function marcarColumnaPresente() {
  sinColumnaHasta = 0;
}

/** ¿El error de Postgres/Prisma es «no existe la columna patientId»? */
export function esColumnaPatientIdAusente(e: unknown): boolean {
  const err = e as { message?: unknown; code?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
  const texto = [err?.message, err?.meta?.message]
    .filter((x): x is string => typeof x === "string")
    .join(" ");
  const codigo = String(err?.meta?.code ?? err?.code ?? "");
  const habla = /patientId/i.test(texto);
  const noExiste = /does not exist|no existe|42703/i.test(texto) || codigo === "42703" || codigo === "P2022";
  return habla && noExiste;
}

export interface FilaBitacora {
  clinicId: string;
  /** `null` solo para un actor externo (paciente, reserva web, bot); ver insertarFilaExterna. */
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  actorType?: string | null;
  actorAdminId?: string | null;
  /** Paciente al que pertenece el movimiento; `null` = fila sin paciente. */
  patientId?: string | null;
}

/** El paciente también dentro de `changes`, para el camino sin columna. */
function conPacienteEnCambios(fila: FilaBitacora): Record<string, unknown> | null {
  if (!fila.patientId) return fila.changes;
  const actual = fila.changes ?? {};
  const mov = (actual._mov ?? {}) as { before?: unknown; after?: Record<string, unknown> };
  return {
    ...actual,
    _mov: { before: mov.before ?? null, after: { ...(mov.after ?? {}), patientId: fila.patientId } },
  };
}

async function crearPorPrisma(fila: FilaBitacora): Promise<void> {
  await prisma.auditLog.create({
    data: {
      clinicId: fila.clinicId,
      userId: fila.userId ?? null,
      entityType: fila.entityType,
      entityId: fila.entityId,
      action: fila.action,
      changes: (conPacienteEnCambios(fila) as object | null) ?? undefined,
      ipAddress: fila.ipAddress ?? null,
      userAgent: fila.userAgent ?? null,
      actorType: fila.actorType ?? undefined,
      actorAdminId: fila.actorAdminId ?? null,
    },
    // Solo el id: sin `select`, el RETURNING pediría también `patientId` si algún
    // día entra al modelo, y sin columna fallaría.
    select: { id: true },
  });
}

/**
 * Inserta la fila. NO atrapa errores: quien llama (logAudit / el helper del
 * paciente) decide qué hacer; ninguno deja que la acción principal falle.
 */
export async function insertarFilaBitacora(fila: FilaBitacora): Promise<void> {
  // «Ver como clínica» (decisión A de Rafael, 1-oct): lo que hace el admin de
  // plataforma va SOLO a su bitácora, nunca a la de la clínica ni a nombre de
  // nadie de la clínica. Va antes del alcance: una acción suplantada no deja
  // ni filas sueltas ni resumen en Movimientos.
  if (await desviarSiSuplantacion(fila)) return;
  // Dentro de `conUnSoloMovimiento` la fila se retiene: el alcance la escribe al terminar, junto con su resumen.
  if (retenerSiHayAlcance(fila)) return;
  const db = prisma as unknown as { $executeRaw?: unknown };
  const puedeCrudo = typeof db.$executeRaw === "function";
  if (!fila.patientId || !puedeCrudo || columnaProbablementeAusente()) {
    await crearPorPrisma(fila);
    return;
  }

  const id = randomUUID();
  const cambios = fila.changes === null ? null : JSON.stringify(fila.changes);
  try {
    // Sin `createdAt`: lo pone el DEFAULT de la columna, igual que en las filas que
    // escribe Prisma (`@default(now())`), sea `timestamp` o `timestamptz`.
    await prisma.$executeRaw`
      INSERT INTO "audit_logs"
        ("id", "clinicId", "userId", "entityType", "entityId", "action", "changes",
         "ipAddress", "userAgent", "actorType", "actorAdminId", "patientId")
      VALUES
        (${id}, ${fila.clinicId}, ${fila.userId}, ${fila.entityType}, ${fila.entityId}, ${fila.action},
         ${cambios}::jsonb, ${fila.ipAddress ?? null}, ${fila.userAgent ?? null},
         ${fila.actorType ?? "staff"}, ${fila.actorAdminId ?? null}, ${fila.patientId})
    `;
    marcarColumnaPresente();
  } catch (e) {
    if (!esColumnaPatientIdAusente(e)) throw e;
    // Falta el SQL: se recuerda un rato y la fila se guarda por el camino de siempre.
    marcarColumnaAusente();
    await crearPorPrisma(fila);
  }
}

// ───────────────────── Actores que no son del equipo ─────────────────────

/** Cuánto se recuerda «userId sigue siendo NOT NULL» antes de volver a intentar. */
export const REINTENTO_USUARIO_NULO_MS = 2 * 60 * 1000;
let sinUsuarioNuloHasta = 0;

/** Solo para pruebas. */
export function _reiniciarEstadoDeUsuarioNulo() {
  sinUsuarioNuloHasta = 0;
}

export function usuarioNuloProbablementeNoPermitido(ahora: number = Date.now()): boolean {
  return ahora < sinUsuarioNuloHasta;
}

/** ¿El error es «"userId" no acepta NULL» (falta sql/audit-logs-actor-externo.sql)? */
export function esUsuarioNoNulo(e: unknown): boolean {
  const err = e as { message?: unknown; code?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
  const texto = [err?.message, err?.meta?.message].filter((x): x is string => typeof x === "string").join(" ");
  const codigo = String(err?.meta?.code ?? err?.code ?? "");
  return /userId/i.test(texto) && (/null value|not-null|Null constraint|violates not-null/i.test(texto) || codigo === "23502" || codigo === "P2011");
}

/**
 * Escribe la fila de alguien que NO es del equipo (`userId` null, `actorType`
 * 'patient' | 'public' | 'bot'). Necesita que Rafael haya corrido
 * sql/audit-logs-actor-externo.sql; sin él NO escribe, NO falla y no vuelve a
 * intentarlo durante REINTENTO_USUARIO_NULO_MS. Devuelve si la fila quedó escrita.
 */
export async function insertarFilaExterna(fila: FilaBitacora): Promise<boolean> {
  if (usuarioNuloProbablementeNoPermitido()) return false;
  try {
    await insertarFilaBitacora({ ...fila, userId: null });
    return true;
  } catch (e) {
    if (!esUsuarioNoNulo(e)) throw e;
    sinUsuarioNuloHasta = Date.now() + REINTENTO_USUARIO_NULO_MS;
    console.warn("[movimientos] audit_logs.userId aún no acepta NULL: los movimientos del paciente/bot/reserva web no se registran hasta aplicar sql/audit-logs-actor-externo.sql");
    return false;
  }
}
