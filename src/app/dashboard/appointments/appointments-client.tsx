"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, User,
  Phone, MessageCircle, Check, AlertCircle, Ban,
  Calendar, List, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Patient { id: string; firstName: string; lastName: string; patientNumber: string; phone?: string | null }
interface Doctor  { id: string; firstName: string; lastName: string; role: string }
interface Appt {
  id: string; patientId: string; doctorId: string; type: string;
  date: string; startTime: string; endTime: string; durationMins: number;
  status: string; notes?: string | null; reminderSent: boolean;
  patient: { id: string; firstName: string; lastName: string; phone?: string | null };
  doctor:  { id: string; firstName: string; lastName: string };
}

interface Props {
  appointments: Appt[]; patients: Patient[]; doctors: Doctor[];
  currentUserId: string; clinicId: string; waConnected: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS_ES   = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const HOURS     = Array.from({ length: 13 }, (_, i) => `${(i + 8).toString().padStart(2,"0")}:00`); // 08:00–20:00
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];

const APPT_TYPES = [
  "Consulta general","Primera vez","Revisión / Control","Limpieza dental","Extracción",
  "Endodoncia","Ortodoncia","Implante","Cirugía","Nutrición","Psicología","Seguimiento","Otro",
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  PENDING:     { label:"Pendiente",   bg:"bg-amber-100 dark:bg-amber-900/30",   text:"text-amber-700 dark:text-amber-300",   dot:"bg-amber-500"   },
  CONFIRMED:   { label:"Confirmada",  bg:"bg-emerald-100 dark:bg-emerald-900/30",text:"text-emerald-700 dark:text-emerald-300",dot:"bg-emerald-500" },
  IN_PROGRESS: { label:"En curso",    bg:"bg-blue-100 dark:bg-blue-900/30",     text:"text-blue-700 dark:text-blue-300",     dot:"bg-blue-500"    },
  COMPLETED:   { label:"Completada",  bg:"bg-slate-100 dark:bg-slate-800",      text:"text-slate-600 dark:text-slate-400",   dot:"bg-slate-400"   },
  CANCELLED:   { label:"Cancelada",   bg:"bg-rose-100 dark:bg-rose-900/30",     text:"text-rose-700 dark:text-rose-300",     dot:"bg-rose-500"    },
  NO_SHOW:     { label:"No asistió",  bg:"bg-orange-100 dark:bg-orange-900/30", text:"text-orange-700 dark:text-orange-300", dot:"bg-orange-500"  },
};

// Doctor colors for calendar
const DOCTOR_COLORS = [
  "bg-blue-500","bg-violet-500","bg-emerald-500","bg-rose-500",
  "bg-amber-500","bg-cyan-500","bg-pink-500","bg-indigo-500",
];

