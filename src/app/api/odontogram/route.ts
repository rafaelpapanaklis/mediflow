import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ensurePatientInClinic,
  getDbUser,
  isMissingTableError,
  puedeEscribirOdontograma,
  puedeLeerOdontograma,
} from "@/lib/odontogram/api-auth";
import { sesionDistinta } from "@/lib/odontogram/sesion-pestana";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { extractAuditMeta } from "@/lib/audit";
import { anotarAccionDeSuplantacion, suplantacionDeEstaPeticion } from "@/lib/admin/suplantacion";
import { ESTADOS_MARCA, admiteEstado, type EstadoMarca } from "@/lib/odontogram/estado-marca";
import { columnaEstadoExiste, fijarEstado, leerEstados } from "@/lib/odontogram/estado-db";

export const dynamic = "force-dynamic";

/** conditionId del catálogo nuevo (caries, caries_inc, crown, rct, ext_done,
 *  post_core, …): minúsculas, dígitos y guión bajo. Es un id LIBRE, no un enum. */
const CONDITION_ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "conditionId inválido");

const SURFACE = z.enum(["M", "D", "V", "L", "O"]);

/** conditionId reservado para la nota por diente — se gestiona en /note. */
const NOTE_CONDITION = "__note__";

const PutSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
  surface: SURFACE.nullable().optional(),
  conditionId: CONDITION_ID.refine((c) => c !== NOTE_CONDITION, {
    message: "usa /api/odontogram/note para la nota por diente",
  }),
  notes: z.string().max(2000).nullable().optional(),
  /** Rojo/azul (ws1-t6). Sin la clave, el estado de la marca no se toca (pestañas con el JS de antes). */
  estado: z.enum(ESTADOS_MARCA).nullable().optional(),
});

const DeleteSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
  surface: SURFACE.nullable().optional(),
  /** Si se omite, borra todas las condiciones de esa (diente, cara) excepto la
   *  nota. Si se manda, borra solo esa condición. */
  conditionId: CONDITION_ID.optional(),
});

/** Clave del candado de una fila de diente completo (pg_advisory_xact_lock(hashtext(clave))). */
function candadoDiente(patientId: string, toothNumber: number, conditionId: string): string {
  return `odontogram:${patientId}:${toothNumber}:${conditionId}`;
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function unexpectedError(err: unknown) {
  if (isMissingTableError(err)) {
    return jsonError("schema_not_migrated", 503, {
      hint: "La tabla odontogram_entries no existe o falta la migración. Aplica sql/odontogram-v2.sql en Supabase.",
    });
  }
  console.error("[/api/odontogram] unexpected error", err);
  return jsonError("internal_error", 500, {
    reason: err instanceof Error ? err.message : "unknown",
  });
}

const ENTRY_SELECT = {
  id: true,
  toothNumber: true,
  surface: true,
  conditionId: true,
  notes: true,
  updatedAt: true,
} as const;

/**
 * GET /api/odontogram?patientId=ID
 * Devuelve { entries, notes }:
 *   - entries: condiciones del catálogo; varias por (diente, cara) son posibles.
 *   - notes:   mapa { [toothNumber]: texto } con la nota clínica por diente.
 */
export async function GET(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    // ¿quién tiene la sesión? (el autoguardado lo pregunta antes de reintentar;
    // no mira al paciente: un 404 no se confunde con «no se pudo saber»)
    if (req.nextUrl.searchParams.get("quien") === "1") {
      return NextResponse.json({ clinicId: dbUser.clinicId, userId: dbUser.id });
    }
    // M6: leer el odontograma es leer expediente (antes bastaba la sesión).
    if (!puedeLeerOdontograma(dbUser)) return jsonError("forbidden", 403);
    const patientId = req.nextUrl.searchParams.get("patientId");
    if (!patientId) return jsonError("missing_patientId", 400);
    // FASE 2 — sharedRead: el odontograma es contenido clínico, así que se LEE
    // también si el paciente vive en una sede vinculada. PUT/DELETE/sync/reset
    // llaman a ensurePatientInClinic SIN esta opción → siguen exigiendo que el
    // paciente sea de la sede activa (compartir es solo-lectura).
    if (!(await ensurePatientInClinic(patientId, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId }, { sharedRead: true }))) {
      return jsonError("patient_not_found", 404);
    }
    // Visibilidad por paciente: lee un solo paciente por id → 404 si no lo puede ver.
    const denied = await assertPatientVisible(patientId, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId });
    if (denied) return denied;
    const rows = await prisma.odontogramEntry.findMany({
      where: { patientId },
      orderBy: [{ toothNumber: "asc" }, { surface: "asc" }],
      select: ENTRY_SELECT,
    });

    // Rojo/azul (ws1-t6): el estado de cada marca, si la base ya tiene la columna. Lo guardado
    // antes no lo tiene y viaja sin él (se pinta como hoy).
    // Si no se puede saber (sonda caída), el odontograma se enseña igual pero se AVISA: sin eso, el
    // selector desaparecía y lo rojo se veía con el color de siempre sin decir nada (v2, m5).
    let conEstado: boolean | null;
    try {
      conEstado = await columnaEstadoExiste({ estricta: true });
    } catch (e) {
      console.error("[/api/odontogram] no se pudo saber si la base guarda el estado:", e);
      conEstado = null;
    }
    const estados = conEstado ? await leerEstados(prisma, patientId) : new Map<string, EstadoMarca>();
    const entries = rows
      .filter((r) => r.conditionId !== NOTE_CONDITION)
      .map((r) => (estados.has(r.id) ? { ...r, estado: estados.get(r.id)! } : r));
    const notes: Record<number, string> = {};
    for (const r of rows) {
      if (r.conditionId === NOTE_CONDITION && r.notes) notes[r.toothNumber] = r.notes;
    }
    // clinicId y userId de la SESIÓN (no del paciente): el autoguardado del
    // panel comprueba con ellos, antes de reintentar algo que falló, que la
    // sesión siga siendo la misma (nada sale firmado por otro ni a otra sede).
    return NextResponse.json({
      entries, notes, clinicId: dbUser.clinicId, userId: dbUser.id,
      ...(conEstado === null ? { estadoNoLeido: true } : { conEstado }),
    });
  } catch (err) {
    return unexpectedError(err);
  }
}

