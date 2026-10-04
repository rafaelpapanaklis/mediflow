"use server";
// ¿El paciente tiene firmado el consentimiento de ortodoncia? (tercera auditoría, N-31)
//
// La pestaña Ortodoncia solo necesitaba esto para el aviso «Falta el consentimiento…», y lo sacaba de
// `getCaseIntakeOptions`, que además lee doctores, tutores, referentes, catálogo, técnicas y precios (~4 s en
// panel.108). Esta lectura hace lo justo: sesión + módulo, el paciente (visibilidad) y la carta. Misma regla que el
// aviso de siempre (`consentimientoDeOrtodonciaFirmado`).

import { consentimientoDeOrtodonciaFirmado } from "@/lib/orthodontics/consentimiento-firmado-db";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { isFailure, ok, type ActionResult } from "./result";

export async function consentimientoOrtoDelPaciente(patientId: string): Promise<ActionResult<{ generalConsentSigned: boolean | null }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const paciente = await loadPatientForOrtho({ ctx, patientId });
  if (isFailure(paciente)) return paciente;
  return ok({ generalConsentSigned: await consentimientoDeOrtodonciaFirmado(ctx.clinicId, patientId) });
}
