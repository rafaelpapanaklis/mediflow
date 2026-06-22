"use client";

import { type CSSProperties, type FocusEvent, useEffect, useRef, useState } from "react";
import { Calendar, Check, Loader2 } from "lucide-react";
import {
  DEFAULT_SERVICE,
  PUBLIC_AVAILABILITY_API,
  PUBLIC_BOOK_API,
  type AvailabilityWithDateResponse,
  type BookRequestBody,
  type BookResponse,
  type DirectoryClinic,
  type DirectoryDoctor,
  type PatientMe,
} from "@/lib/directory/types";
import {
  MONTHS_ES,
  DAYS_SHORT_ES,
  toYMD,
  isDayEnabled,
  formatDateEs,
  fetchPatientMe,
  buildRegistroUrl,
  buildLoginUrl,
  persistSelection,
  cleanPhoneDigits,
  splitName,
} from "@/lib/directory/booking-state";

// ─────────────────────────────────────────────────────────────────────────────
// Pasos 3 (fecha/hora) y 4 (confirmar) del popup de reserva del directorio.
// Lo monta <BookingPopup> (otro agente — NO tocar ese archivo; respeta props).
//
// Reutiliza los endpoints públicos existentes:
//   · GET  /api/public/availability?slug=&date=YYYY-MM-DD&doctorId=
//     → slots de 30 min "HH:MM" (data.slots ?? []; vacío → data.reason).
//   · POST /api/public/book (BookRequestBody) → 409 horario ocupado,
//     429 rate limit, resto { error }.
//
// El paso "confirm" exige sesión de paciente (contrato de otra terminal,
// solo consumo vía fetchPatientMe): sin sesión se persiste la selección
// (persistSelection) y se redirige al registro con ?next= de regreso.
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingScheduleProps {
  clinic: DirectoryClinic;
  mode: "schedule" | "confirm";
  service: string;
  doctor: DirectoryDoctor;
  date: string | null;
  slot: string | null;
  /** Color de acento (clinic.themeColor ?? violeta DaleControl) */
  theme: string;
  /** schedule: día+hora elegidos → el popup avanza a confirm */
  onPick: (date: string, slot: string) => void;
  onBack: () => void;
  /** confirm: POST exitoso → el popup muestra éxito */
  onBooked: () => void;
}

