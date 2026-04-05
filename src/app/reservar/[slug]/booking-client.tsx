"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Check, Calendar, Clock, User, Phone, Mail, FileText, Loader2 } from "lucide-react";

interface Doctor { id: string; firstName: string; lastName: string; specialty: string | null; color: string }
interface Clinic  {
  id: string; name: string; slug: string; specialty: string;
  phone: string | null; address: string | null; city: string | null; logoUrl: string | null;
  schedules: { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }[];
  users: Doctor[];
}

const DAYS_ES    = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const APPT_TYPES = ["Consulta general","Primera vez","Seguimiento","Urgencia","Revisión","Limpieza","Valoración"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseYMD(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}

export function BookingClient({ clinic }: { clinic: Clinic }) {
  const [step,      setStep]      = useState(1); // 1=doctor 2=datetime 3=details 4=success
  const [doctor,    setDoctor]    = useState<Doctor | null>(null);
  const [calDate,   setCalDate]   = useState(new Date()); // calendar display month
  const [selDate,   setSelDate]   = useState<string>("");  // YYYY-MM-DD
  const [slots,     setSlots]     = useState<string[]>([]);
  const [selSlot,   setSelSlot]   = useState("");
  const [loadSlots, setLoadSlots] = useState(false);
  const [form,      setForm]      = useState({ firstName:"", lastName:"", phone:"", email:"", type:"Consulta general", notes:"" });
  const [submitting,setSubmitting]= useState(false);
  const [error,     setError]     = useState("");
  const [bookingId, setBookingId] = useState("");

  // Schedule as map: dayOfWeek → schedule
  const schedMap = Object.fromEntries(clinic.schedules.map(s => [s.dayOfWeek, s]));

  // When date changes, fetch available slots
  useEffect(() => {
    if (!selDate || !doctor) return;
    setSlots([]); setSelSlot(""); setLoadSlots(true);
    fetch(`/api/public/availability?slug=${clinic.slug}&date=${selDate}&doctorId=${doctor.id}`)
      .then(r => r.json())
      .then(d => { setSlots(d.slots ?? []); setLoadSlots(false); })
      .catch(() => setLoadSlots(false));
  }, [selDate, doctor, clinic.slug]);

  // Calendar helpers
  function isDayEnabled(date: Date) {
    const day = date.getDay();
    const schedDay = day === 0 ? 6 : day - 1;
    const sched = schedMap[schedDay];
    const today = new Date(); today.setHours(0,0,0,0);
    return !!sched?.enabled && date >= today;
  }

  function buildCalDays() {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const first = new Date(year, month, 1);
    const last  = new Date(year, month + 1, 0);
    const startPad = first.getDay(); // 0=Sun
    const days: (Date | null)[] = [];
    for (let i = 0; i < startPad; i++) days.push(null);
    for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
    return days;
  }

  async function submit() {
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          slug:      clinic.slug,
          doctorId:  doctor!.id,
          date:      selDate,
          startTime: selSlot,
          type:      form.type,
          firstName: form.firstName.trim(),
          lastName:  form.lastName.trim(),
          phone:     form.phone.trim(),
          email:     form.email.trim() || undefined,
          notes:     form.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al agendar");
      setBookingId(data.appointmentId);
      setStep(4);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = form.firstName.trim() && form.lastName.trim() && form.phone.trim().length >= 10;

  return (
    <div className="min-h-screen" style={{ background:"#f8fafc", fontFamily:"system-ui,sans-serif" }}>

      {/* Header */}
      <header style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"16px 20px" }}>
        <div style={{ maxWidth:520, margin:"0 auto", display:"flex", alignItems:"center", gap:12 }}>
          {clinic.logoUrl
            ? <img src={clinic.logoUrl} alt={clinic.name} style={{ height:36, objectFit:"contain" }} />
            : <div style={{ width:40, height:40, borderRadius:12, background:"#2563eb", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:16, flexShrink:0 }}>{clinic.name[0]}</div>}
          <div>
            <div style={{ fontWeight:700, fontSize:16, color:"#0f172a" }}>{clinic.name}</div>
            {clinic.city && <div style={{ fontSize:13, color:"#64748b" }}>{clinic.city}</div>}
          </div>
        </div>
      </header>

      <main style={{ maxWidth:520, margin:"0 auto", padding:"24px 16px" }}>

        {/* Progress steps */}
        {step < 4 && (
          <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:28 }}>
            {[{n:1,l:"Doctor"},{n:2,l:"Fecha y hora"},{n:3,l:"Tus datos"}].map((s,i) => (
              <div key={s.n} style={{ display:"flex", alignItems:"center", flex:1 }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>
                  <div style={{
                    width:32, height:32, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
                    background: step > s.n ? "#059669" : step === s.n ? "#2563eb" : "#e2e8f0",
                    color: step >= s.n ? "#fff" : "#94a3b8", fontWeight:700, fontSize:14, flexShrink:0,
                  }}>
                    {step > s.n ? <Check size={16} /> : s.n}
                  </div>
                  <div style={{ fontSize:11, marginTop:4, color: step === s.n ? "#2563eb" : "#94a3b8", fontWeight: step === s.n ? 600 : 400 }}>{s.l}</div>
                </div>
                {i < 2 && <div style={{ height:2, flex:1, background: step > s.n ? "#059669" : "#e2e8f0", marginBottom:18, flexShrink:0 }} />}
              </div>
            ))}
          </div>
        )}

        {/* ── STEP 1: Choose Doctor ── */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:6 }}>¿Con qué doctor?</h1>
            <p style={{ fontSize:14, color:"#64748b", marginBottom:20 }}>Selecciona al especialista para tu cita</p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {clinic.users.map(doc => (
                <button key={doc.id} onClick={() => { setDoctor(doc); setStep(2); }}
                  style={{
                    display:"flex", alignItems:"center", gap:14, padding:"16px",
                    background:"#fff", border:`2px solid ${doctor?.id === doc.id ? "#2563eb" : "#e2e8f0"}`,
                    borderRadius:16, cursor:"pointer", textAlign:"left", transition:"border-color 0.15s",
                  }}>
                  <div style={{ width:48, height:48, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:doc.color, color:"#fff", fontWeight:700, fontSize:16, flexShrink:0 }}>
                    {doc.firstName[0]}{doc.lastName[0]}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>Dr/a. {doc.firstName} {doc.lastName}</div>
                    {doc.specialty && <div style={{ fontSize:13, color:"#64748b", marginTop:2 }}>{doc.specialty}</div>}
                  </div>
                  <ChevronRight size={18} color="#94a3b8" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: Date + Time ── */}
        {step === 2 && doctor && (
          <div>
            <button onClick={() => setStep(1)} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#64748b", background:"none", border:"none", cursor:"pointer", marginBottom:16, padding:0 }}>
              <ChevronLeft size={16} /> Cambiar doctor
            </button>
            <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:6 }}>Elige fecha y hora</h1>
            <p style={{ fontSize:14, color:"#64748b", marginBottom:20 }}>
              Dr/a. {doctor.firstName} {doctor.lastName}
            </p>

            {/* Calendar */}
            <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16, padding:"16px", marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
                  style={{ background:"none", border:"none", cursor:"pointer", padding:6, borderRadius:8, color:"#475569" }}>
                  <ChevronLeft size={18} />
                </button>
                <span style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>
                  {MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}
                </span>
                <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
                  style={{ background:"none", border:"none", cursor:"pointer", padding:6, borderRadius:8, color:"#475569" }}>
                  <ChevronRight size={18} />
                </button>
              </div>
              {/* Day headers */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
                {DAYS_ES.map(d => <div key={d} style={{ fontSize:11, fontWeight:600, color:"#94a3b8", textAlign:"center" }}>{d}</div>)}
              </div>
              {/* Day cells */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
                {buildCalDays().map((day, i) => {
                  if (!day) return <div key={i} />;
                  const ymd     = toYMD(day);
                  const enabled = isDayEnabled(day);
                  const sel     = ymd === selDate;
                  return (
                    <button key={i} disabled={!enabled} onClick={() => setSelDate(ymd)}
                      style={{
                        height:36, borderRadius:10, border:"none", cursor:enabled ? "pointer" : "default",
                        background: sel ? "#2563eb" : enabled ? "#f1f5f9" : "transparent",
                        color: sel ? "#fff" : enabled ? "#0f172a" : "#cbd5e1",
                        fontWeight: sel ? 700 : 400, fontSize:13,
                      }}>
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time slots */}
            {selDate && (
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:"#475569", marginBottom:10 }}>
                  Horarios disponibles — {parseYMD(selDate).toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long" })}
                </div>
                {loadSlots ? (
                  <div style={{ display:"flex", alignItems:"center", gap:8, color:"#94a3b8", fontSize:14 }}>
                    <Loader2 size={16} style={{ animation:"spin 1s linear infinite" }} /> Verificando disponibilidad…
                  </div>
                ) : slots.length === 0 ? (
                  <div style={{ fontSize:14, color:"#94a3b8", padding:"12px 0" }}>No hay horarios disponibles este día</div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                    {slots.map(slot => (
                      <button key={slot} onClick={() => setSelSlot(slot)}
                        style={{
                          padding:"10px 0", borderRadius:12, border:`2px solid ${selSlot === slot ? "#2563eb" : "#e2e8f0"}`,
                          background: selSlot === slot ? "#eff6ff" : "#fff",
                          color: selSlot === slot ? "#1d4ed8" : "#475569",
                          fontWeight: selSlot === slot ? 700 : 400, fontSize:13, cursor:"pointer",
                        }}>
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button disabled={!selSlot} onClick={() => setStep(3)}
              style={{
                marginTop:20, width:"100%", padding:"14px", borderRadius:14, border:"none",
                background: selSlot ? "#2563eb" : "#e2e8f0",
                color: selSlot ? "#fff" : "#94a3b8",
                fontWeight:700, fontSize:15, cursor: selSlot ? "pointer" : "default",
              }}>
              Continuar {selSlot && `— ${selSlot}`}
            </button>
          </div>
        )}

        {/* ── STEP 3: Patient Details ── */}
        {step === 3 && (
          <div>
            <button onClick={() => setStep(2)} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#64748b", background:"none", border:"none", cursor:"pointer", marginBottom:16, padding:0 }}>
              <ChevronLeft size={16} /> Cambiar fecha
            </button>
            <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:6 }}>Tus datos</h1>
            <p style={{ fontSize:14, color:"#64748b", marginBottom:20 }}>Para confirmar tu cita el {parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})} a las {selSlot}</p>

            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <Field icon={<User size={16}/>} label="Nombre*" value={form.firstName} onChange={v => setForm(f=>({...f,firstName:v}))} placeholder="Nombre" />
                <Field icon={<User size={16}/>} label="Apellido*" value={form.lastName}  onChange={v => setForm(f=>({...f,lastName:v}))}  placeholder="Apellido" />
              </div>
              <Field icon={<Phone size={16}/>} label="Teléfono (WhatsApp)*" value={form.phone} onChange={v => setForm(f=>({...f,phone:v}))} placeholder="+52 55 1234 5678" type="tel" />
              <Field icon={<Mail  size={16}/>} label="Email (opcional)"    value={form.email} onChange={v => setForm(f=>({...f,email:v}))} placeholder="correo@ejemplo.com" type="email" />

              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>
                  <Calendar size={14} style={{ display:"inline", marginRight:5, verticalAlign:"middle" }} />
                  Tipo de consulta
                </label>
                <select value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))}
                  style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #e2e8f0", background:"#fff", fontSize:14, color:"#0f172a", outline:"none" }}>
                  {APPT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>
                  <FileText size={14} style={{ display:"inline", marginRight:5, verticalAlign:"middle" }} />
                  Notas adicionales (opcional)
                </label>
                <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Ej: Tengo miedo al dentista, es para revisión de brackets…"
                  rows={3}
                  style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #e2e8f0", fontSize:14, color:"#0f172a", resize:"none", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }} />
              </div>
            </div>

            {error && (
              <div style={{ marginTop:12, padding:"10px 14px", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, fontSize:13, color:"#dc2626" }}>
                {error}
              </div>
            )}

            <button disabled={!canSubmit || submitting} onClick={submit}
              style={{
                marginTop:20, width:"100%", padding:"16px", borderRadius:14, border:"none",
                background: canSubmit && !submitting ? "#2563eb" : "#e2e8f0",
                color: canSubmit && !submitting ? "#fff" : "#94a3b8",
                fontWeight:700, fontSize:16, cursor: canSubmit && !submitting ? "pointer" : "default",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
              {submitting ? <><Loader2 size={18} style={{ animation:"spin 1s linear infinite" }} /> Agendando…</> : "Confirmar cita"}
            </button>
            <p style={{ fontSize:12, color:"#94a3b8", textAlign:"center", marginTop:10 }}>
              Recibirás confirmación por WhatsApp
            </p>
          </div>
        )}

        {/* ── STEP 4: Success ── */}
        {step === 4 && (
          <div style={{ textAlign:"center", padding:"32px 0" }}>
            <div style={{ width:72, height:72, borderRadius:"50%", background:"#dcfce7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
              <Check size={36} color="#16a34a" />
            </div>
            <h1 style={{ fontSize:24, fontWeight:700, color:"#0f172a", marginBottom:8 }}>¡Cita agendada!</h1>
            <p style={{ fontSize:15, color:"#64748b", marginBottom:24, lineHeight:1.6 }}>
              Tu cita con Dr/a. {doctor?.firstName} {doctor?.lastName}<br />
              el <strong style={{ color:"#0f172a" }}>{parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}</strong> a las <strong style={{ color:"#0f172a" }}>{selSlot}</strong><br />
              ha sido registrada con éxito.
            </p>
            <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:14, padding:"16px", marginBottom:24 }}>
              <div style={{ fontSize:14, color:"#166534", fontWeight:600 }}>
                Recibirás un mensaje de WhatsApp con los detalles.
              </div>
            </div>
            {clinic.phone && (
              <p style={{ fontSize:13, color:"#94a3b8" }}>
                Para cambios o cancelaciones: <a href={`tel:${clinic.phone}`} style={{ color:"#2563eb" }}>{clinic.phone}</a>
              </p>
            )}
            <button onClick={() => { setStep(1); setSelDate(""); setSelSlot(""); setDoctor(null); }}
              style={{ marginTop:20, padding:"12px 28px", borderRadius:12, border:"1.5px solid #e2e8f0", background:"#fff", color:"#475569", fontWeight:600, fontSize:14, cursor:"pointer" }}>
              Agendar otra cita
            </button>
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Small reusable field component ─────────────────────────────────────────
function Field({ icon, label, value, onChange, placeholder, type = "text" }: {
  icon?: React.ReactNode; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label style={{ fontSize:13, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>
        {icon && <span style={{ display:"inline", marginRight:5, verticalAlign:"middle" }}>{icon}</span>}
        {label}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #e2e8f0", fontSize:14, color:"#0f172a", outline:"none", boxSizing:"border-box" }} />
    </div>
  );
}
