"use server";
// Ortodoncia — las técnicas ACTIVAS de la clínica (ws1-t10), para «Cambiar aparatología» de un caso ya abierto.
// Solo lectura; `clinicId` de la sesión. Sin la columna de la lista salen las 7 de siempre.

import { getOrthoActionContext } from "./_helpers";
import { leerTecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { tecnicasActivas, type TecnicaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function listarTecnicasActivasDeLaClinica(): Promise<ActionResult<{ tecnicas: TecnicaClinica[] }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");
  return ok({ tecnicas: tecnicasActivas((await leerTecnicasDeLaClinica(ctx.clinicId)).tecnicas) });
}
