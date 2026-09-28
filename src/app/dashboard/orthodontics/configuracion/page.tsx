// Ola 1 (ws1-t3 · «Acceso y permisos»): Configuración quedó asignada a esta
// parte (decisión de Rafael, pregunta abierta #1 de REPORTE-ws1-t1.md).
// Doctor tratante por defecto, catálogo de tipos de cita (C7) y plantillas
// de mensaje — ver src/lib/orthodontics/clinic-settings-db.ts.
export const dynamic = "force-dynamic";

import { getOrthoClinicSettings, listarProcedimientosDeOrtodonciaAction } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { OrthoConfiguracionClient } from "@/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient";
import { Pantalla } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export default async function OrthodonticsConfiguracionPage() {
  await exigirModuloOrtodoncia();
  // Ola 2 (ws1-t1): el catálogo se pide aparte, en paralelo — si falla (SQL
  // de orthoIncludedInTreatment sin pegar, o sin permiso), la Configuración
  // igual se pinta: la sección de procedimientos queda vacía, no tumba la
  // pantalla.
  const [res, procRes] = await Promise.all([
    getOrthoClinicSettings(),
    listarProcedimientosDeOrtodonciaAction(),
  ]);
  if (isFailure(res)) {
    return (
      <Pantalla titulo="Configuración">
        <div className={s.error} role="alert">
          No se pudo cargar la Configuración: {res.error}
        </div>
      </Pantalla>
    );
  }
  return (
    <OrthoConfiguracionClient
      settings={res.data.settings}
      doctors={res.data.doctors}
      procedimientos={isFailure(procRes) ? [] : procRes.data.procedimientos}
    />
  );
}
