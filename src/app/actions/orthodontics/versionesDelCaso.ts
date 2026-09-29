"use server";
// Ortodoncia — REEVALUACIONES del caso (ws1-t8): leer la línea de tiempo de versiones y cerrar la versión viva
// con «Nueva reevaluación». Leer pide `medicalRecord.view`; reevaluar, `medicalRecord.edit`. `clinicId` de la
// sesión y el paciente se comprueba contra su visibilidad ANTES de leer o escribir.
//
// Sin sql/ortodoncia-reevaluaciones.sql: leer devuelve `tabla: false` (la ficha no pinta la línea de tiempo) y
// reevaluar dice que falta el SQL.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { cargarDiagnosticoDetalle } from "@/lib/orthodontics/diagnostico-detalle-db";
import { cargarPlanDetalle } from "@/lib/orthodontics/plan-detalle-db";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { cerrarVersionDelCaso, listarVersionesDelCaso } from "@/lib/orthodontics/versiones-caso-db";
import {
  etiquetaDeVersion,
  lineaDeTiempo,
  queCambio,
  validarMotivo,
  versionLegible,
  type CambioEntreVersiones,
  type PuntoDeVersion,
  type VersionLegible,
} from "@/lib/orthodontics/versiones-caso";
import { getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface VersionesDelCaso {
  /** false = falta pegar el SQL de reevaluaciones. */
  tabla: boolean;
  linea: PuntoDeVersion[];
  /** Cada versión (cerradas y la actual, en el orden de `linea`) redactada, con quién la cerró y qué cambió en la siguiente. */
  versiones: Array<{
    numero: number;
    cerradaPor: string | null;
    legible: VersionLegible;
    /** Qué cambió de esta versión a la siguiente (vacío en la actual). */
    cambiosALaSiguiente: CambioEntreVersiones[];
  }>;
}

const plano = (v: unknown) => JSON.parse(JSON.stringify(v ?? {})) as Record<string, unknown>;

async function casoVisible(treatmentPlanId: string, ctx: { clinicId: string; userId: string; role: string }) {
  const caso = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    include: { patient: { select: { visibleUserIds: true } }, diagnosis: true },
  });
  if (!caso) return null;
  if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, caso.patient?.visibleUserIds)) return null;
  return caso;
}

export async function leerVersionesDelCaso(treatmentPlanId: string): Promise<ActionResult<VersionesDelCaso>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");
  if (typeof treatmentPlanId !== "string" || !treatmentPlanId) return fail("Falta el caso");

  const caso = await casoVisible(treatmentPlanId, ctx);
  if (!caso) return fail("Caso no encontrado");
  const cerradas = await listarVersionesDelCaso(ctx.clinicId, caso.id);
  if (cerradas === null) return ok({ tabla: false, linea: [], versiones: [] });

  // La versión viva: lo que hoy está en la ficha.
  const [detalle, planDetalle, tecnica] = await Promise.all([
    cargarDiagnosticoDetalle(ctx.clinicId, caso.diagnosisId),
    cargarPlanDetalle(ctx.clinicId, caso.id),
    cargarNombreDeTecnica(ctx.clinicId, caso.id).catch(() => null),
  ]);
  const { patient: _p, diagnosis, ...planSolo } = caso;
  void _p;
  const viva = versionLegible({
    diagnostico: plano(diagnosis),
    diagnosticoDetalle: detalle,
    plan: { ...plano(planSolo), ...(tecnica ? { techniqueLabel: tecnica } : {}) },
    planDetalle,
  });

  const legibles = [...cerradas.map((v) => versionLegible(v)), viva];
  const linea = lineaDeTiempo(cerradas, caso.diagnosis.diagnosedAt.toISOString());
  return ok({
    tabla: true,
    linea,
    versiones: linea.map((p, i) => ({
      numero: p.numero,
      cerradaPor: cerradas[i]?.cerradaPor ?? null,
      legible: legibles[i]!,
      cambiosALaSiguiente: i < legibles.length - 1 ? queCambio(legibles[i]!, legibles[i + 1]!) : [],
    })),
  });
}

export async function crearReevaluacion(input: unknown): Promise<ActionResult<{ numero: number; etiqueta: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const treatmentPlanId = typeof o.treatmentPlanId === "string" ? o.treatmentPlanId : "";
  if (!treatmentPlanId) return fail("Falta el caso");
  const m = validarMotivo(o.motivo);
  if (m.ok === false) return fail(m.error);

  const caso = await casoVisible(treatmentPlanId, ctx);
  if (!caso) return fail("Caso no encontrado");

  const r = await cerrarVersionDelCaso({ clinicId: ctx.clinicId, userId: ctx.userId, treatmentPlanId: caso.id, motivo: m.motivo });
  if (r.ok === false) return fail(r.error);

  const nueva = r.numero + 1;
  await registrarMovimientoDelPaciente({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    patientId: r.patientId,
    entityType: "orthodontic-plan",
    entityId: caso.id,
    action: "update",
    texto: `Abrió la ${etiquetaDeVersion(nueva).toLowerCase()} del caso de ortodoncia (quedó guardada la versión «${etiquetaDeVersion(r.numero)}» del diagnóstico y del plan)`,
    campos: ["reevaluacion"],
    cambios: { reevaluacion: { before: r.numero, after: nueva } },
  });

  try {
    revalidatePath(`/dashboard/patients/${r.patientId}`);
  } catch (e) {
    console.error("[ortho] crearReevaluacion · revalidate:", e);
  }
  return ok({ numero: nueva, etiqueta: etiquetaDeVersion(nueva) });
}
