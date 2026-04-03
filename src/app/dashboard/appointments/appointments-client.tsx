"use client";

import { useState, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, Plus, X,
  Phone, MessageCircle, Ban,
  Calendar, List, CalendarDays, Search,
  Edit, CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Patient { id: string; firstName: string; lastName: string; patientNumber: string; phone?: string | null }
interface Doctor  { id: string; firstName: string; lastName: string; role: string }
interface Appt {
  id: string; patientId: string; doctorId: string; type: string;
  date: string; startTime: string; endTime: string; durationMins: number;
  status: string; notes?: string | null; reminderSent: boolean;
  googleCalendarEventId?: string | null;
  patient: { id: string; firstName: string; lastName: string; phone?: string | null };
  doctor:  { id: string; firstName: string; lastName: string };
}

interface Props {
  appointments: Appt[]; patients: Patient[]; doctors: Doctor[];
  currentUserId: string; clinicId: string; waConnected: boolean;
}

const DAYS_ES   = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const HOURS     = Array.from({ length: 14 }, (_, i) => `${(i + 7).toString().padStart(2,"0")}:00`);
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const APPT_TYPES = ["Consulta general","Primera vez","Revisión / Control","Limpieza dental","Extracción","Endodoncia","Ortodoncia","Implante","Cirugía","Nutrición","Psicología","Seguimiento","Otro"];

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  PENDING:     { label:"Pendiente",  bg:"bg-amber-100 dark:bg-amber-900/30",    text:"text-amber-700 dark:text-amber-300",    dot:"bg-amber-500",   border:"border-amber-300"   },
  CONFIRMED:   { label:"Confirmada", bg:"bg-emerald-100 dark:bg-emerald-900/30",text:"text-emerald-700 dark:text-emerald-300",dot:"bg-emerald-500", border:"border-emerald-300" },
  IN_PROGRESS: { label:"En curso",   bg:"bg-blue-100 dark:bg-blue-900/30",      text:"text-blue-700 dark:text-blue-300",      dot:"bg-blue-500",    border:"border-blue-300"    },
  COMPLETED:   { label:"Completada", bg:"bg-slate-100 dark:bg-slate-800",       text:"text-slate-600 dark:text-slate-400",    dot:"bg-slate-400",   border:"border-slate-300"   },
  CANCELLED:   { label:"Cancelada",  bg:"bg-rose-100 dark:bg-rose-900/30",      text:"text-rose-700 dark:text-rose-300",      dot:"bg-rose-500",    border:"border-rose-300"    },
  NO_SHOW:     { label:"No asistió", bg:"bg-orange-100 dark:bg-orange-900/30",  text:"text-orange-700 dark:text-orange-300",  dot:"bg-orange-500",  border:"border-orange-300"  },
};

const DOC_COLORS = [
  { bg:"rgba(37,99,235,0.18)",  border:"rgba(37,99,235,0.6)"  },
  { bg:"rgba(124,58,237,0.18)", border:"rgba(124,58,237,0.6)" },
  { bg:"rgba(5,150,105,0.18)",  border:"rgba(5,150,105,0.6)"  },
  { bg:"rgba(225,29,72,0.18)",  border:"rgba(225,29,72,0.6)"  },
  { bg:"rgba(217,119,6,0.18)",  border:"rgba(217,119,6,0.6)"  },
  { bg:"rgba(8,145,178,0.18)",  border:"rgba(8,145,178,0.6)"  },
  { bg:"rgba(219,39,119,0.18)", border:"rgba(219,39,119,0.6)" },
  { bg:"rgba(67,56,202,0.18)",  border:"rgba(67,56,202,0.6)"  },
];

