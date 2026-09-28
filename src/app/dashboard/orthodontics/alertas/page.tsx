import { AlertTriangle } from "lucide-react";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";

// Ola 0 (ws1-t1) · dueña en la Ola 1: «Tablero y alertas» (L1-L4: mensualidad
// vencida, sin próximo control, etc. — REPORTE-ws1-t8.md).
export default function OrthodonticsAlertasPage() {
  return (
    <OrthoModulePlaceholder
      icon={AlertTriangle}
      title="Alertas"
      description="Mensualidades vencidas, casos sin próximo control, faltas. Lo arma la parte «Tablero y alertas» en la Ola 1 — ver REPORTE-ws1-t1.md."
    />
  );
}
