import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

const STATE = z.enum([
  "SANO",
  "CARIES",
  "RESINA",
  "CORONA",
  "ENDODONCIA",
  "IMPLANTE",
  "AUSENTE",
  "EXTRACCION",
]);

const SURFACE = z.enum(["M", "D", "V", "L", "O"]);

const PutSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
  surface: SURFACE.nullable().optional(),
  state: STATE,
  notes: z.string().nullable().optional(),
});

const DeleteSchema = z.object({
  patientId: z.string().min(1),
  toothNumber: z.number().int().min(11).max(85),
  surface: SURFACE.nullable().optional(),
});

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

async function ensurePatientInClinic(
  patientId: string,
  clinicId: string,
): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id: patientId, clinicId },
    select: { id: true },
  });
  return p !== null;
}

/** Detecta el error específico de "tabla no existe" (Prisma P2021 / Postgres 42P01). */
function isMissingTableError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; message?: string; meta?: { code?: string } };
  if (e.code === "P2021") return true;
  if (e.code === "42P01") return true;
  if (e.meta?.code === "42P01") return true;
  if (typeof e.message === "string" && /relation .* does not exist|odontogram_entries.*does not exist/i.test(e.message)) return true;
  return false;
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function unexpectedError(err: unknown) {
  if (isMissingTableError(err)) {
    return jsonError(
      "schema_not_migrated",
      503,
      {
        hint: "La tabla odontogram_entries no existe. Aplica la migración 20260427120000_odontogram_entry en Supabase.",
      },
    );
  }
  console.error("[/api/odontogram] unexpected error", err);
  return jsonError(
    "internal_error",
    500,
    { reason: err instanceof Error ? err.message : "unknown" },
  );
}

/** GET /api/odontogram?patientId=ID — todas las entries del paciente. */
export async function GET(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return jsonError("unauthorized", 401);
    const patientId = req.nextUrl.searchParams.get("patientId");
    if (!patientId) return jsonError("missing_patientId", 400);
    if (!(await ensurePatientInClinic(patientId, dbUser.clinicId))) {
      return jsonError("patient_not_found", 404);
    }
    const entries = await prisma.odontogramEntry.findMany({
      where: { patientId },
      orderBy: [{ toothNumber: "asc" }, { surface: "asc" }],
      select: {
        id: true,
        toothNumber: true,
        surface: true,
        state: true,
        notes: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ entries });
  } catch (err) {
    return unexpectedError(err);
  }
}

/** PUT /api/odontogram — upsert por (patientId, toothNumber, surface). */
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

    const surface = parsed.data.surface ?? null;

    // Postgres trata NULL como distinto en UNIQUE; para full-tooth (surface=null)
    // hacemos el upsert manual: buscar existente y update, sino create.
    if (surface === null) {
      const existing = await prisma.odontogramEntry.findFirst({
        where: {
          patientId: parsed.data.patientId,
          toothNumber: parsed.data.toothNumber,
          surface: null,
        },
        select: { id: true },
      });
      const entry = existing
        ? await prisma.odontogramEntry.update({
            where: { id: existing.id },
            data: { state: parsed.data.state, notes: parsed.data.notes ?? null },
            select: {
              id: true, toothNumber: true, surface: true, state: true,
              notes: true, updatedAt: true,
            },
          })
        : await prisma.odontogramEntry.create({
            data: {
              patientId: parsed.data.patientId,
              toothNumber: parsed.data.toothNumber,
              surface: null,
              state: parsed.data.state,
              notes: parsed.data.notes ?? null,
            },
            select: {
              id: true, toothNumber: true, surface: true, state: true,
              notes: true, updatedAt: true,
            },
          });
      return NextResponse.json({ entry });
    }

    // Surface no-null: upsert real con la unique compound.
    const entry = await prisma.odontogramEntry.upsert({
      where: {
        patientId_toothNumber_surface: {
          patientId: parsed.data.patientId,
          toothNumber: parsed.data.toothNumber,
          surface,
        },
      },
      create: {
        patientId: parsed.data.patientId,
        toothNumber: parsed.data.toothNumber,
        surface,
        state: parsed.data.state,
        notes: parsed.data.notes ?? null,
      },
      update: {
        state: parsed.data.state,
        notes: parsed.data.notes ?? null,
      },
      select: {
        id: true, toothNumber: true, surface: true, state: true,
        notes: true, updatedAt: true,
      },
    });

    return NextResponse.json({ entry });
  } catch (err) {
    return unexpectedError(err);
  }
}

/** DELETE /api/odontogram — quita una entry específica. */
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

    const result = await prisma.odontogramEntry.deleteMany({
      where: {
        patientId: parsed.data.patientId,
        toothNumber: parsed.data.toothNumber,
        surface: parsed.data.surface ?? null,
      },
    });

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err) {
    return unexpectedError(err);
  }
}
