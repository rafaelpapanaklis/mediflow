"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, X, ShieldAlert, ChevronDown } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import { batchValidateAppointments } from "@/lib/agenda/mutations";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

/**
 * Audit ajuste 8: pending validation como sección expandible inline (no modal).
 * El stat "X pendientes validar" en sub-toolbar dispara togglePendingPanel.
 * Cuando state.pendingSectionOpen es true, este banner aparece arriba del body.
 */
export function AgendaValidateBanner() {
  const { state, dispatch, togglePendingPanel } = useAgenda();
  const router = useRouter();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [notifyWA, setNotifyWA] = useState(true);

  const pending = useMemo(
    () =>
      state.appointments
        .filter((a) => a.requiresValidation && a.status === "SCHEDULED")
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [state.appointments],
  );

  if (!state.pendingSectionOpen || pending.length === 0) return null;

  function markBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function processOne(appt: AgendaAppointmentDTO, action: "confirm" | "reject") {
    if (busyIds.has(appt.id)) return;
    markBusy(appt.id, true);
    const original = appt;
    dispatch({
      type: "OPTIMISTIC_STATUS",
      id: appt.id,
      status: action === "confirm" ? "CONFIRMED" : "CANCELLED",
    });
    try {
      const result = await batchValidateAppointments(action, [appt.id]);
      if (result.failed.length > 0) {
        throw new Error(result.failed[0]?.error ?? "update_failed");
      }
      router.refresh();
    } catch (err) {
      dispatch({ type: "ROLLBACK_STATUS", original });
      toast.error(err instanceof Error ? err.message : "No se pudo procesar");
    } finally {
      markBusy(appt.id, false);
    }
  }

  async function confirmAll() {
    if (bulkRunning || pending.length === 0) return;
    setBulkRunning(true);
    const ids = pending.map((a) => a.id);
    try {
      const result = await batchValidateAppointments("confirm", ids);
      if (result.failed.length === 0) {
        toast.success(
          `${result.processed} cita${result.processed === 1 ? "" : "s"} confirmada${result.processed === 1 ? "" : "s"}`,
        );
      } else {
        toast.error(
          `${result.failed.length} cita${result.failed.length === 1 ? "" : "s"} no se pudo confirmar`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al procesar el batch");
    } finally {
      setBulkRunning(false);
    }
  }

  return (
    <section className={styles.validateBanner} aria-label="Citas pendientes de validar">
      <div className={styles.validateBannerHead}>
        <div className={styles.validateBannerTitle}>
          <ShieldAlert size={14} aria-hidden />
          <span>
            <strong>{pending.length}</strong>{" "}
            cita{pending.length === 1 ? "" : "s"} pendiente{pending.length === 1 ? "" : "s"} de validar
          </span>
        </div>
        <div className={styles.validateBannerActions}>
          <label className={styles.validateNotifyToggle}>
            <input
              type="checkbox"
              checked={notifyWA}
              onChange={(e) => setNotifyWA(e.target.checked)}
            />
            <span>Notificar por WhatsApp</span>
          </label>
          <button
            type="button"
            className={styles.validateBulkBtn}
            onClick={() => void confirmAll()}
            disabled={bulkRunning}
          >
            {bulkRunning ? "Confirmando…" : `✓ Aprobar todas (${pending.length})`}
          </button>
          <button
            type="button"
            className={styles.validateBannerClose}
            onClick={() => togglePendingPanel(false)}
            aria-label="Colapsar"
            title="Colapsar"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      <ul className={styles.validateRowList} role="list">
        {pending.map((a) => (
          <ValidateRow
            key={a.id}
            appointment={a}
            doctorColor={doctorColorForAppt(state.doctors, a)}
            resourceName={state.resources.find((r) => r.id === a.resourceId)?.name ?? null}
            timezone={state.timezone}
            busy={busyIds.has(a.id) || bulkRunning}
            onConfirm={() => void processOne(a, "confirm")}
            onReject={() => void processOne(a, "reject")}
          />
        ))}
      </ul>
    </section>
  );
}

interface ValidateRowProps {
  appointment: AgendaAppointmentDTO;
  doctorColor: string;
  resourceName: string | null;
  timezone: string;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}

function ValidateRow({
  appointment, doctorColor, resourceName, timezone, busy, onConfirm, onReject,
}: ValidateRowProps) {
  return (
    <li className={styles.validateBannerRow}>
      <div className={styles.validateBannerRowMain}>
        <span className={styles.validateBannerRowTime}>
          {formatSlotTime(appointment.startsAt, timezone)}
        </span>
        <span className={styles.validateBannerRowName}>{appointment.patient.name}</span>
        {appointment.doctor && (
          <span className={styles.validateBannerRowDoctor}>
            <span
              className={styles.validateRowDoctorDot}
              style={{ background: doctorColor }}
              aria-hidden
            >
              {doctorInitials(appointment.doctor.shortName)}
            </span>
            {appointment.doctor.shortName}
          </span>
        )}
        {resourceName && <span className={styles.validateBannerRowResource}>· {resourceName}</span>}
        <span className={styles.validateBannerRowReason}>{appointment.reason ?? "Consulta"}</span>
        {appointment.overrideReason && (
          <span className={styles.validateBannerRowOverride}>
            «{appointment.overrideReason}»
          </span>
        )}
      </div>
      <div className={styles.validateBannerRowActions}>
        <button
          type="button"
          className={styles.validateBannerActionBtn}
          onClick={onReject}
          disabled={busy}
          aria-label="Rechazar"
          title="Rechazar"
        >
          <X size={12} aria-hidden />
        </button>
        <button
          type="button"
          className={`${styles.validateBannerActionBtn} ${styles.primary}`}
          onClick={onConfirm}
          disabled={busy}
        >
          <Check size={12} aria-hidden /> Aprobar
        </button>
      </div>
    </li>
  );
}

function doctorColorForAppt(
  doctors: { id: string; color: string | null }[],
  appt: AgendaAppointmentDTO,
): string {
  const id = appt.doctor?.id;
  if (!id) return "var(--brand)";
  const meta = doctors.find((d) => d.id === id);
  return doctorColorFor(id, meta?.color ?? null);
}