export function BookingSchedule(props: BookingScheduleProps) {
  const { clinic, mode, service, doctor, date, slot, theme, onPick, onBack, onBooked } = props;

  // Paleta base del directorio (con fallback por si el popup vive fuera de .mfh)
  const INK = "var(--ink, #0f172a)";
  const MUTED = "var(--muted, #64748b)";
  const LINE = "var(--line, #e9e7f3)";
  const B2 = "var(--b2, #6d28d9)";
  const TINT2 = "var(--tint2, #faf8ff)";
  const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 600, color: MUTED };
  const inputCls = "w-full rounded-xl border-2 px-3.5 py-2.5 outline-none transition-colors";
  const inputStyle: CSSProperties = { borderColor: "#f1f5f9", fontSize: 14, color: INK, background: "#fff" };

  // ── Paso 3: calendario + slots ─────────────────────────────────────────────
  const [calDate, setCalDate] = useState<Date>(() => (date ? new Date(`${date}T00:00:00`) : new Date()));
  const [selDate, setSelDate] = useState<string>(date ?? "");
  const [selSlot, setSelSlot] = useState<string>(slot ?? "");
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsReason, setSlotsReason] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  // ── Paso 4: gate de sesión + formulario ────────────────────────────────────
  const [authState, setAuthState] = useState<"checking" | "anon" | PatientMe>("checking");
  const prefilledRef = useRef(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", notes: "" });
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [slotTaken, setSlotTaken] = useState(false);

  // Slots de la fecha elegida — un solo fetch en vuelo (AbortController).
  useEffect(() => {
    if (mode !== "schedule" || !selDate) return;
    const ctrl = new AbortController();
    setLoadingSlots(true);
    setSlots([]);
    setSlotsReason("");
    fetch(
      `${PUBLIC_AVAILABILITY_API}?slug=${encodeURIComponent(clinic.slug)}&date=${selDate}&doctorId=${encodeURIComponent(doctor.id)}`,
      { signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((data: AvailabilityWithDateResponse) => {
        const list = data.slots ?? [];
        setSlots(list);
        setSlotsReason(list.length === 0 ? data.reason ?? "Sin horarios — elige otra fecha" : "");
        setSelSlot((prev) => (prev && list.includes(prev) ? prev : ""));
        setLoadingSlots(false);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setSlotsReason("No pudimos cargar los horarios. Intenta de nuevo.");
        setLoadingSlots(false);
      });
    return () => ctrl.abort();
  }, [mode, selDate, clinic.slug, doctor.id]);

  // Gate de auth al entrar a confirmar (contrato de otra terminal — solo consumo).
  useEffect(() => {
    if (mode !== "confirm") return;
    let alive = true;
    setAuthState("checking");
    fetchPatientMe().then((me) => {
      if (!alive) return;
      if (!me) {
        setAuthState("anon");
        return;
      }
      setAuthState(me);
      if (!prefilledRef.current) {
        prefilledRef.current = true;
        const { firstName, lastName } = splitName(me.name);
        setForm((f) => ({ ...f, firstName, lastName, phone: me.phone ?? "", email: me.email ?? "" }));
      }
    });
    return () => {
      alive = false;
    };
  }, [mode]);

  const now = new Date();
  const todayYMD = toYMD(now);
  const canGoPrev = calDate.getFullYear() * 12 + calDate.getMonth() > now.getFullYear() * 12 + now.getMonth();

  function buildCalCells(): (Date | null)[] {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const pad = firstDay === 0 ? 6 : firstDay - 1; // el grid arranca en lunes
    const last = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(new Date(y, m, d));
    return cells;
  }

  function goToRegister() {
    persistSelection({ clinicSlug: clinic.slug, service, doctorId: doctor.id, date, slot });
    window.location.href = buildRegistroUrl();
  }

  function goToLogin() {
    persistSelection({ clinicSlug: clinic.slug, service, doctorId: doctor.id, date, slot });
    window.location.href = buildLoginUrl();
  }

  const focusTheme = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = theme;
  };
  const blurReset = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#f1f5f9";
  };

  const phoneInvalid = cleanPhoneDigits(form.phone).length < 10;
  const showPhoneError = phoneInvalid && (phoneTouched || attempted);

  async function submit() {
    // Invitado (anon) o con sesión pueden agendar; solo se bloquea mientras se
    // verifica la sesión o ya hay un envío en curso.
    if (authState === "checking" || submitting) return;
    setAttempted(true);
    if (!date || !slot) {
      onBack();
      return;
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("Completa tu nombre y apellido.");
      return;
    }
    if (phoneInvalid) {
      setError("");
      return; // el error inline del teléfono ya queda visible
    }
    setError("");
    setSlotTaken(false);
    setSubmitting(true);
    const body: BookRequestBody = {
      slug: clinic.slug,
      doctorId: doctor.id,
      date,
      startTime: slot,
      type: service || DEFAULT_SERVICE,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    try {
      const res = await fetch(PUBLIC_BOOK_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onBooked(); // el popup muestra el paso de éxito
        return;
      }
      const data: BookResponse = await res.json().catch(() => ({} as BookResponse));
      if (res.status === 409) {
        setSlotTaken(true);
        setError("Ese horario se acaba de ocupar. Elige otro.");
      } else if (res.status === 429) {
        setError("Demasiados intentos. Espera un minuto e intenta de nuevo.");
      } else {
        setError(data.error ?? "No pudimos agendar tu cita. Intenta de nuevo.");
      }
      setSubmitting(false);
    } catch {
      setError("No pudimos agendar tu cita. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  // ── Paso 3 — fecha y hora ──────────────────────────────────────────────────
  if (mode === "schedule") {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
          style={{ color: MUTED }}
        >
          ← Cambiar profesional
        </button>

        {/* Mini-banner del profesional elegido */}
        <div className="mb-5 flex items-center gap-3 rounded-2xl p-3.5" style={{ background: TINT2 }}>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ background: doctor.color }}
          >
            {doctor.firstName.slice(0, 1)}
            {doctor.lastName.slice(0, 1)}
          </div>
          <span className="text-sm font-semibold" style={{ color: INK }}>
            Dr/a. {doctor.firstName} {doctor.lastName}
          </span>
        </div>

        {/* Calendario mensual — arranca en lunes */}
        <div className="mb-4 rounded-2xl border p-4" style={{ borderColor: LINE, background: TINT2 }}>
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              aria-label="Mes anterior"
              disabled={!canGoPrev}
              onClick={() => setCalDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold transition-colors hover:bg-white disabled:opacity-30"
              style={{ color: MUTED }}
            >
              ‹
            </button>
            <span className="text-sm font-bold" style={{ color: INK }}>
              {MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}
            </span>
            <button
              type="button"
              aria-label="Mes siguiente"
              onClick={() => setCalDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold transition-colors hover:bg-white"
              style={{ color: MUTED }}
            >
              ›
            </button>
          </div>
          <div className="mb-2 grid grid-cols-7 gap-1">
            {DAYS_SHORT_ES.map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-semibold" style={{ color: MUTED }}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {buildCalCells().map((day, i) => {
              if (!day) return <div key={`pad-${i}`} />;
              const ymd = toYMD(day);
              const enabled = isDayEnabled(day, clinic.schedules);
              const isSel = ymd === selDate;
              const isToday = ymd === todayYMD;
              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setSelDate(ymd)}
                  className="h-9 rounded-xl text-sm transition-all sm:h-10"
                  style={{
                    background: isSel ? theme : "transparent",
                    color: isSel ? "#fff" : enabled ? INK : "#cbd5e1",
                    fontWeight: isSel || isToday ? 700 : 500,
                    border: isToday && !isSel ? `2px solid ${theme}` : "2px solid transparent",
                    cursor: enabled ? "pointer" : "default",
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Horarios del día elegido */}
        {selDate && (
          <div className="mb-4">
            <div className="mb-3 text-xs font-semibold capitalize" style={{ color: MUTED }}>
              {formatDateEs(selDate)}
            </div>
            {loadingSlots ? (
              <div className="flex items-center gap-2 py-3" style={{ fontSize: 13, color: MUTED }}>
                <Loader2 size={14} className="animate-spin" /> Buscando horarios…
              </div>
            ) : slots.length === 0 ? (
              <p className="py-2" style={{ fontSize: 13, color: MUTED }}>
                {slotsReason || "Sin horarios — elige otra fecha"}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={selSlot === s}
                    onClick={() => setSelSlot(s)}
                    className="rounded-xl border-2 py-2.5 transition-all"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      background: selSlot === s ? theme : "transparent",
                      color: selSlot === s ? "#fff" : INK,
                      borderColor: selSlot === s ? theme : LINE,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={!selDate || !selSlot}
          onClick={() => selDate && selSlot && onPick(selDate, selSlot)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white transition-all disabled:opacity-30"
          style={{ background: theme, boxShadow: `0 8px 24px ${theme}40` }}
        >
          {selSlot ? (
            <>
              <Check size={16} /> Continuar — {selSlot}
            </>
          ) : (
            "Selecciona un horario"
          )}
        </button>
      </div>
    );
  }

  // ── Paso 4 — confirmar con sesión de paciente ──────────────────────────────
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
        style={{ color: MUTED }}
      >
        ← Cambiar horario
      </button>

      {/* Resumen de la selección */}
      <div className="rounded-2xl p-4" style={{ background: `${theme}10` }}>
        <div className="flex items-center gap-2.5 text-sm font-semibold capitalize" style={{ color: INK }}>
          <Calendar size={15} style={{ color: theme }} />
          {date ? formatDateEs(date) : ""} · {slot}
        </div>
        <div className="mt-1" style={{ fontSize: 13, color: MUTED }}>
          Dr/a. {doctor.firstName} {doctor.lastName} · {service || DEFAULT_SERVICE}
        </div>
        <div style={{ fontSize: 12, color: MUTED }}>
          {clinic.name}
          {clinic.city ? ` · ${clinic.city}` : ""}
        </div>
      </div>

      {authState === "checking" && (
        <div className="flex items-center justify-center gap-2 py-8" style={{ fontSize: 13, color: MUTED }}>
          <Loader2 size={16} className="animate-spin" /> Verificando tu sesión…
        </div>
      )}

      {authState !== "checking" && (
        <>
          {typeof authState === "object" ? (
            <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: "#f0fdf4" }}>
              <Check size={14} style={{ color: "#15803d", flexShrink: 0 }} />
              <span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "#15803d" }}>
                Agendas con tu cuenta · {authState.email ?? authState.name}
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border-2 p-3.5" style={{ borderColor: LINE }}>
              <p className="mb-2.5" style={{ fontSize: 12, color: MUTED }}>
                Agenda como invitado llenando tus datos, o entra a tu cuenta DaleControl:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={goToLogin}
                  className="rounded-xl border-2 py-2 text-xs font-bold transition-colors"
                  style={{ borderColor: `${theme}55`, color: B2, background: "#fff" }}
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  onClick={goToRegister}
                  className="rounded-xl py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
                  style={{ background: theme }}
                >
                  Crear cuenta
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block" style={labelStyle}>
                Nombre *
              </label>
              <input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="Nombre"
                className={inputCls}
                style={inputStyle}
                onFocus={focusTheme}
                onBlur={blurReset}
              />
            </div>
            <div>
              <label className="mb-1.5 block" style={labelStyle}>
                Apellido *
              </label>
              <input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Apellido"
                className={inputCls}
                style={inputStyle}
                onFocus={focusTheme}
                onBlur={blurReset}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block" style={labelStyle}>
              WhatsApp / Teléfono *
            </label>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+52 999 123 4567"
              type="tel"
              inputMode="tel"
              className={inputCls}
              style={inputStyle}
              onFocus={focusTheme}
              onBlur={(e) => {
                blurReset(e);
                setPhoneTouched(true);
              }}
            />
            {showPhoneError && (
              <p className="mt-1" style={{ fontSize: 12, color: "#dc2626" }}>
                Mínimo 10 dígitos
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block" style={labelStyle}>
              Email (opcional)
            </label>
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="correo@ejemplo.com"
              type="email"
              inputMode="email"
              className={inputCls}
              style={inputStyle}
              onFocus={focusTheme}
              onBlur={blurReset}
            />
          </div>

          <div>
            <label className="mb-1.5 block" style={labelStyle}>
              Notas (opcional)
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Cuéntanos brevemente tu motivo…"
              rows={2}
              className={`${inputCls} resize-none`}
              style={inputStyle}
              onFocus={focusTheme}
              onBlur={blurReset}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-red-600" style={{ fontSize: 13 }}>
              {error}
            </div>
          )}

          {slotTaken && (
            <button
              type="button"
              onClick={onBack}
              className="w-full rounded-xl border-2 bg-white py-3 text-sm font-semibold transition-colors"
              style={{ borderColor: LINE, color: INK }}
            >
              Elegir otro horario
            </button>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl py-4 text-base font-bold text-white transition-all disabled:opacity-60"
            style={{ background: theme, boxShadow: `0 8px 24px ${theme}40` }}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Confirmando…
              </>
            ) : (
              <>
                <Check size={18} /> Confirmar cita
              </>
            )}
          </button>
          <p className="text-center" style={{ fontSize: 11, color: MUTED }}>
            Recibirás confirmación por WhatsApp 📱
          </p>
        </>
      )}
    </div>
  );
}

// Tipos auxiliares disponibles para la implementación (no borrar):
export type { AvailabilityWithDateResponse, BookRequestBody, BookResponse };
