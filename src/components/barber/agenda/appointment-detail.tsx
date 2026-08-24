"use client";

// ═══════════════════════════════════════════════════════════════════════
// Detalle de una visita + acción rápida según su estado.
//
// Los botones NO se inventan: salen de nextStatuses() del contrato
// (src/lib/barber/types.ts). El primero del flujo lineal se pinta como
// acción principal —"Confirmar cita", "Iniciar servicio", "Completar
// visita"— y cancelar / no llegó quedan como secundarios. Si el contrato
// cambia el flujo, esta pantalla cambia sola.
// ═══════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { MessageCircle, Pencil } from "lucide-react";
import {
  BARBER_APPOINTMENT_ACTION_LABELS,
  BARBER_APPOINTMENT_STATUS_UI,
  nextStatuses,
  type BarberAppointmentDTO,
  type BarberAppointmentStatus,
} from "@/lib/barber/types";
import { formatMXN, minuteToLabel, shopMinuteOfDay } from "@/lib/barber/agenda";
import { Field, Modal, Pill, agendaCss as css } from "./agenda-ui";

export interface AppointmentDetailProps {
  appointment: BarberAppointmentDTO;
  timezone: string;
  branchId: string;
  canEdit: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (appointment: BarberAppointmentDTO, note?: string | null) => void;
}

/** Estados que representan "seguir adelante" (el flujo lineal del contrato). */
const FORWARD: BarberAppointmentStatus[] = ["CONFIRMED", "IN_PROGRESS", "DONE"];

export function AppointmentDetail(props: AppointmentDetailProps) {
  const { appointment: appt, t, timezone } = props;
  const [busy, setBusy] = useState<BarberAppointmentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
  const options = nextStatuses(appt.status);
  const primary = options.find((s) => FORWARD.includes(s)) ?? null;
  const secondary = options.filter((s) => s !== primary);

  const total = appt.services.reduce((acc, s) => acc + s.priceAtBooking, 0);
  const startLabel = minuteToLabel(shopMinuteOfDay(new Date(appt.startAt), timezone));
  const endLabel = minuteToLabel(shopMinuteOfDay(new Date(appt.endAt), timezone));

  const move = async (to: BarberAppointmentStatus) => {
    setBusy(to);
    setError(null);
    try {
      const res = await fetch(`/api/barber/appointments/${appt.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, branchId: props.branchId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("barber.agenda.queue.errors.generic"));
        return;
      }
      props.onChanged(
        data.appointment as BarberAppointmentDTO,
        data.remindersInvalidated > 0 ? t("barber.agenda.move.remindersCancelled") : null,
      );
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={t("barber.agenda.detail.title")}
      onClose={props.onClose}
      closeLabel={t("barber.agenda.actions.close")}
      footer={
        props.canEdit ? (
          <>
            <button type="button" className={css.btn} onClick={props.onEdit}>
              <Pencil size={14} /> {t("barber.agenda.detail.edit")}
            </button>
            {primary ? (
              <button
                type="button"
                className={`${css.btn} ${css.btnPrimary}`}
                onClick={() => move(primary)}
                disabled={busy !== null}
              >
                {BARBER_APPOINTMENT_ACTION_LABELS[primary]}
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {error ? <div className={css.errorBox}>{error}</div> : null}

      <div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.status")}</span>
          <span className={css.detailValue}>
            <Pill tone={ui.tone}>{ui.label}</Pill>
          </span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.client")}</span>
          <span className={css.detailValue}>
            {appt.clientName || "—"}
            {appt.clientPhone ? (
              <>
                {" · "}
                <a
                  href={`https://wa.me/52${appt.clientPhone.replace(/\D/g, "").slice(-10)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand)", textDecoration: "none" }}
                >
                  <MessageCircle size={12} style={{ verticalAlign: -2 }} /> {appt.clientPhone}
                </a>
              </>
            ) : null}
          </span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.barber")}</span>
          <span className={css.detailValue}>{appt.barberName || "—"}</span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.when")}</span>
          <span className={css.detailValue}>
            {startLabel} – {endLabel}
          </span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.services")}</span>
          <span className={css.detailValue}>
            {appt.services.length > 0
              ? appt.services.map((s) => s.serviceName).join(" + ")
              : t("barber.agenda.card.noServices")}
          </span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.total")}</span>
          <span className={css.detailValue}>{formatMXN(total)}</span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.title")}</span>
          <span className={css.detailValue}>
            {t(`barber.agenda.detail.source.${appt.source}`)}
          </span>
        </div>
      </div>

      {appt.notes ? (
        <Field label={t("barber.agenda.detail.notes")}>
          <p className={css.hint} style={{ fontSize: 13, color: "var(--text-2)" }}>
            {appt.notes}
          </p>
        </Field>
      ) : null}

      {props.canEdit && secondary.length > 0 ? (
        <div className={css.actionsRow}>
          {secondary.map((status) => (
            <button
              type="button"
              key={status}
              className={`${css.btn} ${status === "CANCELLED" ? css.btnDanger : ""}`}
              onClick={() => move(status)}
              disabled={busy !== null}
            >
              {BARBER_APPOINTMENT_ACTION_LABELS[status]}
            </button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
