// Ortodoncia — Alertas (L1-L5, ws1-t2, Ola 1): mensualidad vencida, falta de
// control, no-show, próximo a terminar, pasado de fecha. La guarda de módulo
// corre en el layout y, otra vez, aquí.
//
// L1 monta EnviarRecordatorioButton (Paciente y WhatsApp, W2 — reasignado a
// esta parte tras cerrar Tablero y alertas): texto libre dentro de la
// ventana de 24 h, sin plantilla de Meta, opcional/manual.
//
// Diseño (ws1-t3): esta página solo carga los datos, igual que antes; cómo se
// pintan vive en `modulo/vista-alertas.tsx`.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoAlerts } from "@/lib/orthodontics/alerts-data";
import { VistaAlertas } from "@/components/specialties/orthodontics/modulo/vista-alertas";

export default async function OrthodonticsAlertasPage() {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const alerts = await loadOrthoAlerts(user.clinicId, user.clinic.timezone, viewer);

  // El mismo permiso que pide el botón «Nueva cita» del menú (y que usa
  // Controles): quien no puede agendar no ve «Agendar control».
  const puedeAgendar = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "agenda.create",
  );

  // «Posponer 7 días» (ws1-t4 ronda 6, fila 22): el permiso que exige
  // `posponerAlerta`. Posponer no toca el expediente; basta con poder verlo.
  const puedePosponer = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "medicalRecord.view",
  );

  return (
    <VistaAlertas
      alerts={alerts}
      zonaHoraria={user.clinic.timezone}
      puedeAgendar={puedeAgendar}
      puedePosponer={puedePosponer}
    />
  );
}
