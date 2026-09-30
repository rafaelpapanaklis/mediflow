import type { OrthodonticDiagnosis, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { updateDiagnosisSchema } from "@/lib/validation/orthodontics";
import { isMissingColumnError } from "./alta-caso-tolerance";
import { validarArchivosInicialesDelDiagnostico, validarPersonasDelCaso } from "./validar-personas-del-caso-db";
import { cambiosDelDetalle, textoDeMovimientoDelDiagnostico, validarDiagnosticoDetalle, type DiagnosticoDetalle } from "./diagnostico-detalle";
import { columnaDeDiagnosticoDetalleExiste, escribirDetalle, leerDetalleParaGuardar } from "./diagnostico-detalle-db";

// Ortodoncia — GUARDAR el diagnóstico (ws1-t8), en tres tiempos para que la ventana del caso de ws1-t12 guarde
// los DOS pasos (Diagnóstico + Plan) con un solo «Guardar»:
//
//   1. `prepararGuardadoDelDiagnostico(ctx, input)` — valida TODO (zod de siempre, patrón esquelético, detalle,
//      doctor que refirió, archivos iniciales, diagnóstico de esta clínica) y NO escribe nada. Si el plan tampoco
//      tiene errores, recién entonces se escribe: ninguno de los dos queda a medias por un error de validación.
//   2. `ejecutarGuardadoDelDiagnostico(preparado, tx?)` — escribe columnas + detalle. Con `tx` (la transacción
//      de quien guarda también el plan) todo va en ella: si el plan falla, el diagnóstico se deshace.
//   3. `movimientoDelGuardado(preparado, resultado)` — los argumentos de `auditOrtho` (Movimientos): se llama
//      DESPUÉS de confirmar la transacción.
//
// `updateDiagnosis` (acción del paso cuando se guarda solo) es exactamente 1 → 2 → 3. `clinicId` y `userId`
// SIEMPRE de la sesión; `clinicId` vacío no consulta nada.

/** Campos de sql/ortodoncia-alta-caso.sql: si su columna aún no existe se guardan sin ellos. */
const ALTA_CASO_DIAGNOSIS_FIELDS = ["referredByDoctorId", "inObservation", "nextObservationDate"] as const;
const PATRONES = ["MESOFACIAL", "DOLICOFACIAL", "BRAQUIFACIAL"] as const;

export interface DiagnosticoPreparado {
  diagnosisId: string;
  clinicId: string;
  patientId: string;
  before: OrthodonticDiagnosis;
  /** Columnas a escribir (sin `undefined`). */
  data: Record<string, unknown>;
  /** undefined = el detalle no se toca. */
  detalleNuevo?: DiagnosticoDetalle;
}

export type Preparacion = { ok: true; preparado: DiagnosticoPreparado } | { ok: false; error: string };

export async function prepararGuardadoDelDiagnostico(ctx: { clinicId: string }, input: unknown): Promise<Preparacion> {
  if (!ctx.clinicId) return { ok: false, error: "Sesión sin clínica" };
  const parsed = updateDiagnosisSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  // Lo que el esquema de siempre no trae (zod lo descartaba en silencio): el patrón esquelético (el «tipo» del
  // VERT) y el diagnóstico completo, que va por SQL crudo a "diagnosticoDetalle".
  const crudo = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  let skeletalPattern: string | null | undefined;
  if ("skeletalPattern" in crudo) {
    const sp = crudo.skeletalPattern;
    if (sp !== null && sp !== "" && !(PATRONES as readonly unknown[]).includes(sp)) return { ok: false, error: "Patrón esquelético no válido" };
    skeletalPattern = (sp as string | null) || null;
  }
  let detalleNuevo: DiagnosticoDetalle | undefined;
  if (crudo.diagnosticoDetalle !== undefined) {
    const v = validarDiagnosticoDetalle(crudo.diagnosticoDetalle);
    if (v.ok === false) return { ok: false, error: v.error };
    detalleNuevo = v.detalle;
  }

  const before = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: parsed.data.diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return { ok: false, error: "Diagnóstico no encontrado" };

  // X1: el doctor que refirió tiene que ser del directorio de ESTA clínica (repetir el guardado no se re-valida).
  const personaAjena = await validarPersonasDelCaso({
    clinicId: ctx.clinicId,
    patientId: before.patientId,
    pedidas: { referredByDoctorId: parsed.data.referredByDoctorId },
    actuales: { referredByDoctorId: before.referredByDoctorId },
  });
  if (personaAjena) return { ok: false, error: personaAjena };
  // Solo lo que cambia: repetir los archivos que ya tenía no se re-valida.
  const cambia = (nuevo: string | null | undefined, actual: string | null) => (nuevo && nuevo !== actual ? nuevo : null);
  const archivoAjeno = await validarArchivosInicialesDelDiagnostico({
    clinicId: ctx.clinicId,
    patientId: before.patientId,
    initialPhotoSetId: cambia(parsed.data.initialPhotoSetId, before.initialPhotoSetId),
    initialCephFileId: cambia(parsed.data.initialCephFileId, before.initialCephFileId),
    initialScanFileId: cambia(parsed.data.initialScanFileId, before.initialScanFileId),
  });
  if (archivoAjeno) return { ok: false, error: archivoAjeno };

  const { diagnosisId, patientId: _informativo, ...rest } = parsed.data;
  void _informativo;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) data[key] = value;
  if (typeof data.nextObservationDate === "string") data.nextObservationDate = new Date(data.nextObservationDate);
  if (skeletalPattern !== undefined) data.skeletalPattern = skeletalPattern;

  return { ok: true, preparado: { diagnosisId, clinicId: ctx.clinicId, patientId: before.patientId, before, data, ...(detalleNuevo ? { detalleNuevo } : {}) } };
}

