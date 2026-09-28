"use server";
// Orthodontics — Configuración del submenú (Ola 1, ws1-t3). Trae la
// configuración de la clínica (doctor tratante por defecto, catálogo de
// tipos de cita, plantillas) para pintar el formulario, más la lista de
// doctores de la clínica para el selector.

import { prisma } from "@/lib/prisma";
import { getOrthoConfigActionContext } from "./_helpers";
import { loadOrthoClinicSettings, type OrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface OrthoConfigDoctorOption {
  id: string;
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

  const [settings, doctors] = await Promise.all([
    loadOrthoClinicSettings(ctx.clinicId),
    prisma.user.findMany({
      where: { clinicId: ctx.clinicId, role: "DOCTOR", isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  ]);

  return ok({
    settings,
    doctors: doctors.map((d) => ({ id: d.id, name: `${d.firstName} ${d.lastName}`.trim() })),
  });
}
