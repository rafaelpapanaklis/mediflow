"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, MessageCircle, AlertTriangle, Baby, CalendarPlus } from "lucide-react";
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
import { bookingRuleMessage } from "@/lib/agenda/booking-rules";
import { useT } from "@/i18n/i18n-provider";
import { bloqueoQueTapa } from "@/lib/agenda-bloqueos/core";
import {
  ConfirmarBloqueo,
  type BloqueoParaConfirmar,
} from "@/components/dashboard/bloqueos/confirmar-bloqueo";
import { parseBloqueos, type BloqueoDTO } from "@/components/dashboard/bloqueos/tipos";
import { REMINDER_REASON_KEY } from "@/lib/whatsapp/reason-i18n";
import type { TFunction } from "@/i18n/t";
import { getResourceSchedule } from "@/lib/agenda/mutations";
import type { WeekScheduleDTO } from "@/lib/agenda/types";
import type {
  OpenNewAppointmentParams,
} from "@/lib/new-appointment/types";
import { instrumentSans } from "@/fonts/menu";
import {
  AparienciaNuevaCitaProvider,
  useAparienciaNueva,
  useVestir,
  type AparienciaNuevaCita,
} from "./apariencia";
import nc from "./nueva-cita.module.css";

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
  /**
   * Solo la ropa (ver `apariencia.tsx`). Todo lo de abajo —estado, efectos,
   * validación, POST— es idéntico con las dos.
   */
  apariencia?: AparienciaNuevaCita;
}

interface BootData {
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  timezone: string;
  slotMinutes: number;
  dayStart: number;
  dayEnd: number;
  waConnected: boolean;
  /** La clínica tiene encendida la confirmación al agendar (Dashboard → WhatsApp). */
  waConfirmOnCreate: boolean;
}