/**
 * PUT /api/odontogram — agrega (o actualiza notes de) UNA condición específica
 * en (patientId, toothNumber, surface?, conditionId). Idempotente: repetir no
 * duplica. Para quitar usa DELETE. Para la nota por diente usa /note.
 */
export async function PUT(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    // N4-O2: la pestaña dice de qué sesión es lo que manda; si la cookie es de
    // otra (otro usuario u otra sede en otra pestaña), no se escribe nada
    if (sesionDistinta(req.headers, dbUser)) return jsonError("otra_sesion", 409);
    // PAC-05: el mismo rol que exigen /reset y /sync. Escribir un hallazgo en
    // el odontograma es escribir expediente clínico.
    if (!puedeEscribirOdontograma(dbUser)) return jsonError("forbidden", 403);

    const body = await req.json().catch(() => null);
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    // Visibilidad incluida (Ola 3): un doctor excluido ya no escribe el
    // odontograma de un paciente restringido aunque tenga el id.
    if (!(await ensurePatientInClinic(parsed.data.patientId, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId }))) {
      return jsonError("patient_not_found", 404);
    }

    const { patientId, toothNumber, conditionId } = parsed.data;
    const surface = parsed.data.surface ?? null;
    const notes = parsed.data.notes ?? null;
    // Sin `notes` en el cuerpo, la nota de una marca que ya estaba NO se toca: cambiarle el color
    // (rojo/azul, ws1-t6) no borra lo que trae (marca y lote de un implante, lo importado).
    const cambiaNotas = parsed.data.notes !== undefined;
    // El estado se escribe solo si viene, si la marca es de procedimiento y si la base ya tiene la columna.
    // Si no se puede saber si la tiene (sonda caída), 503 y no se guarda nada: la cola del odontograma
    // reintenta, en vez de guardar la marca sin su color y decir «Guardado» (v2, m5).
    const pideEstado = parsed.data.estado !== undefined && admiteEstado(conditionId);
    let conEstado = false;
    if (pideEstado) {
      try {
        conEstado = await columnaEstadoExiste({ estricta: true });
      } catch (e) {
        console.error("[/api/odontogram] no se pudo saber si la base guarda el estado:", e);
        return jsonError("estado_no_disponible", 503);
      }
    }
    const estado = pideEstado && conEstado ? parsed.data.estado : undefined;
    /** ¿La marca ya estaba? (Movimientos dice «Marcó por hacer…» y no «Registró…») */
    let existia = false;

    // Postgres trata NULL como distinto en UNIQUE; para condiciones de diente
    // completo (surface=null) hacemos el upsert manual por (tooth, conditionId).
    if (surface === null) {
      // Diente completo: la unique (patientId, toothNumber, surface, conditionId)
      // NO cubre surface NULL en Postgres (dos NULL no chocan), así que el
      // buscar-y-crear necesita su candado. Con el autoguardado, dos pestañas o
      // un reintento de algo que sí llegó pueden mandar el mismo PUT a la vez.
      const entry = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candadoDiente(patientId, toothNumber, conditionId)}))`;
        const existing = await tx.odontogramEntry.findFirst({
          where: { patientId, toothNumber, surface: null, conditionId },
          select: { id: true },
        });
        existia = !!existing;
        const fila = existing
          ? await tx.odontogramEntry.update({
              where: { id: existing.id },
              data: cambiaNotas ? { notes } : { updatedAt: new Date() },
              select: ENTRY_SELECT,
            })
          : await tx.odontogramEntry.create({
              data: { patientId, toothNumber, surface: null, conditionId, notes },
              select: ENTRY_SELECT,
            });
        if (estado !== undefined) await fijarEstado(tx, patientId, fila.id, estado);
        return fila;
      });
      await anotarEnBitacora(req, dbUser, patientId, "odontogram_write", {
        toothNumber, surface: null, conditionId, notes, ...(estado !== undefined ? { estado, existia } : {}),
      });
      return NextResponse.json({ entry });
    }

    // Surface no-null: upsert real con la unique compound nueva.
    const upsert = (db: Pick<typeof prisma, "odontogramEntry">) => db.odontogramEntry.upsert({
      where: {
        patientId_toothNumber_surface_conditionId: {
          patientId,
          toothNumber,
          surface,
          conditionId,
        },
      },
      create: { patientId, toothNumber, surface, conditionId, notes },
      update: cambiaNotas ? { notes } : {},
      select: ENTRY_SELECT,
    });
    // Con estado, la marca y su color en la misma transacción.
    const entry = estado === undefined
      ? await upsert(prisma)
      : await prisma.$transaction(async (tx) => {
          existia = !!(await tx.odontogramEntry.findFirst({ where: { patientId, toothNumber, surface, conditionId }, select: { id: true } }));
          const fila = await upsert(tx);
          await fijarEstado(tx, patientId, fila.id, estado);
          return fila;
        });

    await anotarEnBitacora(req, dbUser, patientId, "odontogram_write", {
      toothNumber, surface, conditionId, notes, ...(estado !== undefined ? { estado, existia } : {}),
    });
    return NextResponse.json({ entry });
  } catch (err) {
    return unexpectedError(err);
  }
}

/**
 * DELETE /api/odontogram — quita condiciones de (patientId, toothNumber, surface?).
 *   - con conditionId: borra solo esa condición.
 *   - sin conditionId: borra todas las condiciones de esa cara (excepto la nota).
 */
export async function DELETE(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    // N4-O2: la pestaña dice de qué sesión es lo que manda; si la cookie es de
    // otra (otro usuario u otra sede en otra pestaña), no se escribe nada
    if (sesionDistinta(req.headers, dbUser)) return jsonError("otra_sesion", 409);
    // PAC-05: igual que el PUT. Quitar hallazgos de una cara, uno a uno, es el
    // mismo borrado que /reset hace de golpe.
    if (!puedeEscribirOdontograma(dbUser)) return jsonError("forbidden", 403);

    const body = await req.json().catch(() => null);
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    if (!(await ensurePatientInClinic(parsed.data.patientId, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId }))) {
      return jsonError("patient_not_found", 404);
    }

    const surface = parsed.data.surface ?? null;
    const result = await prisma.odontogramEntry.deleteMany({
      where: {
        patientId: parsed.data.patientId,
        toothNumber: parsed.data.toothNumber,
        surface,
        ...(parsed.data.conditionId
          ? { conditionId: parsed.data.conditionId }
          : { conditionId: { not: NOTE_CONDITION } }),
      },
    });

    await anotarEnBitacora(req, dbUser, parsed.data.patientId, "odontogram_delete", {
      toothNumber: parsed.data.toothNumber,
      surface,
      conditionId: parsed.data.conditionId ?? null,
      borradas: result.count,
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err) {
    return unexpectedError(err);
  }
}

/**
 * Deja constancia de quién tocó el odontograma y qué diente.
 *
 * PUT y DELETE eran las dos únicas escrituras del odontograma que no escribían
 * bitácora — /sync y /reset sí—, así que un hallazgo pintado o borrado a mano
 * quedaba registrado como del equipo clínico y sin nombre. Se apunta con lo que
 * ya está en la mano: ni una consulta de más.
 *
 * No tumba la petición si la bitácora falla: el cambio clínico ya se aplicó y
 * devolver 500 haría que la pantalla lo pintara como no guardado.
 */
async function anotarEnBitacora(
  req: NextRequest,
  dbUser: { id: string; clinicId: string },
  patientId: string,
  action: "odontogram_write" | "odontogram_delete",
  // Escalares a secas: es lo que la columna `changes` (Json) acepta, y es todo
  // lo que hace falta para saber qué diente tocó quién.
  detalle: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    const { ipAddress, userAgent } = extractAuditMeta(req);
    // «Ver como clínica» (decisión A): a la bitácora de admin, no a la de la clínica.
    const suplantacion = await suplantacionDeEstaPeticion();
    if (suplantacion) {
      await anotarAccionDeSuplantacion(suplantacion, {
        clinicId: dbUser.clinicId, entityType: "patient", entityId: patientId, action,
        changes: { _odontogram: { after: detalle } }, patientId, ipAddress, userAgent,
      });
      return;
    }
    await prisma.auditLog.create({
      data: {
        clinicId: dbUser.clinicId,
        userId: dbUser.id,
        entityType: "patient",
        entityId: patientId,
        action,
        changes: { _odontogram: { after: detalle } },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (e) {
    console.error("[api/odontogram] no se pudo escribir la bitácora:", e);
  }
}