export interface ResultadoDelGuardado {
  updated: OrthodonticDiagnosis;
  altaCasoFieldsSaved: boolean;
  detalleAntes: DiagnosticoDetalle | null;
  detalleGuardado: DiagnosticoDetalle | null;
  /** Lo nuevo no se guardó (falta el SQL, o falló solo sin `tx`); lo de siempre sí. */
  avisoDetalle: string | null;
}

const AVISO_SIN_SQL =
  "Falta pegar sql/ortodoncia-diagnostico-completo.sql: lo nuevo del diagnóstico (facial, oclusal, cefalometría…) no se guardó; lo demás sí.";

async function columnasDeAltaCasoExisten(tx: Prisma.TransactionClient): Promise<boolean> {
  const filas = (await tx.$queryRaw`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'orthodontic_diagnoses'
       AND column_name IN ('referredByDoctorId', 'inObservation', 'nextObservationDate')`) as { n: number }[];
  return Number(filas[0]?.n ?? 0) === 3;
}

/**
 * Escribe lo preparado. Sin `tx`: igual que siempre (columnas; si faltan las de alta-caso, se reintenta sin
 * ellas; el detalle en su propia transacción y, si falla, se avisa sin deshacer lo demás). Con `tx`: TODO en la
 * transacción de quien llama —un error se propaga y deshace también lo suyo—; las columnas de alta-caso se
 * comprueban antes (dentro de una transacción no se puede reintentar tras un error).
 */
