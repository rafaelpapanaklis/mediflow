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
//
// El cajón va en un PORTAL a <body> (ws1-t10): el botón vive en filas del
// Tablero y de Controles cuyo contenedor crea su propia capa (`.filaDerecha`,
// z-index 1), y un cajón `fixed` metido ahí no podía subir de esa capa: la barra
// de pestañas (z-index 4) se dibujaba encima. Fuera de `.raiz` trae lo suyo: los
// tokens del rediseño (`--pr-*`), los alias del cajón (`--orto-*`, sobre todo el
// velo) y los vestidos de las piezas del módulo.

import { useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Btn } from "../redesign/atoms/Btn";
import {
  DrawerTreatmentCard,
  type DrawerCardSubmit,
} from "../redesign/drawers/DrawerTreatmentCard";
import { getTreatmentCardContextForAppointment } from "@/app/actions/orthodontics/getTreatmentCardContextForAppointment";
import { saveTreatmentCardDraft } from "@/app/actions/orthodontics/saveTreatmentCardDraft";
import { signTreatmentCard } from "@/app/actions/orthodontics/signTreatmentCard";
import { isFailure } from "@/app/actions/orthodontics/result";
import { useTextosFirmaControl } from "../redesign/textos-firma-control";
import orto from "../redesign/orto.module.css";
import modulo from "../modulo/modulo.module.css";
import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import {
  type TreatmentCardDTO,
  type WireStepDTO,
  type OrthoPhaseKey,
  type OrthoElasticClass,
  type OrthoElasticZone,
  type SOAP,
} from "../redesign/types";

export interface BotonHojaControlProps {
  appointmentId: string;
  treatmentPlanId: string;
  /** Para una fila de tabla/lista: botón chico y del ancho de su texto (no el de panel lateral). */
  compacto?: boolean;
}

interface LoadedContext {
  card: TreatmentCardDTO | null;
  /** ws1-t8: estado y fecha de la cita, para el aviso de «cita de otro día» del cajón. */
  cita: { estado: string | null; inicio: string | null };
  controlesPrevistos: number | null;
  tecnica: string | null;
  availableWires: WireStepDTO[];
  availablePhotoSets: Array<{ id: string; label: string }>;
  defaultsForNew: {
    cardNumber: number;
    controlNumero?: number | null;
    phase: OrthoPhaseKey;
    monthAt: number;
    wireFrom: WireStepDTO | null;
    arcosActuales?: { superior: WireStepDTO | null; inferior: WireStepDTO | null };
    visitDate: string;
    durationMin: number;
    lastElastics: Array<{ elasticClass: OrthoElasticClass; config: string; zone: OrthoElasticZone }>;
    lastIndications: string | null;
    /** Fila 12: brackets caídos que el control anterior dejó sin recementar. */
    lastPendingBrackets: Array<{ toothFdi: number; brokenDate: string; notes: string | null }>;
    proximoControlMin?: number | null;
    /** Fila 12: nota con la que arranca la hoja. */
    soapPrefill: SOAP;
  };
}

