"use client";

import { useEffect, useState } from "react";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";
import { getTreatmentPlanIdForAppointment } from "@/app/actions/orthodontics/getTreatmentPlanIdForAppointment";
import { isFailure } from "@/app/actions/orthodontics/result";
import { ResumenCobranza } from "../cobranza/ResumenCobranza";
import { BotonHojaControl } from "./BotonHojaControl";

// Ortodoncia — Ola 1 (ws1-t4, Control y agenda, sep-2026): única ranura del
// panel de la cita (agenda-nueva/panel-cita.tsx). Se autocalifica sola: solo
// hace algo cuando la cita es un control de ortodoncia
// (TIPO_CITA_CONTROL_ORTO); en cualquier otra cita ni entra al resto.
//
// `AgendaAppointmentDTO` no trae `treatmentPlanId` (hueco documentado por
// Ola 0, REPORTE-ws1-t1.md punto 6): en vez de tocar el DTO general de
// Agenda — compartido con TODOS los verticales dentales, no solo
// ortodoncia — esta parte resuelve el plan con un self-fetch por
// `patientId` (getTreatmentPlanIdForAppointment). Se calla si el paciente no
// tiene caso abierto (plan null) o si la cita todavía no existe en el
// servidor (id vacío/optimista).
export interface RanuraCitaProps {
  dto: Pick<AgendaAppointmentDTO, "id" | "reason" | "patient">;
}

export function RanuraCita({ dto }: RanuraCitaProps) {
  const esControl = esCitaControlOrto(dto.reason ?? null);
  const [treatmentPlanId, setTreatmentPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!esControl) {
      setTreatmentPlanId(null);
      return;
    }
    let cancelled = false;
    getTreatmentPlanIdForAppointment(dto.patient.id).then((res) => {
      if (cancelled) return;
      if (isFailure(res)) {
        setTreatmentPlanId(null);
        return;
      }
      setTreatmentPlanId(res.data.treatmentPlanId);
    });
    return () => {
      cancelled = true;
    };
  }, [esControl, dto.patient.id]);

  if (!esControl || !treatmentPlanId) return null;

  return (
    <div className="space-y-3">
      <ResumenCobranza treatmentPlanId={treatmentPlanId} />
      <BotonHojaControl appointmentId={dto.id} treatmentPlanId={treatmentPlanId} />
    </div>
  );
}
