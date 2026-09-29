"use server";
// Orthodontics — action 2/15: updateDiagnosis. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { updateDiagnosisSchema } from "@/lib/validation/orthodontics";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { validarArchivosInicialesDelDiagnostico, validarPersonasDelCaso } from "@/lib/orthodontics/validar-personas-del-caso-db";
import {
  cambiosDelDetalle,
  textoDeMovimientoDelDiagnostico,
  validarDiagnosticoDetalle,
  type DiagnosticoDetalle,
} from "@/lib/orthodontics/diagnostico-detalle";
import { columnaDeDiagnosticoDetalleExiste, escribirDetalle, leerDetalleParaGuardar } from "@/lib/orthodontics/diagnostico-detalle-db";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

// Ola 1 (ws1-t6) — campos de sql/ortodoncia-alta-caso.sql: si el update los
// toca y la columna aún no existe (P2021/P2022), se reintenta sin ellos en
// vez de romper el resto de la edición.
const ALTA_CASO_DIAGNOSIS_FIELDS = [
  "referredByDoctorId",
  "inObservation",
  "nextObservationDate",
] as const;

const PATRONES = ["MESOFACIAL", "DOLICOFACIAL", "BRAQUIFACIAL"] as const;

export async function updateDiagnosis(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean; avisoDetalle: string | null }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updateDiagnosisSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  // ws1-t8 — lo que el esquema de siempre no trae (zod lo descartaba en silencio): el patrón esquelético
  // (el «tipo» del VERT) y el diagnóstico completo, que va por SQL crudo a "diagnosticoDetalle".
  const crudo = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  let skeletalPattern: string | null | undefined;
  if ("skeletalPattern" in crudo) {
    const sp = crudo.skeletalPattern;
    if (sp !== null && sp !== "" && !(PATRONES as readonly unknown[]).includes(sp)) return fail("Patrón esquelético no válido");
    skeletalPattern = (sp as string | null) || null;
  }
  let detalleNuevo: DiagnosticoDetalle | undefined;
  if (crudo.diagnosticoDetalle !== undefined) {
    const v = validarDiagnosticoDetalle(crudo.diagnosticoDetalle);
    if (v.ok === false) return fail(v.error);
    detalleNuevo = v.detalle;
  }

  const before = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: parsed.data.diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return fail("Diagnóstico no encontrado");

  // X1: el doctor que refirió tiene que ser del directorio de ESTA clínica
  // (repetir el que ya estaba guardado no se re-valida).
  const personaAjena = await validarPersonasDelCaso({
    clinicId: ctx.clinicId,
    patientId: before.patientId,
    pedidas: { referredByDoctorId: parsed.data.referredByDoctorId },
    actuales: { referredByDoctorId: before.referredByDoctorId },
  });
  if (personaAjena) return fail(personaAjena);
  // Solo lo que cambia: repetir los archivos que ya tenía no se re-valida.
  const cambia = (nuevo: string | null | undefined, actual: string | null) =>
    nuevo && nuevo !== actual ? nuevo : null;
  const archivoAjeno = await validarArchivosInicialesDelDiagnostico({
    clinicId: ctx.clinicId,
    patientId: before.patientId,
    initialPhotoSetId: cambia(parsed.data.initialPhotoSetId, before.initialPhotoSetId),
    initialCephFileId: cambia(parsed.data.initialCephFileId, before.initialCephFileId),
    initialScanFileId: cambia(parsed.data.initialScanFileId, before.initialScanFileId),
  });
  if (archivoAjeno) return fail(archivoAjeno);

  const { diagnosisId, patientId, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  if (typeof data.nextObservationDate === "string") {
    data.nextObservationDate = new Date(data.nextObservationDate);
  }
  if (skeletalPattern !== undefined) data.skeletalPattern = skeletalPattern;

  try {
    let altaCasoFieldsSaved = true;
    const updated = await prisma.orthodonticDiagnosis
      .update({ where: { id: diagnosisId }, data })
      .catch(async (e) => {
        const touchesAltaCaso = ALTA_CASO_DIAGNOSIS_FIELDS.some((k) => k in data);
        if (!touchesAltaCaso || !isMissingColumnError(e)) throw e;
        altaCasoFieldsSaved = false;
        const reduced = { ...data };
        for (const k of ALTA_CASO_DIAGNOSIS_FIELDS) delete reduced[k];
        console.error(
          "[ortho] updateDiagnosis: columnas de alta-caso.sql aún no existen, se guarda sin ellas:",
          e,
        );
        return prisma.orthodonticDiagnosis.update({ where: { id: diagnosisId }, data: reduced });
      });

    // El diagnóstico completo, bajo candado de fila. Sin la columna (SQL sin pegar) lo de siempre ya quedó y
    // se avisa; si falla, lo de siempre también quedó: se avisa sin deshacerlo.
    let avisoDetalle: string | null = null;
    let detalleAntes: DiagnosticoDetalle | null = null;
    let detalleGuardado: DiagnosticoDetalle | null = null;
    if (detalleNuevo) {
      if (!(await columnaDeDiagnosticoDetalleExiste())) {
        avisoDetalle = "Falta pegar sql/ortodoncia-diagnostico-completo.sql: lo nuevo del diagnóstico (facial, oclusal, cefalometría…) no se guardó; lo demás sí.";
      } else {
        try {
          await prisma.$transaction(async (tx) => {
            detalleAntes = await leerDetalleParaGuardar(tx, ctx.clinicId, diagnosisId);
            await escribirDetalle(tx, ctx.clinicId, diagnosisId, detalleNuevo!);
          });
          detalleGuardado = detalleNuevo;
        } catch (e) {
          console.error("[ortho] updateDiagnosis: no se pudo guardar diagnosticoDetalle:", e);
          avisoDetalle = "No se pudo guardar lo nuevo del diagnóstico (facial, oclusal, cefalometría…); lo demás sí. Inténtalo de nuevo.";
        }
      }
    }

    // Movimientos del paciente: qué apartados cambiaron, sin valores clínicos en la frase.
    const cambioDetalle = detalleGuardado ? cambiosDelDetalle(detalleAntes, detalleGuardado) : { secciones: [], campos: [] };
    const columnasCambiadas = Object.keys(data).filter(
      (k) => JSON.stringify((before as Record<string, unknown>)[k] ?? null) !== JSON.stringify((updated as Record<string, unknown>)[k] ?? null),
    );
    const planoDetalle = (d: DiagnosticoDetalle | null, campos: string[]) =>
      Object.fromEntries(
        campos.map((c) => {
          const [, sec, campo] = c.split(".");
          return [c, (d as Record<string, Record<string, unknown>> | null)?.[sec!]?.[campo!] ?? null];
        }),
      );
    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.DIAGNOSIS_UPDATED,
      entityType: "OrthodonticDiagnosis",
      entityId: updated.id,
      patientId: before.patientId,
      before: { ...(before as unknown as Record<string, unknown>), ...planoDetalle(detalleAntes, cambioDetalle.campos) },
      after: {
        ...(updated as unknown as Record<string, unknown>),
        ...planoDetalle(detalleGuardado, cambioDetalle.campos),
        _mov: { texto: textoDeMovimientoDelDiagnostico(columnasCambiadas, cambioDetalle.secciones) },
      },
    });

    revalidatePath(`/dashboard/patients/${updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${updated.patientId}`);
    void patientId; // patientId del input solo es informativo
    return ok({ id: updated.id, altaCasoFieldsSaved, avisoDetalle });
  } catch (e) {
    console.error("[ortho] updateDiagnosis failed:", e);
    return fail("No se pudo actualizar el diagnóstico");
  }
}
