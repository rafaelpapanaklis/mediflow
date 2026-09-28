"use client";
// Ortodoncia — ws1-t1 ronda 2: "tras firmar un control con 'próximo control
// en N semanas', ofrecer a recepción agendarlo con un clic" (comentario
// original C5 en DrawerTreatmentCard.tsx). Crea la Appointment de verdad a
// partir de lo que el doctor ya capturó al firmar.

import { useState } from "react";
import { Calendar, Check } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { agendarProximoControlDesdeCard } from "@/app/actions/orthodontics/agendarProximoControlDesdeCard";
import { isFailure } from "@/app/actions/orthodontics/result";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export function AgendarProximoControlButton({ cardId }: { cardId: string }) {
  const [estado, setEstado] = useState<"idle" | "cargando" | "agendado" | "error">("idle");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function agendar() {
    setEstado("cargando");
    setMensaje(null);
    const r = await agendarProximoControlDesdeCard({ cardId });
    if (isFailure(r)) {
      setEstado("error");
      setMensaje(r.error);
      return;
    }
    setEstado("agendado");
  }

  if (estado === "agendado") {
    return (
      <span className={s.notaExito} role="status">
        <Check size={14} strokeWidth={2.2} aria-hidden />
        Cita creada
      </span>
    );
  }

  return (
    <>
      <ButtonNew
        type="button"
        variant="secondary"
        size="sm"
        icon={<Calendar size={14} strokeWidth={1.9} aria-hidden />}
        onClick={agendar}
        disabled={estado === "cargando"}
      >
        {estado === "cargando" ? "Agendando…" : "Agendar este control"}
      </ButtonNew>
      {mensaje && (
        <span className={`${s.nota} ${estado === "error" ? s.notaPeligro : ""}`} style={{ maxWidth: 260 }} role={estado === "error" ? "alert" : "status"}>
          {mensaje}
        </span>
      )}
    </>
  );
}