export function NewAppointmentDialog({ isOpen, onClose, params, apariencia = "clasica" }: Props) {
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
  /**
   * WS1-T3 — los bloqueos del día que se está mirando. Llegan del MISMO lote
   * que la rejilla de huecos ya pide (`SlotGridPicker` → `onBloqueos`), así
   * que esta ventana no añade ni una consulta.
   */
  const [bloqueosDelDia, setBloqueosDelDia] = useState<BloqueoDTO[]>([]);
  /**
   * El bloqueo sobre el que se está preguntando, o `null`. Mientras no es
   * `null` la ventana de confirmación está abierta y NADA se ha guardado.
   */
  const [bloqueoPendiente, setBloqueoPendiente] = useState<BloqueoParaConfirmar | null>(null);
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
      // Nada del día anterior sobrevive a cerrar la ventana: ni los bloqueos
      // ni una confirmación a medias.
      setBloqueosDelDia([]);
      setBloqueoPendiente(null);
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
        let waConfirmOnCreate = false;
        try {
          const sRes = await fetch("/api/clinic/me", { credentials: "include" });
          if (sRes.ok) {
            const sBody = await sRes.json();
            waConnected = !!sBody?.clinic?.waConnected;
            waConfirmOnCreate = !!sBody?.clinic?.waConfirmOnCreate;
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
          waConfirmOnCreate,
        });
        // Encendido solo si de verdad va a salir: conectada Y con la
        // confirmación encendida por la clínica. Si no, viaja `false`.
        setNotifyPatient(waConnected && waConfirmOnCreate);
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
    setBloqueoPendiente(null);

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

  /**
   * ¿El hueco elegido cae dentro de un bloqueo? Devuelve el bloqueo o `null`.
   *
   * 🔴 LA MISMA FUNCIÓN QUE USA EL SERVIDOR (`bloqueoQueTapa` → 
   * `bloqueaEsteHueco`). Comparar fechas aquí a mano es lo que haría que la
   * ventana preguntara por un hueco que el servidor no considera bloqueado, o
   * al revés.
   */
  const bloqueoDelHueco = (): BloqueoParaConfirmar | null => {
    if (!slotIso || bloqueosDelDia.length === 0) return null;
    const inicio = new Date(slotIso);
    const fin = new Date(inicio.getTime() + duration * 60_000);
    const b = bloqueoQueTapa(
      bloqueosDelDia,
      inicio.toISOString(),
      fin.toISOString(),
      doctorId || null,
    );
    return b ? { doctorId: b.doctorId, doctorNombre: b.doctorNombre, reason: b.reason } : null;
  };

  const submit = async (bloqueoConfirmado: BloqueoParaConfirmar | null = null) => {
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

    // ── LA PREGUNTA, ANTES DE GUARDAR (WS1-T3) ──
    //
    // Solo si de verdad hay un bloqueo encima del hueco elegido. En el 99 % de
    // las citas esto devuelve `null` y no cuesta ni un clic ni un render: se
    // sigue derecho al POST de siempre.
    if (!bloqueoConfirmado) {
      const bloqueo = bloqueoDelHueco();
      if (bloqueo) {
        setBloqueoPendiente(bloqueo);
        return;
      }
    }

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
          // Solo «ya lo confirmé»: el motivo lo escribe el servidor con el
          // bloqueo que él mismo lee de la base. Y NO va por `overrideReason`,
          // cuyo valor apaga el no-solape. Ver `agenda-bloqueos/core.ts` §7.
          ...(bloqueoConfirmado ? { bloqueoConfirmado: true } : {}),
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
        // El cuerpo ya se leyó: releerlo abajo daría {} y el toast genérico.
        // Reglas del servidor con 422 (pasado, paciente archivado): su frase.
        toast.error(
          bookingRuleMessage(body) ?? t("appointments.newApptDialog.toastCreateFailed"),
        );
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        // Reglas del servidor (pasado, paciente archivado, motivo): su frase, no el código crudo.
        toast.error(
          bookingRuleMessage(errBody) ??
            errBody.error ??
            t("appointments.newApptDialog.toastCreateFailed"),
        );
        setSubmitting(false);
        return;
      }

      const body = (await res.json()) as {
        appointment: { id: string; startsAt: string };
        // P1-13: la API ya no bloquea fuera-de-horario/día cerrado; avisa.
        scheduleWarning?: { message: string } | null;
        // null = no se pidió avisar. Si se pidió, el servidor dice qué pasó.
        whatsapp?: { enviado: true } | { enviado: false; motivo: string } | null;
      };
      // El interruptor prometía un WhatsApp: se dice si salió o por qué no. La
      // cita está creada en los dos casos.
      if (body.whatsapp?.enviado === true) {
        toast.success(t("appointments.newApptDialog.toastCreatedWhatsAppSent"));
      } else {
        toast.success(t("appointments.newApptDialog.toastCreated"));
        // «La cita ya pasó» no es un fallo que avisar (se agendó hacia atrás a
        // propósito): solo se calla.
        if (body.whatsapp && body.whatsapp.enviado === false && body.whatsapp.motivo !== "citaPasada") {
          toast.error(
            t("appointments.newApptDialog.toastWhatsAppNotSent", {
              reason: t(whatsAppNotSentReasonKey(body.whatsapp.motivo)),
            }),
            { duration: 8000 },
          );
        }
      }
      if (body.scheduleWarning?.message) {
        toast(body.scheduleWarning.message, { duration: 6000 });
      }
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

  const nueva = apariencia === "nueva";

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={nueva ? undefined : overlayStyle}
          className={nueva ? `${nc.tokens} ${nc.velo}` : undefined}
        />
        <Dialog.Content
          style={nueva ? undefined : dialogStyle}
          className={nueva ? `${nc.tokens} ${instrumentSans.variable} ${nc.dialogo}` : undefined}
          onEscapeKeyDown={onClose}
          aria-describedby={undefined}
        >
          <AparienciaNuevaCitaProvider value={apariencia}>
          <header {...(nueva ? { className: nc.cabecera } : { style: headerStyle })}>
            {nueva && <CalendarPlus size={22} strokeWidth={2} className={nc.cabeceraIcono} aria-hidden />}
            <Dialog.Title {...(nueva ? { className: nc.titulo } : { style: titleStyle })}>{t("appointments.newApptDialog.title")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label={t("common.close")} {...(nueva ? { className: nc.cerrar } : { style: closeBtnStyle })}>
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <div {...(nueva ? { className: nc.cuerpo } : { style: bodyStyle })}>
            {bootLoading || !boot ? (
              <div {...(nueva ? { className: nc.cargando } : { style: { padding: 48, textAlign: "center", color: "var(--text-3)" } })}>
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

                <div {...(nueva ? { className: nc.dosColumnas } : { style: gridTwo })}>
                  <Field label={t("appointments.newApptDialog.fieldProfessional")}>
                    <select
                      className={nueva ? `${nc.control} ${errors.doctorId ? nc.controlError : ""}` : "input-new"}
                      value={doctorId}
                      onChange={(e) => { setDoctorId(e.target.value); if (errors.doctorId) setErrors((er) => ({ ...er, doctorId: undefined })); }}
                      style={nueva ? undefined : { borderColor: errors.doctorId ? "var(--danger)" : undefined }}
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
                        className={nueva ? `${nc.control} ${errors.resourceId ? nc.controlError : ""}` : "input-new"}
                        value={resourceId}
                        onChange={(e) => { setResourceId(e.target.value); if (errors.resourceId) setErrors((er) => ({ ...er, resourceId: undefined })); }}
                        style={nueva ? undefined : { borderColor: errors.resourceId ? "var(--danger)" : undefined }}
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
                  <div {...(nueva ? { className: nc.pediatria } : { style: pediatricBannerStyle })} role="note" aria-label={t("appointments.newApptDialog.pediatricAriaLabel")}>
                    <span {...(nueva ? { className: nc.pediatriaChip } : { style: pediatricChipStyle })}>
                      <Baby size={12} aria-hidden /> {t("appointments.newApptDialog.pediatricPatient")}
                      {pediatricContext.ageFormatted ? ` · ${pediatricContext.ageFormatted}` : ""}
                    </span>
                    <span {...(nueva ? { className: nc.pediatriaTexto } : { style: pediatricHintStyle })}>
                      {t("appointments.newApptDialog.pediatricSuggestedDuration", {
                        min: pediatricContext.suggestedDurationMin,
                        max: pediatricContext.suggestedDurationMaxMin,
                      })}
                    </span>
                    {pediatricContext.recentFranklLow && pediatricContext.longerBlockSuggestion ? (
                      <span {...(nueva ? { className: nc.pediatriaAviso } : { style: pediatricWarningStyle })}>
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

                <div {...(nueva ? { className: nc.fechaDuracion } : { style: gridDateDur })}>
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
                      onBloqueos={(crudo) =>
                        setBloqueosDelDia(parseBloqueos({ bloqueos: crudo }))
                      }
                    />
                    {errors.slot && (
                      <div {...(nueva ? { className: nc.error } : { style: { fontSize: 11, color: "var(--danger)", marginTop: 4 } })}>
                        {t("appointments.newApptDialog.errorSelectTime")}
                      </div>
                    )}
                  </Field>
                )}

                {boot.waConnected && !boot.waConfirmOnCreate && (
                  <div {...(nueva ? { className: nc.pediatriaTexto } : { style: { fontSize: 11, color: "var(--text-3)" } })}>
                    {t("appointments.newApptDialog.whatsAppConfirmOff")}
                  </div>
                )}

                {boot.waConnected && boot.waConfirmOnCreate && (
                  <div {...(nueva ? { className: nc.opciones } : { style: togglesRowStyle })}>
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
              nueva,
            })}
            submitting={submitting}
            disabled={submitting || !boot}
            onCancel={onClose}
            // Envuelto y no `onSubmit={submit}`: el pie lo enchufa a un
            // `onClick`, que le pasaría el evento del ratón como primer
            // argumento — y ese argumento es justo el «ya confirmó el
            // bloqueo» de `submit`. La ventana de aviso no saldría nunca.
            onSubmit={() => {
              void submit();
            }}
          />
          </AparienciaNuevaCitaProvider>
        </Dialog.Content>
      </Dialog.Portal>

      {/* ── «Ese día está bloqueado» (WS1-T3) ──
          Solo se monta si `submit` encontró un bloqueo encima del hueco. Al
          confirmar se limpia ANTES de reenviar: así los errores del servidor
          (solape, sillón cerrado) salen sobre la ventana de siempre, como
          hasta ahora, y no sobre una confirmación que ya cumplió su papel. */}
      {bloqueoPendiente && (
        <ConfirmarBloqueo
          bloqueo={bloqueoPendiente}
          dayISO={dateISO}
          guardando={submitting}
          onConfirmar={() => {
            const confirmado = bloqueoPendiente;
            setBloqueoPendiente(null);
            void submit(confirmado);
          }}
          onCancelar={() => setBloqueoPendiente(null)}
        />
      )}
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const vestir = useVestir();
  return (
    <div {...vestir({ display: "flex", flexDirection: "column", gap: 6 }, nc.campo)}>
      <span
        {...vestir(
          {
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-3)",
          },
          nc.rotulo,
        )}
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
  nueva = false,
}: {
  slotIso: string | null;
  duration: number;
  patientName: string | null;
  doctorName: string | null;
  timezone: string | null;
  t: TFunction;
  nueva?: boolean;
}): React.ReactNode {
  if (!slotIso || !timezone) {
    return nueva ? (
      <span>{t("appointments.newApptDialog.summaryPrompt")}</span>
    ) : (
      <span style={{ color: "var(--text-3)" }}>{t("appointments.newApptDialog.summaryPrompt")}</span>
    );
  }
  const time = formatSlotTime(slotIso, timezone);
  const firstName = patientName ? patientName.split(" ")[0] : null;
  const bold: React.CSSProperties = { color: "var(--text-1)", fontWeight: 600 };
  const fuerte = nueva ? { className: nc.resumenFuerte } : { style: bold };
  return (
    <>
      <b {...fuerte}>{time}</b>
      {` · ${t("appointments.newApptDialog.summaryMinutes", { count: duration })}`}
      {firstName ? (
        <>
          {" · "}
          <b {...fuerte}>{firstName}</b>
        </>
      ) : null}
      {doctorName ? (
        <>
          {` ${t("appointments.newApptDialog.summaryWith")} `}
          <b {...fuerte}>{doctorName}</b>
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
  const nueva = useAparienciaNueva();
  if (nueva) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${nc.chip} ${active ? nc.chipActivo : ""}`}
        aria-pressed={active}
      >
        {icon}
        {label}
      </button>
    );
  }
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

/**
 * Por qué no salió el WhatsApp → clave de traducción. Los motivos del envío
 * reutilizan las frases del panel de recordatorios (REMINDER_REASON_KEY); los
 * tres propios del aviso al agendar tienen la suya.
 */
function whatsAppNotSentReasonKey(motivo: string): string {
  if (motivo === "apagadoPorClinica") return "appointments.newApptDialog.waReasonOffByClinic";
  if (motivo === "citaPasada") return "appointments.newApptDialog.waReasonPastAppointment";
  return (
    (REMINDER_REASON_KEY as Record<string, string>)[motivo] ??
    "appointments.newApptDialog.waReasonUnknown"
  );
}

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
