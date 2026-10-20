import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { extractAuditMeta } from "@/lib/audit";
import { anotarAccionDeSuplantacion, suplantacionDeEstaPeticion } from "@/lib/admin/suplantacion";
import {
  ensurePatientInClinic,
  getDbUser,
  isMissingTableError,
  puedeEscribirOdontograma,
} from "@/lib/odontogram/api-auth";

export const dynamic = "force-dynamic";

/** conditionId reservado para la nota por diente. */
const NOTE_CONDITION = "__note__";

/** Quién puede REEMPLAZAR el odontograma vivo: puedeEscribirOdontograma
 *  (@/lib/odontogram/api-auth → guardia clínica). Recepción/readonly NO. */

/** Tope de filas aplanadas (anti payload-bomba: este endpoint reemplaza TODO
 *  el odontograma). Un odontograma real queda muy por debajo (~900 máx). */
const MAX_SYNC_ROWS = 2000;

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

/** Un diente tocado en la consulta: cómo estaba al tocarlo y cómo lo dejó. */
const CambioSchema = z.object({ base: RecSchema, now: RecSchema });

const SyncSchema = z
  .object({
    patientId: z.string().min(1),
    /** Modo viejo: el odontograma ENTERO, que reemplaza al vivo. */
    records: z.record(RecSchema).optional(),
    /** Modo «Guardar consulta» (ws1-t11, revisión t4 O4): solo los dientes tocados. */
    cambios: z.record(CambioSchema).optional(),
  })
  .refine((b) => !!b.records !== !!b.cambios, { message: "manda records o cambios (uno de los dos)" });

type Rec = z.infer<typeof RecSchema>;

/** ids de `a` que no están en `b` */
const menos = (a: string[] = [], b: string[] = []) => a.filter((id) => !b.includes(id) && id !== NOTE_CONDITION);

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
/**
 * Modo `cambios`: aplica, DENTRO de una transacción y sobre lo que haya en la
 * base en ese momento, solo lo que el doctor añadió y quitó en cada diente que
 * tocó (más la nota si la cambió). No reemplaza nada más: lo que otra pestaña
 * autoguardó —incluso en el mismo diente— se queda. Las altas de diente
 * completo y la nota toman el mismo candado que el PUT de /api/odontogram y de
 * /note, así que tampoco se duplican si coinciden con un autoguardado.
 */
async function aplicarCambios(
  req: NextRequest,
  dbUser: { id: string; clinicId: string },
  patientId: string,
  cambios: Record<string, { base?: Rec; now?: Rec }>,
) {
  const VACIO: Rec = { surfaces: {}, tooth: [] };
  let total = 0;
  for (const [fdiStr, c] of Object.entries(cambios)) {
    if (!FDI_TEETH.has(Number(fdiStr))) {
      return NextResponse.json({ error: "invalid_tooth", tooth: fdiStr }, { status: 400 });
    }
    for (const r of [c.base ?? VACIO, c.now ?? VACIO]) {
      for (const ids of Object.values(r.surfaces ?? {})) total += ids.length;
      total += (r.tooth ?? []).length + 1;
    }
    if (total > MAX_SYNC_ROWS) {
      return NextResponse.json({ error: "payload_too_large", limit: MAX_SYNC_ROWS }, { status: 413 });
    }
  }
  const dientes = Object.keys(cambios).map(Number);
  const { ipAddress, userAgent } = extractAuditMeta(req);
  const suplantacion = await suplantacionDeEstaPeticion();
  let detalle: unknown = null;
  await prisma.$transaction(async (tx) => {
    const prevRows = await tx.odontogramEntry.findMany({
      where: { patientId, toothNumber: { in: dientes } },
      select: { toothNumber: true, surface: true, conditionId: true, notes: true },
      orderBy: { toothNumber: "asc" },
    });
    let borradas = 0, creadas = 0;
    for (const [fdiStr, c] of Object.entries(cambios)) {
      const base = c.base ?? VACIO, now = c.now ?? VACIO;
      const toothNumber = Number(fdiStr);
      const caras = new Set([...Object.keys(base.surfaces ?? {}), ...Object.keys(now.surfaces ?? {})]);
      for (const surface of caras) {
        const quitar = menos(base.surfaces?.[surface as keyof typeof base.surfaces], now.surfaces?.[surface as keyof typeof now.surfaces]);
        const poner = menos(now.surfaces?.[surface as keyof typeof now.surfaces], base.surfaces?.[surface as keyof typeof base.surfaces]);
        if (quitar.length) {
          borradas += (await tx.odontogramEntry.deleteMany({ where: { patientId, toothNumber, surface, conditionId: { in: quitar } } })).count;
        }
        if (poner.length) {
          creadas += (await tx.odontogramEntry.createMany({
            data: poner.map((conditionId) => ({ patientId, toothNumber, surface, conditionId, notes: null })),
            skipDuplicates: true,
          })).count;
        }
      }
      const quitarDiente = menos(base.tooth, now.tooth);
      if (quitarDiente.length) {
        borradas += (await tx.odontogramEntry.deleteMany({ where: { patientId, toothNumber, surface: null, conditionId: { in: quitarDiente } } })).count;
      }
      for (const conditionId of menos(now.tooth, base.tooth)) {
        // surface NULL: la unique no lo cubre → mismo candado que el PUT
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`odontogram:${patientId}:${toothNumber}:${conditionId}`}))`;
        const ya = await tx.odontogramEntry.findFirst({ where: { patientId, toothNumber, surface: null, conditionId }, select: { id: true } });
        if (!ya) { await tx.odontogramEntry.create({ data: { patientId, toothNumber, surface: null, conditionId, notes: null } }); creadas++; }
      }
      const notaAntes = (base.note ?? "").trim(), notaAhora = (now.note ?? "").trim();
      if (notaAntes !== notaAhora) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`odontogram:${patientId}:${toothNumber}:${NOTE_CONDITION}`}))`;
        borradas += (await tx.odontogramEntry.deleteMany({ where: { patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION } })).count;
        if (notaAhora) {
          await tx.odontogramEntry.create({ data: { patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION, notes: notaAhora } });
          creadas++;
        }
      }
    }
    const changes = {
      _odontogram: { before: { dientes, rows: prevRows }, after: { borradas, creadas }, modo: "cambios" },
    };
    if (suplantacion) {
      detalle = changes;
    } else {
      await tx.auditLog.create({
        data: {
          clinicId: dbUser.clinicId, userId: dbUser.id, entityType: "patient", entityId: patientId,
          action: "odontogram_sync", changes, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null,
        },
      });
    }
  });
  if (suplantacion) {
    await anotarAccionDeSuplantacion(suplantacion, {
      clinicId: dbUser.clinicId, entityType: "patient", entityId: patientId, action: "odontogram_sync",
      changes: detalle, patientId, ipAddress, userAgent,
    });
  }
  return NextResponse.json({ ok: true, dientes: dientes.length });
}

