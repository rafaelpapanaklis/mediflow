"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, AlertTriangle, CheckCircle, Clock, X, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

interface Session { id: string; sessionNumber: number; completedAt: string | null; notes: string | null }
interface InvItem  { id: string; name: string; category: string; emoji: string; quantity: number; unit: string }
interface SelectedInv { id: string; name: string; unit: string; qty: number }
interface Treatment {
  id: string; name: string; description: string | null;
  totalSessions: number; sessionIntervalDays: number; totalCost: number;
  status: string; startDate: string; endDate: string | null;
  nextExpectedDate: string | null; lastFollowUpSent: string | null;
  patient:  { id: string; firstName: string; lastName: string; phone: string | null };
  doctor:   { id: string; firstName: string; lastName: string; color: string };
  sessions: Session[];
}

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  ACTIVE:    { label:"Activo",     bg:"bg-emerald-50 dark:bg-emerald-900/20",  text:"text-emerald-700 dark:text-emerald-300",  dot:"bg-emerald-500" },
  COMPLETED: { label:"Completado", bg:"bg-muted",        text:"text-muted-foreground",       dot:"bg-muted"   },
  ABANDONED: { label:"Abandonado", bg:"bg-rose-50 dark:bg-rose-900/20",        text:"text-rose-700 dark:text-rose-300",         dot:"bg-rose-500"    },
  PAUSED:    { label:"Pausado",    bg:"bg-amber-50 dark:bg-amber-900/20",      text:"text-amber-700 dark:text-amber-300",       dot:"bg-amber-500"   },
};

const COMMON_TREATMENTS = [
  "Ortodoncia con brackets","Ortodoncia invisible","Implante dental","Rehabilitación periodontal",
  "Blanqueamiento dental","Rehabilitación oral completa","Tratamiento de conductos",
  "Plan nutricional","Programa psicológico","Terapia de rehabilitación",
];

interface Props {
  treatments: Treatment[];
  patients: { id: string; firstName: string; lastName: string }[];
  doctors:  { id: string; firstName: string; lastName: string; color: string }[];
  currentUserId: string; isAdmin: boolean; clinicSlug: string;
}

