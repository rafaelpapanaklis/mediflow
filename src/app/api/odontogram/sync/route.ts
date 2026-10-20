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

/** La base solo conoce M|D|V|L|O; una pestaña con el JS de antes manda la incisal como «I» (se guarda como «O»). */
const SURFACE = z.enum(["M", "D", "V", "L", "O", "I"]);
const aBase = (s: string) => (s === "I" ? "O" : s);

/** Hasta cuándo se acepta el modo viejo `records` (pestañas con el JS de antes del despliegue). */
const RECORDS_COMPAT_HASTA = Date.parse("2026-12-01T00:00:00-06:00");

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
    /** Modo viejo (JS de antes del despliegue): el odontograma ENTERO. Ya no reemplaza: solo añade (compat hasta RECORDS_COMPAT_HASTA). */
    records: z.record(RecSchema).optional(),
    /** Modo «Guardar consulta» (ws1-t11, revisión t4 O4): solo los dientes tocados. */
    cambios: z.record(CambioSchema).optional(),
  })
  .refine((b) => !!b.records !== !!b.cambios, { message: "manda records o cambios (uno de los dos)" });

type Rec = z.infer<typeof RecSchema>;

/** ids de `a` que no están en `b` */
const menos = (a: string[] = [], b: string[] = []) => a.filter((id) => !b.includes(id) && id !== NOTE_CONDITION);

/**
 * POST /api/odontogram/sync — «Guardar consulta» hace avanzar el odontograma
 * vivo del paciente (modelo «un odontograma que evoluciona»), mientras la
 * consulta guarda además su propia foto inmutable en specialtyData.odontogram.
 *
 * Ya NO reemplaza el odontograma entero (podía borrar lo que otra pestaña
 * autoguardó). Dos modos:
 *  - `cambios` (el de hoy): solo lo que el doctor añadió y quitó en cada diente
 *    que tocó, aplicado dentro de la transacción sobre la base actual;
 *  - `records` (pestañas con el JS de antes del despliegue): solo añade lo que
 *    falta, nunca borra; responde 410 desde RECORDS_COMPAT_HASTA.
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
      for (const letra of caras) {
        const surface = aBase(letra); // la «I» de una pestaña vieja se guarda como «O»
        const quitar = menos(base.surfaces?.[letra as keyof typeof base.surfaces], now.surfaces?.[letra as keyof typeof now.surfaces]);
        const poner = menos(now.surfaces?.[letra as keyof typeof now.surfaces], base.surfaces?.[letra as keyof typeof base.surfaces]);
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
    // un viaje a la base por diente, cara y hallazgo tocados: con muchos dientes
    // el tope por defecto (5 s) se queda corto (revisión t8, sospecha)
  }, { timeout: 20_000, maxWait: 10_000 });
  if (suplantacion) {
    await anotarAccionDeSuplantacion(suplantacion, {
      clinicId: dbUser.clinicId, entityType: "patient", entityId: patientId, action: "odontogram_sync",
      changes: detalle, patientId, ipAddress, userAgent,
    });
  }
  return NextResponse.json({ ok: true, dientes: dientes.length });
}

/**
 * Modo viejo `records` con la regla segura (N3-O8): dentro de una transacción
 * y sobre lo que haya en la base, añade los hallazgos y la nota que falten
 * (la nota solo si el diente no tiene otra distinta). Nunca borra ni pisa.
 *
 * Límite aceptado (cuarta vuelta, N4-O5; decisión 8): el JS viejo manda TODO
 * lo que cargó, así que lo que otra pestaña quitó mientras esa consulta estaba
 * abierta vuelve a ponerse — igual que hace hoy producción. Solo pasa con
 * pestañas abiertas antes del despliegue y hasta RECORDS_COMPAT_HASTA. Para
 * poder rastrearlo, la bitácora guarda QUÉ se añadió y qué se dejó sin
 * quitar, no solo cuántos (N4-O6).
 */
