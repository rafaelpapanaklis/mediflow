"use client";
import { useState } from "react";
import { Plus, Calendar, Clock, User, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInitials, avatarColor } from "@/lib/utils";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  PENDING:     { label: "Pendiente",  cls: "text-amber-700 bg-amber-50 border-amber-200"       },
  CONFIRMED:   { label: "Confirmada", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  IN_PROGRESS: { label: "En curso",   cls: "text-brand-700 bg-brand-50 border-brand-200"        },
  COMPLETED:   { label: "Completada", cls: "text-slate-600 bg-slate-100 border-slate-200"       },
  CANCELLED:   { label: "Cancelada",  cls: "text-rose-700 bg-rose-50 border-rose-200"           },
  NO_SHOW:     { label: "No asistió", cls: "text-slate-500 bg-slate-50 border-slate-200"        },
};
const TYPES = ["Consulta general","Control","Urgencia","Primera vez","Cirugía","Seguimiento","Vacuna","Otro"];

interface Props {
  todayAppts:    any[];
  patients:      { id: string; firstName: string; lastName: string; patientNumber: string }[];
  doctors:       { id: string; firstName: string; lastName: string; role: string }[];
  currentUserId: string;
}

export function AppointmentsClient({ todayAppts: initial, patients, doctors, currentUserId }: Props) {
  const router = useRouter();
  const [appts, setAppts]     = useState(initial);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    patientId: "", doctorId: currentUserId, type: TYPES[0],
    date: new Date().toISOString().split("T")[0], startTime: "09:00", endTime: "09:30", durationMins: 30, notes: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  async function changeStatus(id: string, status: string) {
    const res = await fetch(`/api/appointments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) {
      const updated = await res.json();
      setAppts(prev => prev.map(a => a.id === id ? { ...a, status: updated.status } : a));
      toast.success("Estado actualizado");
    } else { toast.error("Error al actualizar"); }
  }

  async function createAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patientId) { toast.error("Selecciona un paciente"); return; }
    if (!form.doctorId)  { toast.error("Selecciona un doctor"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).error);
      const appt = await res.json();
      const selectedDate = new Date(form.date + "T00:00:00");
      const today = new Date(); today.setHours(0,0,0,0);
      if (selectedDate.toDateString() === today.toDateString()) {
        setAppts(prev => [...prev, appt].sort((a,b) => a.startTime.localeCompare(b.startTime)));
      }
      toast.success("Cita agendada");
      setShowNew(false);
      setForm(f => ({ ...f, patientId: "", notes: "" }));
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setLoading(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">Agenda</h1>
          <p className="text-sm text-muted-foreground">{appts.length} citas hoy · {new Date().toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long" })}</p>
        </div>
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />Nueva cita</Button>
      </div>

      {showNew && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 mb-5 animate-fade-up">
          <h2 className="text-sm font-bold mb-4 text-brand-700">📅 Agendar nueva cita</h2>
          <form onSubmit={createAppointment} className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="col-span-2 lg:col-span-1 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Paciente *</label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.patientId} onChange={e => set("patientId", e.target.value)}>
                <option value="">Seleccionar…</option>
                {patients.map(p => <option key={p.id} value={p.id}>#{p.patientNumber} — {p.firstName} {p.lastName}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Doctor *</label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.doctorId} onChange={e => set("doctorId", e.target.value)}>
                <option value="">Seleccionar…</option>
                {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Tipo</label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.type} onChange={e => set("type", e.target.value)}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Fecha</label>
              <input type="date" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.date} onChange={e => set("date", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Inicio</label>
              <input type="time" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.startTime} onChange={e => set("startTime", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Fin</label>
              <input type="time" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.endTime} onChange={e => set("endTime", e.target.value)} />
            </div>
            <div className="col-span-2 lg:col-span-3 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Notas (opcional)</label>
              <input className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Motivo de consulta…" value={form.notes} onChange={e => set("notes", e.target.value)} />
            </div>
            <div className="col-span-2 lg:col-span-3 flex gap-2">
              <Button type="submit" disabled={loading} size="sm">{loading ? "Guardando…" : "Confirmar cita"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {appts.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-16 text-center shadow-card">
            <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm mb-3">No hay citas para hoy</p>
            <Button size="sm" onClick={() => setShowNew(true)}>Agendar primera cita</Button>
          </div>
        ) : appts.map(appt => {
          const s = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.PENDING;
          const patientName = appt.patient ? `${appt.patient.firstName} ${appt.patient.lastName}` : "Paciente";
          const doctorName  = appt.doctor  ? `${appt.doctor.firstName} ${appt.doctor.lastName}`   : "Doctor";
          return (
            <div key={appt.id} className="rounded-xl border border-border bg-white p-4 shadow-card flex items-center gap-4">
              <div className="flex-shrink-0 text-center w-14">
                <div className="text-sm font-extrabold">{appt.startTime}</div>
                <div className="text-xs text-muted-foreground">{appt.endTime}</div>
              </div>
              <div className={`w-9 h-9 rounded-full ${avatarColor(appt.patientId)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                {appt.patient ? getInitials(appt.patient.firstName, appt.patient.lastName) : "P"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{patientName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" />Dr/a. {doctorName}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{appt.type}</span>
                  {appt.notes && <span className="truncate max-w-[200px]">{appt.notes}</span>}
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${s.cls}`}>{s.label}</span>
              <div className="flex gap-1.5 flex-shrink-0">
                {appt.status === "PENDING" && (
                  <button onClick={() => changeStatus(appt.id, "CONFIRMED")} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors" title="Confirmar">
                    <CheckCircle className="w-4 h-4" />
                  </button>
                )}
                {!["CANCELLED","COMPLETED","NO_SHOW"].includes(appt.status) && (
                  <>
                    <button onClick={() => changeStatus(appt.id, "COMPLETED")} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Completar">
                      <CheckCircle className="w-4 h-4" />
                    </button>
                    <button onClick={() => changeStatus(appt.id, "CANCELLED")} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600 transition-colors" title="Cancelar">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