type ViewMode = "month" | "week" | "day";

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Main Component ───────────────────────────────────────────────────────────
export function AppointmentsClient({ appointments: initialAppts, patients, doctors, currentUserId, clinicId, waConnected }: Props) {
  const today = new Date();
  const [appts,       setAppts]       = useState<Appt[]>(initialAppts);
  const [view,        setView]        = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string>(toDateStr(today));
  const [showNew,     setShowNew]     = useState(false);
  const [showDetail,  setShowDetail]  = useState<Appt | null>(null);
  const [filterDoc,   setFilterDoc]   = useState<string>("all");
  const [loading,     setLoading]     = useState(false);

  // New appointment form
  const [form, setForm] = useState({
    patientId: "", doctorId: currentUserId, type: "Consulta general",
    date: toDateStr(today), startTime: "09:00", durationMins: 30, notes: "",
  });
  const setF = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  // ── Calendar grid (month view) ──────────────────────────────────────────────
  const calDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const first = new Date(year, month, 1);
    // Week starts Monday: getDay() 0=Sun → 6, 1=Mon → 0
    const startOffset = (first.getDay() + 6) % 7;
    const days: (Date | null)[] = Array(startOffset).fill(null);
    const daysInMonth = new Date(year, month+1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentDate]);

  // ── Appointment map by date ──────────────────────────────────────────────────
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

  // Doctor color map
  const docColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    doctors.forEach((d, i) => { map[d.id] = DOCTOR_COLORS[i % DOCTOR_COLORS.length]; });
    return map;
  }, [doctors]);

  // ── Stats ────────────────────────────────────────────────────────────────────
  const todayStr = toDateStr(today);
  const todayAppts   = apptsByDate[todayStr] ?? [];
  const pendingCount = appts.filter(a => a.status === "PENDING").length;
  const monthAppts   = appts.filter(a => {
    const d = parseDate(a.date);
    return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
  });

  // ── Navigation ────────────────────────────────────────────────────────────────
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

  // ── Create appointment ────────────────────────────────────────────────────────
  async function createAppt() {
    if (!form.patientId) { toast.error("Selecciona un paciente"); return; }
    if (!form.doctorId)  { toast.error("Selecciona un doctor");   return; }
    setLoading(true);
    try {
      const endTime = addTime(form.startTime, form.durationMins);
      const res = await fetch("/api/appointments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, endTime, clinicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const created = await res.json();
      setAppts(prev => [...prev, created]);
      setShowNew(false);
      setForm({ patientId:"", doctorId:currentUserId, type:"Consulta general", date:toDateStr(today), startTime:"09:00", durationMins:30, notes:"" });
      setSelectedDay(form.date);
      toast.success("Cita agendada");
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  // ── Update status ────────────────────────────────────────────────────────────
  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const updated = await res.json();
      setAppts(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
      setShowDetail(prev => prev?.id === id ? { ...prev, status } : prev);
      toast.success("Estado actualizado");
    } catch { toast.error("Error"); }
  }

  // ── Send WhatsApp ────────────────────────────────────────────────────────────
  async function sendWA(apptId: string) {
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: apptId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAppts(prev => prev.map(a => a.id === apptId ? { ...a, reminderSent: true } : a));
      toast.success("Recordatorio enviado por WhatsApp");
    } catch (err: any) { toast.error(err.message); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteAppt(id: string) {
    if (!confirm("¿Cancelar esta cita?")) return;
    await fetch(`/api/appointments/${id}`, { method: "DELETE" });
    setAppts(prev => prev.filter(a => a.id !== id));
    setShowDetail(null);
    toast.success("Cita cancelada");
  }

  // ─── Render appointment pill ─────────────────────────────────────────────────
  const ApptPill = ({ appt, compact = false }: { appt: Appt; compact?: boolean }) => {
    const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.PENDING;
    const color = docColorMap[appt.doctorId] ?? "bg-brand-500";
    return (
      <button onClick={() => setShowDetail(appt)}
        className={`w-full text-left rounded-lg px-2 py-1 mb-0.5 flex items-center gap-1.5 hover:opacity-80 transition-opacity ${compact ? "text-[10px]" : "text-xs"}`}
        style={{ background: "rgba(37,99,235,0.15)", border: "1px solid rgba(37,99,235,0.3)" }}>
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="font-semibold text-foreground truncate">{appt.startTime} {appt.patient.firstName}</span>
      </button>
    );
  };

  // ─── Month view ──────────────────────────────────────────────────────────────
  const MonthView = () => (
    <div>
      <div className="grid grid-cols-7 border-b border-border">
        {DAYS_ES.map(d => (
          <div key={d} className="py-2 text-center text-xs font-bold text-muted-foreground uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ minHeight: 480 }}>
        {calDays.map((day, idx) => {
          if (!day) return <div key={idx} className="border-r border-b border-border bg-muted/10 min-h-[90px]" />;
          const ds    = toDateStr(day);
          const dayAppts = (apptsByDate[ds] ?? []).sort((a,b) => a.startTime.localeCompare(b.startTime));
          const isToday = ds === todayStr;
          const isSel   = ds === selectedDay;
          const isOtherMonth = day.getMonth() !== currentDate.getMonth();
          return (
            <div key={idx}
              onClick={() => { setSelectedDay(ds); }}
              className={`border-r border-b border-border min-h-[90px] p-1 cursor-pointer transition-colors
                ${isOtherMonth ? "bg-muted/10 opacity-50" : ""}
                ${isSel && !isToday ? "bg-brand-50 dark:bg-brand-950/20" : ""}
                hover:bg-muted/20`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold
                  ${isToday ? "bg-brand-600 text-white" : "text-foreground"}`}>
                  {day.getDate()}
                </span>
                {dayAppts.length > 0 && (
                  <span className="text-[10px] font-bold text-muted-foreground">{dayAppts.length}</span>
                )}
              </div>
              <div>
                {dayAppts.slice(0, 3).map(a => <ApptPill key={a.id} appt={a} compact />)}
                {dayAppts.length > 3 && (
                  <div className="text-[10px] text-muted-foreground pl-1">+{dayAppts.length-3} más</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ─── Week view ───────────────────────────────────────────────────────────────
  const WeekView = () => {
    // Get week starting Monday
    const dow = (currentDate.getDay() + 6) % 7;
    const weekStart = new Date(currentDate.getTime() - dow * 86400000);
    const weekDays = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));

    return (
      <div>
        <div className="grid grid-cols-8 border-b border-border">
          <div className="py-2 border-r border-border" />
          {weekDays.map((d, i) => {
            const ds = toDateStr(d);
            const isToday = ds === todayStr;
            return (
              <div key={i} className={`py-2 text-center border-r border-border ${isToday ? "bg-brand-50 dark:bg-brand-950/20" : ""}`}>
                <div className="text-xs text-muted-foreground uppercase">{DAYS_ES[i]}</div>
                <div className={`text-lg font-bold ${isToday ? "text-brand-600" : ""}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 500 }}>
          {HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-8 border-b border-border/40" style={{ minHeight: 60 }}>
              <div className="border-r border-border px-2 py-1">
                <span className="text-xs text-muted-foreground">{hour}</span>
              </div>
              {weekDays.map((d, i) => {
                const ds = toDateStr(d);
                const slotAppts = (apptsByDate[ds] ?? []).filter(a => a.startTime.startsWith(hour.slice(0,2)));
                return (
                  <div key={i}
                    onClick={() => { setSelectedDay(ds); setForm(f => ({ ...f, date: ds, startTime: hour })); setShowNew(true); }}
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

  // ─── Day view ────────────────────────────────────────────────────────────────
  const DayView = () => {
    const ds = toDateStr(currentDate);
    const dayAppts = (apptsByDate[ds] ?? []).sort((a,b) => a.startTime.localeCompare(b.startTime));
    return (
      <div className="overflow-y-auto" style={{ maxHeight: 540 }}>
        {HOURS.map(hour => {
          const slotAppts = dayAppts.filter(a => a.startTime.startsWith(hour.slice(0,2)));
          return (
            <div key={hour} className="flex border-b border-border/40" style={{ minHeight: 64 }}>
              <div className="w-16 flex-shrink-0 px-2 py-2 border-r border-border">
                <span className="text-sm text-muted-foreground">{hour}</span>
              </div>
              <div onClick={() => { setForm(f => ({ ...f, date: ds, startTime: hour })); setShowNew(true); }}
                className="flex-1 p-1 cursor-pointer hover:bg-muted/10 transition-colors">
                {slotAppts.map(a => {
                  const cfg = STATUS_CONFIG[a.status] ?? STATUS_CONFIG.PENDING;
                  return (
                    <button key={a.id} onClick={e => { e.stopPropagation(); setShowDetail(a); }}
                      className={`w-full text-left rounded-xl px-3 py-2 mb-1 ${cfg.bg}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        <span className="text-sm font-bold">{a.startTime} – {a.endTime}</span>
                        <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                        {a.reminderSent && <MessageCircle className="w-3.5 h-3.5 text-emerald-500 ml-auto" />}
                      </div>
                      <div className="text-base font-bold mt-0.5">{a.patient.firstName} {a.patient.lastName}</div>
                      <div className="text-sm text-muted-foreground">{a.type} · Dr/a. {a.doctor.firstName} {a.doctor.lastName}</div>
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

  // ─── Selected day panel ───────────────────────────────────────────────────────
  const selAppts = (apptsByDate[selectedDay] ?? []).sort((a,b) => a.startTime.localeCompare(b.startTime));
  const selDate  = parseDate(selectedDay);

  return (
    <div className="flex gap-5 h-full">

      {/* ── Main calendar area ── */}
      <div className="flex-1 min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={prevPeriod} className="p-2 rounded-xl hover:bg-muted transition-colors"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={nextPeriod} className="p-2 rounded-xl hover:bg-muted transition-colors"><ChevronRight className="w-5 h-5" /></button>
            </div>
            <h1 className="text-xl font-extrabold">
              {view === "month" ? `${MONTHS_ES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
               : view === "week" ? `Semana del ${currentDate.getDate()} de ${MONTHS_ES[currentDate.getMonth()]}`
               : `${currentDate.getDate()} de ${MONTHS_ES[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
            </h1>
            <button onClick={() => { setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(todayStr); }}
              className="text-sm font-semibold text-brand-600 hover:underline">Hoy</button>
          </div>

          <div className="flex items-center gap-2">
            {/* Doctor filter */}
            <select value={filterDoc} onChange={e => setFilterDoc(e.target.value)}
              className="h-10 rounded-xl border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none">
              <option value="all">Todos los doctores</option>
              {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
            </select>

            {/* View switcher */}
            <div className="flex bg-muted rounded-xl p-1 gap-0.5">
              {([["month","Mes",<Calendar key="c" className="w-4 h-4"/>],["week","Sem",<CalendarDays key="cd" className="w-4 h-4"/>],["day","Día",<List key="l" className="w-4 h-4"/>]] as const).map(([v, label, icon]) => (
                <button key={v} onClick={() => { setView(v as ViewMode); setCurrentDate(v === "month" ? new Date(today.getFullYear(), today.getMonth(), 1) : today); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${view === v ? "bg-white dark:bg-slate-800 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {icon} {label}
                </button>
              ))}
            </div>

            <Button onClick={() => setShowNew(true)}>
              <Plus className="w-5 h-5 mr-1.5" /> Nueva cita
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label:"Hoy",          val: todayAppts.length,  color:"text-brand-600"   },
            { label:"Este mes",     val: monthAppts.length,  color:"text-foreground"  },
            { label:"Pendientes",   val: pendingCount,       color:"text-amber-600"   },
            { label:"Completadas",  val: appts.filter(a=>a.status==="COMPLETED").length, color:"text-emerald-600" },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-slate-900 border border-border rounded-xl px-4 py-3 shadow-card">
              <div className={`text-2xl font-extrabold ${s.color}`}>{s.val}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Calendar */}
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden">
          {view === "month" && <MonthView />}
          {view === "week"  && <WeekView  />}
          {view === "day"   && <DayView   />}
        </div>
      </div>

      {/* ── Side panel: selected day ── */}
      <div className="w-72 flex-shrink-0">
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-sm font-bold">
                {DAYS_ES[(selDate.getDay() + 6) % 7]} {selDate.getDate()} {MONTHS_ES[selDate.getMonth()]}
              </div>
              <div className="text-xs text-muted-foreground">{selAppts.length} cita{selAppts.length !== 1 ? "s" : ""}</div>
            </div>
            <button onClick={() => { setForm(f => ({ ...f, date: selectedDay })); setShowNew(true); }}
              className="w-8 h-8 rounded-xl bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700 transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="divide-y divide-border/50 max-h-[calc(100vh-240px)] overflow-y-auto">
            {selAppts.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground">
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div className="text-sm">Sin citas este día</div>
                <button onClick={() => { setForm(f => ({ ...f, date: selectedDay })); setShowNew(true); }}
                  className="mt-2 text-sm text-brand-600 hover:underline font-semibold">
                  + Agregar cita
                </button>
              </div>
            ) : selAppts.map(appt => {
              const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.PENDING;
              return (
                <button key={appt.id} onClick={() => setShowDetail(appt)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <span className="text-sm font-bold">{appt.startTime}</span>
                    <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                  </div>
                  <div className="text-base font-bold truncate">{appt.patient.firstName} {appt.patient.lastName}</div>
                  <div className="text-sm text-muted-foreground">{appt.type}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Dr/a. {appt.doctor.firstName} · {appt.durationMins} min</div>
                  {appt.reminderSent && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-emerald-600 font-semibold">
                      <MessageCircle className="w-3 h-3" /> Recordatorio enviado
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── New appointment modal ── */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900">
              <h2 className="text-lg font-bold">Nueva cita</h2>
              <button onClick={() => setShowNew(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Paciente *</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={form.patientId} onChange={e => setF("patientId", e.target.value)}>
                  <option value="">Seleccionar paciente…</option>
                  {patients.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.patientNumber})</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Doctor *</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={form.doctorId} onChange={e => setF("doctorId", e.target.value)}>
                  {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Tipo de cita</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={form.type} onChange={e => setF("type", e.target.value)}>
                  {APPT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3 space-y-1.5">
                  <Label className="text-sm">Fecha</Label>
                  <input type="date" className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={form.date} onChange={e => setF("date", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Hora inicio</Label>
                  <input type="time" className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={form.startTime} onChange={e => setF("startTime", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Duración</Label>
                  <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                    value={form.durationMins} onChange={e => setF("durationMins", parseInt(e.target.value))}>
                    {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Hora fin</Label>
                  <input readOnly className="flex h-11 w-full rounded-xl border border-border bg-muted px-4 text-base text-muted-foreground"
                    value={addTime(form.startTime, form.durationMins)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Notas (opcional)</Label>
                <textarea className="flex min-h-[70px] w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Indicaciones especiales, motivo de consulta…"
                  value={form.notes} onChange={e => setF("notes", e.target.value)} />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowNew(false)} className="flex-1 h-11 text-base">Cancelar</Button>
              <Button onClick={createAppt} disabled={loading} className="flex-1 h-11 text-base">
                {loading ? "Agendando…" : "✅ Agendar cita"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Appointment detail modal ── */}
      {showDetail && (() => {
        const appt = showDetail;
        const cfg  = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.PENDING;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${cfg.dot}`} />
                  <h2 className="text-lg font-bold">{appt.type}</h2>
                </div>
                <button onClick={() => setShowDetail(null)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
              </div>

              <div className="px-6 py-4 space-y-4">
                {/* Patient */}
                <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {appt.patient.firstName[0]}{appt.patient.lastName[0]}
                  </div>
                  <div>
                    <div className="text-base font-bold">{appt.patient.firstName} {appt.patient.lastName}</div>
                    {appt.patient.phone && <div className="text-sm text-muted-foreground flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{appt.patient.phone}</div>}
                  </div>
                </div>

                {/* Info */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label:"Fecha",   val: parseDate(appt.date).toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long" }) },
                    { label:"Horario", val: `${appt.startTime} – ${appt.endTime}` },
                    { label:"Doctor",  val: `Dr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}` },
                    { label:"Duración",val: `${appt.durationMins} minutos` },
                  ].map(r => (
                    <div key={r.label} className="space-y-0.5">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{r.label}</div>
                      <div className="font-semibold">{r.val}</div>
                    </div>
                  ))}
                </div>

                {appt.notes && (
                  <div className="bg-muted/20 rounded-xl p-3 text-sm">
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Notas</div>
                    <div>{appt.notes}</div>
                  </div>
                )}

                {/* Status */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Estado</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(STATUS_CONFIG).map(([s, c]) => (
                      <button key={s} onClick={() => updateStatus(appt.id, s)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${appt.status === s ? `${c.bg} ${c.text} border-transparent` : "border-border hover:bg-muted"}`}>
                        <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 pb-5 flex flex-wrap gap-2">
                {waConnected && (
                  <Button variant="outline" onClick={() => sendWA(appt.id)} disabled={appt.reminderSent}
                    className="flex-1 gap-2 text-sm border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    <MessageCircle className="w-4 h-4" />
                    {appt.reminderSent ? "Recordatorio enviado" : "Enviar WhatsApp"}
                  </Button>
                )}
                <Button variant="outline" onClick={() => deleteAppt(appt.id)}
                  className="flex-1 gap-2 text-sm border-rose-300 text-rose-700 hover:bg-rose-50">
                  <Ban className="w-4 h-4" /> Cancelar cita
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