export async function ejecutarGuardadoDelDiagnostico(p: DiagnosticoPreparado, tx?: Prisma.TransactionClient): Promise<ResultadoDelGuardado> {
  const { diagnosisId, clinicId, data } = p;
  const conDetalleColumna = p.detalleNuevo ? await columnaDeDiagnosticoDetalleExiste() : false;
  const avisoDetalle = p.detalleNuevo && !conDetalleColumna ? AVISO_SIN_SQL : null;

  if (tx) {
    let datos = data;
    let altaCasoFieldsSaved = true;
    if (ALTA_CASO_DIAGNOSIS_FIELDS.some((k) => k in data) && !(await columnasDeAltaCasoExisten(tx))) {
      altaCasoFieldsSaved = false;
      datos = { ...data };
      for (const k of ALTA_CASO_DIAGNOSIS_FIELDS) delete datos[k];
    }
    // El `where` por id: el diagnóstico ya se comprobó contra la clínica en `preparar`.
    const updated = await tx.orthodonticDiagnosis.update({ where: { id: diagnosisId }, data: datos });
    let detalleAntes: DiagnosticoDetalle | null = null;
    let detalleGuardado: DiagnosticoDetalle | null = null;
    if (p.detalleNuevo && conDetalleColumna) {
      detalleAntes = await leerDetalleParaGuardar(tx, clinicId, diagnosisId);
      await escribirDetalle(tx, clinicId, diagnosisId, p.detalleNuevo);
      detalleGuardado = p.detalleNuevo;
    }
    return { updated, altaCasoFieldsSaved, detalleAntes, detalleGuardado, avisoDetalle };
  }

  let altaCasoFieldsSaved = true;
  const updated = await prisma.orthodonticDiagnosis.update({ where: { id: diagnosisId }, data }).catch(async (e) => {
    const touchesAltaCaso = ALTA_CASO_DIAGNOSIS_FIELDS.some((k) => k in data);
    if (!touchesAltaCaso || !isMissingColumnError(e)) throw e;
    altaCasoFieldsSaved = false;
    const reduced = { ...data };
    for (const k of ALTA_CASO_DIAGNOSIS_FIELDS) delete reduced[k];
    console.error("[ortho] diagnóstico: columnas de alta-caso.sql aún no existen, se guarda sin ellas:", e);
    return prisma.orthodonticDiagnosis.update({ where: { id: diagnosisId }, data: reduced });
  });

  let detalleAntes: DiagnosticoDetalle | null = null;
  let detalleGuardado: DiagnosticoDetalle | null = null;
  let aviso = avisoDetalle;
  if (p.detalleNuevo && conDetalleColumna) {
    try {
      await prisma.$transaction(async (t) => {
        detalleAntes = await leerDetalleParaGuardar(t, clinicId, diagnosisId);
        await escribirDetalle(t, clinicId, diagnosisId, p.detalleNuevo!);
      });
      detalleGuardado = p.detalleNuevo;
    } catch (e) {
      console.error("[ortho] diagnóstico: no se pudo guardar diagnosticoDetalle:", e);
      aviso = "No se pudo guardar lo nuevo del diagnóstico (facial, oclusal, cefalometría…); lo demás sí. Inténtalo de nuevo.";
    }
  }
  return { updated, altaCasoFieldsSaved, detalleAntes, detalleGuardado, avisoDetalle: aviso };
}

/**
 * Los `before`/`after` para `auditOrtho` (Movimientos del paciente): qué apartados cambiaron, con la frase
 * humana en `_mov` y sin valores clínicos en ella. `null` = no cambió nada (no se registra movimiento).
 */
export function movimientoDelGuardado(
  p: DiagnosticoPreparado,
  r: ResultadoDelGuardado,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const cambioDetalle = r.detalleGuardado ? cambiosDelDetalle(r.detalleAntes, r.detalleGuardado) : { secciones: [], campos: [] };
  const columnasCambiadas = Object.keys(p.data).filter(
    (k) => JSON.stringify((p.before as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify((r.updated as unknown as Record<string, unknown>)[k] ?? null),
  );
  if (columnasCambiadas.length === 0 && cambioDetalle.campos.length === 0) return null;
  const plano = (d: DiagnosticoDetalle | null, campos: string[]) =>
    Object.fromEntries(
      campos.map((c) => {
        const [, sec, campo] = c.split(".");
        return [c, (d as Record<string, Record<string, unknown>> | null)?.[sec!]?.[campo!] ?? null];
      }),
    );
  return {
    before: { ...(p.before as unknown as Record<string, unknown>), ...plano(r.detalleAntes, cambioDetalle.campos) },
    after: {
      ...(r.updated as unknown as Record<string, unknown>),
      ...plano(r.detalleGuardado, cambioDetalle.campos),
      _mov: { texto: textoDeMovimientoDelDiagnostico(columnasCambiadas, cambioDetalle.secciones) },
    },
  };
}
