"use server";
// Ortodoncia — «Completar varios a la vez» (ws1-t8, auditoría de BEVADENT: F11 y mejora 8). Guarda los cambios de la
// tabla de casos incompletos: doctor tratante (solo donde falta), tiempo de tratamiento, controles previstos y la
// marca «migrado, sin datos de diagnóstico». Cada caso va por su cuenta: uno que no se pueda guardar no frena a los
// demás, y la respuesta dice cuál y por qué.
//
// Reglas de la casa: `clinicId` y usuario SIEMPRE de la sesión; permiso `medicalRecord.edit` + módulo + acceso a
// Ortodoncia (`getOrthoActionContext`); un paciente restringido no existe para quien no lo ve; los casos se releen
// en el servidor (nada del navegador se da por bueno); el plan se guarda por `aplicarPlanDetalle` (la misma vía que
// «Editar plan», con su bitácora) y el doctor por la misma validación que «Datos del caso».

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { ACTIVE_PLAN_STATUSES } from "@/lib/orthodontics/specialty-kpis";
import { validarPersonasDelCaso } from "@/lib/orthodontics/validar-personas-del-caso-db";
import { actualizarPlanDetalle, cargarPlanDetalle, columnaDePlanDetalleExiste } from "@/lib/orthodontics/plan-detalle-db";
import { aplicarPlanDetalle } from "@/lib/orthodontics/plan-detalle-guardar";
import { planDetalleVacio, type PlanDetalle } from "@/lib/orthodontics/plan-detalle";
import {
  esCasoMigrado,
  motivoParaNoAplicar,
  textoDeMovimientoDeLaMarca,
  validarCambiosEnBloque,
  type CambioDeUnCaso,
} from "@/lib/orthodontics/completar-casos";
import type { AuthContext } from "@/lib/auth-context";
import { auditOrtho, getOrthoActionContext } from "../_helpers";
import { ORTHO_AUDIT_ACTIONS } from "../audit-actions";
import { fail, isFailure, ok, type ActionResult } from "../result";

export interface ResultadoDeUnCaso {
  planId: string;
  ok: boolean;
  /** Por qué no se guardó (o qué parte no se guardó). */
  error?: string;
}

interface CasoReleido {
  id: string;
  patientId: string;
  treatingDoctorId: string | null;
  retentionPlanText: string | null;
  diagnosis: { etiologyNotes: string | null; clinicalSummary: string | null } | null;
  patient: { visibleUserIds: string[] };
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function completarCasosEnBloque(input: unknown): Promise<ActionResult<{ guardados: number; resultados: ResultadoDeUnCaso[] }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!ctx.clinicId || !ctx.userId) return fail("No autenticado");

  const v = validarCambiosEnBloque((input as { cambios?: unknown } | null)?.cambios);
  if (!v.ok) return fail(v.error);
  if (v.cambios.length === 0) return ok({ guardados: 0, resultados: [] });

  // Releer los casos: de ESTA clínica, activos, sin borrar, y de pacientes que esta persona ve.
  const ids = v.cambios.map((c) => c.planId);
  const where = { clinicId: ctx.clinicId, id: { in: ids }, deletedAt: null, status: { in: [...ACTIVE_PLAN_STATUSES] } };
  const select = {
    id: true,
    patientId: true,
    retentionPlanText: true,
    diagnosis: { select: { etiologyNotes: true, clinicalSummary: true } },
    patient: { select: { visibleUserIds: true } },
  } as const;
  let casos: CasoReleido[];
  try {
    casos = (await prisma.orthodonticTreatmentPlan.findMany({ where, select: { ...select, treatingDoctorId: true } })) as CasoReleido[];
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
    // Sin la columna del doctor (sql/ortodoncia-nucleo.sql sin pegar): no se puede poner doctor.
    casos = (await prisma.orthodonticTreatmentPlan.findMany({ where, select })).map((c) => ({ ...c, treatingDoctorId: null })) as CasoReleido[];
  }
  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const porId = new Map(casos.filter((c) => canSeePatient(viewer, c.patient.visibleUserIds)).map((c) => [c.id, c]));
  const planGuardable = await columnaDePlanDetalleExiste();

  const resultados: ResultadoDeUnCaso[] = [];
  const pacientes = new Set<string>();
  for (const cambio of v.cambios) {
    const caso = porId.get(cambio.planId);
    if (!caso) {
      resultados.push({ planId: cambio.planId, ok: false, error: "El caso ya no está activo o no se encontró." });
      continue;
    }
    const plan = planGuardable ? await cargarPlanDetalle(ctx.clinicId, caso.id) : null;
    const migrado = esCasoMigrado({
      etiologyNotes: caso.diagnosis?.etiologyNotes,
      clinicalSummary: caso.diagnosis?.clinicalSummary,
      retentionPlanText: caso.retentionPlanText,
      migradoSinDiagnostico: plan?.migradoSinDiagnostico === true,
    });
    const motivo = motivoParaNoAplicar(cambio, { migrado, doctorId: caso.treatingDoctorId, planGuardable });
    if (motivo) {
      resultados.push({ planId: caso.id, ok: false, error: motivo });
      continue;
    }
    const error = await aplicarUnCaso({ ctx, caso, cambio, plan });
    // Aun con error, lo que sí quedó (p. ej. el doctor) se ve al refrescar.
    pacientes.add(caso.patientId);
    resultados.push(error ? { planId: caso.id, ok: false, error } : { planId: caso.id, ok: true });
  }

  revalidatePath("/dashboard/orthodontics/alertas");
  revalidatePath("/dashboard/orthodontics/tablero");
  revalidatePath("/dashboard/orthodontics/completar");
  for (const p of pacientes) revalidatePath(`/dashboard/patients/${p}`);
  return ok({ guardados: resultados.filter((r) => r.ok).length, resultados });
}

