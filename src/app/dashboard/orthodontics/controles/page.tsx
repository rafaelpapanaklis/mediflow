import Link from "next/link";
import { CalendarClock, CalendarDays, LayoutDashboard } from "lucide-react";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

// Ola 0 (ws1-t1) · dueña en la Ola 1: «Control y agenda» (los controles SON
// citas de la Agenda — TIPO_CITA_CONTROL_ORTO — así que esta pantalla es,
// en el fondo, un filtro sobre la Agenda normal, no una agenda propia).
//
// Diseño (ws1-t3): el cartel le habla a la clínica, no a quien programa, y
// dice dónde se ven HOY los controles.
export default async function OrthodonticsControlesPage() {
  await exigirModuloOrtodoncia();
  return (
    <OrthoModulePlaceholder
      icon={CalendarClock}
      title="Controles / agenda"
      description="Aquí vas a ver solo los controles de ortodoncia. Mientras tanto están en la Agenda de siempre, como citas de tipo «Control de ortodoncia», y los de hoy salen en el Tablero."
    >
      <Link href="/dashboard/agenda" className={s.boton}>
        <CalendarDays size={15} strokeWidth={1.9} aria-hidden />
        Abrir la Agenda
      </Link>
      <Link href="/dashboard/orthodontics/tablero" className={s.boton}>
        <LayoutDashboard size={15} strokeWidth={1.9} aria-hidden />
        Controles de hoy
      </Link>
    </OrthoModulePlaceholder>
  );
}
