"use client";

// Agendar una cita NUEVA desde el portal del paciente (WS2-T1).
// Flujo paso a paso: clínica (si hay 2+) → doctor → fecha → horario →
// motivo/notas opcionales → confirmar. Multi-tenant: el servidor deriva el
// patientId del link de la sesión; aquí solo elegimos clínica/doctor de las
// opciones que el propio endpoint autorizó.
//
// Endpoints:
//   GET  /api/paciente/booking/options
//   GET  /api/paciente/booking/slots?clinicId=&doctorId=&date=YYYY-MM-DD
//   POST /api/paciente/appointments  { clinicId, doctorId, date, startTime, type?, reason? }
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type {
  PacienteBookingClinica,
  PacienteBookingOptionsResponse,
} from "@/lib/patient-portal/types";
import { PacienteCard } from "@/components/paciente/ui";

// ── Paleta / estilos compartidos (mismos del portal) ────────────────────────
const TEXT = "#f5f5f7";
const MUTED = "rgba(245,245,247,0.65)";
const FAINT = "rgba(245,245,247,0.5)";
const BORDER = "1px solid rgba(255,255,255,0.1)";
const ERROR_COLOR = "#f87171";

const PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "clamp(14px, 2.2vw, 22px)",
  width: "100%",
  minWidth: 0,
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: "rgba(245,245,247,0.8)",
  marginBottom: 6,
};

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.04)",
  border: BORDER,
  borderRadius: 10,
  color: TEXT,
  fontSize: 13.5,
  fontFamily: "inherit",
  padding: "10px 12px",
  outline: "none",
  colorScheme: "dark",
};

const PRIMARY_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid #8b5cf6",
  background: "#7c3aed",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
};

const HINT_STYLE: React.CSSProperties = {
  margin: 0,
  padding: "6px 0",
  fontSize: 13,
  color: FAINT,
  lineHeight: 1.45,
};

function Spinner({ size = 14, light = false }: { size?: number; light?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="animate-spin"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-block",
        borderRadius: "50%",
        border: `2px solid ${light ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.25)"}`,
        borderTopColor: light ? "#fff" : "#a78bfa",
      }}
    />
  );
}

/** Hoy en local como YYYY-MM-DD (para el min del input date). El servidor
 *  revalida contra el timezone real de la clínica. */
