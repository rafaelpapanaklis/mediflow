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
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

interface ActionDef {
  status: AppointmentStatus;
  label: string;
  icon: LucideIcon;
  variant?: "primary" | "danger" | undefined;
}

const STATUS_ACTIONS: Record<AppointmentStatus, ActionDef> = {
  SCHEDULED:    { status: "SCHEDULED",    label: "Reagendar",       icon: Calendar },
  CONFIRMED:    { status: "CONFIRMED",    label: "Confirmar",       icon: CheckCircle2 },
  CHECKED_IN:   { status: "CHECKED_IN",   label: "Check-in",        icon: LogIn },
  IN_CHAIR:     { status: "IN_CHAIR",     label: "Pasar a sillón",  icon: Armchair },
  IN_PROGRESS:  { status: "IN_PROGRESS",  label: "Iniciar consulta", icon: Play, variant: "primary" },
  COMPLETED:    { status: "COMPLETED",    label: "Marcar completada", icon: CheckCircle2, variant: "primary" },
  CHECKED_OUT:  { status: "CHECKED_OUT",  label: "Marcar checkout", icon: LogOut },
  CANCELLED:    { status: "CANCELLED",    label: "Cancelar",        icon: X, variant: "danger" },
  NO_SHOW:      { status: "NO_SHOW",      label: "Marcar no-show",  icon: AlertTriangle, variant: "danger" },
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
  const { state, selectAppointment, dispatch } = useAgenda();
  const router = useRouter();
  const [pendingStatus, setPendingStatus] = useState<AppointmentStatus | null>(null);
  const [waSending, setWaSending] = useState(false);
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
      <aside className={styles.detailPanel} aria-label="Detalle de cita">
        <div className={styles.detailEmpty}>
          <span>Selecciona una cita para ver su detalle</span>
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
    ? "Teleconsulta"
    : "—";

  const mode = appt.isTeleconsult
    ? "Teleconsulta"
    : appt.isWalkIn
    ? "Walk-in"
    : "Presencial";

  async function changeStatus(target: AppointmentStatus) {
    if (!appt) return;
    if (appt.status === target) return;
    if (pendingStatus) return;

    const original: AgendaAppointmentDTO = appt;
    setPendingStatus(target);
    dispatch({ type: "OPTIMISTIC_STATUS", id: appt.id, status: target });

    try {
      const updated = await patchAppointmentStatus(appt.id, target);
      startTransition(() => {
        dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
      });
      toast.success("Estado actualizado");
    } catch (err) {
      dispatch({ type: "ROLLBACK_STATUS", original });
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo cambiar el estado";
      toast.error(reason);
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
        throw new Error(body.error ?? "No se pudo enviar WhatsApp");
      }
      toast.success("Recordatorio enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar WhatsApp");
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
  const primaryActions = validTargets.filter(
    (s) => s !== "CANCELLED" && s !== "NO_SHOW",
  );
  const dangerActions = validTargets.filter(
    (s) => s === "CANCELLED" || s === "NO_SHOW",
  );

  return (
    <aside
      className={styles.detailPanel}
      aria-label="Detalle de cita"
      style={{ "--mf-status-color": statusColor } as React.CSSProperties}
    >
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={styles.detailClose}
          onClick={() => selectAppointment(null)}
          aria-label="Cerrar detalle"
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
              {appt.requiresValidation ? "Pendiente de validación" : "Paciente"}
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
        <div className={styles.detailSectionTitle}>Información</div>
        {appt.doctor && (
          <div className={styles.detailRow}>
            <span className={styles.detailRowLabel}>Doctor</span>
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
          <span className={styles.detailRowLabel}>Tratamiento</span>
          <span className={styles.detailRowValue}>{appt.reason ?? "Consulta"}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>{resource?.kind === "ROOM" ? "Sala" : resource?.kind === "EQUIPMENT" ? "Equipo" : "Sillón"}</span>
          <span className={styles.detailRowValue}>{resourceLabel}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>Modo</span>
          <span className={styles.detailRowValue}>{mode}</span>
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Estado</div>
      </div>
      <StatusPipeline
        appt={appt}
        pendingStatus={pendingStatus}
        onChange={changeStatus}
      />

      {appt.requiresValidation && appt.overrideReason && (
        <div className={styles.detailAlerts}>
          <div className={styles.detailAlertsTitle}>
            <AlertTriangle size={12} aria-hidden /> Validación pendiente
          </div>
          <div className={styles.detailAlertsContent}>{appt.overrideReason}</div>
        </div>
      )}

      <div className={styles.detailActions}>
        {/* Acciones de transición de status (filtradas por matriz). */}
        {primaryActions.map((target) => {
          const def = STATUS_ACTIONS[target];
          const Icon = def.icon;
          const isPrimary = def.variant === "primary";
          // Cuando se inicia consulta (IN_PROGRESS), navegamos al
          // expediente con ?appointment=... para abrir SOAP editor.
          const onClickAction = async () => {
            await changeStatus(target);
            if (target === "IN_PROGRESS") {
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
              title={def.label}
            >
              <Icon size={12} aria-hidden />
              {pendingStatus === target ? "…" : def.label}
            </button>
          );
        })}
        {/* Acciones permanentes (no dependen del status). */}
        <button
          type="button"
          className={styles.detailAction}
          onClick={() => router.push(`/dashboard/patients/${appt.patient.id}`)}
          title="Abrir expediente del paciente"
        >
          <FileText size={12} aria-hidden /> Expediente
        </button>
        <button
          type="button"
          className={styles.detailAction}
          onClick={sendWhatsapp}
          disabled={waSending}
        >
          <MessageCircle size={12} aria-hidden />
          {waSending ? "Enviando…" : "WhatsApp"}
        </button>
        {(appt.status === "COMPLETED" || appt.status === "CHECKED_OUT") && (
          <button
            type="button"
            className={styles.detailAction}
            onClick={() => router.push(`/dashboard/patients/${appt.patient.id}?tab=facturacion&appointment=${appt.id}`)}
            title="Cobrar / facturar la cita"
          >
            <DollarSign size={12} aria-hidden /> Cobrar
          </button>
        )}
        <button
          type="button"
          className={styles.detailAction}
          disabled
          title="Edición disponible próximamente"
        >
          <Pencil size={12} aria-hidden /> Editar
        </button>
        {/* Acciones destructivas al final. */}
        {dangerActions.map((target) => {
          const def = STATUS_ACTIONS[target];
          const Icon = def.icon;
          return (
            <button
              key={target}
              type="button"
              className={`${styles.detailAction} ${styles.danger}`}
              onClick={() => changeStatus(target)}
              disabled={pendingStatus !== null}
              title={def.label}
            >
              <Icon size={12} aria-hidden />
              {pendingStatus === target ? "…" : def.label}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/* ─────── Pipeline visual de estados (M5/M6/M7 audit · ajuste 1) ─────── */

interface StatusPipelineProps {
  appt: AgendaAppointmentDTO;
  pendingStatus: AppointmentStatus | null;
  onChange: (status: AppointmentStatus) => void;
}

function StatusPipeline({ appt, pendingStatus, onChange }: StatusPipelineProps) {
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
              onClick={() => onChange(status)}
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
              aria-label="Más opciones de estado"
              title="Más opciones"
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
              <div className={styles.statusPopoverTitle}>Estados especiales</div>
              <div className={styles.statusPopoverList}>
                {offRails.length === 0 ? (
                  <div className={styles.statusPopoverEmpty}>Sin acciones disponibles</div>
                ) : (
                  offRails.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={styles.statusPopoverItem}
                      style={{ "--mf-status-color": STATUS_COLOR[status] } as React.CSSProperties}
                      onClick={() => {
                        setMoreOpen(false);
                        onChange(status);
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
                          ? "Re-abrir cita"
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
          Estado actual: <strong>{STATUS_LABELS[appt.status]}</strong>
        </div>
      )}
    </div>
  );
}
