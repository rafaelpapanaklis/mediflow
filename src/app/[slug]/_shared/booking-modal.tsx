"use client";
/* ============================================================
   Modal de reserva REAL compartido por las plantillas T2–T4.
   Extraído 1:1 del modal que ya funciona en landing-client.tsx
   (classic): GET /api/public/availability + POST /api/public/book.
   Sólo se parametriza el color (theme) y la preselección de
   doctor/servicio, y se añade Esc / focus-trap / bloqueo de scroll.
   ============================================================ */
import { useState, useEffect, useRef } from "react";
import { X, Check, Loader2, ArrowRight, Calendar } from "lucide-react";
import type { LandingClinic, LandingDoctor } from "./types";
import type { PacienteMe } from "@/lib/patient-portal/types";
import { hexAdjust } from "./landing-utils";

const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Divide el nombre completo de la cuenta en nombre + apellido(s) para prellenar. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export interface BookingModalProps {
  clinic: LandingClinic;
  theme: string;
  open: boolean;
  onClose: () => void;
  preselectedDoctorId?: string;
  preselectedService?: string;
}

export function BookingModal({ clinic, theme, open, onClose, preselectedDoctorId, preselectedService }: BookingModalProps) {
  const themeDark = hexAdjust(theme, -35);
  const [step, setStep] = useState(1);
  const [doctor, setDoctor] = useState<LandingDoctor | null>(null);
  const [calDate, setCalDate] = useState(() => new Date());
  const [selDate, setSelDate] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [selSlot, setSelSlot] = useState("");
  const [loadSlots, setLoadSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", type: "Consulta general", notes: "" });
  const [account, setAccount] = useState<PacienteMe | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const schedMap = Object.fromEntries(clinic.schedules.map((s) => [s.dayOfWeek, s]));
  function isDayEnabled(date: Date) {
    const day = date.getDay(), sd = day === 0 ? 6 : day - 1, sched = schedMap[sd];
    const tod = new Date(); tod.setHours(0, 0, 0, 0);
    return !!sched?.enabled && date >= tod;
  }
  function buildCalDays() {
    const y = calDate.getFullYear(), m = calDate.getMonth();
    const fd = new Date(y, m, 1).getDay(), pad = fd === 0 ? 6 : fd - 1, last = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(new Date(y, m, d));
    return cells;
  }

  // Disponibilidad real (idéntico a classic)
  useEffect(() => {
    if (!selDate || !doctor) return;
    setSlots([]); setSelSlot(""); setLoadSlots(true);
    fetch(`/api/public/availability?slug=${clinic.slug}&date=${selDate}&doctorId=${doctor.id}`)
      .then((r) => r.json()).then((d) => setSlots(d.slots ?? [])).catch(() => {}).finally(() => setLoadSlots(false));
  }, [selDate, doctor, clinic.slug]);

  // Reset + preselección al abrir
  useEffect(() => {
    if (!open) return;
    const pre = preselectedDoctorId ? clinic.users.find((u) => u.id === preselectedDoctorId) ?? null : null;
    setDoctor(pre);
    setStep(pre ? 2 : 1);
    setCalDate(new Date());
    setSelDate(""); setSlots([]); setSelSlot(""); setLoadSlots(false);
    setSubmitting(false); setError(""); setAccount(null);
    setForm({ firstName: "", lastName: "", phone: "", email: "", type: preselectedService || "Consulta general", notes: "" });
  }, [open, preselectedDoctorId, preselectedService, clinic.users]);

  // Sesión del portal (OPCIONAL): si el visitante ya tiene cuenta, prellena sus
  // datos y la cita se ligará a su cuenta. Sin sesión → reserva como invitado.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/paciente/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: PacienteMe | null) => {
        if (!alive || !me) return;
        setAccount(me);
        const { firstName, lastName } = splitName(me.name);
        setForm((f) => ({
          ...f,
          firstName: f.firstName || firstName,
          lastName: f.lastName || lastName,
          phone: f.phone || (me.phone ?? ""),
          email: f.email || (me.email ?? ""),
        }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [open]);

  // Esc + bloqueo de scroll del body + focus-trap
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && cardRef.current) {
        const f = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])'))
          .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  // Botones "ya tengo cuenta": vuelven a esta misma landing y reabren la modal.
  function authReturnUrl() {
    return `/${clinic.slug}?reservar=1`;
  }
  function goLogin() {
    window.location.assign(`/paciente/login?next=${encodeURIComponent(authReturnUrl())}`);
  }
  function goRegister() {
    window.location.assign(`/paciente/registro?next=${encodeURIComponent(authReturnUrl())}`);
  }

  async function submit() {
    if (!form.firstName.trim() || !form.lastName.trim() || form.phone.trim().replace(/\D/g, "").length < 10) { setError("Completa nombre y teléfono válido"); return; }
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: clinic.slug, doctorId: doctor!.id, date: selDate, startTime: selSlot, type: form.type, firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim(), email: form.email.trim() || undefined, notes: form.notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al agendar");
      setStep(4);
    } catch (e: any) { setError(e.message); } finally { setSubmitting(false); }
  }

  if (!open) return null;

  const today = toYMD(new Date());
  const baseTypes = doctor?.services.length ? doctor.services : ["Consulta general", "Primera vez", "Revisión", "Urgencia"];
  const typeOptions = preselectedService && !baseTypes.includes(preselectedService) ? [preselectedService, ...baseTypes] : baseTypes;

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div ref={cardRef} className="bg-white w-full sm:max-w-[440px] rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl max-h-[94vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Agendar cita">
        {/* Header */}
        <div className="sticky top-0 bg-white px-6 pt-6 pb-4 border-b border-gray-50 rounded-t-[2.5rem] sm:rounded-t-[2.5rem]">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="font-bold text-gray-900 text-lg l-serif">
                {step === 1 ? "Elige tu doctor" : step === 2 ? "Fecha y hora" : step === 3 ? "Tus datos" : "¡Confirmado!"}
              </div>
              <div className="text-xs text-gray-400">{clinic.name}</div>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-2 rounded-xl hover:bg-gray-100 text-gray-300 hover:text-gray-500"><X size={18} /></button>
          </div>
          {step < 4 && (
            <div className="flex gap-1.5 mt-4">
              {[1, 2, 3].map((s) => <div key={s} className="flex-1 h-1 rounded-full transition-all" style={{ background: s <= step ? theme : "#f3f4f6" }} />)}
            </div>
          )}
        </div>
        <div className="px-6 py-5">
          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-2.5">
              <p className="text-sm text-gray-400 mb-5">Selecciona con quién deseas tu cita</p>
              {clinic.users.map((doc) => (
                <button key={doc.id} onClick={() => { setDoctor(doc); setStep(2); }}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 text-left transition-all">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shrink-0 l-serif" style={{ background: `linear-gradient(135deg,${doc.color},${hexAdjust(doc.color, -25)})` }}>
                    {doc.firstName[0]}{doc.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900">Dr/a. {doc.firstName} {doc.lastName}</div>
                    {doc.specialty && <div className="text-xs mt-0.5 font-semibold" style={{ color: theme }}>{doc.specialty}</div>}
                    {doc.services.length > 0 && <div className="text-xs text-gray-400 mt-1 truncate">{doc.services.slice(0, 3).join(" · ")}</div>}
                  </div>
                  <ArrowRight size={15} className="text-gray-200 shrink-0" />
                </button>
              ))}
            </div>
          )}
          {/* Step 2 */}
          {step === 2 && doctor && (
            <div>
              <button onClick={() => { setStep(1); setSelDate(""); setSelSlot(""); }} className="text-xs text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1">← Cambiar doctor</button>
              <div className="flex items-center gap-3 mb-5 p-3.5 bg-gray-50 rounded-2xl">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: doctor.color }}>{doctor.firstName[0]}{doctor.lastName[0]}</div>
                <span className="text-sm font-semibold text-gray-700">Dr/a. {doctor.firstName} {doctor.lastName}</span>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCalDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))} aria-label="Mes anterior" className="w-9 h-9 rounded-xl hover:bg-gray-200 flex items-center justify-center text-gray-400 font-bold text-lg transition-colors">‹</button>
                  <span className="font-bold text-gray-900 text-sm">{MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}</span>
                  <button onClick={() => setCalDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))} aria-label="Mes siguiente" className="w-9 h-9 rounded-xl hover:bg-gray-200 flex items-center justify-center text-gray-400 font-bold text-lg transition-colors">›</button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {DAYS_SHORT.map((d) => <div key={d} className="text-center text-[10px] text-gray-400 font-semibold py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {buildCalDays().map((day, i) => {
                    if (!day) return <div key={i} />;
                    const ymd = toYMD(day), en = isDayEnabled(day), sel = ymd === selDate, isT = ymd === today;
                    return (
                      <button key={i} disabled={!en} onClick={() => setSelDate(ymd)}
                        className="h-9 rounded-xl text-sm font-medium transition-all"
                        style={{ background: sel ? theme : "transparent", color: sel ? "#fff" : en ? "#1f2937" : "#d1d5db", fontWeight: isT || sel ? 700 : 400, border: isT && !sel ? `2px solid ${theme}` : "2px solid transparent", cursor: en ? "pointer" : "default" }}>
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selDate && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-500 mb-3 capitalize">{new Date(selDate + "T00:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}</div>
                  {loadSlots ? <div className="flex items-center gap-2 text-sm text-gray-400 py-3"><Loader2 size={14} className="animate-spin" />Buscando horarios…</div>
                    : slots.length === 0 ? <p className="text-sm text-gray-400 py-2">Sin horarios — elige otra fecha</p>
                      : <div className="grid grid-cols-4 gap-2">
                          {slots.map((slot) => (
                            <button key={slot} onClick={() => setSelSlot(slot)}
                              className="py-2.5 rounded-xl text-sm font-bold border-2 transition-all"
                              style={{ background: selSlot === slot ? theme : "transparent", color: selSlot === slot ? "#fff" : "#374151", borderColor: selSlot === slot ? theme : "#e5e7eb" }}>
                              {slot}
                            </button>
                          ))}
                        </div>
                  }
                </div>
              )}
              <button disabled={!selSlot} onClick={() => setStep(3)}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-30 flex items-center justify-center gap-2 transition-all"
                style={{ background: theme, boxShadow: `0 6px 20px ${theme}35` }}>
                {selSlot ? <><Check size={16} />Continuar — {selSlot}</> : "Selecciona un horario"}
              </button>
            </div>
          )}
          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <button onClick={() => setStep(2)} className="text-xs text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1">← Cambiar horario</button>
              <div className="rounded-2xl p-4 text-sm font-semibold flex items-center gap-2.5" style={{ background: `${theme}10`, color: themeDark }}>
                <Calendar size={15} /> {selDate ? new Date(selDate + "T00:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "long" }) : ""} · {selSlot} · Dr/a. {doctor?.firstName}
              </div>
              {account ? (
                <div className="rounded-2xl px-4 py-3 text-xs font-semibold flex items-center gap-2" style={{ background: "#f0fdf4", color: "#15803d" }}>
                  <Check size={14} className="shrink-0" />
                  <span className="truncate">Agendas con tu cuenta · {account.email}</span>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-gray-100 p-3.5">
                  <p className="text-xs text-gray-500 mb-2.5">Agenda como invitado llenando tus datos, o entra a tu cuenta DaleControl:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={goLogin}
                      className="py-2 rounded-xl text-xs font-bold border-2 transition-colors hover:bg-gray-50"
                      style={{ borderColor: `${theme}55`, color: themeDark }}>
                      Iniciar sesión
                    </button>
                    <button type="button" onClick={goRegister}
                      className="py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
                      style={{ background: theme }}>
                      Crear cuenta
                    </button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {[{ l: "Nombre *", k: "firstName", p: "Nombre" }, { l: "Apellido *", k: "lastName", p: "Apellido" }].map((f) => (
                  <div key={f.k}>
                    <label className="text-xs font-semibold text-gray-400 block mb-1.5">{f.l}</label>
                    <input value={(form as any)[f.k]} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} placeholder={f.p}
                      className="w-full border-2 border-gray-100 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-blue-200 transition-colors"
                      onFocus={(e) => (e.target.style.borderColor = theme)} onBlur={(e) => (e.target.style.borderColor = "#f3f4f6")} />
                  </div>
                ))}
              </div>
              {[{ l: "WhatsApp / Teléfono *", k: "phone", p: "+52 999 123 4567", t: "tel" }, { l: "Email (opcional)", k: "email", p: "correo@ejemplo.com", t: "email" }].map((f) => (
                <div key={f.k}>
                  <label className="text-xs font-semibold text-gray-400 block mb-1.5">{f.l}</label>
                  <input value={(form as any)[f.k]} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} placeholder={f.p} type={f.t}
                    className="w-full border-2 border-gray-100 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors"
                    onFocus={(e) => (e.target.style.borderColor = theme)} onBlur={(e) => (e.target.style.borderColor = "#f3f4f6")} />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1.5">Motivo de consulta</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border-2 border-gray-100 rounded-xl px-3.5 py-2.5 text-sm outline-none bg-white transition-colors"
                  onFocus={(e) => (e.target.style.borderColor = theme)} onBlur={(e) => (e.target.style.borderColor = "#f3f4f6")}>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1.5">Notas (opcional)</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Describe tu motivo…" rows={2}
                  className="w-full border-2 border-gray-100 rounded-xl px-3.5 py-2.5 text-sm outline-none resize-none transition-colors"
                  onFocus={(e) => (e.target.style.borderColor = theme)} onBlur={(e) => (e.target.style.borderColor = "#f3f4f6")} />
              </div>
              {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3 border border-red-100">{error}</div>}
              <button onClick={submit} disabled={submitting}
                className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 flex items-center justify-center gap-2.5 transition-all"
                style={{ background: theme, boxShadow: `0 8px 24px ${theme}40` }}>
                {submitting ? <><Loader2 size={18} className="animate-spin" />Confirmando…</> : <><Check size={18} />Confirmar cita</>}
              </button>
              <p className="text-xs text-gray-400 text-center">Recibirás confirmación por WhatsApp 📱</p>
            </div>
          )}
          {/* Step 4 */}
          {step === 4 && (
            <div className="text-center py-4">
              <div className="w-24 h-24 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ background: `${theme}12` }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: theme }}>
                  <Check size={32} className="text-white" strokeWidth={3} />
                </div>
              </div>
              <h3 className="l-serif text-2xl font-bold text-gray-900 mb-2">¡Cita confirmada!</h3>
              <p className="text-gray-400 text-sm mb-1">Dr/a. {doctor?.firstName} {doctor?.lastName}</p>
              <p className="font-bold text-base mb-8" style={{ color: theme }}>
                {selDate ? new Date(selDate + "T00:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) : ""} · {selSlot}
              </p>
              <div className="bg-gray-50 rounded-2xl p-5 text-sm text-left space-y-3 mb-6">
                <div className="flex items-center gap-3 text-gray-500"><span className="text-xl">📱</span>Recibirás un WhatsApp con los detalles</div>
                <div className="flex items-center gap-3 text-gray-500"><span className="text-xl">⏰</span>Recordatorio 24 horas antes</div>
                {clinic.address && <div className="flex items-center gap-3 text-gray-500"><span className="text-xl">📍</span>{clinic.address}</div>}
              </div>
              <button onClick={onClose} className="w-full py-3.5 rounded-2xl font-bold text-white" style={{ background: theme }}>Cerrar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