type ViewMode = "month" | "week" | "day";

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDate(s: string) {
  const [y,m,d] = s.split("T")[0].split("-").map(Number);
  return new Date(y, m-1, d);
}
function addTime(base: string, mins: number) {
  const [h,mi] = base.split(":").map(Number);
  const total = h*60 + mi + mins;
  return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
function serializeAppt(a: any): Appt {
  return { ...a, date: a.date instanceof Date ? a.date.toISOString() : String(a.date) };
}

// ── Improvement 1: Patient search with autocomplete ───────────────────────────
function PatientSearch({ patients, value, onChange }: { patients: Patient[]; value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const filtered = useMemo(() => {
    if (!query) return patients.slice(0, 8);
    const q = query.toLowerCase();
    return patients.filter(p => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.patientNumber?.toLowerCase().includes(q)).slice(0, 8);
  }, [patients, query]);
  const selected = patients.find(p => p.id === value);
  return (
    <div className="relative">
      <div className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 items-center gap-2 cursor-pointer"
        onClick={() => setOpen(true)}>
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        {selected
          ? <span className="text-base font-semibold">{selected.firstName} {selected.lastName}</span>
          : <span className="text-base text-muted-foreground">Buscar paciente…</span>}
        {selected && (
          <button onClick={e => { e.stopPropagation(); onChange(""); setQuery(""); }} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-12 left-0 right-0 bg-white dark:bg-slate-800 border border-border rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-border">
              <input autoFocus className="w-full px-3 py-2 text-base bg-transparent focus:outline-none placeholder:text-muted-foreground"
                placeholder="Nombre o número…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div className="max-h-52 overflow-y-auto">
              {filtered.length === 0
                ? <div className="px-4 py-3 text-base text-muted-foreground">Sin resultados</div>
                : filtered.map(p => (
                  <button key={p.id} onClick={() => { onChange(p.id); setOpen(false); setQuery(""); }}
                    className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {p.firstName[0]}{p.lastName[0]}
                    </div>
                    <div>
                      <div className="text-base font-semibold">{p.firstName} {p.lastName}</div>
                      <div className="text-sm text-muted-foreground">{p.patientNumber}</div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AppointmentsClient({ appointments: initialAppts, patients, doctors, currentUserId, clinicId, waConnected }: Props) {
  const today = new Date();
  const [appts,       setAppts]       = useState<Appt[]>(initialAppts);
  const [view,        setView]        = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string>(toDateStr(today));
  const [showNew,     setShowNew]     = useState(false);
  const [showDetail,  setShowDetail]  = useState<Appt | null>(null);
  const [showEdit,    setShowEdit]    = useState(false);
  const [filterDoc,   setFilterDoc]   = useState<string>("all");
  const [loading,     setLoading]     = useState(false);

  const emptyForm = { patientId:"", doctorId:currentUserId, type:"Consulta general", date:toDateStr(today), startTime:"09:00", durationMins:30, notes:"" };
  const [form, setForm] = useState(emptyForm);
  const setF = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const calDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const days: (Date | null)[] = Array(startOffset).fill(null);
    const daysInMonth = new Date(year, month+1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentDate]);

  const apptsByDate = useMemo(() => {
    const map: Record<string, Appt[]> = {};
    const filtered = filterDoc === "all" ? appts : appts.filter(a => a.doctorId === filterDoc);
    for (const a of filtered) {
      const key = a.date.split("T")[0];
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [appts, filterDoc]);

  // Improvement 2: Doctor colors actually applied to pills
  const docColorMap = useMemo(() => {
    const map: Record<string, typeof DOC_COLORS[0]> = {};
    doctors.forEach((d, i) => { map[d.id] = DOC_COLORS[i % DOC_COLORS.length]; });
    return map;
  }, [doctors]);

  const todayStr     = toDateStr(today);
  const todayAppts   = apptsByDate[todayStr] ?? [];
  const pendingCount = appts.filter(a => a.status === "PENDING").length;
  const monthAppts   = appts.filter(a => {
    const d = parseDate(a.date);
    return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
  });

  function prevPeriod() {
    if (view === "month") setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1));
    else if (view === "week") setCurrentDate(d => new Date(d.getTime() - 7*86400000));
    else setCurrentDate(d => new Date(d.getTime() - 86400000));
  }
  function nextPeriod() {
    if (view === "month") setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1));
    else if (view === "week") setCurrentDate(d => new Date(d.getTime() + 7*86400000));
    else setCurrentDate(d => new Date(d.getTime() + 86400000));
  }

  function openNew(date?: string, time?: string) {
    setForm({ ...emptyForm, date: date ?? toDateStr(today), startTime: time ?? "09:00" });
    setShowNew(true);
  }

  async function createAppt() {
    if (!form.patientId) { toast.error("Selecciona un paciente"); return; }
    setLoading(true);
    try {
      const endTime = addTime(form.startTime, form.durationMins);
      const res = await fetch("/api/appointments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, endTime, clinicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const created = await res.json();
      // FIX: serialize date from API before adding to state
      setAppts(prev => [...prev, serializeAppt(created)]);
      setSelectedDay(form.date);
      setShowNew(false);
      setForm(emptyForm);
      toast.success("✅ Cita agendada");
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  // Improvement 5: Edit existing appointment
  async function saveEdit() {
    if (!showDetail) return;
    setLoading(true);
    try {
      const endTime = addTime(form.startTime, form.durationMins);
      const res = await fetch(`/api/appointments/${showDetail.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, endTime }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      setAppts(prev => prev.map(a => a.id === showDetail.id
        ? serializeAppt({ ...a, ...form, endTime, patient: a.patient, doctor: a.doctor })
        : a));
      setShowEdit(false);
      setShowDetail(null);
      toast.success("Cita actualizada");
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Error");
      setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      setShowDetail(prev => prev?.id === id ? { ...prev, status } : prev);
      toast.success("Estado actualizado");
    } catch { toast.error("Error al actualizar"); }
  }

  async function sendWA(apptId: string) {
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: apptId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAppts(prev => prev.map(a => a.id === apptId ? { ...a, reminderSent: true } : a));
      setShowDetail(prev => prev?.id === apptId ? { ...prev, reminderSent: true } : prev);
      toast.success("WhatsApp enviado");
    } catch (err: any) { toast.error(err.message); }
  }

  // FIX: Verify API response before removing from state
  async function deleteAppt(id: string) {
    if (!confirm("¿Cancelar esta cita?")) return;
    try {
      const res = await fetch(`/api/appointments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al cancelar");
      setAppts(prev => prev.filter(a => a.id !== id));
      setShowDetail(null);
      toast.success("Cita cancelada");
    } catch (err: any) { toast.error(err.message); }
  }

  // Improvement 2+3: Pills with doctor color + notes visible
  const ApptPill = ({ appt, compact = false }: { appt: Appt; compact?: boolean }) => {
    const cfg   = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.PENDING;
    const color = docColorMap[appt.doctorId] ?? DOC_COLORS[0];
    return (
      <button onClick={e => { e.stopPropagation(); setShowDetail(appt); }}
        className={`w-full text-left rounded-lg px-2 py-1 mb-0.5 hover:opacity-80 transition-opacity ${compact ? "text-[11px]" : "text-xs"}`}
        style={{ background: color.bg, border: `1px solid ${color.border}` }}>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
          <span className="font-bold text-foreground truncate">{appt.startTime} {appt.patient.firstName}</span>
        </div>
        {!compact && appt.notes && (
          <div className="text-muted-foreground truncate pl-3 mt-0.5">{appt.notes}</div>
        )}
      </button>
    );
  };

  const MonthView = () => (
    <div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/20">
        {DAYS_ES.map(d => (
          <div key={d} className="py-3 text-center text-sm font-bold text-muted-foreground uppercase tracking-wider">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ minHeight: 500 }}>
        {calDays.map((day, idx) => {
          if (!day) return <div key={idx} className="border-r border-b border-border bg-muted/5 min-h-[100px]" />;
          const ds       = toDateStr(day);
          const dayAppts = (apptsByDate[ds] ?? []).sort((a,b) => a.startTime.localeCompare(b.startTime));
          const isToday  = ds === todayStr;
          const isSel    = ds === selectedDay;
          return (
            <div key={idx} onClick={() => setSelectedDay(ds)}
              className={`border-r border-b border-border min-h-[100px] p-1.5 cursor-pointer transition-colors
                ${isSel && !isToday ? "bg-brand-50 dark:bg-brand-950/20" : "hover:bg-muted/20"}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold
                  ${isToday ? "bg-brand-600 text-white" : "text-foreground"}`}>
                  {day.getDate()}
                </span>
                {dayAppts.length > 0 && (
                  <span className="text-xs font-bold text-muted-foreground bg-muted rounded-full w-5 h-5 flex items-center justify-center">
                    {dayAppts.length}
                  </span>
                )}
              </div>
              {dayAppts.slice(0, 3).map(a => <ApptPill key={a.id} appt={a} compact />)}
              {dayAppts.length > 3 && <div className="text-[11px] text-brand-600 font-semibold pl-1">+{dayAppts.length-3} más</div>}
            </div>
          );
        })}
      </div>
    </div>
  );

  const WeekView = () => {
    const dow      = (currentDate.getDay() + 6) % 7;
    const weekStart= new Date(currentDate.getTime() - dow * 86400000);
    const weekDays = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));
    return (
      <div>
        <div className="grid grid-cols-8 border-b border-border bg-muted/20">
          <div className="py-3 border-r border-border" />
          {weekDays.map((d, i) => {
            const ds = toDateStr(d); const isToday = ds === todayStr; const cnt = (apptsByDate[ds]??[]).length;
            return (
              <div key={i} className={`py-3 text-center border-r border-border ${isToday?"bg-brand-50 dark:bg-brand-950/20":""}`}>
                <div className="text-xs font-bold text-muted-foreground uppercase">{DAYS_ES[i]}</div>
                <div className={`text-xl font-bold ${isToday?"text-brand-600":""}`}>{d.getDate()}</div>
                {cnt > 0 && <div className="text-xs text-muted-foreground">{cnt} cita{cnt>1?"s":""}</div>}
              </div>
            );
          })}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
          {HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-8 border-b border-border/40" style={{ minHeight: 64 }}>
              <div className="border-r border-border px-3 py-2"><span className="text-sm text-muted-foreground font-mono">{hour}</span></div>
              {weekDays.map((d, i) => {
                const ds = toDateStr(d);
                const slotAppts = (apptsByDate[ds]??[]).filter(a => a.startTime.startsWith(hour.slice(0,2)));
                return (
                  <div key={i} onClick={() => { setSelectedDay(ds); openNew(ds, hour); }}
                    className="border-r border-border p-0.5 cursor-pointer hover:bg-muted/20 transition-colors">
                    {slotAppts.map(a => <ApptPill key={a.id} appt={a} />)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const DayView = () => {
    const ds = toDateStr(currentDate);
    const dayAppts = (apptsByDate[ds]??[]).sort((a,b) => a.startTime.localeCompare(b.startTime));
    return (
      <div className="overflow-y-auto" style={{ maxHeight: 560 }}>
        {HOURS.map(hour => {
          const slotAppts = dayAppts.filter(a => a.startTime.startsWith(hour.slice(0,2)));
          return (
            <div key={hour} className="flex border-b border-border/40" style={{ minHeight: 72 }}>
              <div className="w-20 flex-shrink-0 px-3 py-3 border-r border-border">
                <span className="text-base text-muted-foreground font-mono">{hour}</span>
              </div>
              <div onClick={() => openNew(ds, hour)} className="flex-1 p-1.5 cursor-pointer hover:bg-muted/10 transition-colors">
                {slotAppts.map(a => {
                  const cfg   = STATUS_CONFIG[a.status]??STATUS_CONFIG.PENDING;
                  const color = docColorMap[a.doctorId]??DOC_COLORS[0];
                  return (
                    <button key={a.id} onClick={e => { e.stopPropagation(); setShowDetail(a); }}
                      className="w-full text-left rounded-xl px-4 py-3 mb-1.5 hover:opacity-90 transition-all"
                      style={{ background: color.bg, border: `1.5px solid ${color.border}` }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                        <span className="text-base font-bold">{a.startTime} – {a.endTime}</span>
                        <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} ml-auto`}>{cfg.label}</span>
                        {/* Improvement 4: Google Calendar indicator */}
                        {a.googleCalendarEventId && <CalendarCheck className="w-4 h-4 text-brand-500" title="Sincronizado con Google Calendar" />}
                        {a.reminderSent && <MessageCircle className="w-4 h-4 text-emerald-500" title="Recordatorio enviado" />}
                      </div>
                      <div className="text-lg font-bold mt-1">{a.patient.firstName} {a.patient.lastName}</div>
                      <div className="text-sm text-muted-foreground">{a.type} · Dr/a. {a.doctor.firstName} {a.doctor.lastName} · {a.durationMins} min</div>
                      {/* Improvement 3: Notes visible in pill */}
                      {a.notes && <div className="text-sm text-muted-foreground italic mt-0.5">📝 {a.notes}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const selDate  = parseDate(selectedDay);
  const selAppts = (apptsByDate[selectedDay]??[]).sort((a,b) => a.startTime.localeCompare(b.startTime));

  // Shared form for new and edit
  const ApptForm = ({ onSubmit, label }: { onSubmit: () => void; label: string }) => (
    <div className="px-6 py-5 space-y-4">
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Paciente *</Label>
        <PatientSearch patients={patients} value={form.patientId} onChange={id => setF("patientId", id)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Doctor *</Label>
        <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          value={form.doctorId} onChange={e => setF("doctorId", e.target.value)}>
          {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Tipo de cita</Label>
        <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          value={form.type} onChange={e => setF("type", e.target.value)}>
          {APPT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 space-y-1.5">
          <Label className="text-base font-semibold">Fecha</Label>
          <input type="date" className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            value={form.date} onChange={e => setF("date", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Hora inicio</Label>
          <input type="time" className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            value={form.startTime} onChange={e => setF("startTime", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Duración</Label>
          <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
            value={form.durationMins} onChange={e => setF("durationMins", parseInt(e.target.value))}>
            {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Hora fin</Label>
          <input readOnly className="flex h-11 w-full rounded-xl border border-border bg-muted px-4 text-base text-muted-foreground"
            value={addTime(form.startTime, form.durationMins)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Notas</Label>
        <textarea className="flex min-h-[80px] w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Motivo de consulta, indicaciones especiales…"
          value={form.notes} onChange={e => setF("notes", e.target.value)} />
      </div>
      <div className="flex gap-3 pt-1">
        <Button variant="outline" onClick={() => { setShowNew(false); setShowEdit(false); }} className="flex-1 h-12 text-base">Cancelar</Button>
        <Button onClick={onSubmit} disabled={loading} className="flex-1 h-12 text-base">{loading ? "Guardando…" : label}</Button>
      </div>
    </div>
  );

  return (
    <div className="flex gap-5 h-full">
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button onClick={prevPeriod} className="p-2.5 rounded-xl hover:bg-muted transition-colors"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={nextPeriod} className="p-2.5 rounded-xl hover:bg-muted transition-colors"><ChevronRight className="w-5 h-5" /></button>
            <h1 className="text-xl font-extrabold ml-1">
              {view==="month" ? `${MONTHS_ES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
               : view==="week" ? `Semana del ${currentDate.getDate()} de ${MONTHS_ES[currentDate.getMonth()]}`
               : `${currentDate.getDate()} de ${MONTHS_ES[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
            </h1>
            <button onClick={() => { setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(todayStr); }}
              className="text-sm font-bold text-brand-600 hover:underline ml-1">Hoy</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterDoc} onChange={e => setFilterDoc(e.target.value)}
              className="h-11 rounded-xl border border-border bg-white dark:bg-slate-900 px-3 text-base focus:outline-none">
              <option value="all">Todos los doctores</option>
              {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
            </select>
            <div className="flex bg-muted rounded-xl p-1 gap-0.5">
              {([["month","Mes",<Calendar key="c" className="w-4 h-4"/>],["week","Sem",<CalendarDays key="cd" className="w-4 h-4"/>],["day","Día",<List key="l" className="w-4 h-4"/>]] as const).map(([v, lbl, icon]) => (
                <button key={v} onClick={() => { setView(v as ViewMode); if (v!=="month") setCurrentDate(today); }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${view===v?"bg-white dark:bg-slate-800 shadow-sm":"text-muted-foreground hover:text-foreground"}`}>
                  {icon} {lbl}
                </button>
              ))}
            </div>
            <Button onClick={() => openNew(selectedDay)}>
              <Plus className="w-5 h-5 mr-1.5" /> Nueva cita
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label:"Citas hoy",   val:todayAppts.length,                              color:"text-brand-600"   },
            { label:"Este mes",    val:monthAppts.length,                              color:"text-foreground"  },
            { label:"Pendientes",  val:pendingCount,                                   color:"text-amber-600"   },
            { label:"Completadas", val:appts.filter(a=>a.status==="COMPLETED").length, color:"text-emerald-600" },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-slate-900 border border-border rounded-2xl px-4 py-3 shadow-card">
              <div className={`text-3xl font-extrabold ${s.color}`}>{s.val}</div>
              <div className="text-base text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden">
          {view==="month" && <MonthView />}
          {view==="week"  && <WeekView  />}
          {view==="day"   && <DayView   />}
        </div>
      </div>

      {/* Side panel */}
      <div className="w-72 flex-shrink-0">
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-base font-bold">{DAYS_ES[(selDate.getDay()+6)%7]} {selDate.getDate()} {MONTHS_ES[selDate.getMonth()]}</div>
              <div className="text-sm text-muted-foreground">{selAppts.length} cita{selAppts.length!==1?"s":""}</div>
            </div>
            <button onClick={() => openNew(selectedDay)}
              className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700 transition-colors">
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="divide-y divide-border/50 max-h-[calc(100vh-260px)] overflow-y-auto">
            {selAppts.length === 0 ? (
              <div className="px-4 py-10 text-center text-muted-foreground">
                <Calendar className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <div className="text-base font-semibold">Sin citas</div>
                <button onClick={() => openNew(selectedDay)} className="mt-2 text-base text-brand-600 hover:underline font-semibold">+ Agregar</button>
              </div>
            ) : selAppts.map(appt => {
              const cfg   = STATUS_CONFIG[appt.status]??STATUS_CONFIG.PENDING;
              return (
                <button key={appt.id} onClick={() => setShowDetail(appt)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="text-base font-bold">{appt.startTime}</span>
                    <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                  </div>
                  <div className="text-base font-bold truncate">{appt.patient.firstName} {appt.patient.lastName}</div>
                  <div className="text-sm text-muted-foreground">{appt.type} · {appt.durationMins} min</div>
                  {appt.notes && <div className="text-sm text-muted-foreground/70 truncate italic mt-0.5">📝 {appt.notes}</div>}
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {appt.googleCalendarEventId && <span className="text-xs text-brand-600 font-semibold flex items-center gap-1"><CalendarCheck className="w-3 h-3"/>Google Cal</span>}
                    {appt.reminderSent && <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><MessageCircle className="w-3 h-3"/>WA enviado</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* New appointment modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h2 className="text-xl font-bold">Nueva cita</h2>
              <button onClick={() => setShowNew(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <ApptForm onSubmit={createAppt} label="✅ Agendar cita" />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h2 className="text-xl font-bold">Editar cita</h2>
              <button onClick={() => setShowEdit(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <ApptForm onSubmit={saveEdit} label="💾 Guardar cambios" />
          </div>
        </div>
      )}

      {/* Detail modal */}
      {showDetail && !showEdit && (() => {
        const appt  = showDetail;
        const cfg   = STATUS_CONFIG[appt.status]??STATUS_CONFIG.PENDING;
        const color = docColorMap[appt.doctorId]??DOC_COLORS[0];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border" style={{ borderLeftWidth:4, borderLeftColor:color.border }}>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${cfg.dot}`} />
                  <h2 className="text-xl font-bold">{appt.type}</h2>
                </div>
                <div className="flex items-center gap-1">
                  {/* Improvement 5: Edit button in detail */}
                  <button onClick={() => {
                    setForm({ patientId:appt.patientId, doctorId:appt.doctorId, type:appt.type,
                      date:appt.date.split("T")[0], startTime:appt.startTime, durationMins:appt.durationMins, notes:appt.notes??""
                    });
                    setShowEdit(true);
                  }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Editar cita">
                    <Edit className="w-5 h-5" />
                  </button>
                  <button onClick={() => setShowDetail(null)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background:color.bg, border:`1px solid ${color.border}` }}>
                  <div className="w-12 h-12 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                    {appt.patient.firstName[0]}{appt.patient.lastName[0]}
                  </div>
                  <div>
                    <div className="text-lg font-bold">{appt.patient.firstName} {appt.patient.lastName}</div>
                    {appt.patient.phone && <div className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5"><Phone className="w-4 h-4"/>{appt.patient.phone}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label:"Fecha",    val:parseDate(appt.date).toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"}) },
                    { label:"Horario",  val:`${appt.startTime} – ${appt.endTime}` },
                    { label:"Doctor",   val:`Dr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}` },
                    { label:"Duración", val:`${appt.durationMins} minutos` },
                  ].map(r => (
                    <div key={r.label} className="bg-muted/20 rounded-xl p-3">
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{r.label}</div>
                      <div className="text-sm font-bold">{r.val}</div>
                    </div>
                  ))}
                </div>
                {/* Improvement 4: Google Calendar badge in detail */}
                <div className="flex gap-2 flex-wrap">
                  {appt.googleCalendarEventId && (
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 px-3 py-1.5 rounded-full">
                      <CalendarCheck className="w-4 h-4"/> Sincronizado con Google Calendar
                    </div>
                  )}
                  {appt.reminderSent && (
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 px-3 py-1.5 rounded-full">
                      <MessageCircle className="w-4 h-4"/> Recordatorio WhatsApp enviado
                    </div>
                  )}
                </div>
                {appt.notes && (
                  <div className="bg-muted/20 rounded-xl p-4">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">📝 Notas</div>
                    <div className="text-base">{appt.notes}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Cambiar estado</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(STATUS_CONFIG).map(([s,c]) => (
                      <button key={s} onClick={() => updateStatus(appt.id,s)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all ${appt.status===s?`${c.bg} ${c.text} ${c.border}`:"border-border hover:bg-muted"}`}>
                        <div className={`w-2 h-2 rounded-full ${c.dot}`}/>{c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 pb-5 flex gap-2">
                {waConnected && (
                  <Button variant="outline" onClick={() => sendWA(appt.id)} disabled={appt.reminderSent}
                    className="flex-1 h-11 gap-2 text-sm border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    <MessageCircle className="w-4 h-4"/>{appt.reminderSent?"WA enviado ✓":"Enviar WhatsApp"}
                  </Button>
                )}
                <Button variant="outline" onClick={() => deleteAppt(appt.id)}
                  className="flex-1 h-11 gap-2 text-sm border-rose-300 text-rose-700 hover:bg-rose-50">
                  <Ban className="w-4 h-4"/> Cancelar cita
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
