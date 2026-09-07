"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
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
  ChevronRight,
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
import { useConfirmWithReason } from "@/components/ui/confirm-dialog";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { AgendaEditAppointmentModal } from "./agenda-edit-appointment-modal";
import { InvoiceDetailModal } from "@/components/dashboard/billing/invoice-detail-modal";
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

/**
 * Gemelo de `patchAppointmentStatus` (@/lib/agenda/mutations) con el motivo de
 * cancelación, que aquella no acepta. Vive aquí y no allá porque mutations.ts
 * no es de esta tarea; lanza el MISMO objeto `{status, error, reason}` que el
 * catch de `changeStatus` ya sabe leer.
 */
async function patchStatusWithReason(
  id: string,
  status: AppointmentStatus,
  reason: string,
): Promise<AgendaAppointmentDTO> {
  const res = await fetch(`/api/appointments/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw {
      status: res.status,
      error: body.error ?? "request_failed",
      reason: body.reason,
    };
  }
  const body = (await res.json()) as { appointment: AgendaAppointmentDTO };
  return body.appointment;
}

function patientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

interface AgendaDetailPanelProps {
  /** Clinic.cfdiTaxMode ("exempt" | "iva16"), threaded desde el server component
   *  de la agenda. Va hasta InvoiceDetailModal, que pre-llena con él el régimen
   *  fiscal del timbrado de forma síncrona (obligatoria allá a propósito: sin
   *  esto el cobro inline de la agenda timbraría con el default "exento"). */
  clinicTaxMode: string | null;
}

export function AgendaDetailPanel({ clinicTaxMode }: AgendaDetailPanelProps) {
  const t = useT();
  const { state, permissions, selectAppointment, dispatch, invalidateRangeCache } = useAgenda();
  const router = useRouter();
  const { open: openNewAppointment } = useNewAppointmentDialog();
  const confirmWithReason = useConfirmWithReason();
  const [pendingStatus, setPendingStatus] = useState<AppointmentStatus | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [chargingInvoice, setChargingInvoice] = useState<any | null>(null);
  const [resolvingCharge, setResolvingCharge] = useState(false);
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

  // ÚNICA ruta al expediente del panel: la usan el nombre/avatar de arriba y
  // el botón "Expediente" de abajo. `patient.id` llega en null cuando el
  // paciente está restringido para este usuario (la cita se ve, el nombre se
  // enmascara — ver maskedPatient): sin id no hay a dónde ir, así que el
  // nombre se queda como texto y el botón deshabilitado en vez de navegar a
  // /dashboard/patients/null.
  const patientHref = appt.patient.id
    ? `/dashboard/patients/${appt.patient.id}`
    : null;

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
    // Guard local (el pipeline de chips también llega aquí): mismo criterio y
    // mismo mensaje que el 403 de la API, sin gastar el round-trip (P1-3).
    const allowed = target === "CANCELLED" ? permissions.canCancel : permissions.canEdit;
    if (!allowed) {
      toast.error(`Permiso requerido: ${target === "CANCELLED" ? "agenda.delete" : "agenda.edit"}`);
      return false;
    }
    if (pendingStatus) return false;
    if (appt.status === target) {
      // Antes esto era un early return silente que el usuario veía como
      // "el botón no hace nada". Ahora damos feedback claro.
      toast(t("agenda.detailPanel.alreadyInStatus", { status: target }));
      return false;
    }

    // Cancelar pide confirmación y MOTIVO. El panel ya tenía el bloque para
    // mostrarlo, pero ninguna cancelación del staff lo guardaba y salía siempre
    // vacío (hallazgo 42). El motivo es opcional: si se deja en blanco, se
    // cancela igual. Todos los caminos de cancelar del panel (botón rojo y menú
    // "Más" del pipeline) pasan por aquí, así que basta con pedirlo una vez.
    let cancelReason: string | undefined;
    if (target === "CANCELLED") {
      // Textos literales: las claves nuevas no están en los diccionarios y
      // src/i18n/ no entra en esta tarea — t() de una clave desconocida
      // devuelve la clave cruda en pantalla. Mismo criterio que el
      // "Permiso requerido:" de más arriba y que STATUS_LABELS.
      const answer = await confirmWithReason({
        title: "¿Cancelar esta cita?",
        description:
          "La cita queda cancelada y se anulan sus recordatorios pendientes. Puedes anotar el motivo para que quede en el expediente.",
        variant: "danger",
        withReason: true,
        reasonLabel: "Motivo de la cancelación (opcional)",
        reasonPlaceholder: "Ej.: el paciente pidió reagendar",
        confirmText: t("agenda.detailPanel.actionCancel"),
      });
      if (!answer.confirmed) return false;
      cancelReason = answer.reason?.trim() || undefined;
    }

    const original: AgendaAppointmentDTO = appt;
    setPendingStatus(target);
    dispatch({ type: "OPTIMISTIC_STATUS", id: appt.id, status: target });

    try {
      const updated =
        cancelReason === undefined
          ? await patchAppointmentStatus(appt.id, target)
          : await patchStatusWithReason(appt.id, target, cancelReason);
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

  // Targets válidos desde el status actual SEGÚN LA MATRIZ (transitions.ts),
  // más los predicates que dependen del reloj — hoy, la gracia de 15 min del
  // no-show. Antes esto devolvía "todos los estados menos el actual" y el panel
  // pintaba ocho botones en cualquier estado, de los que el servidor rechazaba
  // con 409 los que no existían (hallazgos 33 y 39).
  //
  // El filtro por ROL se queda del lado del servidor: el rol no baja por este
  // árbol de props (el panel solo recibe `permissions`), así que aquí se filtra
  // por estado + permisos y la API vuelve a validar rol con 403.
  const validTargets = possibleTransitions(appt.status, {
    now: new Date(),
    appointmentStart: new Date(appt.startsAt),
  });
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
  // Sin agenda.edit no se ofrecen transiciones; cancelar además exige
  // agenda.delete (mismo criterio que la API de /status — P1-3).
  const primaryActions = permissions.canEdit
    ? validTargets.filter(
        (s) =>
          s !== "CANCELLED" &&
          s !== "NO_SHOW" &&
          s !== "CHECKED_IN" &&
          s !== "IN_CHAIR" &&
          !(isTerminal && s === "SCHEDULED"),
      )
    : [];
  const dangerActions = validTargets.filter(
    (s) =>
      (s === "CANCELLED" && permissions.canCancel) ||
      (s === "NO_SHOW" && permissions.canEdit),
  );

  // "Cobrar" desde la agenda: resuelve la factura vinculada a la cita y abre
  // el modal de cobro inline (sin navegar al perfil). Si la cita aún no tiene
  // factura (no se generó desde el expediente con sus procedimientos) avisamos
  // claro en vez de abrir un cobro vacío.
  async function handleCharge() {
    if (!appt || resolvingCharge) return;
    setResolvingCharge(true);
    try {
      const res = await fetch(`/api/invoices/by-appointment/${appt.id}`);
      if (res.status === 404) {
        toast.error(t("agenda.detailPanel.chargeNoInvoice"));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("agenda.detailPanel.chargeError"));
      }
      const data = await res.json();
      setChargingInvoice(data.invoice);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agenda.detailPanel.chargeError"));
    } finally {
      setResolvingCharge(false);
    }
  }

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

  // El nombre va DENTRO del enlace, así que el aria-label lo repite antes del
  // propósito: con solo "Abrir expediente del paciente" el lector de pantalla
  // no diría de QUIÉN es el expediente.
  const patientLinkLabel = `${appt.patient.name} — ${t("agenda.detailPanel.recordTitle")}`;

  // Mismo bloque con y sin enlace: la única diferencia es si va envuelto.
  const patientHeader = (
    <>
      <div className={styles.detailAvatar} aria-hidden>
        {patientInitials(appt.patient.name)}
      </div>
      <div>
        <div className={styles.detailName}>{appt.patient.name}</div>
        <div className={styles.detailSub}>
          {appt.requiresValidation ? t("agenda.detailPanel.pendingValidation") : t("agenda.detailPanel.patient")}
        </div>
      </div>
    </>
  );

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
          {patientHref ? (
            <Link
              href={patientHref}
              className={styles.detailPatientLink}
              title={t("agenda.detailPanel.recordTitle")}
              aria-label={patientLinkLabel}
            >
              {patientHeader}
              {/* La señal de "esto lleva a algún lado" que el hover solo no da
                  (y que en táctil no existe): se queda fija, y al pasar o
                  enfocar toma el acento y se corre. Decorativo — el ancla ya
                  tiene su aria-label. */}
              <ChevronRight
                size={14}
                strokeWidth={2.25}
                className={styles.detailPatientChevron}
                aria-hidden
              />
            </Link>
          ) : (
            patientHeader
          )}
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
        validTargets={validTargets}
      />

      {appt.requiresValidation && appt.overrideReason && (
        <div className={styles.detailAlerts}>
          <div className={styles.detailAlertsTitle}>
            <AlertTriangle size={12} aria-hidden /> {t("agenda.detailPanel.validationPending")}
          </div>
          <div className={styles.detailAlertsContent}>{appt.overrideReason}</div>
        </div>
      )}

      {validTargets.length === 0 && (
        // CHECKED_OUT es terminal: la matriz no tiene ninguna salida para
        // ningún rol. Antes se pintaban cuatro botones y los cuatro daban 409
        // (hallazgo 33). Ahora no hay botones, y se dice por qué.
        <div className={styles.pipelineNote}>
          {`Una cita en "${STATUS_LABELS[appt.status]}" ya no cambia de estado: es el final del recorrido.`}
        </div>
      )}

      <div className={styles.detailActions}>
        {/* Acciones de transición de status (filtradas por matriz). */}
        {primaryActions.map((target) => {
          const def = STATUS_ACTIONS[target];
          const label = t(def.labelKey);
          const Icon = def.icon;
          const isPrimary = def.variant === "primary";
          // Cuando se inicia consulta (IN_PROGRESS), navegamos a la ficha
          // con ?appointment=... — ese parámetro es la INTENCIÓN "consulta
          // en curso"; qué pantalla abre lo decide la ficha según la clínica
          // (ver consult-landing.ts), no esta ruta.
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
          onClick={() => { if (patientHref) router.push(patientHref); }}
          disabled={!patientHref}
          title={t("agenda.detailPanel.recordTitle")}
        >
          <FileText size={12} aria-hidden /> {t("agenda.detailPanel.record")}
        </button>
        {!isTerminal && permissions.canEdit && (
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
            onClick={(e) => { e.stopPropagation(); void handleCharge(); }}
            disabled={resolvingCharge}
            title={t("agenda.detailPanel.chargeTitle")}
          >
            <DollarSign size={12} aria-hidden /> {resolvingCharge ? "…" : t("agenda.detailPanel.charge")}
          </button>
        )}
        {isTerminal && permissions.canCreate && (
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

      {/* Cobro inline: reusa el modal de billing (que ya contiene el
          PaymentModal). La factura vinculada a la cita se resuelve vía
          /api/invoices/by-appointment y se cobra aquí sin navegar al perfil. */}
      <InvoiceDetailModal
        open={chargingInvoice !== null}
        invoice={chargingInvoice}
        patientName={appt.patient.name}
        onClose={() => setChargingInvoice(null)}
        onMutated={() => { invalidateRangeCache(); }}
        clinicTaxMode={clinicTaxMode}
      />
    </aside>
  );
}

/* ─────── Pipeline visual de estados (M5/M6/M7 audit · ajuste 1) ─────── */

interface StatusPipelineProps {
  appt: AgendaAppointmentDTO;
  pendingStatus: AppointmentStatus | null;
  onChange: (status: AppointmentStatus) => Promise<boolean> | void;
  /** Targets que la matriz permite desde el estado actual. */
  validTargets: AppointmentStatus[];
}

function StatusPipeline({ appt, pendingStatus, onChange, validTargets }: StatusPipelineProps) {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const currentIdx = pipelinePosition(appt.status);
  const next = nextLogicalStatus(appt.status);
  // El menú "Más" proponía CANCELLED/NO_SHOW mirando solo el estado actual, sin
  // consultar la matriz: en una cita COMPLETADA seguía ofreciendo "Cancelar"
  // (hallazgo 39). Se intersecta con lo que de verdad se puede hacer.
  const offRails = offRailsStatuses(appt.status).filter((s) => validTargets.includes(s));
  const isOffRails = currentIdx === -1;

  return (
    <div className={styles.statusPipeline}>
      <div className={styles.statusPipelineRow}>
        {STATUS_PIPELINE.map((status, idx) => {
          const isCurrent = appt.status === status;
          const isDone = !isOffRails && idx < currentIdx;
          const isNext = next?.status === status;
          const isPending = pendingStatus === status;
          // El riel del pipeline se sigue viendo entero (es el recorrido de la
          // cita), pero solo se puede pulsar lo que la matriz permite: antes
          // cualquier chip disparaba una transición que el server rechazaba.
          const reachable = validTargets.includes(status);
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
              disabled={!reachable || (pendingStatus !== null && !isPending)}
              aria-current={isCurrent}
              title={
                reachable || isCurrent
                  ? STATUS_LABELS[status]
                  : `No se puede pasar de "${STATUS_LABELS[appt.status]}" a "${STATUS_LABELS[status]}"`
              }
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