function hoyLocal(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

interface SlotsError {
  message: string;
  retryable: boolean;
}

export default function PacienteNuevaCitaPage() {
  const router = useRouter();
  const { data, error, isLoading } =
    usePacienteData<PacienteBookingOptionsResponse>("/api/paciente/booking/options");

  const clinics: PacienteBookingClinica[] = data?.clinics ?? [];

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<SlotsError | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [tipo, setTipo] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Descarta respuestas de fetches viejos (carreras al cambiar fecha rápido). */
  const reqIdRef = useRef(0);
  const hoy = hoyLocal();

  const selectedClinic = clinics.find((c) => c.clinicId === clinicId) ?? null;
  const doctors = selectedClinic?.doctors ?? [];

  // Auto-selección de clínica única.
  useEffect(() => {
    if (clinicId === null && clinics.length === 1) {
      setClinicId(clinics[0].clinicId);
    }
  }, [clinics, clinicId]);

  // Auto-selección de doctor único de la clínica elegida.
  useEffect(() => {
    if (clinicId && doctorId === null && doctors.length === 1) {
      setDoctorId(doctors[0].id);
    }
  }, [clinicId, doctors, doctorId]);

  const resetSlots = useCallback(() => {
    reqIdRef.current += 1;
    setSlots(null);
    setSlotsLoading(false);
    setSlotsError(null);
    setSelectedSlot(null);
  }, []);

  const fetchSlots = useCallback(
    async (cId: string, dId: string, d: string) => {
      const reqId = ++reqIdRef.current;
      setSlotsLoading(true);
      setSlotsError(null);
      setSlots(null);
      setSelectedSlot(null);
      try {
        const qs = new URLSearchParams({ clinicId: cId, doctorId: dId, date: d });
        const res = await fetch(`/api/paciente/booking/slots?${qs.toString()}`, {
          credentials: "same-origin",
        });
        let body: any = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (reqId !== reqIdRef.current) return;
        if (res.ok) {
          setSlots(Array.isArray(body?.slots) ? body.slots : []);
        } else if (res.status === 400) {
          setSlotsError({ message: "La fecha no es válida. Elige otra fecha.", retryable: false });
        } else if (res.status === 401) {
          router.push(`/paciente/login?next=${encodeURIComponent("/paciente/citas/nueva")}`);
        } else if (res.status === 404) {
          setSlotsError({
            message: "No encontramos esa clínica o doctor. Recarga la página.",
            retryable: false,
          });
        } else if (res.status === 429) {
          setSlotsError({
            message: "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
            retryable: true,
          });
        } else {
          setSlotsError({
            message: "No pudimos cargar los horarios. Inténtalo de nuevo.",
            retryable: true,
          });
        }
      } catch {
        if (reqId !== reqIdRef.current) return;
        setSlotsError({
          message: "No pudimos cargar los horarios. Revisa tu conexión e inténtalo de nuevo.",
          retryable: true,
        });
      } finally {
        if (reqId === reqIdRef.current) setSlotsLoading(false);
      }
    },
    [router]
  );

  function handleClinicChange(v: string) {
    setClinicId(v || null);
    setDoctorId(null);
    setDate("");
    setSubmitError(null);
    resetSlots();
  }

  function handleDoctorChange(v: string) {
    setDoctorId(v || null);
    setDate("");
    setSubmitError(null);
    resetSlots();
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setDate(v);
    setSelectedSlot(null);
    setSubmitError(null);
    if (!v || !clinicId || !doctorId) {
      resetSlots();
      return;
    }
    if (v < hoy) {
      reqIdRef.current += 1;
      setSlots(null);
      setSlotsLoading(false);
      setSelectedSlot(null);
      setSlotsError({ message: "Elige una fecha a partir de hoy.", retryable: false });
      return;
    }
    fetchSlots(clinicId, doctorId, v);
  }

  async function handleSubmit() {
    if (!clinicId || !doctorId || !date || !selectedSlot || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/paciente/appointments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId,
          doctorId,
          date,
          startTime: selectedSlot,
          ...(tipo.trim() ? { type: tipo.trim() } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.ok && body?.ok) {
        // Éxito → al listado de citas con aviso one-shot.
        router.push("/paciente/citas?solicitada=1");
        return; // deja submitting=true mientras navega (evita doble envío)
      } else if (res.status === 409) {
        setSubmitError("Ese horario se acaba de ocupar. Elige otro.");
        fetchSlots(clinicId, doctorId, date); // refresca disponibilidad
        setSubmitting(false);
      } else if (res.status === 401) {
        router.push(`/paciente/login?next=${encodeURIComponent("/paciente/citas/nueva")}`);
      } else if (res.status === 404) {
        setSubmitError("No encontramos esa clínica o doctor. Recarga la página.");
        setSubmitting(false);
      } else if (res.status === 400) {
        setSubmitError(
          typeof body?.error === "string" ? body.error : "Revisa los datos e inténtalo de nuevo."
        );
        setSubmitting(false);
      } else if (res.status === 429) {
        setSubmitError("Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.");
        setSubmitting(false);
      } else {
        setSubmitError("No pudimos agendar tu cita. Inténtalo de nuevo.");
        setSubmitting(false);
      }
    } catch {
      setSubmitError("No pudimos agendar tu cita. Revisa tu conexión e inténtalo de nuevo.");
      setSubmitting(false);
    }
  }

  // ── Estados de carga / error de las opciones ───────────────────────────────
  if (isLoading && !data) {
    return (
      <div style={PAGE_STYLE}>
        <Header />
        <PacienteCard>
          <p style={{ ...HINT_STYLE, display: "flex", alignItems: "center", gap: 8, color: MUTED }}>
            <Spinner size={14} /> Cargando opciones…
          </p>
        </PacienteCard>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={PAGE_STYLE}>
        <Header />
        <PacienteCard>
          <p style={{ margin: 0, fontSize: 14, color: MUTED }}>
            No pudimos cargar las opciones para agendar. Recarga la página e inténtalo de nuevo.
          </p>
        </PacienteCard>
      </div>
    );
  }

  if (clinics.length === 0) {
    return (
      <div style={PAGE_STYLE}>
        <Header />
        <PacienteCard>
          <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.5 }}>
            Aún no tienes una clínica vinculada a tu cuenta. Cuando una clínica te registre como
            paciente podrás agendar desde aquí.
          </p>
        </PacienteCard>
      </div>
    );
  }

  const multiClinic = clinics.length > 1;
  const noDoctors = !!clinicId && doctors.length === 0;
  const canSubmit = !!clinicId && !!doctorId && !!date && !!selectedSlot && !submitting;

  return (
    <div style={PAGE_STYLE}>
      <Header />

      <PacienteCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* Paso 1: clínica (solo si hay 2+) */}
          {multiClinic && (
            <div>
              <label htmlFor="nueva-clinica" style={LABEL_STYLE}>
                Clínica
              </label>
              <select
                id="nueva-clinica"
                value={clinicId ?? ""}
                onChange={(e) => handleClinicChange(e.target.value)}
                disabled={submitting}
                style={FIELD_STYLE}
                className="focus-visible:[box-shadow:var(--ring)]"
              >
                <option value="">Elige una clínica…</option>
                {clinics.map((c) => (
                  <option key={c.clinicId} value={c.clinicId}>
                    {c.clinicName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Paso 2: doctor */}
          <div>
            <label htmlFor="nueva-doctor" style={LABEL_STYLE}>
              Doctor/a
            </label>
            {noDoctors ? (
              <p style={{ ...HINT_STYLE, color: ERROR_COLOR }}>
                Esta clínica no tiene doctores disponibles para agendar en línea. Contáctala
                directamente.
              </p>
            ) : (
              <select
                id="nueva-doctor"
                value={doctorId ?? ""}
                onChange={(e) => handleDoctorChange(e.target.value)}
                disabled={submitting || !clinicId}
                style={{ ...FIELD_STYLE, opacity: clinicId ? 1 : 0.6 }}
                className="focus-visible:[box-shadow:var(--ring)]"
              >
                <option value="">
                  {clinicId ? "Elige un doctor/a…" : "Primero elige una clínica"}
                </option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` — ${d.specialty}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Paso 3: fecha */}
          <div>
            <label htmlFor="nueva-fecha" style={LABEL_STYLE}>
              Fecha
            </label>
            <input
              id="nueva-fecha"
              type="date"
              min={hoy}
              value={date}
              onChange={handleDateChange}
              disabled={submitting || !doctorId}
              style={{ ...FIELD_STYLE, opacity: doctorId ? 1 : 0.6 }}
              className="focus-visible:[box-shadow:var(--ring)]"
            />
            {!doctorId && (
              <p style={HINT_STYLE}>Elige un doctor/a para ver los horarios disponibles.</p>
            )}
          </div>

          {/* Paso 4: horario */}
          {doctorId && date && (
            <div aria-live="polite" style={{ minWidth: 0 }}>
              <span style={LABEL_STYLE}>Horario</span>
              {slotsLoading ? (
                <p style={{ ...HINT_STYLE, color: MUTED, display: "flex", alignItems: "center", gap: 8 }}>
                  <Spinner size={13} /> Buscando horarios…
                </p>
              ) : slotsError ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                  <p style={{ ...HINT_STYLE, color: ERROR_COLOR, padding: 0 }}>{slotsError.message}</p>
                  {slotsError.retryable && (
                    <button
                      type="button"
                      onClick={() => fetchSlots(clinicId!, doctorId, date)}
                      className="transition-colors hover:bg-white/[0.08]"
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(139,92,246,0.5)",
                        background: "rgba(139,92,246,0.15)",
                        color: "#c4b5fd",
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      Reintentar
                    </button>
                  )}
                </div>
              ) : slots && slots.length === 0 ? (
                <p style={HINT_STYLE}>No hay horarios disponibles ese día, prueba otra fecha.</p>
              ) : slots ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                    gap: 8,
                  }}
                >
                  {slots.map((s) => {
                    const sel = s === selectedSlot;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={submitting}
                        aria-pressed={sel}
                        onClick={() => {
                          setSelectedSlot(s);
                          setSubmitError(null);
                        }}
                        className={
                          sel ? undefined : "bg-white/[0.06] transition-colors hover:bg-white/[0.12]"
                        }
                        style={{
                          padding: "9px 4px",
                          borderRadius: 10,
                          fontSize: 13,
                          fontWeight: 600,
                          fontFamily: "inherit",
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          cursor: submitting ? "not-allowed" : "pointer",
                          border: sel ? "1px solid #8b5cf6" : BORDER,
                          color: sel ? "#fff" : "rgba(245,245,247,0.85)",
                          background: sel ? "#7c3aed" : undefined,
                          boxShadow: sel ? "0 0 14px rgba(124,58,237,0.35)" : undefined,
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* Paso 5: motivo / notas (opcionales) — solo con slot elegido */}
          {selectedSlot && (
            <>
              <div>
                <label htmlFor="nueva-tipo" style={LABEL_STYLE}>
                  Motivo de tu visita (opcional)
                </label>
                <input
                  id="nueva-tipo"
                  type="text"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  maxLength={80}
                  disabled={submitting}
                  placeholder="Ej. Consulta general, revisión, limpieza…"
                  style={FIELD_STYLE}
                  className="focus-visible:[box-shadow:var(--ring)]"
                />
              </div>
              <div>
                <label htmlFor="nueva-notas" style={LABEL_STYLE}>
                  Notas para la clínica (opcional)
                </label>
                <textarea
                  id="nueva-notas"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={submitting}
                  placeholder="Cuéntanos cualquier detalle que debamos saber"
                  style={{ ...FIELD_STYLE, resize: "vertical", minHeight: 64, lineHeight: 1.45 }}
                  className="focus-visible:[box-shadow:var(--ring)]"
                />
                <div style={{ textAlign: "right", fontSize: 11, color: FAINT, marginTop: 2 }}>
                  {reason.length}/500
                </div>
              </div>
            </>
          )}

          {submitError && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: ERROR_COLOR, lineHeight: 1.45 }}>
              {submitError}
            </p>
          )}

          {/* Confirmar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="transition-opacity hover:opacity-90"
              style={{
                ...PRIMARY_BTN,
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? undefined : 0.55,
              }}
            >
              {submitting ? (
                <>
                  <Spinner size={14} light /> Agendando…
                </>
              ) : (
                "Confirmar cita"
              )}
            </button>
            <p style={{ margin: 0, fontSize: 12, color: FAINT, textAlign: "center", lineHeight: 1.45 }}>
              La clínica revisará y confirmará tu cita.
            </p>
          </div>
        </div>
      </PacienteCard>
    </div>
  );
}

function Header() {
  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px, 2.4vw, 26px)", fontWeight: 700 }}>
          Agendar cita
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: "clamp(13px, 1.5vw, 14px)", color: MUTED }}>
          Elige clínica, doctor y horario.
        </p>
      </div>
      <Link
        href="/paciente/citas"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 10,
          border: BORDER,
          color: MUTED,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        ← Mis citas
      </Link>
    </header>
  );
}