export function BotonHojaControl({ appointmentId, treatmentPlanId, compacto = false }: BotonHojaControlProps) {
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<LoadedContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textosFirma = useTextosFirmaControl();

  const abrir = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getTreatmentCardContextForAppointment(appointmentId, treatmentPlanId);
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      // Revisión de ws1-t9, fallo 2: la hoja de hoy ya estaba firmada «sin cita»; al abrirla desde esta cita quedó
      // ligada a ella (y la cita cerrada). Se dice, para que nadie la busque «por registrar».
      if (res.data.hojaFirmadaLigada) {
        toast.success(
          res.data.hojaFirmadaLigada.citaCerrada ? textosFirma.hojaFirmadaLigadaYCitaCerrada : textosFirma.hojaFirmadaLigadaSinCerrar,
          { duration: 9000 },
        );
      }
      setCtx({
        card: res.data.existingCard,
        cita: { estado: res.data.appointmentStatus, inicio: res.data.appointmentStartsAt },
        controlesPrevistos: res.data.controlesPrevistos,
        tecnica: res.data.technique,
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
      procedimientos: payload.procedimientos,
      // ws1-t12: las extracciones del plan que se hicieron hoy se marcan al firmar (el borrador no las toca).
      ...(firmar && payload.extraccionesRealizadas ? { extraccionesRealizadas: payload.extraccionesRealizadas } : {}),
    };
    const res = firmar ? await signTreatmentCard(base) : await saveTreatmentCardDraft(base);
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    // «Nada en silencio» (ws1-t1, Ola 2): en modo PAGO_POR_CONTROL, si el
    // control no se pudo facturar solo (catálogo sin precio, o un error al
    // crear la factura), la firma clínica SÍ se guarda — pero Recepción
    // tiene que enterarse para cobrarlo a mano.
    const avisoControlSinFacturar = firmar
      ? (res.data as { avisoControlSinFacturar?: string }).avisoControlSinFacturar
      : undefined;
    if (avisoControlSinFacturar) {
      toast.error(avisoControlSinFacturar, { duration: 8000 });
    }
    const avisoExtracciones = firmar ? (res.data as { avisoExtracciones?: string }).avisoExtracciones : undefined;
    if (avisoExtracciones) toast.error(avisoExtracciones, { duration: 9000 });
    const avisoProcedimientos = firmar
      ? (res.data as { avisoProcedimientos?: string }).avisoProcedimientos
      : undefined;
    if (avisoProcedimientos) toast.error(avisoProcedimientos, { duration: 9000 });
    const avisoReposiciones = firmar ? (res.data as { avisoReposiciones?: string }).avisoReposiciones : undefined;
    if (avisoReposiciones) toast(avisoReposiciones, { duration: 9000 });
    // ws1-t8 (punto 12): la cita era de otro día y el paciente no había llegado — no se tocó.
    const citaDeOtroDiaSinTocar = firmar ? (res.data as { citaDeOtroDiaSinTocar?: string }).citaDeOtroDiaSinTocar : undefined;
    if (citaDeOtroDiaSinTocar) toast(textosFirma.firmadaSinTocarCita(citaDeOtroDiaSinTocar), { duration: 10000 });
    // M11 (Ronda 6): al FIRMAR, el cajón se queda abierto — es él quien
    // ahora ofrece Agendar/Avisar el próximo control con el cardId que
    // devuelve la firma (ver DrawerTreatmentCard.tsx, `justSigned`). Antes
    // este botón cerraba el cajón en los dos casos y esa pantalla nunca
    // llegaba a pintarse desde la Agenda. "Guardar borrador" sigue
    // cerrando: eso no cambió.
    if (!firmar) {
      cerrar();
      return;
    }
    return res.data.cardId;
  };

  return (
    <>
      <Btn
        variant="primary"
        size={compacto ? "sm" : "md"}
        className={compacto ? "" : "w-full"}
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
      {open && ctx && typeof document !== "undefined" ? createPortal(
        <div className={`${CLASES_REDISENO} ${orto.raiz} ${modulo.portal}`}>
        <DrawerTreatmentCard
          card={ctx.card}
          availableWires={ctx.availableWires}
          treatmentPlanId={treatmentPlanId}
          availablePhotoSets={ctx.availablePhotoSets}
          appointmentId={appointmentId}
          cita={ctx.cita}
          controlesPrevistos={ctx.controlesPrevistos}
          tecnica={ctx.tecnica}
          defaultsForNew={
            ctx.card
              ? undefined
              : {
                  cardNumber: ctx.defaultsForNew.cardNumber,
                  controlNumero: ctx.defaultsForNew.controlNumero,
                  phase: ctx.defaultsForNew.phase,
                  monthAt: ctx.defaultsForNew.monthAt,
                  wireFrom: ctx.defaultsForNew.wireFrom,
                  arcosActuales: ctx.defaultsForNew.arcosActuales ?? null,
                  visitDate: ctx.defaultsForNew.visitDate,
                  lastElastics: ctx.defaultsForNew.lastElastics,
                  lastIndications: ctx.defaultsForNew.lastIndications,
                  lastPendingBrackets: ctx.defaultsForNew.lastPendingBrackets,
                  proximoControlMin: ctx.defaultsForNew.proximoControlMin,
                  soapPrefill: ctx.defaultsForNew.soapPrefill,
                }
          }
          onClose={cerrar}
          onSave={(payload) => guardar(payload, false)}
          onSign={(payload) => guardar(payload, true)}
        />
        </div>,
        document.body,
      ) : null}
    </>
  );
}
