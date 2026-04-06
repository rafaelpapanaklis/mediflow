"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Check, Phone, Mail, FileText, Loader2, MapPin, Clock } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Doctor {
  id: string; firstName: string; lastName: string;
  specialty: string | null; color: string;
  services: string[]; // FIX: added missing field
}
interface Clinic {
  id: string; name: string; slug: string; specialty: string;
  phone: string | null; address: string | null; city: string | null;
  logoUrl: string | null; description: string | null;
  schedules: { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }[];
  users: Doctor[];
}

const DAYS_ES   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const FALLBACK_TYPES = ["Consulta general","Primera vez","Revisión","Urgencia","Seguimiento"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseYMD(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}

// ── Main component ─────────────────────────────────────────────────────────
export function BookingClient({
  clinic,
  preselectedService,
}: {
  clinic: Clinic;
  preselectedService: string | null;
}) {
  const [step,       setStep]       = useState(1);
  const [doctor,     setDoctor]     = useState<Doctor | null>(null);
  const [calDate,    setCalDate]    = useState(new Date());
  const [selDate,    setSelDate]    = useState("");
  const [slots,      setSlots]      = useState<string[]>([]);
  const [selSlot,    setSelSlot]    = useState("");
  const [loadSlots,  setLoadSlots]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "", email: "",
    type: preselectedService ?? "Consulta general", notes: "",
  });

  // FIX: Filter doctors by preselected service if coming from /clinicas
  const visibleDoctors = useMemo(() => {
    if (!preselectedService) return clinic.users;
    const svc = preselectedService.toLowerCase();
    const filtered = clinic.users.filter(d =>
      d.services.some(s => s.toLowerCase().includes(svc))
    );
    // If no doctors match (e.g. no services configured), show all
    return filtered.length > 0 ? filtered : clinic.users;
  }, [clinic.users, preselectedService]);

  // FIX: Appointment types = doctor's services + fallbacks
  const apptTypes = useMemo(() => {
    if (!doctor || doctor.services.length === 0) return FALLBACK_TYPES;
    const combined = [...doctor.services, ...FALLBACK_TYPES.filter(t =>
      !doctor.services.some(s => s.toLowerCase() === t.toLowerCase())
    )];
    return combined;
  }, [doctor]);

  // When doctor changes, update type to preselected service or first available
  useEffect(() => {
    if (!doctor) return;
    if (preselectedService && doctor.services.some(s =>
      s.toLowerCase().includes(preselectedService.toLowerCase())
    )) {
      // Use the exact service name from the doctor's list
      const match = doctor.services.find(s =>
        s.toLowerCase().includes(preselectedService.toLowerCase())
      );
      setForm(f => ({ ...f, type: match ?? preselectedService }));
    } else if (doctor.services.length > 0) {
      setForm(f => ({ ...f, type: doctor.services[0] }));
    }
  }, [doctor, preselectedService]);

  // Schedule map
  const schedMap = Object.fromEntries(clinic.schedules.map(s => [s.dayOfWeek, s]));

  function isDayEnabled(date: Date) {
    const day     = date.getDay();
    const schedDay = day === 0 ? 6 : day - 1;
    const sched   = schedMap[schedDay];
    const today   = new Date(); today.setHours(0,0,0,0);
    return !!sched?.enabled && date >= today;
  }

  function buildCalDays() {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const first = new Date(year, month, 1);
    const last  = new Date(year, month+1, 0);
    const pad   = first.getDay();
    const days: (Date|null)[] = [];
    for (let i=0; i<pad; i++) days.push(null);
    for (let d=1; d<=last.getDate(); d++) days.push(new Date(year, month, d));
    return days;
  }

  // Fetch slots when date or doctor changes
  useEffect(() => {
    if (!selDate || !doctor) return;
    setSlots([]); setSelSlot(""); setLoadSlots(true);
    fetch(`/api/public/availability?slug=${clinic.slug}&date=${selDate}&doctorId=${doctor.id}`)
      .then(r => r.json())
      .then(d => { setSlots(d.slots ?? []); })
      .catch(() => {})
      .finally(() => setLoadSlots(false));
  }, [selDate, doctor, clinic.slug]);

  async function submit() {
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
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
      setStep(4);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = form.firstName.trim().length > 0
    && form.lastName.trim().length > 0
    && form.phone.trim().replace(/\D/g,"").length >= 10;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", fontFamily:"system-ui,-apple-system,sans-serif" }}>

      {/* Header */}
      <header style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
          {clinic.logoUrl
            ? <img src={clinic.logoUrl} alt={clinic.name} style={{ height:36, objectFit:"contain", flexShrink:0 }} />
            : <div style={{ width:40, height:40, borderRadius:12, background:"#2563eb", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:16, flexShrink:0 }}>{clinic.name[0]}</div>}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>{clinic.name}</div>
            {(clinic.city || clinic.address) && (
              <div style={{ fontSize:12, color:"#64748b", display:"flex", alignItems:"center", gap:3 }}>
                <MapPin size={11} /> {clinic.city ?? clinic.address}
              </div>
            )}
          </div>
          {clinic.phone && (
            <a href={`tel:${clinic.phone}`}
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#2563eb", fontWeight:600, textDecoration:"none", flexShrink:0 }}>
              <Phone size={14} /> {clinic.phone}
            </a>
          )}
        </div>
      </header>

      <main style={{ maxWidth:560, margin:"0 auto", padding:"20px 16px 40px" }}>

        {/* Service banner if coming from directory */}
        {preselectedService && step < 4 && (
          <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:12, padding:"10px 14px", marginBottom:16, display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#1d4ed8", fontWeight:600 }}>
            🔍 Buscando doctores para: <strong>{preselectedService}</strong>
          </div>
        )}

        {/* Progress bar */}
        {step < 4 && (
          <div style={{ display:"flex", alignItems:"center", marginBottom:24 }}>
            {[{n:1,l:"Doctor"},{n:2,l:"Fecha y hora"},{n:3,l:"Confirmar"}].map((s,i) => (
              <div key={s.n} style={{ display:"flex", alignItems:"center", flex:1 }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:"0 0 auto" }}>
                  <div style={{
                    width:30, height:30, borderRadius:"50%",
                    background: step > s.n ? "#059669" : step === s.n ? "#2563eb" : "#e2e8f0",
                    color: step >= s.n ? "#fff" : "#94a3b8",
                    fontWeight:700, fontSize:13,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    {step > s.n ? <Check size={14}/> : s.n}
                  </div>
                  <div style={{ fontSize:11, marginTop:3, color: step===s.n ? "#2563eb" : "#94a3b8", fontWeight:step===s.n ? 600 : 400, whiteSpace:"nowrap" }}>{s.l}</div>
                </div>
                {i < 2 && <div style={{ flex:1, height:2, background: step > s.n ? "#059669" : "#e2e8f0", marginBottom:16, minWidth:12 }} />}
              </div>
            ))}
          </div>
        )}

        {/* ── STEP 1: Doctor ── */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:4 }}>
              {preselectedService ? `Doctores para ${preselectedService}` : "¿Con quién quieres tu cita?"}
            </h1>
            <p style={{ fontSize:13, color:"#64748b", marginBottom:18 }}>
              {visibleDoctors.length} doctor{visibleDoctors.length !== 1 ? "es" : ""} disponible{visibleDoctors.length !== 1 ? "s" : ""}
            </p>

            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {visibleDoctors.map(doc => (
                <button key={doc.id}
                  onClick={() => { setDoctor(doc); setStep(2); }}
                  style={{
                    display:"flex", alignItems:"center", gap:14, padding:"16px 18px",
                    background:"#fff", border:"2px solid #e2e8f0", borderRadius:16,
                    cursor:"pointer", textAlign:"left", width:"100%", transition:"all 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#2563eb")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#e2e8f0")}>
                  {/* Avatar */}
                  <div style={{ width:52, height:52, borderRadius:"50%", background:doc.color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:18, flexShrink:0 }}>
                    {doc.firstName[0]}{doc.lastName[0]}
                  </div>
                  {/* Info */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>
                      Dr/a. {doc.firstName} {doc.lastName}
                    </div>
                    {doc.specialty && (
                      <div style={{ fontSize:13, color:"#64748b", marginTop:2 }}>{doc.specialty}</div>
                    )}
                    {/* Services tags */}
                    {doc.services.length > 0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:6 }}>
                        {doc.services.slice(0, 4).map(s => (
                          <span key={s} style={{
                            fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:999,
                            background: preselectedService && s.toLowerCase().includes(preselectedService.toLowerCase()) ? "#dbeafe" : "#f1f5f9",
                            color:      preselectedService && s.toLowerCase().includes(preselectedService.toLowerCase()) ? "#1d4ed8" : "#475569",
                          }}>{s}</span>
                        ))}
                        {doc.services.length > 4 && (
                          <span style={{ fontSize:11, color:"#94a3b8" }}>+{doc.services.length - 4} más</span>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} color="#cbd5e1" style={{ flexShrink:0 }} />
                </button>
              ))}
            </div>

            {/* Clinic info card */}
            {clinic.description && (
              <div style={{ marginTop:20, background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:"14px 16px" }}>
                <div style={{ fontSize:13, color:"#475569", lineHeight:1.6 }}>{clinic.description}</div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Date + Time ── */}
        {step === 2 && doctor && (
          <div>
            {/* Back button */}
            <button onClick={() => { setStep(1); setSelDate(""); setSelSlot(""); }}
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#64748b", background:"none", border:"none", cursor:"pointer", marginBottom:16, padding:0 }}>
              <ChevronLeft size={16} /> {doctor.firstName} {doctor.lastName}
            </button>

            <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:4 }}>Elige fecha y hora</h1>
            <p style={{ fontSize:13, color:"#64748b", marginBottom:18 }}>
              Dr/a. {doctor.firstName} {doctor.lastName} · {form.type}
            </p>

            {/* Calendar */}
            <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16, padding:"16px 16px 12px", marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
                  style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:8, padding:"6px 10px", cursor:"pointer", color:"#475569", display:"flex", alignItems:"center" }}>
                  <ChevronLeft size={16}/>
                </button>
                <span style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>
                  {MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}
                </span>
                <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
                  style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:8, padding:"6px 10px", cursor:"pointer", color:"#475569", display:"flex", alignItems:"center" }}>
                  <ChevronRight size={16}/>
                </button>
              </div>

              {/* Day headers — start Mon */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:4 }}>
                {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => (
                  <div key={d} style={{ fontSize:11, fontWeight:600, color:"#94a3b8", textAlign:"center", paddingBottom:4 }}>{d}</div>
                ))}
              </div>

              {/* Day cells — reorder Sun to end */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
                {(() => {
                  const days = buildCalDays();
                  // buildCalDays starts with Sunday pad — shift to Monday
                  // First day of month getDay(): 0=Sun,1=Mon,...
                  const year = calDate.getFullYear(), month = calDate.getMonth();
                  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
                  const mondayPad = firstDay === 0 ? 6 : firstDay - 1;
                  const last = new Date(year, month+1, 0).getDate();
                  const cells: (Date|null)[] = [];
                  for (let i=0; i<mondayPad; i++) cells.push(null);
                  for (let d=1; d<=last; d++) cells.push(new Date(year, month, d));
                  return cells.map((day, i) => {
                    if (!day) return <div key={i} />;
                    const ymd     = toYMD(day);
                    const enabled = isDayEnabled(day);
                    const sel     = ymd === selDate;
                    const isToday = toYMD(new Date()) === ymd;
                    return (
                      <button key={i} disabled={!enabled} onClick={() => setSelDate(ymd)}
                        style={{
                          height:38, borderRadius:10, border: isToday && !sel ? "2px solid #2563eb" : "none",
                          cursor: enabled ? "pointer" : "default",
                          background: sel ? "#2563eb" : enabled ? "#f1f5f9" : "transparent",
                          color: sel ? "#fff" : enabled ? "#0f172a" : "#d1d5db",
                          fontWeight: sel || isToday ? 700 : 400, fontSize:13,
                          transition:"all 0.1s",
                        }}>
                        {day.getDate()}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Time slots */}
            {selDate && (
              <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16, padding:"14px 16px", marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:600, color:"#475569", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                  <Clock size={14}/> {parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}
                </div>
                {loadSlots ? (
                  <div style={{ display:"flex", alignItems:"center", gap:8, color:"#94a3b8", fontSize:13, padding:"8px 0" }}>
                    <Loader2 size={16} style={{ animation:"spin 1s linear infinite" }}/> Verificando disponibilidad…
                  </div>
                ) : slots.length === 0 ? (
                  <div style={{ fontSize:13, color:"#94a3b8", padding:"8px 0" }}>
                    Sin horarios disponibles este día — elige otra fecha
                  </div>
                ) : (
                  <>
                    {/* Morning */}
                    {slots.filter(s => parseInt(s) < 13).length > 0 && (
                      <div style={{ marginBottom:12 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>☀️ Mañana</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                          {slots.filter(s => parseInt(s) < 13).map(slot => (
                            <SlotButton key={slot} slot={slot} selected={selSlot===slot} onSelect={setSelSlot} />
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Afternoon */}
                    {slots.filter(s => parseInt(s) >= 13).length > 0 && (
                      <div>
                        <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>🌤 Tarde</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                          {slots.filter(s => parseInt(s) >= 13).map(slot => (
                            <SlotButton key={slot} slot={slot} selected={selSlot===slot} onSelect={setSelSlot} />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <button disabled={!selSlot} onClick={() => setStep(3)}
              style={{
                width:"100%", padding:"14px", borderRadius:14, border:"none",
                background: selSlot ? "#2563eb" : "#e2e8f0",
                color: selSlot ? "#fff" : "#94a3b8",
                fontWeight:700, fontSize:15, cursor: selSlot ? "pointer" : "default",
                transition:"all 0.15s",
              }}>
              {selSlot ? `Continuar — ${selSlot}` : "Elige un horario"}
            </button>
          </div>
        )}

        {/* ── STEP 3: Patient Details ── */}
        {step === 3 && (
          <div>
            <button onClick={() => setStep(2)}
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#64748b", background:"none", border:"none", cursor:"pointer", marginBottom:16, padding:0 }}>
              <ChevronLeft size={16} /> Cambiar horario
            </button>

            {/* Summary card */}
            <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:14, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e40af", marginBottom:4 }}>Tu cita:</div>
              <div style={{ fontSize:13, color:"#1d4ed8" }}>
                📅 {parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
              </div>
              <div style={{ fontSize:13, color:"#1d4ed8" }}>
                🕐 {selSlot} · Dr/a. {doctor?.firstName} {doctor?.lastName}
              </div>
              <div style={{ fontSize:13, color:"#1d4ed8" }}>📋 {form.type}</div>
            </div>

            <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:16 }}>Tus datos</h1>

            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {/* Name row */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <FormField label="Nombre *" value={form.firstName} onChange={v => setForm(f=>({...f,firstName:v}))} placeholder="Nombre" />
                <FormField label="Apellido *" value={form.lastName} onChange={v => setForm(f=>({...f,lastName:v}))} placeholder="Apellido" />
              </div>

              {/* Phone */}
              <FormField label="WhatsApp / Teléfono *" value={form.phone} onChange={v => setForm(f=>({...f,phone:v}))} placeholder="+52 999 123 4567" type="tel" />

              {/* Email */}
              <FormField label="Email (opcional)" value={form.email} onChange={v => setForm(f=>({...f,email:v}))} placeholder="correo@ejemplo.com" type="email" />

              {/* Appointment type */}
              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>
                  Motivo de la cita
                </label>
                <select value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))}
                  style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #e2e8f0", background:"#fff", fontSize:14, color:"#0f172a", outline:"none" }}>
                  {apptTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>
                  <FileText size={13} style={{ display:"inline", marginRight:4, verticalAlign:"middle" }}/>
                  Notas para el doctor (opcional)
                </label>
                <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Describe brevemente tu motivo de consulta o cualquier información importante…"
                  rows={3}
                  style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #e2e8f0", fontSize:13, color:"#0f172a", resize:"none", outline:"none", fontFamily:"inherit", boxSizing:"border-box", lineHeight:1.5 }} />
              </div>
            </div>

            {error && (
              <div style={{ marginTop:12, padding:"10px 14px", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, fontSize:13, color:"#dc2626" }}>
                ⚠️ {error}
              </div>
            )}

            <button disabled={!canSubmit || submitting} onClick={submit}
              style={{
                marginTop:20, width:"100%", padding:"16px", borderRadius:14, border:"none",
                background: canSubmit && !submitting ? "#2563eb" : "#e2e8f0",
                color: canSubmit && !submitting ? "#fff" : "#94a3b8",
                fontWeight:700, fontSize:16, cursor: canSubmit && !submitting ? "pointer" : "default",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                transition:"all 0.15s",
              }}>
              {submitting
                ? <><Loader2 size={18} style={{ animation:"spin 1s linear infinite" }}/> Confirmando cita…</>
                : "✅ Confirmar cita"}
            </button>
            <p style={{ fontSize:12, color:"#94a3b8", textAlign:"center", marginTop:8 }}>
              Recibirás confirmación por WhatsApp al número que indicaste
            </p>
          </div>
        )}

        {/* ── STEP 4: Success ── */}
        {step === 4 && (
          <div style={{ textAlign:"center", padding:"32px 0" }}>
            <div style={{ width:80, height:80, borderRadius:"50%", background:"#dcfce7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
              <Check size={40} color="#16a34a" />
            </div>
            <h1 style={{ fontSize:26, fontWeight:700, color:"#0f172a", marginBottom:8 }}>¡Cita confirmada! 🎉</h1>
            <p style={{ fontSize:15, color:"#64748b", marginBottom:24, lineHeight:1.7 }}>
              Tu cita con <strong style={{ color:"#0f172a" }}>Dr/a. {doctor?.firstName} {doctor?.lastName}</strong><br />
              el <strong style={{ color:"#0f172a" }}>{parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}</strong>
              {" "}a las <strong style={{ color:"#0f172a" }}>{selSlot}</strong><br/>
              ha sido registrada con éxito.
            </p>

            <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:16, padding:"16px 20px", marginBottom:20, textAlign:"left" }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#166534", marginBottom:8 }}>¿Qué sigue?</div>
              <div style={{ fontSize:13, color:"#166534", lineHeight:1.8 }}>
                📱 Recibirás un WhatsApp con los detalles<br/>
                ⏰ Te avisaremos 24h antes como recordatorio<br/>
                📍 {clinic.address ?? `Consulta la dirección con ${clinic.name}`}
              </div>
            </div>

            {clinic.phone && (
              <a href={`tel:${clinic.phone}`}
                style={{ display:"inline-flex", alignItems:"center", gap:6, background:"#fff", border:"1.5px solid #e2e8f0", color:"#2563eb", fontWeight:600, fontSize:14, padding:"10px 20px", borderRadius:12, textDecoration:"none", marginBottom:16 }}>
                <Phone size={14} /> {clinic.phone}
              </a>
            )}

            <br/>
            <button onClick={() => { setStep(1); setSelDate(""); setSelSlot(""); setDoctor(null); setForm({firstName:"",lastName:"",phone:"",email:"",type:preselectedService ?? "Consulta general",notes:""}); }}
              style={{ padding:"10px 24px", borderRadius:12, border:"1.5px solid #e2e8f0", background:"#fff", color:"#475569", fontWeight:600, fontSize:14, cursor:"pointer" }}>
              Agendar otra cita
            </button>
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Reusable components ────────────────────────────────────────────────────
function SlotButton({ slot, selected, onSelect }: { slot:string; selected:boolean; onSelect:(s:string)=>void }) {
  return (
    <button onClick={() => onSelect(slot)}
      style={{
        padding:"9px 0", borderRadius:10,
        border: `2px solid ${selected ? "#2563eb" : "#e2e8f0"}`,
        background: selected ? "#eff6ff" : "#fff",
        color: selected ? "#1d4ed8" : "#475569",
        fontWeight: selected ? 700 : 500, fontSize:13, cursor:"pointer",
        transition:"all 0.1s",
      }}>
      {slot}
    </button>
  );
}

function FormField({ label, value, onChange, placeholder, type="text" }: {
  label:string; value:string; onChange:(v:string)=>void; placeholder?:string; type?:string;
}) {
  return (
    <div>
      <label style={{ fontSize:13, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #e2e8f0", fontSize:14, color:"#0f172a", outline:"none", boxSizing:"border-box", background:"#fff" }}
        onFocus={e => e.target.style.borderColor="#2563eb"}
        onBlur={e => e.target.style.borderColor="#e2e8f0"}
      />
    </div>
  );
}
