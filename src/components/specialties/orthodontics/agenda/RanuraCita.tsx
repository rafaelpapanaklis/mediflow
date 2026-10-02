"use client";

import { useEffect, useState } from "react";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import { esCitaOrtoConHoja } from "@/lib/orthodontics/agenda-constants";
import { getTreatmentPlanIdForAppointment } from "@/app/actions/orthodontics/getTreatmentPlanIdForAppointment";
import { ESTADO_VACIO_RANURA_CITA, esRespuestaCaida, resolverEstadoRanuraCita } from "./ranura-cita-estado";
import { ResumenCobranza } from "../cobranza/ResumenCobranza";
import { BotonHojaControl } from "./BotonHojaControl";
import { RAIZ_ORTO } from "../redesign/raiz";

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
//
// Arreglo de la revisión cruzada (REPORTE-ws1-t1.md, sección «Revisión
// cruzada»): `getTreatmentPlanIdForAppointment` exigía `medicalRecord.view`
// a secas, así que recepción (solo `billing.view`) se quedaba sin la ranura
// ENTERA — ni siquiera el resumen de cobranza que necesita para cobrar en
// la visita (R1). Ahora la action acepta `medicalRecord.view` O
// `billing.view`, y devuelve además `canOpenClinicalCard`: un fallo de
// permiso ya NO se traga todo en silencio — se oculta SOLO la parte
// clínica (`BotonHojaControl`); `ResumenCobranza` se muestra en cuanto hay
// caso, para cualquiera de los dos roles.
export interface RanuraCitaProps {
  dto: Pick<AgendaAppointmentDTO, "id" | "reason" | "patient">;
  /**
   * Cómo se cobra el caso de esta cita, en cuanto se sabe (`null` = no hay caso o no se
   * pudo saber). El panel de la cita lo usa para decidir si ofrece «Pedir anticipo».
   */
  onModoDeCobro?: (modo: "PRECIO_TOTAL" | "PAGO_POR_CONTROL" | null) => void;
}

export function RanuraCita({ dto, onModoDeCobro }: RanuraCitaProps) {
  const esControl = esCitaOrtoConHoja(dto.reason ?? null);
  const [state, setState] = useState(ESTADO_VACIO_RANURA_CITA);
  // H41: si la consulta se aborta (dev lento, 502) reintenta una vez y, si
  // vuelve a fallar, avisa con «Reintentar» en vez de quedarse vacía.
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  // La consulta ya contestó de verdad (con o sin caso): recién ahí se sabe el modo de cobro.
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    if (!esControl) {
      setState(ESTADO_VACIO_RANURA_CITA);
      setFallo(false);
      setCargado(false);
      return;
    }
    setCargado(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cargar = (reintentosRestantes: number) => {
      // H23 (QA ws1-t9): `resolverEstadoRanuraCita` tolera un `res` vacío o
      // mal formado; el `.catch` cubre el rechazo directo de la promesa.
      getTreatmentPlanIdForAppointment(dto.patient.id, dto.id)
        .then((res) => {
          if (cancelled) return;
          // X8: un 502 deja la action en `undefined` sin rechazar: que lo tome
          // el `.catch` (reintento y «Reintentar») en vez de callarse.
          if (esRespuestaCaida(res)) throw new Error("respuesta caída");
          setFallo(false);
          setState(resolverEstadoRanuraCita(res));
          setCargado(true);
        })
        .catch(() => {
          if (cancelled) return;
          if (reintentosRestantes > 0) {
            timer = setTimeout(() => cargar(reintentosRestantes - 1), 1500);
            return;
          }
          setState(ESTADO_VACIO_RANURA_CITA);
          setFallo(true);
        });
    };
    setFallo(false);
    cargar(1);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [esControl, dto.patient.id, dto.id, intento]);

  // Se avisa al panel cuando ya se sabe (con o sin caso, o si la consulta falló definitivamente).
  const aviso = onModoDeCobro;
  const modo = state.billingMode;
  const conocido = esControl && cargado && !fallo;
  useEffect(() => {
    if (aviso && conocido) aviso(modo);
  }, [aviso, conocido, modo]);

  if (esControl && fallo) {
    return (
      <div className={`${RAIZ_ORTO} flex items-center gap-[10px] text-xs`}>
        <span>No se pudo cargar ortodoncia.</span>
        <button type="button" className="underline" onClick={() => setIntento((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!esControl || !state.treatmentPlanId) return null;

  return (
    // La Agenda solo presta sus propios tokens: la ranura monta los del
    // módulo para verse igual que dentro de la ficha (y el cajón de la hoja
    // de control, que cuelga de aquí, también).
    <div className={`${RAIZ_ORTO} flex flex-col gap-[10px]`}>
      <ResumenCobranza treatmentPlanId={state.treatmentPlanId} />
      {state.canOpenClinicalCard ? (
        <BotonHojaControl appointmentId={dto.id} treatmentPlanId={state.treatmentPlanId} firmada={state.hojaFirmada} />
      ) : null}
    </div>
  );
}
