"use server";
// Ortodoncia — las listas de la clínica (brackets, alineadores, placas, aditamentos, prescripciones y tipos de
// cementación) para «Editar plan» y para el alta del caso. Solo lectura; `clinicId` de la sesión. Sin la columna
// (sql/ortodoncia-plan-de-tratamiento.sql) salen las de ejemplo (las de Dentalink).

import { getOrthoActionContext } from "./_helpers";
import { leerOpcionesDelPlan } from "@/lib/orthodontics/plan-detalle-db";
import type { OpcionesDelPlan } from "@/lib/orthodontics/plan-detalle";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function cargarOpcionesDelPlan(): Promise<ActionResult<{ opciones: OpcionesDelPlan; frecuenciaControlDias: number }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");
  const { opciones, frecuenciaControlDias } = await leerOpcionesDelPlan(ctx.clinicId);
  return ok({ opciones, frecuenciaControlDias });
}
