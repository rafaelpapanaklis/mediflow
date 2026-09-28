import { Users } from "lucide-react";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";

// Ola 0 (ws1-t1) · dueña en la Ola 1: «Tablero y alertas»
// (src/lib/orthodontics/load-patients.ts, OrthodonticsSpecialtyClient.tsx —
// la misma tabla que hoy vive en /dashboard/specialties/orthodontics, que
// se oculta por S1).
export default function OrthodonticsPacientesPage() {
  return (
    <OrthoModulePlaceholder
      icon={Users}
      title="Pacientes en tratamiento"
      description="La lista de casos abiertos, con su fase y su cobranza. Lo arma la parte «Tablero y alertas» en la Ola 1 — ver REPORTE-ws1-t1.md."
    />
  );
}
