// Ortodoncia — ¿este usuario puede VER lo clínico de un caso? (ws1-t5, ronda 6)
//
// Es la misma llave que exige `getOrthoActionContext({ write: false })` en las
// server actions del módulo (`medicalRecord.view`). Vive aparte para las
// rutas que no pasan por ese ayudante —porque contestan con su propio código
// HTTP— y para que la regla tenga test sin base de datos.
//
// Respeta los permisos personalizados de Equipo → Permisos: si la clínica le
// quitó el expediente a un doctor, aquí sale `false` aunque su rol lo traiga.

import { puedeClinico } from "@/lib/auth/guardia-clinica";

export interface UsuarioConPermisos {
  role: string;
  permissionsOverride?: string[] | null;
}

export function puedeVerExpediente(usuario: UsuarioConPermisos | null | undefined): boolean {
  // M6: delega en el guardia clínico compartido (una sola regla para todo lo clínico).
  return puedeClinico(usuario, "ver");
}

/** Lo que se le dice a quien pide un PDF del expediente sin la llave. */
export const MENSAJE_SIN_PERMISO_DE_EXPEDIENTE = "No tienes permiso para ver el expediente de este paciente.";
