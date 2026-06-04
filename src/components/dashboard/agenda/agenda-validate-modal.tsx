"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, X, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import { batchValidateAppointments } from "@/lib/agenda/mutations";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

export function AgendaValidateModal() {
  const t = useT();
  const { state, dispatch, closeModal } = useAgenda();
  const router = useRouter();
  const open = state.modalOpen === "validate";
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  const pending = useMemo(
    () =>
      state.appointments
        .filter((a) => a.requiresValidation && a.status === "SCHEDULED")
        .sort(
          (a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        ),
    [state.appointments],
  );

  function markBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function processOne(
    appt: AgendaAppointmentDTO,
    action: "confirm" | "reject",
  ) {
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
      // refetch del día para sincronizar requiresValidation: false
      router.refresh();
    } catch (err) {
      dispatch({ type: "ROLLBACK_STATUS", original });
      toast.error(
        err instanceof Error ? err.message : t("agenda.validateModal.processError"),
      );
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
          t("agenda.validateModal.confirmedToast", { count: result.processed }),
        );
      } else {
        toast.error(
          t("agenda.validateModal.confirmFailedToast", { count: result.failed.length }),
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("agenda.validateModal.batchError"),
      );
    } finally {
      setBulkRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className={styles.validateModal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <ShieldAlert
              size={14}
              aria-hidden
              style={{ color: "var(--warning)", marginRight: 6, verticalAlign: "-2px" }}
            />
            {t("agenda.validateModal.title")}
          </div>
          <div className={styles.validateSubtitle}>
            {pending.length === 0
              ? t("agenda.validateModal.subtitleEmpty")
              : t("agenda.validateModal.subtitleCount", { count: pending.length })}
          </div>
        </div>
        <div className={styles.modalBody}>
          {pending.length === 0 ? (
            <div className={styles.modalEmpty}>
              {t("agenda.validateModal.allProcessed")}
            </div>
          ) : (
            pending.map((a) => (
              <ValidateRow
                key={a.id}
                appointment={a}
                doctorColor={doctorColorForAppt(state.doctors, a)}
                resourceName={
                  state.resources.find((r) => r.id === a.resourceId)?.name ?? null
                }
                busy={busyIds.has(a.id) || bulkRunning}
                timezone={state.timezone}
                onConfirm={() => void processOne(a, "confirm")}
                onReject={() => void processOne(a, "reject")}
              />
            ))
          )}
        </div>
        <div className={styles.validateFooter}>
          <button
            type="button"
            className={styles.modalAddCancel}
            onClick={closeModal}
          >
            {t("common.close")}
          </button>
          {pending.length > 0 && (
            <button
              type="button"
              className={styles.modalAddSave}
              onClick={() => void confirmAll()}
              disabled={bulkRunning}
            >
              {bulkRunning
                ? t("agenda.validateModal.confirming")
                : t("agenda.validateModal.confirmAll", { count: pending.length })}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ValidateRowProps {
  appointment: AgendaAppointmentDTO;
  doctorColor: string;
  resourceName: string | null;
  busy: boolean;
  timezone: string;
  onConfirm: () => void;
  onReject: () => void;
}

function ValidateRow({
  appointment,
  doctorColor,
  resourceName,
  busy,
  timezone,
  onConfirm,
  onReject,
}: ValidateRowProps) {
  const t = useT();
  return (
    <div className={styles.validateRow}>
      <div className={styles.validateRowMain}>
        <div className={styles.validateRowName}>{appointment.patient.name}</div>
        <div className={styles.validateRowMeta}>
          <span className={styles.validateRowTime}>
            {formatSlotTime(appointment.startsAt, timezone)}
            {appointment.endsAt &&
              ` – ${formatSlotTime(appointment.endsAt, timezone)}`}
          </span>
          {appointment.doctor && (
            <span className={styles.validateRowDoctor}>
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
          {resourceName && <span>· {resourceName}</span>}
          <span>· {appointment.reason ?? t("agenda.validateModal.consultationDefault")}</span>
        </div>
        {appointment.overrideReason && (
          <div className={styles.validateRowReason}>
            {appointment.overrideReason}
          </div>
        )}
      </div>
      <div className={styles.validateRowActions}>
        <button
          type="button"
          className={`${styles.validateAction} ${styles.danger}`}
          onClick={onReject}
          disabled={busy}
          aria-label={t("agenda.validateModal.reject")}
        >
          <X size={12} aria-hidden /> {t("agenda.validateModal.reject")}
        </button>
        <button
          type="button"
          className={`${styles.validateAction} ${styles.primary}`}
          onClick={onConfirm}
          disabled={busy}
          aria-label={t("agenda.validateModal.confirm")}
        >
          <Check size={12} aria-hidden /> {t("agenda.validateModal.confirm")}
        </button>
      </div>
    </div>
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
