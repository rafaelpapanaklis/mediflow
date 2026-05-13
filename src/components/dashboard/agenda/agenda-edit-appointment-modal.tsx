"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { rescheduleAppointment, type ApiError } from "@/lib/agenda/mutations";
import { describeOverlapConflict, describeResourceUnavailable } from "@/lib/agenda/conflict-copy";
import { getTzParts } from "@/lib/agenda/time-utils";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";

interface Props {
  appt: AgendaAppointmentDTO | null;
  isOpen: boolean;
  onClose: () => void;
}

interface FormState {
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  durationMin: number;
  doctorId: string;
  resourceId: string;  // "" = sin sillón
  reason: string;
  overrideReason: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoToLocalParts(iso: string, timezone: string): { date: string; time: string } {
  const p = getTzParts(new Date(iso), timezone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

function localToIso(date: string, time: string, timezone: string): string | null {
  if (!date || !time) return null;
  // Construimos como local-en-tz; convertimos a UTC. Implementación
  // simple: armamos "<date>T<time>:00" y dejamos que JS lo interprete
  // como local del runtime; luego ajustamos por la diferencia entre tz
  // del runtime y la tz objetivo. Para Vercel (UTC) + tz dental
  // (America/Mexico_City) esto tiene un offset fijo, pero usamos
  // getTzParts inverso para precisión.
  const naive = new Date(`${date}T${time}:00`);
  if (Number.isNaN(naive.getTime())) return null;
  // Calcular offset de la tz target en este instante:
  const probe = getTzParts(naive, timezone);
  const probeYear = probe.year;
  const probeMonth = probe.month;
  const probeDay = probe.day;
  const probeHour = probe.hour;
  const probeMinute = probe.minute;
  // Si probeDate matches our intended (date, time), naive ya está en
  // tz target. Si no, calcular delta y ajustar.
  const [yT, mT, dT] = date.split("-").map((n) => parseInt(n, 10));
  const [hT, miT] = time.split(":").map((n) => parseInt(n, 10));
  const intendedMs = Date.UTC(yT, mT - 1, dT, hT, miT, 0);
  const probeMs = Date.UTC(probeYear, probeMonth - 1, probeDay, probeHour, probeMinute, 0);
  const offsetMs = intendedMs - probeMs;
  return new Date(naive.getTime() + offsetMs).toISOString();
}

export function AgendaEditAppointmentModal({ appt, isOpen, onClose }: Props) {
  const { state, dispatch } = useAgenda();
  const [form, setForm] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  // Hidratar el form cuando se abre con un appointment.
  useEffect(() => {
    if (!isOpen || !appt) {
      setForm(null);
      setConflict(null);
      return;
    }
    const startLocal = isoToLocalParts(appt.startsAt, state.timezone);
    const endMs = appt.endsAt ? new Date(appt.endsAt).getTime() : new Date(appt.startsAt).getTime();
    const startMs = new Date(appt.startsAt).getTime();
    const durationMin = Math.max(15, Math.round((endMs - startMs) / 60_000));
    setForm({
      date: startLocal.date,
      startTime: startLocal.time,
      durationMin,
      doctorId: appt.doctor?.id ?? "",
      resourceId: appt.resourceId ?? "",
      reason: appt.reason ?? "",
      overrideReason: "",
    });
    setConflict(null);
  }, [isOpen, appt, state.timezone]);

  // Cerrar con Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !appt || !form) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!appt || !form || submitting) return;
    setConflict(null);

    const startsAtIso = localToIso(form.date, form.startTime, state.timezone);
    if (!startsAtIso) {
      toast.error("Fecha u hora inválida");
      return;
    }
    const endsMs = new Date(startsAtIso).getTime() + form.durationMin * 60_000;
    const endsAtIso = new Date(endsMs).toISOString();
    if (!form.doctorId) {
      toast.error("Seleccioná un doctor");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await rescheduleAppointment(appt.id, {
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        doctorId: form.doctorId,
        resourceId: form.resourceId || null,
        ...(form.overrideReason ? { overrideReason: form.overrideReason } : {}),
        ...(form.reason !== (appt.reason ?? "") ? { reason: form.reason } : {}),
      });
      dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
      toast.success("Cita actualizada");
      onClose();
    } catch (err) {
      const e = err as ApiError & { message?: string };
      // overlap → mostrar conflict warning con copy descriptivo (doctor vs sillón vs ambos).
      if (e?.error === "appointment_overlap") {
        setConflict(
          describeOverlapConflict(e.conflictingAppointment, {
            doctorId: form.doctorId,
            resourceId: form.resourceId || null,
          }),
        );
      } else if (e?.error === "resource_unavailable") {
        const resourceName =
          state.resources.find((r) => r.id === form.resourceId)?.name ?? null;
        setConflict(
          describeResourceUnavailable(
            e.reason as "outside_schedule" | "resource_closed_this_day" | undefined,
            resourceName,
          ),
        );
      } else {
        const detail = e?.reason ?? e?.error ?? e?.message ?? "No se pudo actualizar";
        const prefix = e?.status ? `[${e.status}] ` : "";
        toast.error(`${prefix}${detail}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const activeDoctors = state.doctors.filter((d) => d.activeInAgenda);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-appt-title"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(15,10,30,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 10,
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        }}
      >
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-soft)",
        }}>
          <div>
            <h2 id="edit-appt-title" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
              Editar cita
            </h2>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              {appt.patient.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: 28, height: 28, display: "grid", placeItems: "center",
              background: "transparent", border: 0, borderRadius: 6,
              cursor: "pointer", color: "var(--text-3)",
            }}
          >
            <X size={14} />
          </button>
        </header>

        <form onSubmit={submit} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Fecha">
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Hora inicio">
              <input
                type="time"
                required
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field label="Duración (min)">
              <select
                required
                value={form.durationMin}
                onChange={(e) => setForm({ ...form, durationMin: parseInt(e.target.value, 10) })}
                style={inputStyle}
              >
                {[15, 30, 45, 60, 75, 90, 105, 120, 150, 180].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Doctor">
            <select
              required
              value={form.doctorId}
              onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
              style={inputStyle}
            >
              <option value="">— Seleccionar —</option>
              {activeDoctors.map((d) => (
                <option key={d.id} value={d.id}>{d.displayName}</option>
              ))}
            </select>
          </Field>
          <Field label="Sillón / Sala">
            <select
              value={form.resourceId}
              onChange={(e) => setForm({ ...form, resourceId: e.target.value })}
              style={inputStyle}
            >
              <option value="">Sin sillón asignado</option>
              {state.resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Tratamiento / motivo">
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Ej. Limpieza, Endodoncia, Consulta general…"
              style={inputStyle}
            />
          </Field>

          {conflict && (
            <div style={{
              padding: 10,
              background: "color-mix(in srgb, var(--warning) 10%, transparent)",
              border: "1px solid var(--warning)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--text-1)",
            }}>
              <strong style={{ color: "var(--warning)" }}>Conflicto:</strong> {conflict}
              <div style={{ marginTop: 8 }}>
                <Field label="Razón para sobrescribir (solo ADMIN)">
                  <input
                    type="text"
                    value={form.overrideReason}
                    onChange={(e) => setForm({ ...form, overrideReason: e.target.value })}
                    placeholder="Ej. Doble cita autorizada por X"
                    style={inputStyle}
                  />
                </Field>
              </div>
            </div>
          )}

          <footer style={{
            display: "flex", justifyContent: "flex-end", gap: 8,
            paddingTop: 8, borderTop: "1px solid var(--border-soft)", marginTop: 4,
          }}>
            <button
              type="button"
              onClick={onClose}
              style={btnGhostStyle}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              style={btnPrimaryStyle}
              disabled={submitting}
            >
              {submitting ? "Guardando…" : conflict ? "Sobrescribir y guardar" : "Guardar cambios"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 6,
  color: "var(--text-1)",
  fontFamily: "inherit",
};
const btnGhostStyle: React.CSSProperties = {
  padding: "7px 14px",
  fontSize: 12, fontWeight: 600,
  background: "transparent",
  border: "1px solid var(--border-soft)",
  borderRadius: 6,
  color: "var(--text-2)",
  cursor: "pointer",
  fontFamily: "inherit",
};
const btnPrimaryStyle: React.CSSProperties = {
  padding: "7px 14px",
  fontSize: 12, fontWeight: 700,
  background: "var(--brand)",
  border: 0,
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
