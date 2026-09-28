// Orthodontics — panel agregado VIEJO del módulo (KPIs + tabla/Kanban).
//
// Sección I (revisión de lógica de uso): ya no se pinta. Un marcador o un
// enlace viejo llega al módulo de hoy (`/dashboard/orthodontics`), cuyo layout
// hace las guardias (clínica dental, módulo activo, permiso
// `specialties.orthodontics`). El archivo se queda solo para redirigir.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { MODULO_ORTODONCIA } from "@/lib/orthodontics/rutas-viejas";

export default function OrthodonticsIndexPage() {
  redirect(MODULO_ORTODONCIA);
}