/** Aplica el cambio de UN caso. Devuelve el error para el usuario, o null. */
async function aplicarUnCaso(a: {
  ctx: AuthContext;
  caso: CasoReleido;
  cambio: CambioDeUnCaso;
  plan: PlanDetalle | null;
}): Promise<string | null> {
  const { ctx, caso, cambio } = a;

  // 1 · Doctor tratante, solo donde falta (cambiarlo es «Datos del caso», que ofrece mover los controles agendados).
  if (cambio.doctorId && cambio.doctorId !== caso.treatingDoctorId) {
    const ajeno = await validarPersonasDelCaso({
      clinicId: ctx.clinicId,
      patientId: caso.patientId,
      pedidas: { treatingDoctorId: cambio.doctorId },
      actuales: { treatingDoctorId: caso.treatingDoctorId },
    });
    if (ajeno) return ajeno;
    try {
      // `treatingDoctorId: null` en el where: si alguien le puso doctor mientras tanto, no se pisa.
      const r = await prisma.orthodonticTreatmentPlan.updateMany({
        where: { id: caso.id, clinicId: ctx.clinicId, treatingDoctorId: null },
        data: { treatingDoctorId: cambio.doctorId },
      });
      if (r.count === 0) return "Este caso ya tiene doctor tratante: se cambia desde «Datos del caso».";
      // El rastro de siempre del doctor (de ahí sale a quién se atribuye cada cobro, produccion.ts).
      await auditOrtho({
        ctx,
        action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED,
        entityType: "OrthodonticTreatmentPlan",
        entityId: caso.id,
        patientId: caso.patientId,
        before: { treatingDoctorId: caso.treatingDoctorId },
        after: { treatingDoctorId: cambio.doctorId },
      });
    } catch (e) {
      if (esRelacionAusente(e)) return "Falta pegar sql/ortodoncia-nucleo.sql: el doctor tratante no se puede guardar todavía.";
      console.error("[ortodoncia:completar] no se pudo guardar el doctor:", e);
      return "No se pudo guardar el doctor tratante.";
    }
  }

  // 2 · Tiempo de tratamiento y controles previstos: por la misma vía que «Editar plan» (bitácora incluida).
  if (cambio.controlesPrevistos !== undefined || cambio.duracionMeses !== undefined) {
    const actual = a.plan ?? planDetalleVacio();
    const r = await aplicarPlanDetalle({
      ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
      treatmentPlanId: caso.id,
      patientId: caso.patientId,
      plan: { ...actual, controlesPrevistos: cambio.controlesPrevistos ?? actual.controlesPrevistos },
      ...(cambio.duracionMeses !== undefined ? { duracionMeses: cambio.duracionMeses } : {}),
    });
    if (!r.ok) return "error" in r ? r.error : "No se pudo guardar el plan de tratamiento.";
  }

  // 3 · La marca «migrado, sin datos de diagnóstico» (solo en casos migrados: ya lo comprobó `motivoParaNoAplicar`).
  if (cambio.migradoSinDiagnostico !== undefined && cambio.migradoSinDiagnostico !== (a.plan?.migradoSinDiagnostico === true)) {
    const poner = cambio.migradoSinDiagnostico;
    const r = await actualizarPlanDetalle(ctx.clinicId, caso.id, (actual) => {
      const { migradoSinDiagnostico: _m, ...resto } = actual;
      void _m;
      return poner ? { ...resto, migradoSinDiagnostico: true } : (resto as PlanDetalle);
    });
    if (!r.ok) {
      if ("motivo" in r && r.motivo === "sin-columna") return "Falta pegar sql/ortodoncia-plan-de-tratamiento.sql: la marca no se puede guardar.";
      return "No se pudo guardar la marca de migrado.";
    }
    await registrarMovimientoDelPaciente({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: caso.patientId,
      entityType: "orthodontic-plan",
      entityId: caso.id,
      action: "update",
      texto: textoDeMovimientoDeLaMarca(poner),
      campos: ["migradoSinDiagnostico"],
      cambios: { migradoSinDiagnostico: { before: !poner, after: poner } },
    });
  }
  return null;
}
