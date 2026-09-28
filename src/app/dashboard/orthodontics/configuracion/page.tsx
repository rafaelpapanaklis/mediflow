// Ola 1 (ws1-t3 · «Acceso y permisos»): Configuración quedó asignada a esta
// parte (decisión de Rafael, pregunta abierta #1 de REPORTE-ws1-t1.md).
// Doctor tratante por defecto, catálogo de tipos de cita (C7) y plantillas
// de mensaje — ver src/lib/orthodontics/clinic-settings-db.ts.
export const dynamic = "force-dynamic";

import { getOrthoClinicSettings } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { OrthoConfiguracionClient } from "@/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient";

export default async function OrthodonticsConfiguracionPage() {
  const res = await getOrthoClinicSettings();
  if (isFailure(res)) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--text-3)" }}>
        No se pudo cargar la Configuración: {res.error}
      </div>
    );
  }
  return <OrthoConfiguracionClient settings={res.data.settings} doctors={res.data.doctors} />;
}
