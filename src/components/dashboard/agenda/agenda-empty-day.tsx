"use client";

import { Calendar } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";

export function AgendaEmptyDay() {
  const { open } = useNewAppointmentDialog();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 40,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--brand-softer)",
          border: "1px solid var(--border-brand)",
          color: "var(--trial-accent-calm)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Calendar size={24} aria-hidden />
      </div>
      <div>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text-1)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          No hay profesionales activos
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-2)",
            margin: 0,
            maxWidth: 360,
          }}
        >
          Agrega un profesional desde Equipo o crea una cita para comenzar.
        </p>
      </div>
      <ButtonNew variant="primary" onClick={() => open({})}>
        Crear primera cita
      </ButtonNew>
    </div>
  );
}
