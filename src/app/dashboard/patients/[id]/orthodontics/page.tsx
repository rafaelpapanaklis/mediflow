// Orthodontics — vista embebida VIEJA del módulo dentro del expediente.
//
// Sección I (revisión de lógica de uso): ya no se pinta. Un marcador o un
// enlace viejo llega a la ficha del paciente, pestaña Ortodoncia, que es la
// vista de hoy y hace sus propias guardias (clínica dental, módulo activo,
// permiso, visibilidad del paciente). El archivo se queda solo para redirigir.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { fichaOrtodonciaDesdeRutaVieja } from "@/lib/orthodontics/rutas-viejas";

export default async function PatientOrthodonticsPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  redirect(fichaOrtodonciaDesdeRutaVieja(params.id, searchParams));
}
