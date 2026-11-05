// ¿El portal puede prometer que un cambio de cita «se aplica al instante»?
// (ws1-t10 v2, m3 de la revisión de t12).
//
// Con la auto-aprobación de la clínica, sí… salvo reagendar una cita «Sin
// doctor»: el servidor la deja SIEMPRE como solicitud (D6,
// api/paciente/appointments/[id]/change-request), así que la pantalla no puede
// decir «al instante» y después «Enviamos tu solicitud». Cancelar no depende del
// doctor: sigue la política de la clínica.
//
// PURO: lo usan la página de citas del portal y su prueba.

import type { PacienteCita } from "./types";

export function reagendarSeAutoAprueba(autoApproveClinica: boolean, cita: Pick<PacienteCita, "doctorName">): boolean {
  return autoApproveClinica && cita.doctorName !== null;
}
