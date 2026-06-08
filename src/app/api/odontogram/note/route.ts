import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ensurePatientInClinic,
  getDbUser,
  isMissingTableError,
} from "@/lib/odontogram/api-auth";

export const dynamic = "force-dynamic";

/** conditionId reservado para la nota clínica por diente (surface=null). */
const NOTE_CONDITION = "__note__";

const NoteSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
  note: z.string().max(2000),
});

const DeleteSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
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
  console.error("[/api/odontogram/note] unexpected error", err);
  return jsonError("internal_error", 500, {
    reason: err instanceof Error ? err.message : "unknown",
  });
}

/** Borra la nota por diente (entry reservada conditionId="__note__"). */
async function clearNote(patientId: string, toothNumber: number) {
  await prisma.odontogramEntry.deleteMany({
    where: { patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION },
  });
}

/**
 * PUT /api/odontogram/note — define la nota clínica del diente. Hay una nota por
 * diente (surface=null, conditionId="__note__"). Un note vacío la borra.
 */
export async function PUT(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);

    const body = await req.json().catch(() => null);
    const parsed = NoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { patientId, toothNumber } = parsed.data;
    if (!(await ensurePatientInClinic(patientId, dbUser.clinicId))) {
      return jsonError("patient_not_found", 404);
    }

    const note = parsed.data.note.trim();
    if (!note) {
      await clearNote(patientId, toothNumber);
      return NextResponse.json({ ok: true, note: null });
    }

    const existing = await prisma.odontogramEntry.findFirst({
      where: { patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION },
      select: { id: true },
    });
    if (existing) {
      await prisma.odontogramEntry.update({
        where: { id: existing.id },
        data: { notes: note },
      });
    } else {
      await prisma.odontogramEntry.create({
        data: {
          patientId,
          toothNumber,
          surface: null,
          conditionId: NOTE_CONDITION,
          notes: note,
        },
      });
    }
    return NextResponse.json({ ok: true, note });
  } catch (err) {
    return unexpectedError(err);
  }
}

/** DELETE /api/odontogram/note — quita la nota del diente. */
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
    await clearNote(parsed.data.patientId, parsed.data.toothNumber);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unexpectedError(err);
  }
}
