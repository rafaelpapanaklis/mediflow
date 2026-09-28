"use server";
// Orthodontics — Configuración del submenú (Ola 1, ws1-t3). Trae la
// configuración de la clínica (doctor tratante por defecto, catálogo de
// tipos de cita, plantillas) para pintar el formulario, más la lista de
// doctores de la clínica para el selector.

import { getOrthoConfigActionContext } from "./_helpers";
import { loadOrthoClinicSettings, type OrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { cargarDoctoresTratantes } from "@/lib/orthodontics/doctores-tratantes-db";
import { etiquetaDeDoctor } from "@/lib/orthodontics/doctores-tratantes";
import { isFailure, ok, type ActionResult } from "./result";

export interface OrthoConfigDoctorOption {
  id: string;
  /** Con la especialidad si la marcó en Equipo: «Ana Ruiz · Ortodoncia». */
  name: string;
}

export interface OrthoClinicSettingsPayload {
  settings: OrthoClinicSettings;
  doctors: OrthoConfigDoctorOption[];
}

export async function getOrthoClinicSettings(): Promise<ActionResult<OrthoClinicSettingsPayload>> {
  const auth = await getOrthoConfigActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  // ws1-t5 (ronda 6): la lista incluye al dueño o administrador que atiende y
  // pone primero a quien marcó «Ortodoncia» en Equipo (doctores-tratantes.ts).
  const [settings, doctors] = await Promise.all([
    loadOrthoClinicSettings(ctx.clinicId),
    cargarDoctoresTratantes(ctx.clinicId),
  ]);

  return ok({
    settings,
    doctors: doctors.map((d) => ({ id: d.id, name: etiquetaDeDoctor(d) })),
  });
}
