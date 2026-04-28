"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft, ChevronRight, Plus, X,
  Phone, MessageCircle, Ban,
  Calendar, List, CalendarDays, Search,
  Edit, CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { getApptColors } from "@/lib/appointment-colors";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Patient { id: string; firstName: string; lastName: string; patientNumber: string; phone?: string | null }
interface Doctor  { id: string; firstName: string; lastName: string; role: string }
interface Appt {
  id: string; patientId: string; doctorId: string; type: string;
  date: string; startTime: string; endTime: string; durationMins: number;
  status: string; notes?: string | null; reminderSent: boolean;
  googleCalendarEventId?: string | null;
  mode?: string; paymentStatus?: string;
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
  COMPLETED:   { label:"Completada", bg:"bg-muted",       text:"text-muted-foreground",    dot:"bg-muted",   border:"border-border"   },
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
      <div className="flex h-11 w-full rounded-xl border border-border bg-card px-4 items-center gap-2 cursor-pointer"
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
          <div className="absolute z-20 top-12 left-0 right-0 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
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

// ── ApptForm — defined OUTSIDE main component to prevent focus loss ──────────
interface ApptFormProps {
  form: { patientId: string; doctorId: string; type: string; date: string; startTime: string; durationMins: number; notes: string; mode: string };
  setForm: React.Dispatch<React.SetStateAction<any>>;
  doctors: { id: string; firstName: string; lastName: string }[];
  patients: Patient[];
  loading: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  label: string;
}

function ApptForm({ form, setForm, doctors, patients, loading, onSubmit, onCancel, label }: ApptFormProps) {
  function setF(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  return (
    <>
      <div className="modal__body">
        {/* Paciente y cita */}
        <div style={{ marginBottom: 22 }}>
          <div className="form-section__title">
            Paciente y tipo
            <span className="form-section__rule" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px 14px" }}>
            <div className="field-new">
              <label className="field-new__label">Paciente <span className="req">*</span></label>
              <PatientSearch patients={patients} value={form.patientId} onChange={id => setF("patientId", id)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">Doctor <span className="req">*</span></label>
                <select className="input-new" value={form.doctorId} onChange={e => setF("doctorId", e.target.value)}>
                  {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">Tipo de cita</label>
                <select className="input-new" value={form.type} onChange={e => setF("type", e.target.value)}>
                  {APPT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="field-new">
              <label className="field-new__label">Modo</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setF("mode", "IN_PERSON")}
                  className={`btn-new ${form.mode !== "TELECONSULTATION" ? "btn-new--primary" : "btn-new--secondary"}`}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Presencial
                </button>
                <button
                  type="button"
                  onClick={() => setF("mode", "TELECONSULTATION")}
                  className={`btn-new ${form.mode === "TELECONSULTATION" ? "btn-new--primary" : "btn-new--secondary"}`}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Teleconsulta
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Fecha y hora */}
        <div style={{ marginBottom: 22 }}>
          <div className="form-section__title">
            Fecha y hora
            <span className="form-section__rule" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
            <div className="field-new" style={{ gridColumn: "1 / -1" }}>
              <label className="field-new__label">Fecha <span className="req">*</span></label>
              <input type="date" className="input-new" value={form.date} onChange={e => setF("date", e.target.value)} />
            </div>
            <div className="field-new">
              <label className="field-new__label">Hora inicio</label>
              <input type="time" className="input-new mono" value={form.startTime} onChange={e => setF("startTime", e.target.value)} />
            </div>
            <div className="field-new">
              <label className="field-new__label">Duración</label>
              <select className="input-new mono" value={form.durationMins} onChange={e => setF("durationMins", parseInt(e.target.value))}>
                {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div className="field-new" style={{ gridColumn: "1 / -1" }}>
              <label className="field-new__label">Hora fin</label>
              <input
                readOnly
                className="input-new mono"
                style={{ color: "var(--text-3)", background: "var(--bg-elev-2)" }}
                value={addTime(form.startTime, form.durationMins)}
              />
            </div>
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">Notas</label>
          <textarea
            className="input-new"
            style={{ height: 70, paddingTop: 8, resize: "vertical" }}
            placeholder="Motivo de consulta, indicaciones especiales…"
            value={form.notes}
            onChange={e => setF("notes", e.target.value)}
          />
        </div>
      </div>

      <div className="modal__footer">
        <ButtonNew variant="ghost" onClick={onCancel} type="button">Cancelar</ButtonNew>
        <ButtonNew variant="primary" onClick={onSubmit} disabled={loading} type="button">
          {loading ? "Guardando…" : label}
        </ButtonNew>
      </div>
    </>
  );
}

export function AppointmentsClient({ appointments: initialAppts, patients, doctors, currentUserId, clinicId, waConnected }: Props) {
  const askConfirm = useConfirm();
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

  const searchParams = useSearchParams();

  // Auto-open new appointment modal if ?new=1 in URL (with optional patientId)
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      const patientId = searchParams.get("patientId");
      if (patientId) {
        setForm(f => ({ ...f, patientId }));
      }
      setShowNew(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("patientId");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  // Refresh appointments when page gains focus (back from another page/tab)
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const res = await fetch("/api/appointments");
        if (res.ok && mounted) {
          const data = await res.json();
          if (mounted) setAppts(data.appointments ?? []);
        }
      } catch { /* silent */ }
    }
    window.addEventListener("focus", refresh);
    // Also refresh on navigation (visibilitychange)
    function onVisible() { if (document.visibilityState === "visible") refresh(); }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const emptyForm = { patientId:"", doctorId:currentUserId, type:"Consulta general", date:toDateStr(today), startTime:"09:00", durationMins:30, notes:"", mode:"IN_PERSON" };
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
    if (!(await askConfirm({
      title: "¿Cancelar esta cita?",
      description: "El paciente recibirá una notificación si tiene contacto registrado.",
      variant: "warning",
      confirmText: "Cancelar cita",
      cancelText: "No, mantener",
    }))) return;
    try {
      const res = await fetch(`/api/appointments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al cancelar");
      setAppts(prev => prev.filter(a => a.id !== id));
      setShowDetail(null);
      toast.success("Cita cancelada");
    } catch (err: any) { toast.error(err.message); }
  }

  // Pill usada en MonthView y WeekView — colorea según status (DS tokens).
  const ApptPill = ({ appt, compact = false }: { appt: Appt; compact?: boolean }) => {
    const c = getApptColors(appt.status);
    return (
      <button
        onClick={e => { e.stopPropagation(); setShowDetail(appt); }}
        type="button"
        style={{
          width: "100%",
          textAlign: "left",
          background: c.bg,
          border: `1px solid ${c.border}`,
          borderLeft: `3px solid ${c.dot}`,
          color: c.text,
          padding: compact ? "3px 6px" : "5px 8px",
          borderRadius: 4,
          marginBottom: 3,
          fontSize: compact ? 10 : 11,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          cursor: "pointer",
          transition: "transform .12s, box-shadow .12s",
          overflow: "hidden",
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 12px ${c.border}`; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 9, flexShrink: 0 }}>{appt.startTime}</span>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {appt.patient.firstName}
          </span>
          {appt.mode === "TELECONSULTATION" && <span style={{ fontSize: 9, flexShrink: 0 }} title="Teleconsulta">📹</span>}
        </div>
        {!compact && appt.notes && (
          <div style={{ fontSize: 9, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {appt.notes}
          </div>
        )}
      </button>
    );
  };

  const MonthView = () => (
    <div>
      {/* Header días */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        background: "rgba(255,255,255,0.015)",
        borderBottom: "1px solid var(--border-soft)",
      }}>
        {DAYS_ES.map(d => (
          <div
            key={d}
            style={{
              padding: "12px 14px",
              textAlign: "center",
              fontSize: 10,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grid de días */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {calDays.map((day, idx) => {
          if (!day) return (
            <div
              key={idx}
              style={{
                minHeight: 110,
                borderRight: "1px solid var(--border-soft)",
                borderBottom: "1px solid var(--border-soft)",
                background: "rgba(255,255,255,0.01)",
              }}
            />
          );
          const ds       = toDateStr(day);
          const dayAppts = (apptsByDate[ds] ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
          const isToday  = ds === todayStr;
          const isSel    = ds === selectedDay;
          return (
            <div
              key={idx}
              onClick={() => setSelectedDay(ds)}
              style={{
                minHeight: 110,
                padding: "8px 10px",
                borderRight: "1px solid var(--border-soft)",
                borderBottom: "1px solid var(--border-soft)",
                cursor: "pointer",
                transition: "background .12s",
                background: isToday ? "var(--brand-softer)" : isSel ? "var(--bg-hover)" : "transparent",
                position: "relative",
              }}
              onMouseEnter={e => {
                if (!isToday && !isSel) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={e => {
                if (!isToday && !isSel) e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                {isToday ? (
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: "var(--brand)", color: "#fff",
                    display: "grid", placeItems: "center",
                    fontSize: 12, fontWeight: 600,
                    boxShadow: "0 0 12px rgba(124,58,237,0.4)",
                  }}>
                    {day.getDate()}
                  </span>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>
                    {day.getDate()}
                  </span>
                )}
                {dayAppts.length > 0 && (
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-4)" }}>
                    {dayAppts.length}
                  </span>
                )}
              </div>
              {dayAppts.slice(0, 3).map(a => <ApptPill key={a.id} appt={a} compact />)}
              {dayAppts.length > 3 && (
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                  +{dayAppts.length - 3} más
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const WeekView = () => {
    const dow       = (currentDate.getDay() + 6) % 7;
    const weekStart = new Date(currentDate.getTime() - dow * 86400000);
    const weekDays  = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));
    return (
      <div>
        {/* Header sticky */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "60px repeat(7, 1fr)",
            borderBottom: "1px solid var(--border-soft)",
            background: "rgba(10,10,15,0.8)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          <div style={{ borderRight: "1px solid var(--border-soft)" }} />
          {weekDays.map((d, i) => {
            const ds = toDateStr(d);
            const isToday = ds === todayStr;
            const cnt = (apptsByDate[ds] ?? []).length;
            return (
              <div
                key={i}
                style={{
                  padding: "10px 12px",
                  textAlign: "center",
                  borderRight: "1px solid var(--border-soft)",
                  background: isToday ? "var(--brand-softer)" : "transparent",
                }}
              >
                <div style={{
                  fontSize: 10, color: "var(--text-3)",
                  textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
                }}>
                  {DAYS_ES[i]}
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 500, marginTop: 2,
                  color: isToday ? "var(--brand)" : "var(--text-1)",
                }}>
                  {d.getDate()}
                </div>
                {cnt > 0 && (
                  <div className="mono" style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>
                    {cnt}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Hour rows */}
        <div style={{ overflowY: "auto", maxHeight: 560 }}>
          {HOURS.map(hour => (
            <div
              key={hour}
              style={{
                display: "grid",
                gridTemplateColumns: "60px repeat(7, 1fr)",
                borderBottom: "1px solid var(--border-soft)",
                minHeight: 60,
              }}
            >
              <div style={{
                borderRight: "1px solid var(--border-soft)",
                padding: "4px 10px",
              }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-4)" }}>{hour}</span>
              </div>
              {weekDays.map((d, i) => {
                const ds = toDateStr(d);
                const slotAppts = (apptsByDate[ds] ?? []).filter(a => a.startTime.startsWith(hour.slice(0, 2)));
                return (
                  <div
                    key={i}
                    onClick={() => { setSelectedDay(ds); openNew(ds, hour); }}
                    style={{
                      borderRight: "1px solid var(--border-soft)",
                      padding: 2,
                      cursor: "pointer",
                      transition: "background .12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
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
    const dayAppts = (apptsByDate[ds] ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const nowHour = String(new Date().getHours()).padStart(2, "0");
    return (
      <div
        style={{ overflowY: "auto", maxHeight: 580 }}
        ref={el => {
          if (!el) return;
          const target = el.querySelector(`[data-hour="${nowHour}"]`);
          if (target) (target as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      >
        {HOURS.map(hour => {
          const slotAppts = dayAppts.filter(a => a.startTime.startsWith(hour.slice(0, 2)));
          return (
            <div
              key={hour}
              data-hour={hour.slice(0, 2)}
              style={{
                display: "flex",
                borderBottom: "1px solid var(--border-soft)",
                minHeight: 72,
              }}
            >
              <div style={{
                width: 80, flexShrink: 0,
                padding: "10px 14px",
                borderRight: "1px solid var(--border-soft)",
              }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>{hour}</span>
              </div>
              <div
                onClick={() => openNew(ds, hour)}
                style={{
                  flex: 1, padding: 4,
                  cursor: "pointer",
                  transition: "background .12s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                {slotAppts.map(a => {
                  const c = getApptColors(a.status);
                  return (
                    <button
                      key={a.id}
                      onClick={e => { e.stopPropagation(); setShowDetail(a); }}
                      type="button"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: c.bg,
                        border: `1px solid ${c.border}`,
                        borderLeft: `3px solid ${c.dot}`,
                        color: c.text,
                        borderRadius: 6,
                        padding: "10px 14px",
                        marginBottom: 4,
                        cursor: "pointer",
                        transition: "transform .12s, box-shadow .12s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 16px -4px ${c.border}`; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot }} />
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{a.startTime} – {a.endTime}</span>
                        <BadgeNew tone={
                          a.status === "CONFIRMED"   ? "success" :
                          a.status === "IN_PROGRESS" ? "brand" :
                          a.status === "COMPLETED"   ? "info" :
                          a.status === "CANCELLED" || a.status === "NO_SHOW" ? "danger" : "warning"
                        }>{c.label}</BadgeNew>
                        {a.mode === "TELECONSULTATION" && <BadgeNew tone="brand">Teleconsulta</BadgeNew>}
                        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                          {a.googleCalendarEventId && (
                            <span title="Sincronizado con Google Calendar"><CalendarCheck size={14} style={{ color: "var(--brand)" }} /></span>
                          )}
                          {a.reminderSent && (
                            <span title="Recordatorio enviado"><MessageCircle size={14} style={{ color: "var(--success)" }} /></span>
                          )}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
                        {a.patient.firstName} {a.patient.lastName}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        {a.type} · Dr/a. {a.doctor.firstName} {a.doctor.lastName} · {a.durationMins} min
                      </div>
                      {a.notes && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic", marginTop: 4 }}>
                          📝 {a.notes}
                        </div>
                      )}
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
  // ApptForm moved outside — see standalone function below

  const completedCount = appts.filter(a => a.status === "COMPLETED").length;
  const periodTitle =
    view === "month" ? `${MONTHS_ES[currentDate.getMonth()]} ${currentDate.getFullYear()}` :
    view === "week"  ? `Semana del ${currentDate.getDate()} de ${MONTHS_ES[currentDate.getMonth()]}` :
                       `${currentDate.getDate()} de ${MONTHS_ES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header: title + period nav + actions */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>Agenda</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <button onClick={prevPeriod} className="icon-btn-new" type="button" aria-label="Periodo anterior">
              <ChevronLeft size={14} />
            </button>
            <button onClick={nextPeriod} className="icon-btn-new" type="button" aria-label="Siguiente periodo">
              <ChevronRight size={14} />
            </button>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, textTransform: "capitalize" }}>{periodTitle}</p>
            <button
              onClick={() => { setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(todayStr); }}
              className="btn-new btn-new--ghost btn-new--sm"
              type="button"
            >
              Hoy
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select
            value={filterDoc}
            onChange={e => setFilterDoc(e.target.value)}
            className="input-new"
            style={{ width: "auto", minWidth: 180 }}
          >
            <option value="all">Todos los doctores</option>
            {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
          </select>
          <div className="segment-new">
            {([["month", "Mes", Calendar], ["week", "Sem", CalendarDays], ["day", "Día", List]] as const).map(([v, lbl, Icon]) => (
              <button
                key={v}
                onClick={() => { setView(v as ViewMode); if (v !== "month") setCurrentDate(today); }}
                type="button"
                className={`segment-new__btn ${view === v ? "segment-new__btn--active" : ""}`}
              >
                <Icon size={11} style={{ marginRight: 4, display: "inline", verticalAlign: -2 }} />
                {lbl}
              </button>
            ))}
          </div>
          <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => openNew(selectedDay)}>
            Nueva cita
          </ButtonNew>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Citas hoy"   value={String(todayAppts.length)} icon={Calendar} />
        <KpiCard label="Este mes"    value={String(monthAppts.length)} icon={CalendarDays} />
        <KpiCard label="Pendientes"  value={String(pendingCount)} icon={List} />
        <KpiCard label="Completadas" value={String(completedCount)} icon={CalendarCheck} />
      </div>

      {/* Main layout — calendar + side panel */}
      <div className="flex gap-5" style={{ alignItems: "flex-start" }}>
        <div className="flex-1 min-w-0">
          <div className="card" style={{ overflow: "hidden" }}>
            {view === "month" && <MonthView />}
            {view === "week"  && <WeekView  />}
            {view === "day"   && <DayView   />}
          </div>
        </div>

      {/* Side panel */}
      <div className="w-72 flex-shrink-0">
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card__header">
            <div>
              <div className="card__title">{DAYS_ES[(selDate.getDay()+6)%7]} {selDate.getDate()} {MONTHS_ES[selDate.getMonth()]}</div>
              <div className="card__sub">{selAppts.length} cita{selAppts.length!==1?"s":""}</div>
            </div>
            <button
              onClick={() => openNew(selectedDay)}
              type="button"
              className="icon-btn-new"
              aria-label="Nueva cita"
            >
              <Plus size={14} />
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
                    <span className="mono text-base font-bold">{appt.startTime}</span>
                    <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                  </div>
                  <div className="text-base font-bold truncate">{appt.patient.firstName} {appt.patient.lastName}</div>
                  <div className="text-sm text-muted-foreground">{appt.type} · <span className="mono">{appt.durationMins}</span> min</div>
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
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Nueva cita</div>
              <button onClick={() => setShowNew(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <ApptForm form={form} setForm={setForm} doctors={doctors} patients={patients} loading={loading} onSubmit={createAppt} onCancel={() => { setShowNew(false); setShowEdit(false); }} label="✅ Agendar cita" />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && showDetail && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Editar cita</div>
              <button onClick={() => setShowEdit(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <ApptForm form={form} setForm={setForm} doctors={doctors} patients={patients} loading={loading} onSubmit={saveEdit} onCancel={() => { setShowNew(false); setShowEdit(false); }} label="💾 Guardar cambios" />
          </div>
        </div>
      )}

      {/* Detail modal */}
      {showDetail && !showEdit && (() => {
        const appt  = showDetail;
        const cfg   = STATUS_CONFIG[appt.status]??STATUS_CONFIG.PENDING;
        const color = docColorMap[appt.doctorId]??DOC_COLORS[0];
        return (
          <div className="modal-overlay" onClick={() => setShowDetail(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ borderLeftWidth: 4, borderLeftColor: color.border }}>
              <div className="modal__header">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${cfg.dot}`} />
                  <div className="modal__title">{appt.type}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => {
                    setForm({ patientId:appt.patientId, doctorId:appt.doctorId, type:appt.type,
                      date:appt.date.split("T")[0], startTime:appt.startTime, durationMins:appt.durationMins, notes:appt.notes??"", mode:appt.mode??"IN_PERSON"
                    });
                    setShowEdit(true);
                  }} type="button" className="btn-new btn-new--ghost btn-new--sm" title="Editar cita">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => setShowDetail(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                    <X size={14} />
                  </button>
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
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 bg-brand-600/15 border border-brand-200 px-3 py-1.5 rounded-full">
                      <CalendarCheck className="w-4 h-4"/> Sincronizado con Google Calendar
                    </div>
                  )}
                  {appt.reminderSent && (
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 px-3 py-1.5 rounded-full">
                      <MessageCircle className="w-4 h-4"/> Recordatorio WhatsApp enviado
                    </div>
                  )}
                  {appt.mode === "TELECONSULTATION" && (
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-violet-600 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 px-3 py-1.5 rounded-full">
                      📹 Teleconsulta
                    </div>
                  )}
                </div>
                {appt.mode === "TELECONSULTATION" && (
                  <div className="space-y-2">
                    {appt.paymentStatus === "paid" ? (
                      <a href={`/teleconsulta/${appt.id}?role=doctor`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors">
                        📹 Unirse a videollamada
                      </a>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 px-3 py-1.5 rounded-full w-fit">
                          ⏳ Pago pendiente
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/pago/${appt.id}`); toast.success("Link de pago copiado"); }}
                          className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-border hover:bg-muted text-sm font-bold transition-colors">
                          📋 Copiar link de pago
                        </button>
                      </div>
                    )}
                    {waConnected && (
                      <button onClick={() => sendWA(appt.id)}
                        className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-emerald-300 hover:bg-emerald-50 text-emerald-700 text-sm font-bold transition-colors">
                        <MessageCircle className="w-4 h-4"/> Enviar link por WhatsApp
                      </button>
                    )}
                  </div>
                )}
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
    </div>
  );
}