export async function POST(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!puedeEscribirOdontograma(dbUser)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = SyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { patientId } = parsed.data;
    // Aislamiento multi-tenant + visibilidad (Ola 3): sync borra y reinserta el
    // odontograma COMPLETO — un doctor excluido no debe poder reemplazarlo.
    if (!(await ensurePatientInClinic(patientId, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId }))) {
      return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }

    if (parsed.data.cambios) {
      return aplicarCambios(req, dbUser, patientId, parsed.data.cambios);
    }
    const records = parsed.data.records!;

    // Tope ANTES de aplanar: cuenta longitudes sin materializar objetos-fila,
    // con salida temprana (una bomba de 10^6 ids no llega a construir rows).
    let flatCount = 0;
    for (const rec of Object.values(records)) {
      for (const ids of Object.values(rec.surfaces ?? {})) flatCount += ids.length;
      flatCount += (rec.tooth ?? []).length;
      if (rec.note) flatCount += 1;
      if (flatCount > MAX_SYNC_ROWS) {
        return NextResponse.json(
          { error: "payload_too_large", limit: MAX_SYNC_ROWS },
          { status: 413 },
        );
      }
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

    const { ipAddress, userAgent } = extractAuditMeta(req);
    // Reemplazo atómico del odontograma del paciente (solo de ESTE paciente),
    // con snapshot defensivo: las filas previas quedan serializadas en
    // audit_logs.changes (Json) dentro de la MISMA transacción — si algo
    // falla no hay ni borrado ni snapshot; si commitea, el estado anterior es
    // restaurable a mano. (Sin tabla de versiones en el schema, audit es el
    // lugar natural.)
    // «Ver como clínica» (decisión A): la foto de antes va a la bitácora de admin, no a la de la clínica.
    const suplantacion = await suplantacionDeEstaPeticion();
    let cambiosParaAdmin: unknown = null;
    await prisma.$transaction(async (tx) => {
      const prevRows = await tx.odontogramEntry.findMany({
        where: { patientId },
        select: { toothNumber: true, surface: true, conditionId: true, notes: true },
        orderBy: { toothNumber: "asc" },
      });
      const del = await tx.odontogramEntry.deleteMany({ where: { patientId } });
      const created = rows.length
        ? await tx.odontogramEntry.createMany({ data: rows, skipDuplicates: true })
        : { count: 0 };
      if (suplantacion) {
        cambiosParaAdmin = {
          _odontogram: {
            before: { count: del.count, rows: prevRows },
            after: { count: created.count },
          },
        };
      } else {
        await tx.auditLog.create({
          data: {
            clinicId: dbUser.clinicId,
            userId: dbUser.id,
            entityType: "patient",
            entityId: patientId,
            action: "odontogram_sync",
            changes: {
              _odontogram: {
                before: { count: del.count, rows: prevRows },
                after: { count: created.count },
              },
            },
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
          },
        });
      }
    });
    if (suplantacion) {
      await anotarAccionDeSuplantacion(suplantacion, {
        clinicId: dbUser.clinicId, entityType: "patient", entityId: patientId, action: "odontogram_sync",
        changes: cambiosParaAdmin, patientId, ipAddress, userAgent,
      });
    }

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
