"use client";

// Ortodoncia — Ola 1 (ws1-t4, Control y agenda, sep-2026): botón "Nueva hoja
// de control" del panel de la cita (montada por RanuraCita, solo en citas de
// control de ortodoncia — TIPO_CITA_CONTROL_ORTO). C6 del documento de
// alcance: "el control nace de la cita" — desde AQUÍ el doctor abre la hoja
// ligada a `appointmentId` (`ortho_treatment_cards.appointmentId`,
// sql/ortodoncia-nucleo.sql).
//
// Al pulsar, trae el contexto mínimo (getTreatmentCardContextForAppointment)
// y abre el MISMO `DrawerTreatmentCard` que usa la ficha del paciente —
// guardar/firmar van directo a saveTreatmentCardDraft/signTreatmentCard con
// `appointmentId` puesto, para que la hoja quede ligada a esta cita.

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Btn } from "../redesign/atoms/Btn";
import {
  DrawerTreatmentCard,
  type DrawerCardSubmit,
} from "../redesign/drawers/DrawerTreatmentCard";
import { getTreatmentCardContextForAppointment } from "@/app/actions/orthodontics/getTreatmentCardContextForAppointment";
import { saveTreatmentCardDraft } from "@/app/actions/orthodontics/saveTreatmentCardDraft";
import { signTreatmentCard } from "@/app/actions/orthodontics/signTreatmentCard";
import { isFailure } from "@/app/actions/orthodontics/result";
import orto from "../redesign/orto.module.css";
import { PHASE_LABELS, type TreatmentCardDTO, type WireStepDTO, type OrthoPhaseKey } from "../redesign/types";

export interface BotonHojaControlProps {
  appointmentId: string;
  treatmentPlanId: string;
}

interface LoadedContext {
  card: TreatmentCardDTO | null;
  availableWires: WireStepDTO[];
  availablePhotoSets: Array<{ id: string; label: string }>;
  defaultsForNew: {
    cardNumber: number;
    phase: OrthoPhaseKey;
    monthAt: number;
    wireFrom: WireStepDTO | null;
    visitDate: string;
    durationMin: number;
  };
}

export function BotonHojaControl({ appointmentId, treatmentPlanId }: BotonHojaControlProps) {
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<LoadedContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abrir = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getTreatmentCardContextForAppointment(appointmentId, treatmentPlanId);
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      setCtx({
        card: res.data.existingCard,
        availableWires: res.data.availableWires,
        availablePhotoSets: res.data.availablePhotoSets,
        defaultsForNew: res.data.defaultsForNew,
      });
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const cerrar = () => {
    setOpen(false);
    setCtx(null);
  };

  const guardar = async (payload: DrawerCardSubmit, firmar: boolean) => {
    if (!ctx) return;
    const base = {
      cardId: payload.cardId,
      treatmentPlanId,
      appointmentId,
      cardNumber: ctx.card?.cardNumber ?? ctx.defaultsForNew.cardNumber,
      visitDate: ctx.card?.visitDate ?? ctx.defaultsForNew.visitDate,
      durationMin: ctx.card?.durationMin ?? ctx.defaultsForNew.durationMin,
      phaseKey: ctx.card?.phaseKey ?? ctx.defaultsForNew.phase,
      monthAt: ctx.card?.monthAt ?? ctx.defaultsForNew.monthAt,
      wireFromId: ctx.card?.wireFrom?.id ?? ctx.defaultsForNew.wireFrom?.id ?? null,
      wireToId: payload.wireToId,
      soap: payload.soap,
      hygiene: payload.hygiene,
      elastics: payload.elastics,
      iprPoints: payload.iprPoints,
      brokenBrackets: payload.brokenBrackets,
      hasProgressPhoto: payload.hasProgressPhoto,
      photoSetId: payload.photoSetId,
      nextDate: payload.nextDate,
      nextDurationMin: payload.nextDurationMin,
      activationsNote: payload.activationsNote,
      indications: payload.indications,
    };
    const res = firmar ? await signTreatmentCard(base) : await saveTreatmentCardDraft(base);
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    cerrar();
  };

  return (
    <>
      <Btn
        variant="primary"
        size="md"
        className="w-full"
        icon={loading ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" aria-hidden /> : <FileText size={15} strokeWidth={1.75} aria-hidden />}
        onClick={abrir}
        disabled={loading}
      >
        {loading ? "Abriendo…" : "Registrar control"}
      </Btn>
      {error ? (
        <div className={`${orto.aviso} ${orto.avisoPeligro}`} role="alert">
          {error}
        </div>
      ) : null}
      {open && ctx ? (
        <DrawerTreatmentCard
          card={ctx.card}
          availableWires={ctx.availableWires}
          availablePhotoSets={ctx.availablePhotoSets}
          defaultsForNew={
            ctx.card
              ? undefined
              : {
                  cardNumber: ctx.defaultsForNew.cardNumber,
                  phase: PHASE_LABELS[ctx.defaultsForNew.phase],
                  monthAt: ctx.defaultsForNew.monthAt,
                  wireFrom: ctx.defaultsForNew.wireFrom,
                  visitDate: ctx.defaultsForNew.visitDate,
                }
          }
          onClose={cerrar}
          onSave={(payload) => guardar(payload, false)}
          onSign={(payload) => guardar(payload, true)}
        />
      ) : null}
    </>
  );
}