async function aplicarRecordsCompat(
  req: NextRequest,
  dbUser: { id: string; clinicId: string },
  patientId: string,
  records: Record<string, Rec>,
) {
  let total = 0;
  for (const [fdiStr, rec] of Object.entries(records)) {
    if (!FDI_TEETH.has(Number(fdiStr))) {
      return NextResponse.json({ error: "invalid_tooth", tooth: fdiStr }, { status: 400 });
    }
    for (const ids of Object.values(rec.surfaces ?? {})) total += (ids ?? []).length;
    total += (rec.tooth ?? []).length + 1;
    if (total > MAX_SYNC_ROWS) return NextResponse.json({ error: "payload_too_large", limit: MAX_SYNC_ROWS }, { status: 413 });
  }
  const { ipAddress, userAgent } = extractAuditMeta(req);
  const suplantacion = await suplantacionDeEstaPeticion();
  let detalle: unknown = null;
  let creadas = 0, sinQuitar = 0, notasSinPisar = 0;
  /** «diente:cara:hallazgo» (letras de la base; «-» = diente completo) */
  const agregadas: string[] = [];
  let sinQuitarClaves: string[] = [];
  await prisma.$transaction(async (tx) => {
    const antes = await tx.odontogramEntry.findMany({
      where: { patientId },
      select: { toothNumber: true, surface: true, conditionId: true, notes: true },
    });
    const clave = (t: number, s: string | null, c: string) => `${t}:${s ?? "-"}:${c}`;
    const hay = new Set(antes.map((r) => clave(r.toothNumber, r.surface, r.conditionId)));
    const pedidas = new Set<string>();
    for (const [fdiStr, rec] of Object.entries(records)) {
      const toothNumber = Number(fdiStr);
      for (const [letra, ids] of Object.entries(rec.surfaces ?? {})) {
        const surface = aBase(letra);
        for (const conditionId of ids ?? []) {
          if (conditionId === NOTE_CONDITION) continue;
          pedidas.add(clave(toothNumber, surface, conditionId));
          if (hay.has(clave(toothNumber, surface, conditionId))) continue;
          const n = (await tx.odontogramEntry.createMany({
            data: [{ patientId, toothNumber, surface, conditionId, notes: null }], skipDuplicates: true,
          })).count;
          creadas += n;
          if (n) agregadas.push(clave(toothNumber, surface, conditionId));
        }
      }
      for (const conditionId of rec.tooth ?? []) {
        if (conditionId === NOTE_CONDITION) continue;
        pedidas.add(clave(toothNumber, null, conditionId));
        if (hay.has(clave(toothNumber, null, conditionId))) continue;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`odontogram:${patientId}:${toothNumber}:${conditionId}`}))`;
        const ya = await tx.odontogramEntry.findFirst({ where: { patientId, toothNumber, surface: null, conditionId }, select: { id: true } });
        if (!ya) {
          await tx.odontogramEntry.create({ data: { patientId, toothNumber, surface: null, conditionId, notes: null } });
          creadas++;
          agregadas.push(clave(toothNumber, null, conditionId));
        }
      }
      const nota = (rec.note ?? "").trim();
      if (nota) {
        const actual = antes.find((r) => r.toothNumber === toothNumber && r.conditionId === NOTE_CONDITION);
        if (!actual) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`odontogram:${patientId}:${toothNumber}:${NOTE_CONDITION}`}))`;
          const ya = await tx.odontogramEntry.findFirst({ where: { patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION }, select: { id: true } });
          if (!ya) {
            await tx.odontogramEntry.create({ data: { patientId, toothNumber, surface: null, conditionId: NOTE_CONDITION, notes: nota } });
            creadas++;
            agregadas.push(clave(toothNumber, null, NOTE_CONDITION));
          }
        } else if ((actual.notes ?? "").trim() !== nota) {
          notasSinPisar++;
        }
      }
    }
    // lo que hay y la consulta no trae: antes se borraba; ahora se deja
    sinQuitarClaves = antes
      .filter((r) => r.conditionId !== NOTE_CONDITION && !pedidas.has(clave(r.toothNumber, r.surface, r.conditionId)))
      .map((r) => clave(r.toothNumber, r.surface, r.conditionId));
    sinQuitar = sinQuitarClaves.length;
    const changes = {
      _odontogram: {
        modo: "records-compat",
        after: { creadas, sinQuitar, notasSinPisar, agregadas, sinQuitarClaves },
      },
    };
    if (suplantacion) detalle = changes;
    else {
      await tx.auditLog.create({
        data: {
          clinicId: dbUser.clinicId, userId: dbUser.id, entityType: "patient", entityId: patientId,
          action: "odontogram_sync", changes, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null,
        },
      });
    }
  }, { timeout: 20_000, maxWait: 10_000 });
  if (suplantacion) {
    await anotarAccionDeSuplantacion(suplantacion, {
      clinicId: dbUser.clinicId, entityType: "patient", entityId: patientId, action: "odontogram_sync",
      changes: detalle, patientId, ipAddress, userAgent,
    });
  }
  return NextResponse.json({ ok: true, modo: "compat", creadas, sinQuitar, notasSinPisar });
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
    // Modo viejo (`records`): lo manda «Guardar consulta» de una pestaña que
    // sigue con el JS de antes del despliegue (revisión t8, N3-O8). Antes
    // REEMPLAZABA el odontograma entero; ahora, durante una temporada, se acepta
    // con la regla segura: solo AÑADE lo que falta. Sin la base de la consulta no
    // se sabe si algo que falta en `records` lo quitó el doctor o lo puso otra
    // pestaña después, así que no se borra nada (y se dice cuántas cosas no se
    // quitaron). La consulta guarda además su propia foto completa.
    if (parsed.data.records) {
      if (Date.now() >= RECORDS_COMPAT_HASTA) {
        return NextResponse.json(
          { error: "gone", hint: "El reemplazo completo del odontograma ya no existe: recarga la página para guardar solo los dientes tocados." },
          { status: 410 },
        );
      }
      return aplicarRecordsCompat(req, dbUser, patientId, parsed.data.records);
    }
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
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
