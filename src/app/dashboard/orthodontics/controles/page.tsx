// Ortodoncia — Controles / agenda (ws1-t3, H16 de la QA en vivo del
// 28-sep-2026: este apartado decía «Próximamente»). Los controles de hoy y de
// los próximos siete días, y quién falta de control.
//
// Los controles SON citas de la Agenda (`TIPO_CITA_CONTROL_ORTO`, decisión 2
// de la arquitectura): esta pantalla es un filtro sobre la Agenda de siempre,
// no una agenda propia. Agendar se hace con la ventana de Nueva cita.
//
// La guarda de módulo corre en el layout y, otra vez, aquí. `clinicId` y la
// zona horaria salen de la sesión.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoControles } from "@/lib/orthodontics/controles-data";
import { zonaValida } from "@/components/specialties/orthodontics/modulo/fechas";
import { VistaControles } from "@/components/specialties/orthodontics/modulo/vista-controles";

export default async function OrthodonticsControlesPage() {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const zona = zonaValida(user.clinic.timezone);

  const data = await loadOrthoControles(user.clinicId, zona, viewer);

  // El mismo permiso que pide el botón «Nueva cita» del menú.
  const puedeAgendar = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "agenda.create",
  );

  return <VistaControles data={data} zonaHoraria={zona} puedeAgendar={puedeAgendar} />;
}
