"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, MessageCircle, AlertTriangle, Baby } from "lucide-react";
import toast from "react-hot-toast";
import { SlotGridPicker } from "./slot-grid-picker";
import { PatientSearchField } from "./patient-search-field";
import { MotivoField } from "./motivo-field";
import { DateDropdown } from "./date-dropdown";
import { DurationPicker } from "./duration-picker";
import { SummaryFooter } from "./summary-footer";
import { todayInTz, formatSlotTime } from "@/lib/agenda/time-utils";
import {
  DURATION_PRESETS_MIN,
  defaultDurationFor,
} from "@/lib/new-appointment/duration-presets";
import type {
  AppointmentConflictError,
  DoctorColumnDTO,
  ResourceDTO,
} from "@/lib/agenda/types";
import { describeOverlapConflict, describeResourceUnavailable } from "@/lib/agenda/conflict-copy";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { getResourceSchedule } from "@/lib/agenda/mutations";
import type { WeekScheduleDTO } from "@/lib/agenda/types";
import type {
  OpenNewAppointmentParams,
} from "@/lib/new-appointment/types";

const REASON_PRESET_KEYS = [
  "appointments.newApptDialog.presetGeneralConsult",
  "appointments.newApptDialog.presetFirstConsult",
  "appointments.newApptDialog.presetCleaning",
  "appointments.newApptDialog.presetResin",
  "appointments.newApptDialog.presetPain",
  "appointments.newApptDialog.presetUrgency",
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  params: OpenNewAppointmentParams | null;
}

interface BootData {
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  timezone: string;
  slotMinutes: number;
  dayStart: number;
  dayEnd: number;
  waConnected: boolean;
}

