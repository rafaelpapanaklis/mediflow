"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import * as Popover from "@radix-ui/react-popover";
import {
  Pencil,
  MessageCircle,
  X,
  Play,
  AlertTriangle,
  MoreHorizontal,
  Check,
  FileText,
  DollarSign,
  Calendar,
  LogIn,
  Armchair,
  CheckCircle2,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import {
  STATUS_PIPELINE,
  STATUS_LABELS,
  nextLogicalStatus,
  offRailsStatuses,
  pipelinePosition,
} from "@/lib/agenda/status-pipeline";
import { possibleTransitions } from "@/lib/agenda/transitions";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { AgendaEditAppointmentModal } from "./agenda-edit-appointment-modal";
import {
  RESOURCE_KIND_LABELS,
  type AgendaAppointmentDTO,
  type AppointmentStatus,
} from "@/lib/agenda/types";
import styles from "./agenda.module.css";

interface ActionDef {
  status: AppointmentStatus;
  /** Translation key resolved via t() at render time. */
  labelKey: string;
  icon: LucideIcon;
  variant?: "primary" | "danger" | undefined;
}

const STATUS_ACTIONS: Record<AppointmentStatus, ActionDef> = {
  SCHEDULED:    { status: "SCHEDULED",    labelKey: "agenda.detailPanel.actionReschedule",     icon: Calendar },
  CONFIRMED:    { status: "CONFIRMED",    labelKey: "agenda.detailPanel.actionConfirm",        icon: CheckCircle2 },
  CHECKED_IN:   { status: "CHECKED_IN",   labelKey: "agenda.detailPanel.actionCheckIn",        icon: LogIn },
  IN_CHAIR:     { status: "IN_CHAIR",     labelKey: "agenda.detailPanel.actionToChair",        icon: Armchair },
  IN_PROGRESS:  { status: "IN_PROGRESS",  labelKey: "agenda.detailPanel.actionStartConsult",   icon: Play, variant: "primary" },
  COMPLETED:    { status: "COMPLETED",    labelKey: "agenda.detailPanel.actionMarkCompleted",  icon: CheckCircle2, variant: "primary" },
  CHECKED_OUT:  { status: "CHECKED_OUT",  labelKey: "agenda.detailPanel.actionMarkCheckout",   icon: LogOut },
  CANCELLED:    { status: "CANCELLED",    labelKey: "agenda.detailPanel.actionCancel",         icon: X, variant: "danger" },
  NO_SHOW:      { status: "NO_SHOW",      labelKey: "agenda.detailPanel.actionMarkNoShow",     icon: AlertTriangle, variant: "danger" },
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED:    "var(--warning)",
  CONFIRMED:    "var(--info)",
  CHECKED_IN:   "var(--brand)",
  IN_CHAIR:     "var(--brand)",
  IN_PROGRESS:  "var(--success)",
  COMPLETED:    "var(--text-3)",
  CHECKED_OUT:  "var(--text-3)",
  CANCELLED:    "var(--text-4)",
  NO_SHOW:      "var(--danger)",
};

function patientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function AgendaDetailPanel() {
  const t = useT();
  const { state, selectAppointment, dispatch } = useAgenda();
  const router = useRouter();
  const { open: openNewAppointment } = useNewAppointmentDialog();
  const [pendingStatus, setPendingStatus] = useState<AppointmentStatus | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [, startTransition] = useTransition();

  const appt = useMemo(
    () =>
      state.selectedAppointmentId
        ? state.appointments.find((a) => a.id === state.selectedAppointmentId) ?? null
        : null,
    [state.appointments, state.selectedAppointmentId],
  );

  if (!appt) {
    return (
      <aside className={styles.detailPanel} aria-label={t("agenda.detailPanel.ariaLabel")}>
        <div className={styles.detailEmpty}>
          <span>{t("agenda.detailPanel.emptyState")}</span>
        </div>
      </aside>
    );
  }

  const doctorMeta = appt.doctor
    ? state.doctors.find((d) => d.id === appt.doctor!.id) ?? null
    : null;
  const docColor = appt.doctor
    ? doctorColorFor(appt.doctor.id, doctorMeta?.color ?? null)
    : "var(--brand)";
  const statusColor = STATUS_COLOR[appt.status];

  const start = formatSlotTime(appt.startsAt, state.timezone);
  const end = appt.endsAt ? formatSlotTime(appt.endsAt, state.timezone) : null;
  const startMs = new Date(appt.startsAt).getTime();
  const endMs = appt.endsAt ? new Date(appt.endsAt).getTime() : startMs;
  const durationMin = Math.max(0, Math.round((endMs - startMs) / 60_000));

  const resource = appt.resourceId
    ? state.resources.find((r) => r.id === appt.resourceId) ?? null
    : null;

  const resourceLabel = resource
    ? resource.name
    : appt.isTeleconsult
    ? t("agenda.detailPanel.teleconsult")
    : "—";

  const mode = appt.isTeleconsult
    ? t("agenda.detailPanel.teleconsult")
    : appt.isWalkIn
    ? t("agenda.detailPanel.walkIn")
    : t("agenda.detailPanel.inPerson");

  /**
   * Cambia el status del appointment optimistically + revalidate via
   * server. Devuelve true si el server confirmó el cambio, false si
   * hubo error o no aplica. El caller usa el bool para decidir side
   * effects (ej. navegar al expediente solo si IN_PROGRESS persistió).
   */
  async function changeStatus(target: AppointmentStatus): Promise<boolean> {
    if (!appt) return false;
    if (pendingStatus) return false;
    if (appt.status === target) {
      // Antes esto era un early return silente que el usuario veía como
      // "el botón no hace nada". Ahora damos feedback claro.
      toast(t("agenda.detailPanel.alreadyInStatus", { status: target }));
      return false;
    }

    const original: AgendaAppointmentDTO = appt;
    setPendingStatus(target);
    dispatch({ type: "OPTIMISTIC_STATUS", id: appt.id, status: target });

    try {
      const updated = await patchAppointmentStatus(appt.id, target);
      startTransition(() => {
        dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
      });
      toast.success(t("agenda.detailPanel.statusUpdated"));
      return true;
    } catch (err) {
      dispatch({ type: "ROLLBACK_STATUS", original });
      // ApiError viene como { status, error, reason } desde mutations.ts.
      // Native Error tiene .message. Fetch reject puede ser TypeError.
      const e = err as { status?: number; reason?: string; error?: string; message?: string };
      const detail = e?.reason ?? e?.error ?? e?.message ?? t("agenda.detailPanel.statusChangeError");
      const prefix = e?.status ? `[${e.status}] ` : "";
      toast.error(`${prefix}${detail}`);
      return false;
    } finally {
      setPendingStatus(null);
    }
  }

  async function sendWhatsapp() {
    if (!appt || waSending) return;
    setWaSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appt.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("agenda.detailPanel.whatsappError"));
      }
      toast.success(t("agenda.detailPanel.reminderSent"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agenda.detailPanel.whatsappError"));
    } finally {
      setWaSending(false);
    }
  }

  // Targets válidos desde el status actual (estructural, ignora rol — el
  // server enforcea rol con 409 si no aplica). Renderizamos un botón por
  // cada target válido. Esto reemplaza el "Iniciar consulta" hard-coded
  // que solo aceptaba CHECKED_IN como origen y bloqueaba el flow
  // CONFIRMED → IN_PROGRESS reportado por el usuario.
  const validTargets = possibleTransitions(appt.status);
  // Para citas terminales (CANCELLED/NO_SHOW), "SCHEDULED" técnicamente es
  // una transición válida (revertir el status). Pero la UX clínica dental
  // espera que "Reagendar" abra una nueva cita — la cita vieja queda
  // CANCELLED y se crea otra. Por eso filtramos SCHEDULED del listado de
  // primary actions y lo manejamos como botón aparte que abre el modal
  // de Nueva Cita pre-poblado.
  const isTerminal = appt.status === "CANCELLED" || appt.status === "NO_SHOW";
  // CHECKED_IN ("En Sala de Espera") e IN_CHAIR se excluyen de los botones
  // de acción: el primero es alcanzable por el chip del pipeline y el
  // segundo se de-prioriza del flujo. La transición backend sigue válida.
  const primaryActions = validTargets.filter(
    (s) =>
      s !== "CANCELLED" &&
      s !== "NO_SHOW" &&
      s !== "CHECKED_IN" &&
      s !== "IN_CHAIR" &&
      !(isTerminal && s === "SCHEDULED"),
  );
  const dangerActions = validTargets.filter(
    (s) => s === "CANCELLED" || s === "NO_SHOW",
  );

  function handleReschedule() {
    if (!appt) return;
    openNewAppointment({
      initialPatient: { id: appt.patient.id, name: appt.patient.name },
      initialDoctorId: appt.doctor?.id,
      initialReason: appt.reason ?? undefined,
      initialSlot: {
        doctorId: appt.doctor?.id,
        resourceId: appt.resourceId,
      },
      openAgendaAfter: false,
    });
    selectAppointment(null);
  }

  return (
    <aside
      className={styles.detailPanel}
      aria-label={t("agenda.detailPanel.ariaLabel")}
      style={{ "--mf-status-color": statusColor } as React.CSSProperties}
    >
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={styles.detailClose}
          onClick={() => selectAppointment(null)}
          aria-label={t("agenda.detailPanel.closeAriaLabel")}
        >
          <X size={14} />
        </button>
        <div className={styles.detailPatientRow}>
          <div className={styles.detailAvatar} aria-hidden>
            {patientInitials(appt.patient.name)}
          </div>
          <div>
            <div className={styles.detailName}>{appt.patient.name}</div>
            <div className={styles.detailSub}>
              {appt.requiresValidation ? t("agenda.detailPanel.pendingValidation") : t("agenda.detailPanel.patient")}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.detailTimeCard}>
        <div>
          <span className={styles.detailTimeMain}>{start}</span>
          {end && <span className={styles.detailTimeEnd}>– {end}</span>}
        </div>
        <div className={styles.detailTimeMeta}>
          <strong>{durationMin} min</strong> · {mode}
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>{t("agenda.detailPanel.sectionInfo")}</div>
        {appt.doctor && (
          <div className={styles.detailRow}>
            <span className={styles.detailRowLabel}>{t("agenda.detailPanel.labelDoctor")}</span>
            <span className={styles.detailRowValue}>
              <span
                className={styles.detailDocAvatar}
                style={{ background: docColor }}
                aria-hidden
              >
                {doctorInitials(appt.doctor.shortName)}
              </span>
              <span style={{ marginLeft: 8 }}>{appt.doctor.shortName}</span>
            </span>
          </div>
        )}
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>{t("agenda.detailPanel.labelTreatment")}</span>
          <span className={styles.detailRowValue}>{appt.reason ?? t("agenda.detailPanel.consultDefault")}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>{resource ? RESOURCE_KIND_LABELS[resource.kind] : t("agenda.detailPanel.labelResource")}</span>
          <span className={styles.detailRowValue}>{resourceLabel}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>{t("agenda.detailPanel.labelMode")}</span>
          <span className={styles.detailRowValue}>{mode}</span>
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>{t("agenda.detailPanel.sectionStatus")}</div>
        {appt.status === "CONFIRMED" && (
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--success)" }}>
            {t("agenda.detailPanel.confirmedByPatient")}
          </div>
        )}
        {(appt.status === "SCHEDULED" || (appt.status as string) === "PENDING") && (
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {t("agenda.detailPanel.toConfirm")}
          </div>
        )}
        {appt.status === "CANCELLED" && (
          <div style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 600, color: "var(--danger)" }}>
              {t("agenda.detailPanel.patientCancelled")}
            </span>
            {appt.cancelReason && (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                {appt.cancelReason}
              </div>
            )}
          </div>
        )}
      </div>
      <StatusPipeline
        appt={appt}
        pendingStatus={pendingStatus}
        onChange={changeStatus}
      />

      {appt.requiresValidation && appt.overrideReason && (
        <div className={styles.detailAlerts}>
          <div className={styles.detailAlertsTitle}>
            <AlertTriangle size={12} aria-hidden /> {t("agenda.detailPanel.validationPending")}
          </div>
          <div className={styles.detailAlertsContent}>{appt.overrideReason}</div>
        </div>
      )}

      <div className={styles.detailActions}>
        {/* Acciones de transición de status (filtradas por matriz). */}
        {primaryActions.map((target) => {
          const def = STATUS_ACTIONS[target];
          const label = t(def.labelKey);
          const Icon = def.icon;
          const isPrimary = def.variant === "primary";
          // Cuando se inicia consulta (IN_PROGRESS), navegamos al
          // expediente con ?appointment=... para abrir SOAP editor.
          // SOLO si la transición se aplicó OK (changeStatus → true).
          // Antes navegaba aún si el server rechazaba con 409 → user
          // veía cambio de página pero status real intacto.
          const onClickAction = async (e: React.MouseEvent) => {
            e.stopPropagation();
            const ok = await changeStatus(target);
            if (ok && target === "IN_PROGRESS") {
              router.push(`/dashboard/patients/${appt.patient.id}?appointment=${appt.id}`);
            }
          };
          return (
            <button
              key={target}
              type="button"
              className={`${styles.detailAction} ${isPrimary ? styles.primary : ""}`}
              onClick={onClickAction}
              disabled={pendingStatus !== null}
              title={label}
            >
              <Icon size={12} aria-hidden />
              {pendingStatus === target ? "…" : label}
            </button>
          );
        })}
        {/* Acciones permanentes (no dependen del status). */}
        <button
          type="button"
          className={styles.detailAction}
          onClick={() => router.push(`/dashboard/patients/${appt.patient.id}`)}
          title={t("agenda.detailPanel.recordTitle")}
        >
          <FileText size={12} aria-hidden /> {t("agenda.detailPanel.record")}
        </button>
        {!isTerminal && (
          <button
            type="button"
            className={styles.detailAction}
            onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
            title={t("agenda.detailPanel.editTitle")}
          >
            <Pencil size={12} aria-hidden /> {t("common.edit")}
          </button>
        )}
        <button
          type="button"
          className={styles.detailAction}
          onClick={sendWhatsapp}
          disabled={waSending}
        >
          <MessageCircle size={12} aria-hidden />
          {waSending ? t("agenda.detailPanel.sending") : "WhatsApp"}
        </button>
        {(appt.status === "COMPLETED" || appt.status === "CHECKED_OUT") && (
          <button
            type="button"
            className={styles.detailAction}
            onClick={() => router.push(`/dashboard/patients/${appt.patient.id}?tab=facturacion&appointment=${appt.id}`)}
            title={t("agenda.detailPanel.chargeTitle")}
          >
            <DollarSign size={12} aria-hidden /> {t("agenda.detailPanel.charge")}
          </button>
        )}
        {isTerminal && (
          <button
            type="button"
            className={`${styles.detailAction} ${styles.primary}`}
            onClick={(e) => { e.stopPropagation(); handleReschedule(); }}
            title={t("agenda.detailPanel.rescheduleTitle")}
          >
            <Calendar size={12} aria-hidden /> {t("agenda.detailPanel.actionReschedule")}
          </button>
        )}
        {/* Acciones destructivas al final. */}
        {dangerActions.map((target) => {
          const def = STATUS_ACTIONS[target];
          const label = t(def.labelKey);
          const Icon = def.icon;
          return (
            <button
              key={target}
              type="button"
              className={`${styles.detailAction} ${styles.danger}`}
              onClick={(e) => {
                e.stopPropagation();
                void changeStatus(target);
              }}
              disabled={pendingStatus !== null}
              title={label}
            >
              <Icon size={12} aria-hidden />
              {pendingStatus === target ? "…" : label}
            </button>
          );
        })}
      </div>

      <AgendaEditAppointmentModal
        appt={editOpen ? appt : null}
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </aside>
  );
}

