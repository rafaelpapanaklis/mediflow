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
 * variables de color (`CLASES_PORTAL_AGENDA`: los `--m2-*` del menú con su
 * versión oscura + los `--ag-*` de `.tokensAgenda`) y su letra.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ArrowRight, Loader2, X } from "lucide-react";
import { instrumentSans } from "@/fonts/menu";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import type { PlannedReschedule } from "@/lib/agenda/reschedule-flow";
import { fechaCorta } from "@/lib/agenda-nueva/fechas";
import { diaEnTz } from "@/lib/agenda-nueva/geometria";
import { rangoDePlan } from "@/lib/agenda-nueva/interacciones";
import { CLASES_PORTAL_AGENDA } from "./ropa";
import s from "./agenda-nueva.module.css";

/** Lo mínimo del bloqueo para avisar. Subconjunto del `BloqueoDTO`. */
export interface BloqueoDelDestino {
  /** `null` = toda la clínica. */
  doctorId: string | null;
  doctorNombre: string | null;
  reason: string;
}

export interface ConfirmarMovimientoProps {
  plan: PlannedReschedule;
  guardando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  /**
   * WS1-T3 — el bloqueo que tapa el destino, o `null`. Con él, esta ventana
   * deja de ser un «¿mover?» de trámite y dice en amarillo que ese día está
   * cerrado, con el motivo escrito. Sin él (el 99 % de los movimientos) la
   * ventana sale exactamente como antes: ni un píxel de más.
   */
  bloqueo?: BloqueoDelDestino | null;
  /** El día de destino, `YYYY-MM-DD` en la zona de la clínica. */
  diaDestino?: string;
}

export function ConfirmarMovimiento({
  plan,
  guardando,
  onConfirmar,
  onCancelar,
  bloqueo = null,
  diaDestino,
}: ConfirmarMovimientoProps) {
  const { state } = useAgenda();
  // Solo para el aviso de bloqueo: el resto de esta ventana conserva sus
  // textos tal cual estaban (los traduce ws1-t1 cuando le toque la agenda
  // nueva entera). `vista-mes.tsx` ya usa `useT` en esta misma carpeta.
  const t = useT();
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
        <Dialog.Overlay className={`${CLASES_PORTAL_AGENDA} ${s.velo}`} />
        <Dialog.Content
          className={`${CLASES_PORTAL_AGENDA} ${instrumentSans.variable} ${s.modalMover}`}
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

          {/* ── El aviso de bloqueo (WS1-T3) ──
              Triángulo + texto: el color amarillo es refuerzo, no el mensaje.
              Se lee el MOTIVO que escribió la persona, y de quién es el cierre
              —toda la clínica, o el doctor que se ausenta—. */}
          {bloqueo && (
            <div className={s.moverBloqueo} role="alert">
              <AlertTriangle size={17} strokeWidth={2.2} className={s.moverBloqueoIcono} aria-hidden />
              <div className={s.moverBloqueoTextos}>
                <span className={s.moverBloqueoTitulo}>
                  {t("agenda.bloqueos.confirmar.titulo")}
                </span>
                <span className={s.moverBloqueoDetalle}>
                  {diaDestino ? `${fechaCorta(diaDestino)} · ` : ""}
                  {bloqueo.reason} ·{" "}
                  {bloqueo.doctorId === null
                    ? t("agenda.bloqueos.confirmar.alcanceClinica")
                    : bloqueo.doctorNombre ?? t("agenda.bloqueos.confirmar.alcanceDoctorSinNombre")}
                </span>
                <span className={s.moverBloqueoNota}>
                  {t("agenda.bloqueos.confirmar.cerradaPara")}{" "}
                  {t("agenda.bloqueos.confirmar.tuSiPuedes")}
                </span>
              </div>
            </div>
          )}

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