export function NewAppointmentDialog({ isOpen, onClose, params }: Props) {
  const t = useT();
  const router = useRouter();
  const reasonPresets = REASON_PRESET_KEYS.map((key) => t(key));

  const [boot, setBoot] = useState<BootData | null>(null);
  const [bootLoading, setBootLoading] = useState(false);

  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [resourceId, setResourceId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [dateISO, setDateISO] = useState("");
  const [duration, setDuration] = useState(30);
  const [customDurationInput, setCustomDurationInput] = useState("");
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [notifyPatient, setNotifyPatient] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ patient?: boolean; doctorId?: boolean; resourceId?: boolean; reason?: boolean; slot?: boolean }>({});
  // Pediatrics — context derivado del paciente seleccionado. Se hidrata
  // tras seleccionar paciente vía /api/pediatrics/context. Cuando no
  // aplica el módulo (gating), el endpoint devuelve { pediatric: false }
  // y este state queda en null sin afectar el flujo normal.
  const [pediatricContext, setPediatricContext] = useState<{
    ageFormatted: string | null;
    suggestedDurationMin: number;
    suggestedDurationMaxMin: number;
    recentFranklLow: boolean;
    longerBlockSuggestion: { minMin: number; maxMin: number } | null;
    primaryGuardianName: string | null;
  } | null>(null);

  // Resource working hours. undefined = not yet loaded (or no resource).
  // null = resource is always-open (no schedule rows). Object = schedule.
  const [resourceSchedule, setResourceSchedule] = useState<
    WeekScheduleDTO | null | undefined
  >(undefined);

  useEffect(() => {
    if (!resourceId) {
      setResourceSchedule(undefined);
      return;
    }
    let cancelled = false;
    setResourceSchedule(undefined);
    getResourceSchedule(resourceId)
      .then((body) => {
        if (!cancelled) setResourceSchedule(body.schedule);
      })
      .catch(() => {
        if (!cancelled) setResourceSchedule(null); // fail-open: no filter
      });
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  useEffect(() => {
    // Reset boot al cerrar el modal: así cada apertura re-fetchea doctores,
    // recursos y config en vez de servir los datos de la primera apertura
    // (evita selectores stale sin necesidad de hard refresh).
    if (!isOpen) {
      setBoot(null);
      return;
    }
    if (boot) return;
    setBootLoading(true);
    fetch(`/api/appointments?date=${todayInTz("America/Mexico_City")}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (body) => {
        if (!body) {
          toast.error(t("appointments.newApptDialog.toastConfigLoadFailed"));
          onClose();
          return;
        }
        let waConnected = false;
        try {
          const sRes = await fetch("/api/clinic/me", { credentials: "include" });
          if (sRes.ok) {
            const sBody = await sRes.json();
            waConnected = !!sBody?.clinic?.waConnected;
          }
        } catch {
          /* default false */
        }
        setBoot({
          doctors: body.doctors ?? [],
          resources: body.resources ?? [],
          timezone: body.timezone,
          slotMinutes: body.slotMinutes,
          dayStart: body.dayStart,
          dayEnd: body.dayEnd,
          waConnected,
        });
        setNotifyPatient(waConnected);
        setDuration(defaultDurationFor(body.slotMinutes));
      })
      .finally(() => setBootLoading(false));
  }, [isOpen, boot, onClose]);

  useEffect(() => {
    if (!isOpen || !boot) return;

    setErrors({});
    setPatient(params?.initialPatient ?? null);
    setReason(params?.initialReason ?? "");
    setSubmitting(false);
    setPediatricContext(null);

    const initialSlot = params?.initialSlot;
    if (initialSlot?.startsAt) {
      const d = new Date(initialSlot.startsAt);
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: boot.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      setDateISO(fmt.format(d));
      setSlotIso(initialSlot.startsAt);
    } else {
      setDateISO(todayInTz(boot.timezone));
      setSlotIso(null);
    }

    if (initialSlot?.doctorId) {
      setDoctorId(initialSlot.doctorId);
    } else if (params?.initialDoctorId) {
      setDoctorId(params.initialDoctorId);
    } else if (boot.doctors[0]) {
      setDoctorId(boot.doctors[0].id);
    } else {
      setDoctorId("");
    }

    setResourceId(initialSlot?.resourceId ?? "");
  }, [isOpen, boot, params]);

  // Pediatrics — al cambiar paciente, consulta el endpoint para saber si
  // aplica el módulo. Si aplica, baja la duración a 30 min y pre-llena
  // notas con el tutor (spec §4.B.8).
  useEffect(() => {
    if (!patient) {
      setPediatricContext(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/pediatrics/context?patientId=${encodeURIComponent(patient.id)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body || !body.pediatric) {
          setPediatricContext(null);
          return;
        }
        setPediatricContext({
          ageFormatted: body.ageFormatted,
          suggestedDurationMin: body.suggestedDurationMin,
          suggestedDurationMaxMin: body.suggestedDurationMaxMin,
          recentFranklLow: Boolean(body.recentFranklLow),
          longerBlockSuggestion: body.longerBlockSuggestion ?? null,
          primaryGuardianName: body.primaryGuardianName ?? null,
        });
        setDuration(body.recentFranklLow ? 60 : body.suggestedDurationMin);
        if (body.primaryGuardianName) {
          setReason((current) =>
            current.trim().length === 0
              ? t("appointments.newApptDialog.reasonGuardianPrefill", {
                  name: body.primaryGuardianName,
                })
              : current,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setPediatricContext(null);
      });
    return () => { cancelled = true; };
  }, [patient]);

  const submit = async () => {
    const newErrors: typeof errors = {};
    if (!patient) newErrors.patient = true;
    if (!doctorId) newErrors.doctorId = true;
    if (boot && boot.resources.length > 0 && !resourceId) newErrors.resourceId = true;
    if (!reason.trim()) newErrors.reason = true;
    if (!slotIso) newErrors.slot = true;
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast.error(t("appointments.newApptDialog.toastFillRequired"));
      return;
    }
    if (!boot) return;

    const finalReason = reason.trim() || null;

    const startsAt = new Date(slotIso);
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);

    setSubmitting(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          doctorId,
          resourceId: resourceId || null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          reason: finalReason,
          isTeleconsult: false,
          notifyPatient,
        }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as AppointmentConflictError;
        toast.error(
          describeOverlapConflict(body.conflictingAppointment, {
            doctorId,
            resourceId: resourceId || null,
          }),
          { duration: 5000 },
        );
        setSubmitting(false);
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: "outside_schedule" | "resource_closed_this_day";
        };
        if (body?.error === "resource_unavailable") {
          const resourceName =
            boot?.resources.find((r) => r.id === resourceId)?.name ?? null;
          toast.error(describeResourceUnavailable(body.reason, resourceName), {
            duration: 5000,
          });
          setSubmitting(false);
          return;
        }
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error ?? t("appointments.newApptDialog.toastCreateFailed"));
        setSubmitting(false);
        return;
      }

      const body = (await res.json()) as { appointment: { id: string; startsAt: string } };
      toast.success(t("appointments.newApptDialog.toastCreated"));
      params?.onCreated?.({ id: body.appointment.id, startsAt: body.appointment.startsAt });

      if (params?.redirectAfter) {
        router.push(params.redirectAfter);
      } else if (params?.openAgendaAfter) {
        router.push(`/dashboard/agenda?date=${dateISO}&highlight=${body.appointment.id}`);
      } else {
        router.refresh();
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(t("appointments.newApptDialog.toastNetworkError"));
      setSubmitting(false);
    }
  };

  const config = boot
    ? {
        timezone: boot.timezone,
        slotMinutes: boot.slotMinutes,
        dayStart: boot.dayStart,
        dayEnd: boot.dayEnd,
      }
    : null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content
          style={dialogStyle}
          onEscapeKeyDown={onClose}
          aria-describedby={undefined}
        >
          <header style={headerStyle}>
            <Dialog.Title style={titleStyle}>{t("appointments.newApptDialog.title")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label={t("common.close")} style={closeBtnStyle}>
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <div style={bodyStyle}>
            {bootLoading || !boot ? (
              <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
                <Loader2 size={22} className="animate-spin" style={{ display: "inline-block" }} />
              </div>
            ) : (
              <>
                <Field label={t("appointments.newApptDialog.fieldPatient")}>
                  <PatientSearchField
                    value={patient}
                    onChange={(p) => { setPatient(p); if (errors.patient) setErrors((er) => ({ ...er, patient: undefined })); }}
                    error={errors.patient}
                  />
                </Field>

                <div style={gridTwo}>
                  <Field label={t("appointments.newApptDialog.fieldProfessional")}>
                    <select
                      className="input-new"
                      value={doctorId}
                      onChange={(e) => { setDoctorId(e.target.value); if (errors.doctorId) setErrors((er) => ({ ...er, doctorId: undefined })); }}
                      style={{ borderColor: errors.doctorId ? "var(--danger)" : undefined }}
                    >
                      {boot.doctors.length === 0 && <option value="">{t("appointments.newApptDialog.optionNoActiveProfessionals")}</option>}
                      {boot.doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.shortName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {boot.resources.length > 0 && (
                    <Field label={t("appointments.newApptDialog.fieldRoom")}>
                      <select
                        className="input-new"
                        value={resourceId}
                        onChange={(e) => { setResourceId(e.target.value); if (errors.resourceId) setErrors((er) => ({ ...er, resourceId: undefined })); }}
                        style={{ borderColor: errors.resourceId ? "var(--danger)" : undefined }}
                      >
                        <option value="">—</option>
                        {boot.resources.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>

                {pediatricContext ? (
                  <div style={pediatricBannerStyle} role="note" aria-label={t("appointments.newApptDialog.pediatricAriaLabel")}>
                    <span style={pediatricChipStyle}>
                      <Baby size={12} aria-hidden /> {t("appointments.newApptDialog.pediatricPatient")}
                      {pediatricContext.ageFormatted ? ` · ${pediatricContext.ageFormatted}` : ""}
                    </span>
                    <span style={pediatricHintStyle}>
                      {t("appointments.newApptDialog.pediatricSuggestedDuration", {
                        min: pediatricContext.suggestedDurationMin,
                        max: pediatricContext.suggestedDurationMaxMin,
                      })}
                    </span>
                    {pediatricContext.recentFranklLow && pediatricContext.longerBlockSuggestion ? (
                      <span style={pediatricWarningStyle}>
                        <AlertTriangle size={12} aria-hidden /> {t("appointments.newApptDialog.pediatricFranklWarning", {
                          min: pediatricContext.longerBlockSuggestion.minMin,
                          max: pediatricContext.longerBlockSuggestion.maxMin,
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <Field label={t("appointments.newApptDialog.fieldReason")}>
                  <MotivoField
                    value={reason}
                    onChange={(v) => { setReason(v); if (errors.reason) setErrors((er) => ({ ...er, reason: undefined })); }}
                    presets={reasonPresets}
                    error={errors.reason}
                  />
                </Field>

                <div style={gridDateDur}>
                  <Field label={t("common.date")}>
                    <DateDropdown
                      value={dateISO}
                      onChange={(iso) => { setDateISO(iso); setSlotIso(null); }}
                      todayISO={todayInTz(boot.timezone)}
                    />
                  </Field>
                  <Field label={t("appointments.newApptDialog.fieldDuration")}>
                    <DurationPicker
                      presets={DURATION_PRESETS_MIN}
                      duration={duration}
                      customInput={customDurationInput}
                      onSelectPreset={(d) => { setDuration(d); setCustomDurationInput(""); }}
                      onCustomChange={(raw) => {
                        setCustomDurationInput(raw);
                        if (raw === "") return;
                        const n = parseInt(raw, 10);
                        if (!Number.isFinite(n)) return;
                        const clamped = Math.max(5, Math.min(480, n));
                        setDuration(clamped);
                      }}
                    />
                  </Field>
                </div>

                {config && doctorId && (
                  <Field label={t("appointments.newApptDialog.fieldAvailableTime")}>
                    <SlotGridPicker
                      dateISO={dateISO}
                      doctorId={doctorId}
                      resourceId={resourceId || null}
                      durationMin={duration}
                      config={config}
                      doctors={boot.doctors}
                      value={slotIso}
                      onChange={(iso) => { setSlotIso(iso); if (errors.slot) setErrors((er) => ({ ...er, slot: undefined })); }}
                      resourceSchedule={resourceSchedule}
                      grouped
                    />
                    {errors.slot && (
                      <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
                        {t("appointments.newApptDialog.errorSelectTime")}
                      </div>
                    )}
                  </Field>
                )}

                {boot.waConnected && (
                  <div style={togglesRowStyle}>
                    <ToggleChip
                      active={notifyPatient}
                      icon={<MessageCircle size={12} />}
                      label={t("appointments.newApptDialog.toggleSendWhatsApp")}
                      onClick={() => setNotifyPatient((v) => !v)}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <SummaryFooter
            summary={summaryNode({
              slotIso,
              duration,
              patientName: patient?.name ?? null,
              doctorName: boot?.doctors.find((d) => d.id === doctorId)?.shortName ?? null,
              timezone: boot?.timezone ?? null,
              t,
            })}
            submitting={submitting}
            disabled={submitting || !boot}
            onCancel={onClose}
            onSubmit={submit}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function summaryNode({
  slotIso,
  duration,
  patientName,
  doctorName,
  timezone,
  t,
}: {
  slotIso: string | null;
  duration: number;
  patientName: string | null;
  doctorName: string | null;
  timezone: string | null;
  t: TFunction;
}): React.ReactNode {
  if (!slotIso || !timezone) {
    return <span style={{ color: "var(--text-3)" }}>{t("appointments.newApptDialog.summaryPrompt")}</span>;
  }
  const time = formatSlotTime(slotIso, timezone);
  const firstName = patientName ? patientName.split(" ")[0] : null;
  const bold: React.CSSProperties = { color: "var(--text-1)", fontWeight: 600 };
  return (
    <>
      <b style={bold}>{time}</b>
      {` · ${t("appointments.newApptDialog.summaryMinutes", { count: duration })}`}
      {firstName ? (
        <>
          {" · "}
          <b style={bold}>{firstName}</b>
        </>
      ) : null}
      {doctorName ? (
        <>
          {` ${t("appointments.newApptDialog.summaryWith")} `}
          <b style={bold}>{doctorName}</b>
        </>
      ) : null}
    </>
  );
}

function ToggleChip({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        background: active ? "var(--brand-soft)" : "transparent",
        color: active ? "var(--trial-accent-calm)" : "var(--text-2)",
        border: "1px solid",
        borderColor: active ? "var(--border-brand)" : "var(--border-soft)",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 0.12s",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,10,30,0.55)",
  backdropFilter: "blur(4px)",
  zIndex: 70,
};

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(94vw, 880px)",
  maxHeight: "min(92vh, 980px)",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 16,
  boxShadow: "0 24px 64px -16px rgba(15,10,30,0.45)",
  display: "flex",
  flexDirection: "column",
  zIndex: 71,
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 24px",
  borderBottom: "1px solid var(--border-soft)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  color: "var(--text-1)",
  margin: 0,
};

const closeBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 8,
  color: "var(--text-3)",
  cursor: "pointer",
};

const bodyStyle: React.CSSProperties = {
  padding: "20px 24px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 18,
  overflowY: "auto",
};

const gridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
};

const gridDateDur: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "280px 1fr",
  gap: 14,
};

const togglesRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  paddingTop: 2,
};

const pediatricBannerStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  padding: "10px 12px",
  background: "var(--brand-soft)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  marginTop: 4,
};

const pediatricChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--brand)",
  background: "var(--bg-elev)",
  padding: "4px 8px",
  borderRadius: 999,
};

const pediatricHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-2)",
};

const pediatricWarningStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  fontWeight: 500,
  color: "var(--warning)",
};
