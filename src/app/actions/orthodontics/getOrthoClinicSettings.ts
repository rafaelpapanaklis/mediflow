"use server";
// Orthodontics — Configuración del submenú (Ola 1, ws1-t3). Trae la
// configuración de la clínica (catálogo de tipos de cita, plantillas, modo de
// cobro) para pintar el formulario. Ya no hay «doctor tratante por defecto»
// (ws1-t10): el doctor se propone al abrir cada caso.

import { getOrthoConfigActionContext } from "./_helpers";
import { loadOrthoClinicSettings, type OrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { isFailure, ok, type ActionResult } from "./result";

export interface OrthoClinicSettingsPayload {
  settings: OrthoClinicSettings;
}

export async function getOrthoClinicSettings(): Promise<ActionResult<OrthoClinicSettingsPayload>> {
  const auth = await getOrthoConfigActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const settings = await loadOrthoClinicSettings(ctx.clinicId);

  return ok({ settings });
}
