"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, Video, Footprints, MessageCircle } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { PatientCombobox } from "./patient-combobox";
import { SlotGridPicker } from "./slot-grid-picker";
import { todayInTz } from "@/lib/agenda/time-utils";
import {
  DURATION_PRESETS_MIN,
  defaultDurationFor,
} from "@/lib/new-appointment/duration-presets";
import type {
  AppointmentConflictError,
  DoctorColumnDTO,
  ResourceDTO,
} from "@/lib/agenda/types";
import type {
  OpenNewAppointmentParams,
} from "@/lib/new-appointment/types";

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
  const router = useRouter();

  const [boot, setBoot] = useState<BootData | null>(null);
  const [bootLoading, setBootLoading] = useState(false);

  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [resourceId, setResourceId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [dateISO, setDateISO] = useState("");
  const [duration, setDuration] = useState(30);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [isTeleconsult, setIsTeleconsult] = useState(false);
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [notifyPatient, setNotifyPatient] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || boot) return;
    setBootLoading(true);
    fetch(`/api/appointments?date=${todayInTz("America/Mexico_City")}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (body) => {
        if (!body) {
          toast.error("No se pudo cargar la configuración de la clínica");
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

    setPatient(params?.initialPatient ?? null);
    setReason(params?.initialReason ?? "");
    setIsTeleconsult(false);
    setIsWalkIn(false);
    setSubmitting(false);

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

  const submit = async () => {
    if (!patient) return toast.error("Selecciona un paciente");
    if (!doctorId) return toast.error("Selecciona un profesional");
    if (!slotIso) return toast.error("Selecciona un horario");
    if (!boot) return;

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
          reason: reason.trim() || null,
          isTeleconsult,
          isWalkIn,
          notifyPatient,
        }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as AppointmentConflictError;
        toast.error(
          `Conflicto: ya existe cita con ${body.conflictingAppointment.patientName} en ese horario.`,
          { duration: 5000 },
        );
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error ?? "No se pudo crear la cita");
        setSubmitting(false);
        return;
      }

      const body = (await res.json()) as { appointment: { id: string; startsAt: string } };
      toast.success("Cita creada");
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
      toast.error("Error de red. Intenta de nuevo.");
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
            <Dialog.Title style={titleStyle}>Nueva cita</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Cerrar" style={closeBtnStyle}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>

          <div style={bodyStyle}>
            {bootLoading || !boot ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-2)" }}>
                <Loader2 size={20} className="animate-spin" style={{ display: "inline-block" }} />
              </div>
            ) : (
              <>
                <Field label="Paciente*">
                  <PatientCombobox value={patient} onChange={setPatient} />
                </Field>

                <div style={gridTwo}>
                  <Field label="Profesional*">
                    <select
                      className="input-new"
                      value={doctorId}
                      onChange={(e) => setDoctorId(e.target.value)}
                    >
                      {boot.doctors.length === 0 && <option value="">Sin profesionales activos</option>}
                      {boot.doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.shortName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {boot.resources.length > 0 && (
                    <Field label="Sillón / Sala">
                      <select
                        className="input-new"
                        value={resourceId}
                        onChange={(e) => setResourceId(e.target.value)}
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

                <Field label="Motivo">
                  <input
                    type="text"
                    className="input-new"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Consulta general, control, urgencia..."
                  />
                </Field>

                <div style={gridTwo}>
                  <Field label="Fecha">
                    <input
                      type="date"
                      className="input-new"
                      value={dateISO}
                      onChange={(e) => {
                        setDateISO(e.target.value);
                        setSlotIso(null);
                      }}
                    />
                  </Field>
                  <Field label="Duración">
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {DURATION_PRESETS_MIN.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDuration(d)}
                          style={{
                            ...durationChipStyle,
                            background: duration === d ? "var(--brand-soft)" : "transparent",
                            borderColor: duration === d ? "var(--border-brand)" : "var(--border-soft)",
                            color: duration === d ? "var(--trial-accent-calm)" : "var(--text-2)",
                          }}
                        >
                          {d}m
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                {config && doctorId && (
                  <Field label="Horario disponible">
                    <SlotGridPicker
                      dateISO={dateISO}
                      doctorId={doctorId}
                      resourceId={resourceId || null}
                      durationMin={duration}
                      config={config}
                      doctors={boot.doctors}
                      value={slotIso}
                      onChange={setSlotIso}
                    />
                  </Field>
                )}

                <div style={togglesRowStyle}>
                  <ToggleChip
                    active={isTeleconsult}
                    icon={<Video size={12} />}
                    label="Videollamada"
                    onClick={() => setIsTeleconsult((v) => !v)}
                  />
                  <ToggleChip
                    active={isWalkIn}
                    icon={<Footprints size={12} />}
                    label="Walk-in"
                    onClick={() => setIsWalkIn((v) => !v)}
                  />
                  {boot.waConnected && (
                    <ToggleChip
                      active={notifyPatient}
                      icon={<MessageCircle size={12} />}
                      label="Enviar WhatsApp"
                      onClick={() => setNotifyPatient((v) => !v)}
                    />
                  )}
                </div>
              </>
            )}
          </div>

          <footer style={footerStyle}>
            <ButtonNew variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </ButtonNew>
            <ButtonNew
              variant="primary"
              onClick={submit}
              disabled={submitting || !boot || !patient || !doctorId || !slotIso}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creando...
                </>
              ) : (
                "Crear cita"
              )}
            </ButtonNew>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
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
  width: "min(92vw, 720px)",
  maxHeight: "92vh",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 14,
  boxShadow: "0 24px 60px -12px rgba(15,10,30,0.4)",
  display: "flex",
  flexDirection: "column",
  zIndex: 71,
  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  borderBottom: "1px solid var(--border-soft)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--text-1)",
  margin: 0,
};

const closeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 6,
  color: "var(--text-2)",
  cursor: "pointer",
};

const bodyStyle: React.CSSProperties = {
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  overflowY: "auto",
};

const gridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const togglesRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  paddingTop: 4,
};

const durationChipStyle: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  border: "1px solid",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  cursor: "pointer",
  transition: "all 0.12s",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  padding: "14px 20px",
  borderTop: "1px solid var(--border-soft)",
};
