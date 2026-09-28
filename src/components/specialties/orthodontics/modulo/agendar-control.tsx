"use client";
// Módulo de Ortodoncia — «Agendar control» (ws1-t3, H16). Abre la ventana de
// Nueva cita de siempre, ya con el paciente y el motivo «Control de
// ortodoncia» puestos: no es otra forma de agendar, es un atajo. Al crearla se
// vuelve a pedir la pantalla, y el paciente sale de «Sin próximo control».
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import s from "./modulo.module.css";

export function AgendarControlBoton({ patientId, patientName, doctorId }: { patientId: string; patientName: string; /** El doctor tratante del caso: la cita nace con él, no con quien esté de turno. */ doctorId?: string | null }) {
  const router = useRouter();
  const { open } = useNewAppointmentDialog();
  return (
    <button
      type="button"
      className={`${s.boton} ${s.botonPeq}`}
      aria-label={`Agendar control de ${patientName}`}
      onClick={() =>
        open({
          initialPatient: { id: patientId, name: patientName },
          initialReason: TIPO_CITA_CONTROL_ORTO,
          ...(doctorId ? { initialDoctorId: doctorId } : {}),
          onCreated: () => router.refresh(),
        })
      }
    >
      <CalendarPlus size={14} strokeWidth={1.9} aria-hidden />
      Agendar control
    </button>
  );
}
