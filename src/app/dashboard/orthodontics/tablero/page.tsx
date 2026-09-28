import { LayoutDashboard } from "lucide-react";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";

// Ola 0 (ws1-t1) · dueña en la Ola 1: «Tablero y alertas»
// (src/lib/orthodontics/{load-patients,specialty-kpis}.ts, OrthodonticsSpecialtyClient.tsx).
export default function OrthodonticsTableroPage() {
  return (
    <OrthoModulePlaceholder
      icon={LayoutDashboard}
      title="Tablero"
      description="Casos activos, cobranza al corriente y alertas de un vistazo. Lo arma la parte «Tablero y alertas» en la Ola 1 — ver REPORTE-ws1-t1.md."
    />
  );
}
