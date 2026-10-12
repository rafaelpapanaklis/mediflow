// Orthodontics — página detalle VIEJA del paciente (SPEC §6).
//
// Sección I (revisión de lógica de uso): ya no se pinta. Un marcador o un
// enlace viejo llega a la ficha del paciente, pestaña Ortodoncia, que hace sus
// propias guardias. El archivo se queda solo para redirigir.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { fichaOrtodonciaDesdeRutaVieja } from "@/lib/orthodontics/rutas-viejas";

export default async function OrthodonticsPatientDetailPage(
  props: {
    params: Promise<{ patientId: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  redirect(fichaOrtodonciaDesdeRutaVieja(params.patientId, searchParams));
}
