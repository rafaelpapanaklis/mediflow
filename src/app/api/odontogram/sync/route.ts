import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ensurePatientInClinic,
  getDbUser,
  isMissingTableError,
} from "@/lib/odontogram/api-auth";

export const dynamic = "force-dynamic";

/** conditionId reservado para la nota por diente. */
const NOTE_CONDITION = "__note__";

/* Mismas reglas de validación que el route principal /api/odontogram (un route
   de Next solo puede exportar handlers HTTP, así que no se pueden importar de
   ahí — mantener AMBOS en sync). */
const CONDITION_ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "conditionId inválido");

const SURFACE = z.enum(["M", "D", "V", "L", "O"]);

/** Dientes FDI reales: permanentes 11-18 / 21-28 / 31-38 / 41-48 y temporales
 *  51-55 / 61-65 / 71-75 / 81-85. El rango plano 11..85 aceptaba huecos
 *  inexistentes (19, 29, 39, 49, 56-60, 66-70, 76-80). */
const FDI_TEETH = new Set<number>([
  ...[1, 2, 3, 4].flatMap((q) => Array.from({ length: 8 }, (_, i) => q * 10 + 1 + i)),
  ...[5, 6, 7, 8].flatMap((q) => Array.from({ length: 5 }, (_, i) => q * 10 + 1 + i)),
]);

/** Shape `Records` del OdontogramV2: { [fdi]: { surfaces?, tooth?, note? } }. */
const RecSchema = z.object({
  surfaces: z.record(SURFACE, z.array(CONDITION_ID)).optional(),
  tooth: z.array(CONDITION_ID).optional(),
  note: z.string().max(2000).optional(),
});

const SyncSchema = z.object({
  patientId: z.string().min(1),
  records: z.record(RecSchema),
});

/**
 * POST /api/odontogram/sync — REEMPLAZA todo el odontograma vivo del paciente
 * con el `records` recibido (borra + reinserta, atómico).
 *
 * Lo usa "Guardar consulta": el odontograma del paciente AVANZA con cada
 * consulta (modelo "un odontograma que evoluciona"), mientras la consulta
 * guarda además su propia foto inmutable en specialtyData.odontogram. Así la
 * siguiente consulta arranca del estado más reciente y la pestaña "Odontograma"
 * queda coherente.
 */
export async function POST(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const parsed = SyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { patientId, records } = parsed.data;
    // Aislamiento multi-tenant: el paciente debe pertenecer a la clínica activa.
    if (!(await ensurePatientInClinic(patientId, dbUser.clinicId))) {
      return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }

    // Aplanar `records` -> filas de odontogram_entries.
    const rows: {
      patientId: string;
      toothNumber: number;
      surface: string | null;
      conditionId: string;
      notes: string | null;
    }[] = [];
    for (const [fdiStr, rec] of Object.entries(records)) {
      const toothNumber = Number(fdiStr);
      // Rechazo explícito (no skip silencioso): este endpoint REEMPLAZA el
      // odontograma completo; descartar dientes en silencio = pérdida de datos.
      if (!FDI_TEETH.has(toothNumber)) {
        return NextResponse.json(
          { error: "invalid_tooth", tooth: fdiStr },
          { status: 400 },
        );
      }
      for (const [surface, ids] of Object.entries(rec.surfaces ?? {})) {
        for (const conditionId of ids) {
          if (conditionId === NOTE_CONDITION) continue;
          rows.push({ patientId, toothNumber, surface, conditionId, notes: null });
        }
      }
      for (const conditionId of rec.tooth ?? []) {
        if (conditionId === NOTE_CONDITION) continue;
        rows.push({ patientId, toothNumber, surface: null, conditionId, notes: null });
      }
      if (rec.note && rec.note.trim()) {
        rows.push({ patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION, notes: rec.note });
      }
    }

    // Reemplazo atómico del odontograma del paciente (solo de ESTE paciente).
    await prisma.$transaction([
      prisma.odontogramEntry.deleteMany({ where: { patientId } }),
      ...(rows.length
        ? [prisma.odontogramEntry.createMany({ data: rows, skipDuplicates: true })]
        : []),
    ]);

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "La tabla odontogram_entries no existe o falta la migración. Aplica sql/odontogram-v2.sql en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[/api/odontogram/sync] unexpected error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
