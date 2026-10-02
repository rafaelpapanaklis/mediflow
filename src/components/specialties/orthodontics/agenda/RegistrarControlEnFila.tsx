"use client";

// Ortodoncia — Ronda 6 (ws1-t8, «El día de la ortodoncista», M3). Hallazgo 3:
// "los controles de hoy se listan en tres pantallas [Tablero, Controles,
// Hoy] y en ninguna se registra el control". Tablero y Controles ya montan
// `BotonHojaControl` directo (tienen el treatmentPlanId resuelto en su
// propia consulta); la fila de "Hoy" (`fila-cita.tsx`, dental core,
// compartida con TODOS los verticales) es una cita CUALQUIERA — necesita el
// mismo self-fetch por `patientId` que ya usa `RanuraCita.tsx` en el panel
// de la cita de la Agenda, para saber si hay caso y si se puede abrir la
// parte clínica.
//
// Deliberadamente MÁS chico que `RanuraCita`: aquí no cabe `ResumenCobranza`
// (fila de una sola línea, no un panel lateral) — solo el botón.

import { useEffect, useState } from "react";
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";
import { getTreatmentPlanIdForAppointment } from "@/app/actions/orthodontics/getTreatmentPlanIdForAppointment";
import { ESTADO_VACIO_RANURA_CITA, resolverEstadoRanuraCita } from "./ranura-cita-estado";
import { BotonHojaControl } from "./BotonHojaControl";

export interface RegistrarControlEnFilaProps {
  appointmentId: string;
  patientId: string;
  reason: string | null | undefined;
}

export function RegistrarControlEnFila({ appointmentId, patientId, reason }: RegistrarControlEnFilaProps) {
  const esControl = esCitaControlOrto(reason ?? null);
  const [state, setState] = useState(ESTADO_VACIO_RANURA_CITA);

  useEffect(() => {
    if (!esControl) {
      setState(ESTADO_VACIO_RANURA_CITA);
      return;
    }
    let cancelled = false;
    getTreatmentPlanIdForAppointment(patientId, appointmentId)
      .then((res) => {
        if (!cancelled) setState(resolverEstadoRanuraCita(res));
      })
      .catch(() => {
        if (!cancelled) setState(ESTADO_VACIO_RANURA_CITA);
      });
    return () => {
      cancelled = true;
    };
  }, [esControl, patientId, appointmentId]);

  if (!esControl || !state.treatmentPlanId || !state.canOpenClinicalCard) return null;

  return <BotonHojaControl appointmentId={appointmentId} treatmentPlanId={state.treatmentPlanId} compacto firmada={state.hojaFirmada} />;
}
