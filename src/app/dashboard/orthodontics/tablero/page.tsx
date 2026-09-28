// Ortodoncia — Tablero (T1-T7, ws1-t2, Ola 1). El vistazo del doctor y de la
// dirección: activos, controles de hoy, saldos vencidos, producción,
// conversión de valoraciones, lo que va a entrar por mensualidades y
// colocaciones/retiros del mes. La guarda de módulo ya corrió en el layout.
//
// La lista de "Controles de hoy" monta EnviarIndicacionesButton (Paciente y
// WhatsApp, W5 — reasignado a esta parte): manda por WhatsApp las
// indicaciones (C3, "Control y agenda") ya cargadas en la hoja de control de
// esa cita, si las hay.
//
// Diseño (ws1-t3): esta página solo carga los datos, igual que antes; cómo se
// pintan vive en `modulo/vista-tablero.tsx`.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { loadOrthoTableroData, loadTodayControlsWithIndications } from "@/lib/orthodontics/tablero-data";
import { VistaTablero } from "@/components/specialties/orthodontics/modulo/vista-tablero";

export default async function OrthodonticsTableroPage() {
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const [data, controlesHoy] = await Promise.all([
    loadOrthoTableroData(user.clinicId, user.clinic.timezone, viewer),
    loadTodayControlsWithIndications(user.clinicId, user.clinic.timezone, viewer),
  ]);

  return <VistaTablero data={data} controlesHoy={controlesHoy} />;
}
