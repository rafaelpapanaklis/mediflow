"use client";
import { CalendarPlus, UserPlus, Search } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";

export function HomeShortcutBar() {
  const { openPalette } = useCommandPalette();
  const { open: openAppt } = useNewAppointmentDialog();
  const { open: openPatient } = useNewPatientDialog();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 18,
        paddingTop: 18,
        borderTop: "1px solid var(--border-soft)",
      }}
    >
      <ButtonNew
        variant="primary"
        icon={<CalendarPlus size={14} />}
        onClick={() => openAppt({ openAgendaAfter: true })}
      >
        Nueva cita
      </ButtonNew>
      <ButtonNew
        variant="secondary"
        icon={<UserPlus size={14} />}
        onClick={() => openPatient()}
      >
        Nuevo paciente
      </ButtonNew>
      <ButtonNew
        variant="ghost"
        icon={<Search size={14} />}
        onClick={openPalette}
      >
        Buscar paciente
      </ButtonNew>
    </div>
  );
}