/* ─────── Pipeline visual de estados (M5/M6/M7 audit · ajuste 1) ─────── */

interface StatusPipelineProps {
  appt: AgendaAppointmentDTO;
  pendingStatus: AppointmentStatus | null;
  onChange: (status: AppointmentStatus) => Promise<boolean> | void;
}

function StatusPipeline({ appt, pendingStatus, onChange }: StatusPipelineProps) {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const currentIdx = pipelinePosition(appt.status);
  const next = nextLogicalStatus(appt.status);
  const offRails = offRailsStatuses(appt.status);
  const isOffRails = currentIdx === -1;

  return (
    <div className={styles.statusPipeline}>
      <div className={styles.statusPipelineRow}>
        {STATUS_PIPELINE.map((status, idx) => {
          const isCurrent = appt.status === status;
          const isDone = !isOffRails && idx < currentIdx;
          const isNext = next?.status === status;
          const isPending = pendingStatus === status;
          const stateClass = isCurrent
            ? styles.current
            : isDone
            ? styles.done
            : isNext
            ? styles.next
            : styles.future;

          return (
            <button
              key={status}
              type="button"
              className={`${styles.pipelineChip} ${stateClass}`}
              style={{ "--mf-status-color": STATUS_COLOR[status] } as React.CSSProperties}
              onClick={(e) => {
                e.stopPropagation();
                void onChange(status);
              }}
              disabled={pendingStatus !== null && !isPending}
              aria-current={isCurrent}
              title={STATUS_LABELS[status]}
            >
              {isDone && <Check size={10} aria-hidden />}
              <span>{STATUS_LABELS[status]}</span>
              {isPending && <span aria-hidden>…</span>}
            </button>
          );
        })}
        <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={styles.pipelineMore}
              aria-label={t("agenda.detailPanel.moreStatusOptionsAria")}
              title={t("agenda.detailPanel.moreOptions")}
            >
              <MoreHorizontal size={14} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className={styles.statusPopover}
            >
              <div className={styles.statusPopoverTitle}>{t("agenda.detailPanel.specialStatuses")}</div>
              <div className={styles.statusPopoverList}>
                {offRails.length === 0 ? (
                  <div className={styles.statusPopoverEmpty}>{t("agenda.detailPanel.noActionsAvailable")}</div>
                ) : (
                  offRails.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={styles.statusPopoverItem}
                      style={{ "--mf-status-color": STATUS_COLOR[status] } as React.CSSProperties}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoreOpen(false);
                        void onChange(status);
                      }}
                      disabled={pendingStatus !== null}
                    >
                      <span
                        className={styles.statusPopoverDot}
                        style={{ background: STATUS_COLOR[status] }}
                        aria-hidden
                      />
                      <span>
                        {status === "SCHEDULED" && (appt.status === "CANCELLED" || appt.status === "NO_SHOW")
                          ? t("agenda.detailPanel.reopenAppointment")
                          : STATUS_LABELS[status]}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {isOffRails && (
        <div className={styles.pipelineNote}>
          {t("agenda.detailPanel.currentStatus")} <strong>{STATUS_LABELS[appt.status]}</strong>
        </div>
      )}
    </div>
  );
}
