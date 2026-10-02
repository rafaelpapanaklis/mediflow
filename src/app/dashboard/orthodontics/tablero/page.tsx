// Ortodoncia — Tablero (T1-T7, ws1-t2, Ola 1). El vistazo del doctor y de la
// dirección: activos, controles de hoy, saldos vencidos, producción,
// conversión de valoraciones, lo que va a entrar por mensualidades y
// colocaciones/retiros del mes. La guarda de módulo corre en el layout y, otra vez, aquí.
//
// La lista de "Controles de hoy" monta EnviarIndicacionesButton (Paciente y
// WhatsApp, W5 — reasignado a esta parte): manda por WhatsApp las
// indicaciones (C3, "Control y agenda") ya cargadas en la hoja de control de
// esa cita, si las hay.
//
// Diseño (ws1-t3): esta página solo carga los datos, igual que antes; cómo se
// pintan vive en `modulo/vista-tablero.tsx`.
//
// Primeros pasos (ws1-t5): mientras a la clínica le falte elegir cómo cobra,
// su doctor tratante, abrir un caso o su plan de pago, el Tablero lo dice
// arriba, a quien puede hacerlo (quien administra la clínica). Con todo hecho
// el bloque no se pinta.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoTableroData, loadTodayControlsWithIndications } from "@/lib/orthodontics/tablero-data";
import { cargarFiltroSinPrueba } from "@/lib/patients/paciente-de-prueba-db";
import { loadPrimerosPasosOrtodoncia } from "@/lib/orthodontics/primeros-pasos-db";
import { hasPermission } from "@/lib/auth/permissions";
import { VistaTablero } from "@/components/specialties/orthodontics/modulo/vista-tablero";
import { PrimerosPasosOrtodoncia } from "@/components/specialties/orthodontics/modulo/primeros-pasos";

export default async function OrthodonticsTableroPage() {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  // ws1-t11 (11d): los indicadores no cuentan a los «Pacientes de prueba / no contactar».
  const sinPrueba = await cargarFiltroSinPrueba(user.clinicId);
  const [data, controlesHoy] = await Promise.all([
    loadOrthoTableroData(user.clinicId, user.clinic.timezone, viewer, new Date(), sinPrueba),
    loadTodayControlsWithIndications(user.clinicId, user.clinic.timezone, viewer),
  ]);

  // Después de la tanda de arriba, no junto a ella: son tres lecturas más y
  // el pooler se satura por encima de 7 a la vez. Solo para quien puede
  // cambiar la Configuración; a los demás el bloque les pediría pasos que no
  // pueden dar.
  const puedeConfigurar = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "settings.view",
  );
  const primerosPasos = puedeConfigurar ? await loadPrimerosPasosOrtodoncia(user.clinicId) : null;

  return (
    <>
      {primerosPasos && <PrimerosPasosOrtodoncia pasos={primerosPasos} />}
      <VistaTablero
        data={data}
        controlesHoy={controlesHoy}
        zonaHoraria={user.clinic.timezone}
        puedeEditarCasos={hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride }, "medicalRecord.edit")}
      />
    </>
  );
}
