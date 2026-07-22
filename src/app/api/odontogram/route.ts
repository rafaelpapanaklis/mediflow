import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ensurePatientInClinic,
  getDbUser,
  isMissingTableError,
} from "@/lib/odontogram/api-auth";
import { assertPatientVisible } from "@/lib/patient-visibility";

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
});

const DeleteSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
  surface: SURFACE.nullable().optional(),
  /** Si se omite, borra todas las condiciones de esa (diente, cara) excepto la
   *  nota. Si se manda, borra solo esa condición. */
  conditionId: CONDITION_ID.optional(),
});

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
    const patientId = req.nextUrl.searchParams.get("patientId");
    if (!patientId) return jsonError("missing_patientId", 400);
    // FASE 2 — sharedRead: el odontograma es contenido clínico, así que se LEE
    // también si el paciente vive en una sede vinculada. PUT/DELETE/sync/reset
    // llaman a ensurePatientInClinic SIN esta opción → siguen exigiendo que el
    // paciente sea de la sede activa (compartir es solo-lectura).
    if (!(await ensurePatientInClinic(patientId, dbUser.clinicId, { sharedRead: true }))) {
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

    const entries = rows.filter((r) => r.conditionId !== NOTE_CONDITION);
    const notes: Record<number, string> = {};
    for (const r of rows) {
      if (r.conditionId === NOTE_CONDITION && r.notes) notes[r.toothNumber] = r.notes;
    }
    return NextResponse.json({ entries, notes });
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

    const body = await req.json().catch(() => null);
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    if (!(await ensurePatientInClinic(parsed.data.patientId, dbUser.clinicId))) {
      return jsonError("patient_not_found", 404);
    }

    const { patientId, toothNumber, conditionId } = parsed.data;
    const surface = parsed.data.surface ?? null;
    const notes = parsed.data.notes ?? null;

    // Postgres trata NULL como distinto en UNIQUE; para condiciones de diente
    // completo (surface=null) hacemos el upsert manual por (tooth, conditionId).
    if (surface === null) {
      const existing = await prisma.odontogramEntry.findFirst({
        where: { patientId, toothNumber, surface: null, conditionId },
        select: { id: true },
      });
      const entry = existing
        ? await prisma.odontogramEntry.update({
            where: { id: existing.id },
            data: { notes },
            select: ENTRY_SELECT,
          })
        : await prisma.odontogramEntry.create({
            data: { patientId, toothNumber, surface: null, conditionId, notes },
            select: ENTRY_SELECT,
          });
      return NextResponse.json({ entry });
    }

    // Surface no-null: upsert real con la unique compound nueva.
    const entry = await prisma.odontogramEntry.upsert({
      where: {
        patientId_toothNumber_surface_conditionId: {
          patientId,
          toothNumber,
          surface,
          conditionId,
        },
      },
      create: { patientId, toothNumber, surface, conditionId, notes },
      update: { notes },
      select: ENTRY_SELECT,
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

    const body = await req.json().catch(() => null);
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    if (!(await ensurePatientInClinic(parsed.data.patientId, dbUser.clinicId))) {
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

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err) {
    return unexpectedError(err);
  }
}