export function TreatmentsClient({ treatments: initial, patients, doctors, currentUserId, isAdmin, clinicSlug }: Props) {
  const [treatments, setTreatments] = useState<Treatment[]>(initial);
  const [filter,     setFilter]     = useState<string>("ALL");
  const [showNew,    setShowNew]    = useState(false);
  const [selected,   setSelected]   = useState<Treatment | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [addingSession, setAddingSession] = useState<string | null>(null);
  const [sessionNote,  setSessionNote]  = useState("");
  const [invItems,     setInvItems]     = useState<InvItem[]>([]);
  const [selInv,       setSelInv]       = useState<SelectedInv[]>([]);
  const [loadingInv,   setLoadingInv]   = useState(false);

  // New plan form
  const [form, setForm] = useState({
    patientId: "", doctorId: currentUserId, name: "", description: "",
    totalSessions: "6", sessionIntervalDays: "30", totalCost: "",
  });

  const now = new Date();
  const filtered = treatments.filter(t => {
    if (filter === "ALL")     return true;
    if (filter === "OVERDUE") return t.status === "ACTIVE" && !!t.nextExpectedDate && new Date(t.nextExpectedDate) < now;
    return t.status === filter;
  });

  // Stats
  const active    = treatments.filter(t => t.status === "ACTIVE").length;
  const overdue   = treatments.filter(t => t.status === "ACTIVE" && t.nextExpectedDate && new Date(t.nextExpectedDate) < now).length;
  const completed = treatments.filter(t => t.status === "COMPLETED").length;

  function daysOverdue(t: Treatment) {
    if (!t.nextExpectedDate) return 0;
    const diff = now.getTime() - new Date(t.nextExpectedDate).getTime();
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
  }

  function progressPct(t: Treatment) {
    return t.totalSessions > 0 ? Math.round((t.sessions.length / t.totalSessions) * 100) : 0;
  }

  async function createPlan() {
    if (!form.patientId || !form.name.trim()) { toast.error("Selecciona paciente y nombre"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/treatments", {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          patientId:          form.patientId,
          doctorId:           form.doctorId,
          name:               form.name.trim(),
          description:        form.description.trim() || null,
          totalSessions:      Number(form.totalSessions),
          sessionIntervalDays:Number(form.sessionIntervalDays),
          totalCost:          Number(form.totalCost) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTreatments(prev => [data, ...prev]);
      setShowNew(false);
      setForm({ patientId:"", doctorId:currentUserId, name:"", description:"", totalSessions:"6", sessionIntervalDays:"30", totalCost:"" });
      toast.success("Plan de tratamiento creado");
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function addSession(treatmentId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/treatments/${treatmentId}`, {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          action: "add_session",
          notes: sessionNote.trim() || null,
          inventoryItems: selInv.map(i => ({ id: i.id, qty: i.qty, name: i.name })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Update state locally (optimistic update)
      setTreatments(prev => prev.map(t => {
        if (t.id !== treatmentId) return t;
        const newSession: Session = {
          id: `temp-${Date.now()}`, sessionNumber: t.sessions.length + 1,
          completedAt: new Date().toISOString(), notes: sessionNote.trim() || null,
        };
        return {
          ...t,
          sessions:        [...t.sessions, newSession],
          status:          data.completed ? "COMPLETED" : "ACTIVE",
          nextExpectedDate:data.completed ? null : new Date(Date.now() + t.sessionIntervalDays * 24 * 60 * 60 * 1000).toISOString(),
        };
      }));

      if (selected?.id === treatmentId) {
        setSelected(prev => {
          if (!prev) return null;
          const newSession: Session = { id:`temp-${Date.now()}`, sessionNumber:prev.sessions.length+1, completedAt:new Date().toISOString(), notes:sessionNote.trim()||null };
          return { ...prev, sessions:[...prev.sessions, newSession], status:data.completed?"COMPLETED":"ACTIVE" };
        });
      }

      setAddingSession(null);
      setSessionNote("");
      setSelInv([]);
      toast.success(data.completed ? "¡Tratamiento completado!" : `Sesión ${data.sessionNumber} registrada`);
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function changeStatus(treatmentId: string, status: string) {
    try {
      const res = await fetch(`/api/treatments/${treatmentId}`, {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Error");
      setTreatments(prev => prev.map(t => t.id === treatmentId ? { ...t, status } : t));
      if (selected?.id === treatmentId) setSelected(prev => prev ? { ...prev, status } : null);
      toast.success("Estado actualizado");
    } catch { toast.error("Error al actualizar"); }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Activity className="w-7 h-7 text-brand-600" /> Tratamientos
          </h1>
          <p className="text-base text-muted-foreground mt-0.5">Seguimiento de planes de tratamiento activos</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold text-base transition-colors">
          <Plus className="w-5 h-5" /> Nuevo plan
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label:"Activos",    val:active,    icon:"💊", color:"text-brand-600"   },
          { label:"Con atraso", val:overdue,   icon:"⚠️", color:"text-amber-600"   },
          { label:"Completados",val:completed, icon:"✅", color:"text-emerald-600" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-2xl p-4 shadow-card text-center">
            <div className="text-2xl mb-1">{k.icon}</div>
            <div className={`text-3xl font-extrabold ${k.color}`}>{k.val}</div>
            <div className="text-sm text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-xl p-1 w-fit mb-5">
        {[["ALL","Todos"],["ACTIVE","Activos"],["OVERDUE","En riesgo"],["COMPLETED","Completados"],["PAUSED","Pausados"]].map(([val,label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${filter === val ? "bg-brand-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Treatment list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-2xl">
          <div className="text-4xl mb-3">💊</div>
          <div className="text-lg font-semibold mb-1">Sin planes de tratamiento</div>
          <div className="text-sm">Crea el primer plan para un paciente</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => {
            const pct     = progressPct(t);
            const od      = daysOverdue(t);
            const isLate  = t.status === "ACTIVE" && od > 0;
            const cfg     = STATUS_CFG[t.status] ?? STATUS_CFG.ACTIVE;

            return (
              <div key={t.id}
                className={`bg-card border rounded-2xl shadow-card overflow-hidden cursor-pointer hover:border-brand-300 transition-all ${isLate ? "border-amber-300 dark:border-amber-700" : "border-border"}`}
                onClick={() => setSelected(t)}>
                <div className="px-5 py-4 flex items-center gap-4">
                  {/* Doctor color bar */}
                  <div className="w-1 h-14 rounded-full flex-shrink-0" style={{ background:t.doctor.color }} />

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-bold">{t.name}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      {isLate && (
                        <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3.5 h-3.5" /> {od}d sin venir
                        </span>
                      )}
                    </div>
                    <Link href={`/dashboard/patients/${t.patient.id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-sm text-brand-600 hover:underline font-semibold">
                      {t.patient.firstName} {t.patient.lastName}
                    </Link>
                    <div className="text-sm text-muted-foreground">Dr/a. {t.doctor.firstName} {t.doctor.lastName}</div>
                  </div>

                  {/* Progress */}
                  <div className="text-right flex-shrink-0 min-w-[80px]">
                    <div className="text-base font-bold">{t.sessions.length}/{t.totalSessions}</div>
                    <div className="text-xs text-muted-foreground">sesiones</div>
                    <div className="mt-1.5 w-20 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full" style={{ width:`${pct}%` }} />
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail panel (modal) ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background:"rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="bg-card rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-lg font-bold">{selected.name}</h2>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-xl hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Patient + doctor */}
              <div className="flex gap-3">
                <div className="flex-1 bg-muted/30 rounded-xl p-3">
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Paciente</div>
                  <Link href={`/dashboard/patients/${selected.patient.id}`} onClick={() => setSelected(null)}
                    className="text-base font-bold text-brand-600 hover:underline">
                    {selected.patient.firstName} {selected.patient.lastName}
                  </Link>
                  {selected.patient.phone && <div className="text-sm text-muted-foreground">{selected.patient.phone}</div>}
                </div>
                <div className="flex-1 bg-muted/30 rounded-xl p-3">
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Doctor</div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background:selected.doctor.color }} />
                    <span className="text-base font-bold">Dr/a. {selected.doctor.firstName} {selected.doctor.lastName}</span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-semibold">Progreso</span>
                  <span className="text-muted-foreground">{selected.sessions.length} de {selected.totalSessions} sesiones ({progressPct(selected)}%)</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${selected.status==="COMPLETED" ? "bg-emerald-500" : "bg-brand-600"}`}
                    style={{ width:`${progressPct(selected)}%` }} />
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label:"Costo total", val:formatCurrency(selected.totalCost) },
                  { label:"Intervalo",   val:`${selected.sessionIntervalDays} días` },
                  { label:"Estado",      val:STATUS_CFG[selected.status]?.label ?? selected.status },
                ].map(s => (
                  <div key={s.label} className="bg-muted/20 rounded-xl p-3 text-center">
                    <div className="text-sm font-bold">{s.val}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Sessions timeline */}
              <div>
                <div className="text-sm font-bold mb-3">Sesiones realizadas</div>
                <div className="space-y-2">
                  {selected.sessions.map(s => (
                    <div key={s.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-semibold">Sesión {s.sessionNumber}</span>
                        {s.notes && <div className="text-xs text-muted-foreground">{s.notes}</div>}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {s.completedAt ? new Date(s.completedAt).toLocaleDateString("es-MX",{day:"numeric",month:"short"}) : ""}
                      </span>
                    </div>
                  ))}
                  {/* Pending sessions */}
                  {Array.from({ length: Math.max(0, selected.totalSessions - selected.sessions.length) }).map((_, i) => (
                    <div key={`pending-${i}`} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0 opacity-40">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span className="text-sm text-muted-foreground">Sesión {selected.sessions.length + i + 1}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add session */}
              {selected.status === "ACTIVE" && (
                <div>
                  {addingSession === selected.id ? (
                    <div className="space-y-3">
                      <textarea className="w-full border border-border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                        placeholder="Notas de la sesión (opcional)" rows={2}
                        value={sessionNote} onChange={e => setSessionNote(e.target.value)} />

                      {/* Inventory picker */}
                      <InventoryPicker
                        clinicItems={invItems}
                        selected={selInv}
                        loading={loadingInv}
                        onOpen={async () => {
                          if (invItems.length > 0) return;
                          setLoadingInv(true);
                          try {
                            const r = await fetch("/api/inventory");
                            const d = await r.json();
                            setInvItems(Array.isArray(d) ? d : []);
                          } catch {} finally { setLoadingInv(false); }
                        }}
                        onAdd={(item) => {
                          if (!selInv.find(i => i.id === item.id)) {
                            setSelInv(prev => [...prev, { id:item.id, name:item.name, unit:item.unit, qty:1 }]);
                          }
                        }}
                        onQtyChange={(id, qty) => setSelInv(prev => prev.map(i => i.id===id ? {...i,qty} : i))}
                        onRemove={(id) => setSelInv(prev => prev.filter(i => i.id !== id))}
                      />

                      <div className="flex gap-2">
                        <button onClick={() => addSession(selected.id)} disabled={saving}
                          className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50">
                          {saving ? "Guardando…" : "Confirmar sesión"}
                        </button>
                        <button onClick={() => { setAddingSession(null); setSessionNote(""); setSelInv([]); }}
                          className="px-4 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setAddingSession(selected.id)}
                      className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2">
                      <Plus className="w-5 h-5" /> Registrar sesión completada
                    </button>
                  )}
                </div>
              )}

              {/* Status change */}
              {selected.status === "ACTIVE" && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => changeStatus(selected.id, "PAUSED")}
                    className="flex-1 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-50 transition-colors">
                    ⏸ Pausar
                  </button>
                  <button onClick={() => changeStatus(selected.id, "ABANDONED")}
                    className="flex-1 py-2 border border-rose-300 text-rose-700 rounded-xl text-sm font-semibold hover:bg-rose-50 transition-colors">
                    Marcar abandonado
                  </button>
                </div>
              )}
              {selected.status === "PAUSED" && (
                <button onClick={() => changeStatus(selected.id, "ACTIVE")}
                  className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold transition-colors">
                  ▶ Reactivar tratamiento
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New plan modal ── */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background:"rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="bg-card rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">Nuevo plan de tratamiento</h2>
              <button onClick={() => setShowNew(false)} className="p-1.5 rounded-xl hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Patient */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Paciente *</label>
                <select className="w-full h-11 rounded-xl border border-border px-3 text-base focus:outline-none"
                  value={form.patientId} onChange={e => setForm(f=>({...f,patientId:e.target.value}))}>
                  <option value="">Selecciona un paciente</option>
                  {patients.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              {/* Doctor (admin only) */}
              {isAdmin && (
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold">Doctor *</label>
                  <select className="w-full h-11 rounded-xl border border-border px-3 text-base focus:outline-none"
                    value={form.doctorId} onChange={e => setForm(f=>({...f,doctorId:e.target.value}))}>
                    {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
                  </select>
                </div>
              )}
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Nombre del tratamiento *</label>
                <input className="w-full h-11 rounded-xl border border-border px-3 text-base focus:outline-none"
                  placeholder="Ej: Ortodoncia 18 meses"
                  value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} />
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {COMMON_TREATMENTS.slice(0,5).map(t => (
                    <button key={t} onClick={() => setForm(f=>({...f,name:t}))}
                      className="text-xs px-2.5 py-1 bg-muted rounded-full hover:bg-brand-500/15 hover:text-brand-700 transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {/* Sessions + interval */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold">Total de sesiones</label>
                  <input type="number" min="1" max="100"
                    className="w-full h-11 rounded-xl border border-border px-3 text-base focus:outline-none"
                    value={form.totalSessions} onChange={e => setForm(f=>({...f,totalSessions:e.target.value}))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold">Días entre sesiones</label>
                  <input type="number" min="1" max="365"
                    className="w-full h-11 rounded-xl border border-border px-3 text-base focus:outline-none"
                    value={form.sessionIntervalDays} onChange={e => setForm(f=>({...f,sessionIntervalDays:e.target.value}))} />
                </div>
              </div>
              {/* Cost */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Costo total del tratamiento</label>
                <input type="number" min="0"
                  className="w-full h-11 rounded-xl border border-border px-3 text-base focus:outline-none"
                  placeholder="$0.00 MXN" value={form.totalCost} onChange={e => setForm(f=>({...f,totalCost:e.target.value}))} />
              </div>
              <button onClick={createPlan} disabled={saving || !form.patientId || !form.name.trim()}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-base transition-colors disabled:opacity-50">
                {saving ? "Creando…" : "Crear plan de tratamiento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inventory Picker ──────────────────────────────────────────────────────
function InventoryPicker({ clinicItems, selected, loading, onOpen, onAdd, onQtyChange, onRemove }: {
  clinicItems: InvItem[];
  selected: SelectedInv[];
  loading: boolean;
  onOpen: () => void;
  onAdd: (item: InvItem) => void;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = clinicItems.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground">📦 Insumos utilizados</span>
        <button type="button"
          onClick={() => { setOpen(o => !o); if (!open) onOpen(); }}
          className="text-xs font-semibold text-brand-600 hover:underline">
          {open ? "Cerrar" : "+ Agregar insumo"}
        </button>
      </div>

      {/* Selected items */}
      {selected.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {selected.map(item => (
            <div key={item.id} className="flex items-center gap-2 bg-muted/30 rounded-xl px-3 py-2">
              <span className="text-sm font-semibold flex-1">{item.name}</span>
              <div className="flex items-center gap-1">
                <button type="button"
                  onClick={() => item.qty > 1 && onQtyChange(item.id, item.qty - 1)}
                  className="w-6 h-6 rounded-lg bg-card border border-border flex items-center justify-center text-sm font-bold hover:bg-muted">−</button>
                <span className="text-sm font-bold w-8 text-center">{item.qty}</span>
                <button type="button"
                  onClick={() => onQtyChange(item.id, item.qty + 1)}
                  className="w-6 h-6 rounded-lg bg-card border border-border flex items-center justify-center text-sm font-bold hover:bg-muted">+</button>
                <span className="text-xs text-muted-foreground ml-1">{item.unit}</span>
              </div>
              <button type="button" onClick={() => onRemove(item.id)}
                className="text-rose-500 hover:text-rose-700 ml-1 text-sm font-bold">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Item picker dropdown */}
      {open && (
        <div className="border border-border rounded-xl bg-card shadow-lg">
          <div className="p-2 border-b border-border">
            <input
              className="w-full px-3 py-2 text-sm rounded-lg border border-border focus:outline-none bg-card"
              placeholder="Buscar insumo…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {loading ? (
            <div className="p-3 text-sm text-muted-foreground text-center">Cargando inventario…</div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground text-center">Sin insumos{search ? " que coincidan" : " en inventario"}</div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {filtered.map(item => (
                <button key={item.id} type="button"
                  onClick={() => { onAdd(item); }}
                  disabled={!!selected.find(s => s.id === item.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-lg">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.category} · {item.quantity} {item.unit} disponibles</div>
                  </div>
                  {selected.find(s => s.id === item.id) && (
                    <span className="text-xs text-emerald-600 font-bold flex-shrink-0">✓ Agregado</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
