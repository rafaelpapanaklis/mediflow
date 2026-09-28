"use server";
// Ortodoncia — Catálogo (ws1-t1, Ola 2). Solo lectura: los procedimientos de
// ortodoncia (category "orthodontics") de la clínica, para la pantalla de
// Configuración («incluido en el tratamiento» / «con costo aparte») y para
// cualquier panel que necesite mostrarlos.

import { getOrthoConfigActionContext } from "../_helpers";
import { listarProcedimientosDeOrtodoncia, type OrthoProcedureRow } from "@/lib/orthodontics/catalog-procedures";
import { isFailure, ok, type ActionResult } from "../result";

export async function listarProcedimientosDeOrtodonciaAction(): Promise<ActionResult<{ procedimientos: OrthoProcedureRow[] }>> {
  const auth = await getOrthoConfigActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const procedimientos = await listarProcedimientosDeOrtodoncia(ctx.clinicId);
  return ok({ procedimientos });
}
