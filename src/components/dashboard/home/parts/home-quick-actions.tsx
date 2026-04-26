"use client";

import { CalendarPlus, UserPlus } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";

export function HomeQuickActions() {
  const { open: openAppt } = useNewAppointmentDialog();
  const { open: openPatient } = useNewPatientDialog();

  return (
    <div
      className="mf-home-quick-actions"
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        flexShrink: 0,
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
    </div>
  );
}
