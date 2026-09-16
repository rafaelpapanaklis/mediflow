"use client";

/**
 * «¿Mover la cita?» — la confirmación que sale al soltar una cita arrastrada.
 *
 * Es el MISMO paso que la agenda de siempre (`AgendaRescheduleConfirmModal`):
 * nada se guarda hasta confirmar, y mientras se guarda no se puede cerrar. Lo
 * que cambia es la ropa (la del diseño nuevo) y que dice lo que la de siempre
 * callaba: de quién es la cita y, si cambia de doctor o de día, de dónde a
 * dónde.
 *
 * Va en un portal, fuera de la raíz de la agenda, así que trae sus propias
 * variables de color (`.tokensAgenda`) y su letra.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Loader2, X } from "lucide-react";
import { instrumentSans } from "@/fonts/menu";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import type { PlannedReschedule } from "@/lib/agenda/reschedule-flow";
import { fechaCorta } from "@/lib/agenda-nueva/fechas";
import { diaEnTz } from "@/lib/agenda-nueva/geometria";
import { rangoDePlan } from "@/lib/agenda-nueva/interacciones";
import s from "./agenda-nueva.module.css";

export interface ConfirmarMovimientoProps {
  plan: PlannedReschedule;
  guardando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarMovimiento({ plan, guardando, onConfirmar, onCancelar }: ConfirmarMovimientoProps) {
  const { state } = useAgenda();
  const tz = state.timezone;
  const { original } = plan;

  const nombreDoctor = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const d = state.doctors.find((x) => x.id === id);
    return d?.shortName ?? d?.displayName ?? (original.doctor?.id === id ? original.doctor.shortName : null);
  };

  const antes = {
    fecha: fechaCorta(diaEnTz(original.startsAt, tz)),
    rango: rangoDePlan(
      { newStartsAt: original.startsAt, newEndsAt: original.endsAt ?? original.startsAt },
      tz,
    ),
    doctor: nombreDoctor(original.doctor?.id),
  };
  const despues = {
    fecha: fechaCorta(diaEnTz(plan.newStartsAt, tz)),
    rango: rangoDePlan(plan, tz),
    doctor: nombreDoctor(plan.newDoctorId),
  };
  const cambiaDoctor = (original.doctor?.id ?? null) !== plan.newDoctorId;

  return (
    <Dialog.Root
      open
      onOpenChange={(abierto) => {
        if (!abierto && !guardando) onCancelar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={`${s.tokensAgenda} ${s.velo}`} />
        <Dialog.Content
          className={`${s.tokensAgenda} ${instrumentSans.variable} ${s.modalMover}`}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (guardando) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (guardando) e.preventDefault();
          }}
        >
          <div className={s.modalCabecera}>
            <span className={s.panelRotulo}>Mover cita</span>
            <Dialog.Close asChild>
              <button
                type="button"
                className={`${s.panelIconoBoton} ${s.panelCerrar}`}
                aria-label="Cerrar"
                disabled={guardando}
              >
                <X size={18} strokeWidth={2.2} />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Title className={s.modalTitulo}>{original.patient.name}</Dialog.Title>

          <div className={s.moverFilas}>
            <div className={`${s.moverFila} ${s.moverFilaAntes}`}>
              <span className={s.datoRotulo}>Antes</span>
              <span className={s.moverHora}>{antes.rango}</span>
              <span className={s.moverDetalle}>
                {antes.fecha}
                {cambiaDoctor && antes.doctor ? ` · ${antes.doctor}` : ""}
              </span>
            </div>
            <ArrowRight className={s.moverFlecha} size={18} strokeWidth={2.2} aria-hidden />
            <div className={`${s.moverFila} ${s.moverFilaDespues}`}>
              <span className={s.datoRotulo}>Ahora</span>
              <span className={s.moverHora}>{despues.rango}</span>
              <span className={s.moverDetalle}>
                {despues.fecha}
                {despues.doctor ? ` · ${despues.doctor}` : ""}
              </span>
            </div>
          </div>

          <div className={s.modalPie}>
            <button
              type="button"
              className={s.accionSecundaria}
              onClick={onCancelar}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={s.accionPrincipal}
              onClick={onConfirmar}
              disabled={guardando}
              autoFocus
            >
              {guardando ? (
                <>
                  <Loader2 size={16} className={s.girando} aria-hidden />
                  Moviendo…
                </>
              ) : (
                "Mover cita"
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
