import { CalendarClock } from "lucide-react";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";

// Ola 0 (ws1-t1) · dueña en la Ola 1: «Control y agenda» (los controles SON
// citas de la Agenda — TIPO_CITA_CONTROL_ORTO — así que esta pantalla es,
// en el fondo, un filtro sobre la Agenda normal, no una agenda propia).
export default function OrthodonticsControlesPage() {
  return (
    <OrthoModulePlaceholder
      icon={CalendarClock}
      title="Controles / agenda"
      description="Los controles de ortodoncia de la Agenda normal, filtrados. Lo arma la parte «Control y agenda» en la Ola 1 — ver REPORTE-ws1-t1.md."
    />
  );
}
