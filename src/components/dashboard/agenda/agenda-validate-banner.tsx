"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, X, ShieldAlert, ChevronDown } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import { batchValidateAppointments } from "@/lib/agenda/mutations";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

/**
 * La ROPA del rediseño (ws1-t1, hallazgo 9): una clase por cada pieza del
 * banner, con los MISMOS nombres que usa `agenda.module.css`, para que el
 * componente elija entre las dos hojas con un solo `??`. Es OPCIONAL y
 * aditiva: sin ella se usan las clases de siempre y no cambia ni un nodo.
 * Solo la agenda nueva la pasa (`agenda-nueva/ropa.ts`).
 *
 * ⛔ No cambia ni una regla: la cola, el aprobar uno a uno o todos, el
 * aviso de WhatsApp y el rollback son los mismos.
 */
export type ValidarRopa = Readonly<Record<
  | "validateBanner"
  | "validateBannerHead"
  | "validateBannerTitle"
  | "validateBannerActions"
  | "validateNotifyToggle"
  | "validateBulkBtn"
  | "validateBannerClose"
  | "validateRowList"
  | "validateBannerRow"
  | "validateBannerRowMain"
  | "validateBannerRowTime"
  | "validateBannerRowName"
  | "validateBannerRowDoctor"
  | "validateRowDoctorDot"
  | "validateBannerRowResource"
  | "validateBannerRowReason"
  | "validateBannerRowOverride"
  | "validateBannerRowActions"
  | "validateBannerActionBtn"
  | "primary",
  string
>>;

/**
 * Audit ajuste 8: pending validation como sección expandible inline (no modal).
 * El stat "X pendientes validar" en sub-toolbar dispara togglePendingPanel.
 * Cuando state.pendingSectionOpen es true, este banner aparece arriba del body.
 */
export function AgendaValidateBanner({ ropa }: { ropa?: ValidarRopa } = {}) {
  const t = useT();
  // Sin ropa, `c` ES el módulo de siempre: las mismas clases, nodo por nodo.
  const c: ValidarRopa = ropa ?? (styles as ValidarRopa);
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
      toast.error(err instanceof Error ? err.message : t("agenda.validateBanner.processError"));
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
          t("agenda.validateBanner.confirmedToast", { count: result.processed }),
        );
      } else {
        toast.error(
          t("agenda.validateBanner.confirmFailedToast", { count: result.failed.length }),
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agenda.validateBanner.batchError"));
    } finally {
      setBulkRunning(false);
    }
  }

  return (
    <section className={c.validateBanner} aria-label={t("agenda.validateBanner.sectionLabel")}>
      <div className={c.validateBannerHead}>
        <div className={c.validateBannerTitle}>
          <ShieldAlert size={14} aria-hidden />
          <span>
            <strong>{pending.length}</strong>{" "}
            {t("agenda.validateBanner.pendingCount", { count: pending.length })}
          </span>
        </div>
        <div className={c.validateBannerActions}>
          <label className={c.validateNotifyToggle}>
            <input
              type="checkbox"
              checked={notifyWA}
              onChange={(e) => setNotifyWA(e.target.checked)}
            />
            <span>{t("agenda.validateBanner.notifyWhatsApp")}</span>
          </label>
          <button
            type="button"
            className={c.validateBulkBtn}
            onClick={() => void confirmAll()}
            disabled={bulkRunning}
          >
            {bulkRunning
              ? t("agenda.validateBanner.confirming")
              : t("agenda.validateBanner.approveAll", { count: pending.length })}
          </button>
          <button
            type="button"
            className={c.validateBannerClose}
            onClick={() => togglePendingPanel(false)}
            aria-label={t("agenda.validateBanner.collapse")}
            title={t("agenda.validateBanner.collapse")}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      <ul className={c.validateRowList} role="list">
        {pending.map((a) => (
          <ValidateRow
            key={a.id}
            c={c}
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
  c: ValidarRopa;
  appointment: AgendaAppointmentDTO;
  doctorColor: string;
  resourceName: string | null;
  timezone: string;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}

function ValidateRow({
  c, appointment, doctorColor, resourceName, timezone, busy, onConfirm, onReject,
}: ValidateRowProps) {
  const t = useT();
  return (
    <li className={c.validateBannerRow}>
      <div className={c.validateBannerRowMain}>
        <span className={c.validateBannerRowTime}>
          {formatSlotTime(appointment.startsAt, timezone)}
        </span>
        <span className={c.validateBannerRowName}>{appointment.patient.name}</span>
        {appointment.doctor && (
          <span className={c.validateBannerRowDoctor}>
            <span
              className={c.validateRowDoctorDot}
              style={{ background: doctorColor }}
              aria-hidden
            >
              {doctorInitials(appointment.doctor.shortName)}
            </span>
            {appointment.doctor.shortName}
          </span>
        )}
        {resourceName && <span className={c.validateBannerRowResource}>· {resourceName}</span>}
        <span className={c.validateBannerRowReason}>{appointment.reason ?? t("agenda.validateBanner.consultationDefault")}</span>
        {appointment.overrideReason && (
          <span className={c.validateBannerRowOverride}>
            «{appointment.overrideReason}»
          </span>
        )}
      </div>
      <div className={c.validateBannerRowActions}>
        <button
          type="button"
          className={c.validateBannerActionBtn}
          onClick={onReject}
          disabled={busy}
          aria-label={t("agenda.validateBanner.reject")}
          title={t("agenda.validateBanner.reject")}
        >
          <X size={12} aria-hidden />
        </button>
        <button
          type="button"
          className={`${c.validateBannerActionBtn} ${c.primary}`}
          onClick={onConfirm}
          disabled={busy}
        >
          <Check size={12} aria-hidden /> {t("agenda.validateBanner.approve")}
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
