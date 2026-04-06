"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Check, Phone, FileText, Loader2, MapPin, Clock, Calendar } from "lucide-react";

interface Doctor {
  id: string; firstName: string; lastName: string;
  specialty: string | null; color: string; services: string[];
}
interface Clinic {
  id: string; name: string; slug: string; specialty: string;
  phone: string | null; address: string | null; city: string | null;
  logoUrl: string | null; description: string | null;
  schedules: { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }[];
  users: Doctor[];
}

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_SHORT = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const FALLBACK_TYPES = ["Consulta general","Primera vez","Revisión","Urgencia","Seguimiento"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseYMD(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}

// ── Shared dark styles ──────────────────────────────────────────────────────
const S = {
  page:    { minHeight:"100vh", background:"#0f172a", color:"#f1f5f9", fontFamily:"system-ui,-apple-system,sans-serif" },
  card:    { background:"#1e293b", border:"1px solid #334155", borderRadius:16 },
  input:   { width:"100%", padding:"11px 14px", borderRadius:12, border:"1.5px solid #334155", background:"#0f172a", color:"#f1f5f9", fontSize:16, outline:"none", boxSizing:"border-box" as const },
  label:   { fontSize:13, fontWeight:600, color:"#94a3b8", display:"block", marginBottom:6 },
  muted:   { color:"#64748b" },
  primary: { background:"#2563eb", color:"#fff", fontWeight:700, border:"none", cursor:"pointer", transition:"background 0.15s" },
  ghost:   { background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", cursor:"pointer", transition:"all 0.15s" },
};

export function BookingClient({ clinic, preselectedService }: { clinic: Clinic; preselectedService: string | null }) {
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
    firstName:"", lastName:"", phone:"", email:"",
    type: preselectedService ?? "Consulta general", notes:"",
  });

  const visibleDoctors = useMemo(() => {
    if (!preselectedService) return clinic.users;
    const svc = preselectedService.toLowerCase();
    const filtered = clinic.users.filter(d => d.services.some(s => s.toLowerCase().includes(svc)));
    return filtered.length > 0 ? filtered : clinic.users;
  }, [clinic.users, preselectedService]);

  const apptTypes = useMemo(() => {
    if (!doctor || doctor.services.length === 0) return FALLBACK_TYPES;
    return [...doctor.services, ...FALLBACK_TYPES.filter(t =>
      !doctor.services.some(s => s.toLowerCase() === t.toLowerCase())
    )];
  }, [doctor]);

  useEffect(() => {
    if (!doctor) return;
    const match = preselectedService
      ? doctor.services.find(s => s.toLowerCase().includes(preselectedService.toLowerCase()))
      : null;
    setForm(f => ({ ...f, type: match ?? (doctor.services[0] ?? "Consulta general") }));
  }, [doctor, preselectedService]);

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
    const firstDay = new Date(year, month, 1).getDay();
    const mondayPad = firstDay === 0 ? 6 : firstDay - 1;
    const last = new Date(year, month+1, 0).getDate();
    const cells: (Date|null)[] = [];
    for (let i=0; i<mondayPad; i++) cells.push(null);
    for (let d=1; d<=last; d++) cells.push(new Date(year, month, d));
    return cells;
  }

  useEffect(() => {
    if (!selDate || !doctor) return;
    setSlots([]); setSelSlot(""); setLoadSlots(true);
    fetch(`/api/public/availability?slug=${clinic.slug}&date=${selDate}&doctorId=${doctor.id}`)
      .then(r => r.json())
      .then(d => setSlots(d.slots ?? []))
      .catch(() => {})
      .finally(() => setLoadSlots(false));
  }, [selDate, doctor, clinic.slug]);

  async function submit() {
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/public/book", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          slug: clinic.slug, doctorId: doctor!.id, date: selDate,
          startTime: selSlot, type: form.type,
          firstName: form.firstName.trim(), lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al agendar");
      setStep(4);
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  const canSubmit = form.firstName.trim() && form.lastName.trim()
    && form.phone.trim().replace(/\D/g,"").length >= 10;

  const today = toYMD(new Date());

  return (
    <div style={S.page}>

      {/* Header */}
      <header style={{ background:"#1e293b", borderBottom:"1px solid #334155", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ maxWidth:580, margin:"0 auto", padding:"14px 16px", display:"flex", alignItems:"center", gap:12 }}>
          {clinic.logoUrl
            ? <img src={clinic.logoUrl} alt={clinic.name} style={{ height:36, objectFit:"contain", flexShrink:0 }} />
            : <div style={{ width:40, height:40, borderRadius:12, background:"#2563eb", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:16, flexShrink:0 }}>{clinic.name[0]}</div>
          }
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:15, color:"#f1f5f9" }}>{clinic.name}</div>
            {clinic.city && <div style={{ fontSize:12, color:"#64748b", display:"flex", alignItems:"center", gap:3 }}><MapPin size={11}/> {clinic.city}</div>}
          </div>
          {clinic.phone && (
            <a href={`tel:${clinic.phone}`} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#60a5fa", fontWeight:600, textDecoration:"none", flexShrink:0 }}>
              <Phone size={14}/> {clinic.phone}
            </a>
          )}
        </div>
      </header>

      <main style={{ maxWidth:580, margin:"0 auto", padding:"20px 16px 48px" }}>

        {/* Service banner */}
        {preselectedService && step < 4 && (
          <div style={{ background:"#1e3a5f", border:"1px solid #2563eb", borderRadius:12, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#93c5fd", fontWeight:600 }}>
            🔍 Mostrando doctores para: <strong style={{ color:"#60a5fa" }}>{preselectedService}</strong>
          </div>
        )}

        {/* Progress */}
        {step < 4 && (
          <div style={{ display:"flex", alignItems:"center", marginBottom:24 }}>
            {[{n:1,l:"Doctor"},{n:2,l:"Fecha y hora"},{n:3,l:"Confirmar"}].map((s,i) => (
              <div key={s.n} style={{ display:"flex", alignItems:"center", flex:1 }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <div style={{
                    width:32, height:32, borderRadius:"50%",
                    background: step > s.n ? "#059669" : step === s.n ? "#2563eb" : "#1e293b",
                    border: step < s.n ? "1.5px solid #334155" : "none",
                    color: step >= s.n ? "#fff" : "#475569",
                    fontWeight:700, fontSize:13,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    {step > s.n ? <Check size={14}/> : s.n}
                  </div>
                  <div style={{ fontSize:11, marginTop:4, color: step===s.n ? "#60a5fa" : "#475569", fontWeight: step===s.n ? 600 : 400, whiteSpace:"nowrap" }}>{s.l}</div>
                </div>
                {i < 2 && <div style={{ flex:1, height:2, background: step > s.n ? "#059669" : "#1e293b", marginBottom:18, marginLeft:4, marginRight:4 }} />}
              </div>
            ))}
          </div>
        )}

        {/* ── STEP 1: Doctor ── */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", marginBottom:4 }}>
              {preselectedService ? `Doctores · ${preselectedService}` : "Elige tu doctor"}
            </h1>
            <p style={{ fontSize:13, color:"#64748b", marginBottom:20 }}>
              {visibleDoctors.length} doctor{visibleDoctors.length !== 1 ? "es" : ""} disponible{visibleDoctors.length !== 1 ? "s" : ""}
            </p>

            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {visibleDoctors.map(doc => (
                <button key={doc.id}
                  onClick={() => { setDoctor(doc); setStep(2); }}
                  style={{ display:"flex", alignItems:"center", gap:14, padding:"16px 18px", ...S.card, cursor:"pointer", textAlign:"left", width:"100%", transition:"border-color 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#2563eb")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#334155")}>
                  <div style={{ width:52, height:52, borderRadius:"50%", background:doc.color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:18, flexShrink:0 }}>
                    {doc.firstName[0]}{doc.lastName[0]}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:15, color:"#f1f5f9" }}>Dr/a. {doc.firstName} {doc.lastName}</div>
                    {doc.specialty && <div style={{ fontSize:13, color:"#64748b", marginTop:2 }}>{doc.specialty}</div>}
                    {doc.services.length > 0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:8 }}>
                        {doc.services.slice(0,4).map(s => (
                          <span key={s} style={{
                            fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:999,
                            background: preselectedService && s.toLowerCase().includes(preselectedService.toLowerCase()) ? "#1e3a5f" : "#0f172a",
                            color:      preselectedService && s.toLowerCase().includes(preselectedService.toLowerCase()) ? "#60a5fa" : "#64748b",
                            border:     preselectedService && s.toLowerCase().includes(preselectedService.toLowerCase()) ? "1px solid #2563eb" : "1px solid #1e293b",
                          }}>{s}</span>
                        ))}
                        {doc.services.length > 4 && <span style={{ fontSize:11, color:"#475569" }}>+{doc.services.length - 4}</span>}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} color="#334155" style={{ flexShrink:0 }} />
                </button>
              ))}
            </div>

            {clinic.description && (
              <div style={{ marginTop:20, ...S.card, padding:"14px 16px" }}>
                <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6 }}>{clinic.description}</div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Date + Time ── */}
        {step === 2 && doctor && (
          <div>
            <button onClick={() => { setStep(1); setSelDate(""); setSelSlot(""); }}
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#64748b", background:"none", border:"none", cursor:"pointer", marginBottom:16, padding:0 }}>
              <ChevronLeft size={16}/> Cambiar doctor
            </button>
            <h1 style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", marginBottom:4 }}>Fecha y hora</h1>
            <p style={{ fontSize:13, color:"#64748b", marginBottom:18 }}>Dr/a. {doctor.firstName} {doctor.lastName} · {form.type}</p>

            {/* Calendar */}
            <div style={{ ...S.card, padding:"16px", marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
                  style={{ ...S.ghost, padding:"6px 10px", borderRadius:8, display:"flex", alignItems:"center" }}>
                  <ChevronLeft size={16}/>
                </button>
                <span style={{ fontWeight:700, fontSize:15, color:"#f1f5f9" }}>
                  {MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}
                </span>
                <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
                  style={{ ...S.ghost, padding:"6px 10px", borderRadius:8, display:"flex", alignItems:"center" }}>
                  <ChevronRight size={16}/>
                </button>
              </div>
              {/* Day headers Mon→Sun */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:6 }}>
                {DAYS_SHORT.map(d => <div key={d} style={{ fontSize:11, fontWeight:600, color:"#475569", textAlign:"center" }}>{d}</div>)}
              </div>
              {/* Day cells */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
                {buildCalDays().map((day, i) => {
                  if (!day) return <div key={i}/>;
                  const ymd     = toYMD(day);
                  const enabled = isDayEnabled(day);
                  const sel     = ymd === selDate;
                  const isToday = ymd === today;
                  return (
                    <button key={i} disabled={!enabled} onClick={() => setSelDate(ymd)}
                      style={{
                        height:38, borderRadius:10, border: isToday && !sel ? "1.5px solid #2563eb" : "none",
                        cursor: enabled ? "pointer" : "default",
                        background: sel ? "#2563eb" : enabled ? "#1e293b" : "transparent",
                        color: sel ? "#fff" : enabled ? "#f1f5f9" : "#334155",
                        fontWeight: sel || isToday ? 700 : 400, fontSize:13,
                      }}>
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slots */}
            {selDate && (
              <div style={{ ...S.card, padding:"14px 16px", marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:600, color:"#94a3b8", marginBottom:12, display:"flex", alignItems:"center", gap:6 }}>
                  <Clock size={13}/> {parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}
                </div>
                {loadSlots ? (
                  <div style={{ display:"flex", alignItems:"center", gap:8, color:"#475569", fontSize:13 }}>
                    <Loader2 size={15} style={{ animation:"spin 1s linear infinite" }}/> Verificando disponibilidad…
                  </div>
                ) : slots.length === 0 ? (
                  <div style={{ fontSize:13, color:"#475569" }}>Sin horarios disponibles — elige otra fecha</div>
                ) : (
                  <>
                    {slots.filter(s => parseInt(s) < 13).length > 0 && (
                      <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:"#475569", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>☀️ Mañana</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                          {slots.filter(s => parseInt(s) < 13).map(slot => (
                            <DarkSlot key={slot} slot={slot} selected={selSlot===slot} onSelect={setSelSlot}/>
                          ))}
                        </div>
                      </div>
                    )}
                    {slots.filter(s => parseInt(s) >= 13).length > 0 && (
                      <div>
                        <div style={{ fontSize:11, fontWeight:600, color:"#475569", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>🌤 Tarde</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                          {slots.filter(s => parseInt(s) >= 13).map(slot => (
                            <DarkSlot key={slot} slot={slot} selected={selSlot===slot} onSelect={setSelSlot}/>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <button disabled={!selSlot} onClick={() => setStep(3)}
              style={{ width:"100%", padding:"14px", borderRadius:14, fontSize:15, fontWeight:700,
                ...( selSlot ? S.primary : { background:"#1e293b", color:"#475569", border:"none", cursor:"default" }) }}>
              {selSlot ? `Continuar — ${selSlot}` : "Elige un horario"}
            </button>
          </div>
        )}

        {/* ── STEP 3: Details ── */}
        {step === 3 && (
          <div>
            <button onClick={() => setStep(2)}
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#64748b", background:"none", border:"none", cursor:"pointer", marginBottom:16, padding:0 }}>
              <ChevronLeft size={16}/> Cambiar horario
            </button>

            {/* Summary */}
            <div style={{ background:"#1e3a5f", border:"1px solid #2563eb", borderRadius:14, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#60a5fa", marginBottom:6 }}>Tu cita:</div>
              <div style={{ fontSize:13, color:"#93c5fd", lineHeight:1.8 }}>
                📅 {parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}<br/>
                🕐 {selSlot} · Dr/a. {doctor?.firstName} {doctor?.lastName}<br/>
                📋 {form.type}
              </div>
            </div>

            <h1 style={{ fontSize:20, fontWeight:800, color:"#f1f5f9", marginBottom:16 }}>Tus datos</h1>

            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <DarkField label="Nombre *" value={form.firstName} onChange={v => setForm(f=>({...f,firstName:v}))} placeholder="Nombre"/>
                <DarkField label="Apellido *" value={form.lastName} onChange={v => setForm(f=>({...f,lastName:v}))} placeholder="Apellido"/>
              </div>
              <DarkField label="WhatsApp / Teléfono *" value={form.phone} onChange={v => setForm(f=>({...f,phone:v}))} placeholder="+52 999 123 4567" type="tel"/>
              <DarkField label="Email (opcional)" value={form.email} onChange={v => setForm(f=>({...f,email:v}))} placeholder="correo@ejemplo.com" type="email"/>

              <div>
                <label style={S.label}>Motivo de la cita</label>
                <select value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))}
                  style={{ ...S.input }}>
                  {apptTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label style={S.label}>
                  <FileText size={12} style={{ display:"inline", marginRight:4, verticalAlign:"middle" }}/>
                  Notas para el doctor (opcional)
                </label>
                <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Describe brevemente tu motivo de consulta…" rows={3}
                  style={{ ...S.input, resize:"none", fontFamily:"inherit", lineHeight:1.6 }}/>
              </div>
            </div>

            {error && (
              <div style={{ marginTop:12, padding:"10px 14px", background:"#450a0a", border:"1px solid #7f1d1d", borderRadius:10, fontSize:13, color:"#f87171" }}>
                ⚠️ {error}
              </div>
            )}

            <button disabled={!canSubmit || submitting} onClick={submit}
              style={{ marginTop:20, width:"100%", padding:"16px", borderRadius:14, fontSize:16, fontWeight:700,
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                ...( canSubmit && !submitting ? S.primary : { background:"#1e293b", color:"#475569", border:"none", cursor:"default" }) }}>
              {submitting ? <><Loader2 size={18} style={{ animation:"spin 1s linear infinite" }}/> Confirmando…</> : "✅ Confirmar cita"}
            </button>
            <p style={{ fontSize:12, color:"#475569", textAlign:"center", marginTop:8 }}>
              Recibirás confirmación por WhatsApp
            </p>
          </div>
        )}

        {/* ── STEP 4: Success ── */}
        {step === 4 && (
          <div style={{ textAlign:"center", padding:"32px 0" }}>
            <div style={{ width:80, height:80, borderRadius:"50%", background:"#052e16", border:"2px solid #16a34a", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 24px" }}>
              <Check size={40} color="#4ade80"/>
            </div>
            <h1 style={{ fontSize:28, fontWeight:800, color:"#f1f5f9", marginBottom:8 }}>¡Cita confirmada! 🎉</h1>
            <p style={{ fontSize:15, color:"#94a3b8", marginBottom:28, lineHeight:1.7 }}>
              Dr/a. <strong style={{ color:"#f1f5f9" }}>{doctor?.firstName} {doctor?.lastName}</strong><br/>
              <strong style={{ color:"#60a5fa" }}>{selDate ? parseYMD(selDate).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"}) : ""}</strong> a las <strong style={{ color:"#60a5fa" }}>{selSlot}</strong>
            </p>

            <div style={{ background:"#052e16", border:"1px solid #166534", borderRadius:16, padding:"16px 20px", marginBottom:20, textAlign:"left" }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#4ade80", marginBottom:8 }}>¿Qué sigue?</div>
              <div style={{ fontSize:13, color:"#86efac", lineHeight:1.9 }}>
                📱 Recibirás un WhatsApp con los detalles<br/>
                ⏰ Recordatorio 24h antes de tu cita<br/>
                {clinic.address && <>📍 {clinic.address}</>}
              </div>
            </div>

            {clinic.phone && (
              <a href={`tel:${clinic.phone}`}
                style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#1e293b", border:"1px solid #334155", color:"#60a5fa", fontWeight:600, fontSize:14, padding:"12px 24px", borderRadius:12, textDecoration:"none", marginBottom:20 }}>
                <Phone size={15}/> {clinic.phone}
              </a>
            )}

            <br/>
            <button onClick={() => { setStep(1); setSelDate(""); setSelSlot(""); setDoctor(null); setForm({firstName:"",lastName:"",phone:"",email:"",type:preselectedService ?? "Consulta general",notes:""}); }}
              style={{ padding:"10px 24px", borderRadius:12, ...S.ghost, fontWeight:600, fontSize:14 }}>
              Agendar otra cita
            </button>
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform:rotate(360deg) } } input::placeholder, textarea::placeholder { color:#475569 } select option { background:#1e293b; color:#f1f5f9 }`}</style>
    </div>
  );
}

function DarkSlot({ slot, selected, onSelect }: { slot:string; selected:boolean; onSelect:(s:string)=>void }) {
  return (
    <button onClick={() => onSelect(slot)}
      style={{ padding:"9px 0", borderRadius:10, fontSize:13, fontWeight: selected ? 700 : 500, cursor:"pointer",
        background: selected ? "#2563eb" : "#0f172a",
        color:      selected ? "#fff" : "#94a3b8",
        border:     selected ? "2px solid #2563eb" : "1.5px solid #1e293b",
        transition:"all 0.1s",
      }}>
      {slot}
    </button>
  );
}

function DarkField({ label, value, onChange, placeholder, type="text" }: {
  label:string; value:string; onChange:(v:string)=>void; placeholder?:string; type?:string;
}) {
  const S_input: React.CSSProperties = {
    width:"100%", padding:"11px 14px", borderRadius:12,
    border:"1.5px solid #334155", background:"#0f172a",
    color:"#f1f5f9", fontSize:16, outline:"none", boxSizing:"border-box",
  };
  return (
    <div>
      <label style={{ fontSize:13, fontWeight:600, color:"#94a3b8", display:"block", marginBottom:6 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={S_input}
        onFocus={e => e.target.style.borderColor="#2563eb"}
        onBlur={e => e.target.style.borderColor="#334155"}
      />
    </div>
  );
}
