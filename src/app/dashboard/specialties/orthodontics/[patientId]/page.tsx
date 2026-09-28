// Orthodontics — página detalle VIEJA del paciente (SPEC §6).
//
// Sección I (revisión de lógica de uso): ya no se pinta. Un marcador o un
// enlace viejo llega a la ficha del paciente, pestaña Ortodoncia, que hace sus
// propias guardias. El archivo se queda solo para redirigir.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { fichaOrtodonciaDesdeRutaVieja } from "@/lib/orthodontics/rutas-viejas";

export default function OrthodonticsPatientDetailPage({
  params,
  searchParams,
}: {
  params: { patientId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(fichaOrtodonciaDesdeRutaVieja(params.patientId, searchParams));
}
