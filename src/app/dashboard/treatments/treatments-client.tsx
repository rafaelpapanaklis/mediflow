"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, AlertTriangle, CheckCircle, Clock, X, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { fmtMXN, formatRelativeDate } from "@/lib/format";
import toast from "react-hot-toast";

type StatusTone = "success" | "warning" | "danger" | "neutral" | "info" | "brand";
const STATUS_TONE: Record<string, { tone: StatusTone; label: string }> = {
  ACTIVE:    { tone: "success", label: "Activo" },
  COMPLETED: { tone: "neutral", label: "Completado" },
  ABANDONED: { tone: "danger",  label: "Abandonado" },
  PAUSED:    { tone: "warning", label: "Pausado" },
};

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
    if (!form.patientId) { toast.error("Selecciona un paciente"); return; }
    if (!form.name.trim()) { toast.error("Ingresa un nombre para el plan"); return; }
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
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Tratamientos
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            Seguimiento de planes de tratamiento activos
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
          Nuevo plan
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Planes activos"   value={String(active)}    icon={Activity} />
        <KpiCard label="Con atraso"       value={String(overdue)}   icon={AlertTriangle} />
        <KpiCard label="Completados"      value={String(completed)} icon={CheckCircle} />
        <KpiCard label="Total pacientes"  value={String(new Set(treatments.map(t => t.patient.id)).size)} icon={Clock} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="segment-new">
          {[["ALL","Todos"],["ACTIVE","Activos"],["OVERDUE","En riesgo"],["COMPLETED","Completados"],["PAUSED","Pausados"]].map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val as string)}
              className={`segment-new__btn ${filter === val ? "segment-new__btn--active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <CardNew>
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
            <Activity size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
            <div style={{ color: "var(--text-2)", fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              Sin planes de tratamiento
            </div>
            <div style={{ fontSize: 12 }}>Crea el primer plan para un paciente</div>
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(t => {
            const pct     = progressPct(t);
            const od      = daysOverdue(t);
            const isLate  = t.status === "ACTIVE" && od > 0;
            const cfg     = STATUS_TONE[t.status] ?? STATUS_TONE.ACTIVE;
            const patientName = `${t.patient.firstName} ${t.patient.lastName}`;

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t)}
                className="card"
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  border: isLate ? "1px solid rgba(245,158,11,0.3)" : "1px solid var(--border-soft)",
                  background: "var(--bg-elev)",
                  color: "inherit",
                  transition: "border-color .15s",
                }}
              >
                <div style={{ width: 3, height: 40, borderRadius: 2, background: t.doctor.color, flexShrink: 0 }} />

                <AvatarNew name={patientName} size="sm" />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{t.name}</span>
                    <BadgeNew tone={cfg.tone} dot>{cfg.label}</BadgeNew>
                    {isLate && <BadgeNew tone="warning" dot>{od}d sin venir</BadgeNew>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    <Link
                      href={`/dashboard/patients/${t.patient.id}`}
                      onClick={e => e.stopPropagation()}
                      style={{ color: "#c4b5fd", fontWeight: 500, textDecoration: "none" }}
                    >
                      {patientName}
                    </Link>
                    <span style={{ margin: "0 6px" }}>·</span>
                    Dr/a. {t.doctor.firstName} {t.doctor.lastName}
                    {t.nextExpectedDate && (
                      <>
                        <span style={{ margin: "0 6px" }}>·</span>
                        Próxima: {formatRelativeDate(t.nextExpectedDate)}
                      </>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: "right", flexShrink: 0, minWidth: 120 }}>
                  <div className="mono" style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 600 }}>
                    {t.sessions.length}/{t.totalSessions} sesiones
                  </div>
                  <div style={{ width: 100, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 6, marginLeft: "auto", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand)", borderRadius: 2 }} />
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
                    {fmtMXN(t.totalCost)}
                  </div>
                </div>

                <ChevronRight size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}

      {/* ── Detail modal ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <AvatarNew name={`${selected.patient.firstName} ${selected.patient.lastName}`} size="sm" />
                <div>
                  <div className="modal__title">{selected.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {selected.patient.firstName} {selected.patient.lastName}
                  </div>
                </div>
                <div style={{ marginLeft: 8 }}>
                  <BadgeNew tone={(STATUS_TONE[selected.status] ?? STATUS_TONE.ACTIVE).tone} dot>
                    {(STATUS_TONE[selected.status] ?? STATUS_TONE.ACTIVE).label}
                  </BadgeNew>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal__body">
              {/* Patient + doctor info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 18 }}>
                <div style={{ padding: 12, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 4 }}>Paciente</div>
                  <Link
                    href={`/dashboard/patients/${selected.patient.id}`}
                    onClick={() => setSelected(null)}
                    style={{ fontSize: 13, fontWeight: 600, color: "#c4b5fd", textDecoration: "none" }}
                  >
                    {selected.patient.firstName} {selected.patient.lastName}
                  </Link>
                  {selected.patient.phone && (
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{selected.patient.phone}</div>
                  )}
                </div>
                <div style={{ padding: 12, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 4 }}>Doctor</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: selected.doctor.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                      Dr/a. {selected.doctor.firstName} {selected.doctor.lastName}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--text-1)" }}>Progreso</span>
                  <span className="mono" style={{ color: "var(--text-3)" }}>
                    {selected.sessions.length}/{selected.totalSessions} ({progressPct(selected)}%)
                  </span>
                </div>
                <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${progressPct(selected)}%`,
                      background: selected.status === "COMPLETED" ? "var(--success)" : "var(--brand)",
                      borderRadius: 4,
                      transition: "width .3s",
                      boxShadow: selected.status === "COMPLETED" ? "0 0 8px var(--success)" : "0 0 8px var(--brand)",
                    }}
                  />
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 18 }}>
                {[
                  { label: "Costo total", val: formatCurrency(selected.totalCost) },
                  { label: "Intervalo",   val: `${selected.sessionIntervalDays} días` },
                  { label: "Sesiones",    val: `${selected.sessions.length}/${selected.totalSessions}` },
                ].map(s => (
                  <div
                    key={s.label}
                    style={{
                      padding: 12,
                      background: "var(--bg-elev-2)",
                      border: "1px solid var(--border-soft)",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                      {s.label}
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {/* Sessions timeline */}
              <div style={{ marginBottom: 18 }}>
                <div className="form-section__title">
                  Sesiones
                  <span className="form-section__rule" />
                </div>
                <div style={{ position: "relative", paddingLeft: 28 }}>
                  <div style={{
                    position: "absolute",
                    left: 11,
                    top: 4,
                    bottom: 4,
                    width: 2,
                    background: "var(--border-soft)",
                  }} />
                  {selected.sessions.map(s => (
                    <div key={s.id} style={{ position: "relative", marginBottom: 12 }}>
                      <div style={{
                        position: "absolute",
                        left: -22,
                        top: 6,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--success)",
                        border: "2px solid var(--success)",
                        display: "grid",
                        placeItems: "center",
                        boxShadow: "0 0 8px rgba(16,185,129,0.4)",
                      }}>
                        <CheckCircle size={12} style={{ color: "#fff" }} />
                      </div>
                      <div style={{
                        background: "var(--bg-elev)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: 8,
                        padding: 10,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>Sesión {s.sessionNumber}</div>
                            {s.notes && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{s.notes}</div>}
                          </div>
                          {s.completedAt && (
                            <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
                              {new Date(s.completedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, selected.totalSessions - selected.sessions.length) }).map((_, i) => (
                    <div key={`pending-${i}`} style={{ position: "relative", marginBottom: 12, opacity: 0.5 }}>
                      <div style={{
                        position: "absolute",
                        left: -22,
                        top: 6,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--bg-elev-2)",
                        border: "2px solid var(--border-soft)",
                        display: "grid",
                        placeItems: "center",
                      }}>
                        <Clock size={12} style={{ color: "var(--text-4)" }} />
                      </div>
                      <div style={{
                        background: "var(--bg-elev)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 12,
                        color: "var(--text-3)",
                      }}>
                        Sesión {selected.sessions.length + i + 1} · Pendiente
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add session */}
              {selected.status === "ACTIVE" && (
                <div style={{ marginBottom: 14 }}>
                  {addingSession === selected.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div className="form-section__title">
                        Registrar sesión
                        <span className="form-section__rule" />
                      </div>
                      <div className="field-new">
                        <label className="field-new__label">Notas de la sesión</label>
                        <textarea
                          className="input-new"
                          placeholder="Observaciones, progreso o notas clínicas (opcional)"
                          rows={3}
                          value={sessionNote}
                          onChange={e => setSessionNote(e.target.value)}
                        />
                      </div>

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

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <ButtonNew
                          variant="ghost"
                          onClick={() => { setAddingSession(null); setSessionNote(""); setSelInv([]); }}
                        >
                          Cancelar
                        </ButtonNew>
                        <ButtonNew
                          variant="primary"
                          onClick={() => addSession(selected.id)}
                          disabled={saving}
                          icon={<CheckCircle size={14} />}
                        >
                          {saving ? "Guardando…" : "Confirmar sesión"}
                        </ButtonNew>
                      </div>
                    </div>
                  ) : (
                    <ButtonNew
                      variant="primary"
                      onClick={() => setAddingSession(selected.id)}
                      icon={<Plus size={14} />}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Registrar sesión completada
                    </ButtonNew>
                  )}
                </div>
              )}

              {/* Status change */}
              {selected.status === "ACTIVE" && addingSession !== selected.id && (
                <div style={{ display: "flex", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                  <ButtonNew
                    variant="secondary"
                    onClick={() => changeStatus(selected.id, "PAUSED")}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Pausar
                  </ButtonNew>
                  <ButtonNew
                    variant="danger"
                    onClick={() => changeStatus(selected.id, "ABANDONED")}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Marcar abandonado
                  </ButtonNew>
                </div>
              )}
              {selected.status === "PAUSED" && (
                <ButtonNew
                  variant="primary"
                  onClick={() => changeStatus(selected.id, "ACTIVE")}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Reactivar tratamiento
                </ButtonNew>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New plan modal ── */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Nuevo plan de tratamiento</div>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal__body">
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Información general */}
                <div>
                  <div className="form-section__title">
                    Información general
                    <span className="form-section__rule" />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="field-new">
                      <label className="field-new__label">
                        Paciente <span className="req">*</span>
                      </label>
                      <select
                        className="input-new"
                        value={form.patientId}
                        onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))}
                      >
                        <option value="">Selecciona un paciente</option>
                        {patients.map(p => (
                          <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                        ))}
                      </select>
                    </div>

                    {isAdmin && (
                      <div className="field-new">
                        <label className="field-new__label">
                          Doctor <span className="req">*</span>
                        </label>
                        <select
                          className="input-new"
                          value={form.doctorId}
                          onChange={e => setForm(f => ({ ...f, doctorId: e.target.value }))}
                        >
                          {doctors.map(d => (
                            <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="field-new">
                      <label className="field-new__label">
                        Nombre del tratamiento <span className="req">*</span>
                      </label>
                      <input
                        className="input-new"
                        placeholder="Ej: Ortodoncia 18 meses"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {COMMON_TREATMENTS.slice(0, 5).map(t => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, name: t }))}
                            className="tag-new"
                            style={{ cursor: "pointer" }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="field-new">
                      <label className="field-new__label">Descripción</label>
                      <textarea
                        className="input-new"
                        placeholder="Notas o detalles del plan (opcional)"
                        rows={2}
                        value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Plan de sesiones */}
                <div>
                  <div className="form-section__title">
                    Plan de sesiones
                    <span className="form-section__rule" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
                    <div className="field-new">
                      <label className="field-new__label">Total de sesiones</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        className="input-new"
                        value={form.totalSessions}
                        onChange={e => setForm(f => ({ ...f, totalSessions: e.target.value }))}
                      />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">Días entre sesiones</label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        className="input-new"
                        value={form.sessionIntervalDays}
                        onChange={e => setForm(f => ({ ...f, sessionIntervalDays: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Costos */}
                <div>
                  <div className="form-section__title">
                    Costo
                    <span className="form-section__rule" />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Costo total del tratamiento (MXN)</label>
                    <input
                      type="number"
                      min="0"
                      className="input-new"
                      placeholder="0.00"
                      value={form.totalCost}
                      onChange={e => setForm(f => ({ ...f, totalCost: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" onClick={() => setShowNew(false)}>
                Cancelar
              </ButtonNew>
              <ButtonNew
                variant="primary"
                onClick={createPlan}
                disabled={saving || !form.patientId || !form.name.trim()}
              >
                {saving ? "Creando…" : "Crear plan"}
              </ButtonNew>
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
    <div className="field-new">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <label className="field-new__label" style={{ margin: 0 }}>Insumos utilizados</label>
        <button
          type="button"
          onClick={() => { setOpen(o => !o); if (!open) onOpen(); }}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#c4b5fd",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {open ? "Cerrar" : "+ Agregar insumo"}
        </button>
      </div>

      {/* Selected items */}
      {selected.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {selected.map(item => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", flex: 1 }}>{item.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => item.qty > 1 && onQtyChange(item.id, item.qty - 1)}
                  style={{
                    width: 22, height: 22, borderRadius: 6,
                    background: "var(--bg-elev)", border: "1px solid var(--border-soft)",
                    color: "var(--text-1)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  −
                </button>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", width: 28, textAlign: "center" }}>
                  {item.qty}
                </span>
                <button
                  type="button"
                  onClick={() => onQtyChange(item.id, item.qty + 1)}
                  style={{
                    width: 22, height: 22, borderRadius: 6,
                    background: "var(--bg-elev)", border: "1px solid var(--border-soft)",
                    color: "var(--text-1)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  +
                </button>
                <span style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 4 }}>{item.unit}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                style={{
                  color: "var(--danger)", background: "transparent", border: "none",
                  marginLeft: 4, fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
                aria-label="Eliminar insumo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Item picker dropdown */}
      {open && (
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--border-soft)" }}>
            <input
              className="input-new"
              placeholder="Buscar insumo…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {loading ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
              Cargando inventario…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
              Sin insumos{search ? " que coincidan" : " en inventario"}
            </div>
          ) : (
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {filtered.map(item => {
                const isSelected = !!selected.find(s => s.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { onAdd(item); }}
                    disabled={isSelected}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: "transparent",
                      border: "none",
                      textAlign: "left",
                      cursor: isSelected ? "not-allowed" : "pointer",
                      opacity: isSelected ? 0.45 : 1,
                      color: "var(--text-1)",
                    }}
                    onMouseOver={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg-elev-2)"; }}
                    onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 16 }}>{item.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                        {item.category} · {item.quantity} {item.unit} disponibles
                      </div>
                    </div>
                    {isSelected && (
                      <span style={{ fontSize: 10, color: "var(--success)", fontWeight: 700, flexShrink: 0 }}>✓ Agregado</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
