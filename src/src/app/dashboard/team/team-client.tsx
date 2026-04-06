"use client";

import { useState, useMemo } from "react";
import { Plus, X, Edit, UserCheck, UserX, Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const DOCTOR_COLORS = [
  "#3b82f6","#7c3aed","#059669","#e11d48","#d97706",
  "#0891b2","#db2777","#4338ca","#16a34a","#dc2626",
  "#9333ea","#0284c7","#f97316","#84cc16",
];
const ROLES = [
  { value:"DOCTOR",       label:"Doctor",        icon:"🩺", desc:"Sus pacientes y citas" },
  { value:"ADMIN",        label:"Administrador", icon:"🛡️", desc:"Acceso completo"        },
  { value:"RECEPTIONIST", label:"Recepcionista", icon:"📋", desc:"Agenda y citas"          },
];
const SPECIALTIES = [
  "Medicina General","Odontología","Psicología","Nutrición","Dermatología",
  "Pediatría","Ginecología","Ortopedia","Cardiología","Otra",
];

interface FormState {
  firstName: string; lastName: string; email: string;
  role: string; specialty: string; color: string;
  phone: string; services: string[];
}
interface TeamMember {
  id: string; firstName: string; lastName: string; email: string;
  role: string; specialty: string | null; color: string; services: string[];
  avatarUrl: string | null; phone: string | null;
  isActive: boolean; createdAt: string;
  _count: { appointments: number; records: number };
}

// ── MemberForm declared OUTSIDE TeamClient ──────────────────────────────────
// This is the fix for Bug 1 (focus loss) and Bug 2 (validation).
// When defined inside TeamClient as `const MemberForm = ...`, React treats it
// as a new component type on every render and unmounts/remounts the inputs,
// causing focus loss on every keystroke. Defined outside, it is stable.
function MemberForm({
  form, setForm, onSubmit, onCancel, loading, isEdit,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: () => void;
  onCancel: () => void;
  loading: boolean;
  isEdit: boolean;
}) {
  const [svcInput, setSvcInput] = useState("");

  function set(k: keyof FormState, v: any) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function addSvc() {
    const val = svcInput.trim().replace(/,+$/, "");
    if (val && !form.services.includes(val)) set("services", [...form.services, val]);
    setSvcInput("");
  }

  return (
    <div className="px-6 py-5 space-y-4">
      {/* Name */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Nombre *</Label>
          <input
            autoFocus
            className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Juan"
            value={form.firstName}
            onChange={e => set("firstName", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Apellido *</Label>
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="García"
            value={form.lastName}
            onChange={e => set("lastName", e.target.value)}
          />
        </div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Email *</Label>
        <input
          type="email"
          className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="doctor@clinica.com"
          value={form.email}
          onChange={e => set("email", e.target.value)}
          disabled={isEdit}
        />
        {!isEdit && (
          <p className="text-sm text-muted-foreground">
            La cuenta se crea al instante. Se muestra una contraseña temporal para compartir con el doctor.
          </p>
        )}
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Rol</Label>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map(r => (
            <button key={r.value} type="button" onClick={() => set("role", r.value)}
              className={`flex flex-col items-center p-3 rounded-xl border-2 text-center transition-all ${form.role === r.value ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30" : "border-border hover:border-slate-400"}`}>
              <span className="text-xl mb-1">{r.icon}</span>
              <span className="text-sm font-bold">{r.label}</span>
              <span className="text-xs text-muted-foreground mt-0.5 leading-tight">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Specialty + Phone */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Especialidad</Label>
          <select
            className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
            value={form.specialty}
            onChange={e => set("specialty", e.target.value)}>
            <option value="">Sin especialidad</option>
            {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Teléfono</Label>
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
            placeholder="+52 999 000 0000"
            value={form.phone}
            onChange={e => set("phone", e.target.value)}
          />
        </div>
      </div>

      {/* Services */}
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Servicios / Tratamientos que realiza</Label>
        <div className="flex gap-2">
          <input
            className="flex h-11 flex-1 rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
            placeholder="Ej: Ortodoncia, Implantes, Limpieza…"
            value={svcInput}
            onChange={e => setSvcInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSvc(); } }}
          />
          <button type="button" onClick={addSvc}
            className="h-11 px-4 rounded-xl border border-border bg-white dark:bg-slate-800 font-bold text-xl hover:bg-muted transition-colors">
            +
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Presiona Enter o coma para agregar cada servicio</p>
        {form.services.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {form.services.map(s => (
              <span key={s} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-3 py-1 rounded-full">
                {s}
                <button type="button" onClick={() => set("services", form.services.filter(x => x !== s))}
                  className="text-brand-500 hover:text-brand-900 font-bold leading-none ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Color */}
      <div className="space-y-2">
        <Label className="text-base font-semibold">Color en agenda</Label>
        <div className="flex gap-2 flex-wrap">
          {DOCTOR_COLORS.map(c => (
            <button key={c} type="button" onClick={() => set("color", c)}
              className={`w-9 h-9 rounded-xl transition-all hover:scale-110 ${form.color === c ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-110" : ""}`}
              style={{ background: c }} />
          ))}
        </div>
        {form.color && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-4 h-4 rounded" style={{ background: form.color }} />
            Así se verán las citas de este doctor en el calendario
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 h-12 text-base">Cancelar</Button>
        <Button onClick={onSubmit} disabled={loading} className="flex-1 h-12 text-base">
          {loading ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear doctor"}
        </Button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
interface Props { team: TeamMember[]; currentUserId: string; clinicName: string }

export function TeamClient({ team: initialTeam, currentUserId, clinicName }: Props) {
  const [team,       setTeam]       = useState<TeamMember[]>(initialTeam);
  const [showNew,    setShowNew]    = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [filter,     setFilter]     = useState<"active"|"all"|"inactive">("active");
  const [tempPass,   setTempPass]   = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  const usedColors = team.map(m => m.color);
  const nextColor  = DOCTOR_COLORS.find(c => !usedColors.includes(c)) ?? DOCTOR_COLORS[0];

  const emptyForm = (): FormState => ({
    firstName:"", lastName:"", email:"", role:"DOCTOR",
    specialty:"", color: nextColor, phone:"", services:[],
  });

  const [form, setForm] = useState<FormState>(emptyForm);

  const filtered = useMemo(() =>
    team.filter(m => filter === "all" ? true : filter === "active" ? m.isActive : !m.isActive),
    [team, filter]
  );

  const active  = team.filter(m => m.isActive).length;
  const doctors = team.filter(m => m.role === "DOCTOR" && m.isActive).length;
  const admins  = team.filter(m => m.role === "ADMIN"  && m.isActive).length;

  async function createDoctor() {
    // Read current form state directly — no stale closure issue
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      toast.error("Nombre, apellido y email son requeridos");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/team", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTeam(prev => [...prev, { ...data, _count:{ appointments:0, records:0 } }]);
      setTempPass(data.tempPassword ?? null);
      setShowNew(false);
      setForm(emptyForm());
      toast.success(`✅ Doctor ${data.firstName} ${data.lastName} creado`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateDoctor() {
    if (!editMember) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/team/${editMember.id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTeam(prev => prev.map(m => m.id === editMember.id ? { ...m, ...form } : m));
      setEditMember(null);
      toast.success("Datos actualizados");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(m: TeamMember) {
    if (m.id === currentUserId) { toast.error("No puedes desactivarte"); return; }
    try {
      const res = await fetch(`/api/team/${m.id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      if (!res.ok) throw new Error();
      setTeam(prev => prev.map(t => t.id === m.id ? { ...t, isActive: !m.isActive } : t));
      toast.success(m.isActive ? "Doctor desactivado" : "Doctor reactivado");
    } catch { toast.error("Error"); }
  }

  async function deleteMember(m: TeamMember) {
    if (m.id === currentUserId) { toast.error("No puedes eliminarte"); return; }
    if (!confirm(`¿Eliminar a ${m.firstName} ${m.lastName}?`)) return;
    try {
      const res = await fetch(`/api/team/${m.id}`, { method:"DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.deactivated) {
        setTeam(prev => prev.map(t => t.id === m.id ? { ...t, isActive:false } : t));
        toast.success("Doctor desactivado (tiene registros)");
      } else {
        setTeam(prev => prev.filter(t => t.id !== m.id));
        toast.success("Doctor eliminado");
      }
    } catch (err: any) { toast.error(err.message); }
  }

  function openEdit(m: TeamMember) {
    setForm({
      firstName: m.firstName, lastName: m.lastName, email: m.email,
      role: m.role, specialty: m.specialty ?? "", color: m.color,
      phone: m.phone ?? "", services: m.services ?? [],
    });
    setEditMember(m);
  }

  function copyPass() {
    if (!tempPass) return;
    navigator.clipboard.writeText(tempPass);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">👥 Equipo médico</h1>
          <p className="text-base text-muted-foreground mt-0.5">
            {clinicName} · {active} miembro{active !== 1 ? "s" : ""} activo{active !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm()); setShowNew(true); }}>
          <Plus className="w-5 h-5 mr-2" /> Agregar doctor
        </Button>
      </div>

      {/* Temp password banner */}
      {tempPass && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-2xl p-4 mb-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">🔑</span>
            <div className="flex-1">
              <div className="text-base font-bold text-amber-800 dark:text-amber-200 mb-1">
                Doctor creado — contraseña temporal
              </div>
              <div className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                Comparte esta contraseña con el doctor. Puede cambiarla en Configuración → Seguridad.
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <code className="text-base font-mono font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100 px-4 py-2 rounded-xl tracking-widest">
                  {tempPass}
                </code>
                <button onClick={copyPass}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors">
                  {copied ? <Check className="w-4 h-4"/> : <Copy className="w-4 h-4"/>}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
            <button onClick={() => setTempPass(null)} className="text-amber-600 hover:text-amber-800 p-1">
              <X className="w-4 h-4"/>
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label:"Doctores activos", val:doctors, color:"text-brand-600",   icon:"🩺" },
          { label:"Administradores",  val:admins,  color:"text-violet-600",  icon:"🛡️" },
          { label:"Total activos",    val:active,  color:"text-emerald-600", icon:"👥" },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-slate-900 border border-border rounded-2xl px-5 py-4 shadow-card">
            <div className="text-xl mb-1">{s.icon}</div>
            <div className={`text-3xl font-extrabold ${s.color}`}>{s.val}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(["active","all","inactive"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${filter === f ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-900 border border-border hover:border-slate-400"}`}>
            {f === "active" ? "Activos" : f === "all" ? "Todos" : "Inactivos"}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-base font-semibold">No hay miembros</p>
            <button onClick={() => { setForm(emptyForm()); setShowNew(true); }}
              className="mt-2 text-sm text-brand-600 hover:underline font-semibold">
              + Agregar primer doctor
            </button>
          </div>
        ) : filtered.map((m, idx) => (
          <div key={m.id}
            className={`flex items-center gap-4 px-6 py-4 group hover:bg-muted/10 transition-colors ${idx > 0 ? "border-t border-border/50" : ""} ${!m.isActive ? "opacity-60" : ""}`}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-base flex-shrink-0"
              style={{ background: m.color }}>
              {m.firstName[0]}{m.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base">{m.firstName} {m.lastName}</span>
                {m.id === currentUserId && (
                  <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">Tú</span>
                )}
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  m.role === "ADMIN" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" :
                  m.role === "DOCTOR" ? "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" :
                  "bg-slate-100 text-slate-600"
                }`}>
                  {ROLES.find(r => r.value === m.role)?.label ?? m.role}
                </span>
                {!m.isActive && <span className="text-xs font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">Inactivo</span>}
              </div>
              <div className="text-sm text-muted-foreground">{m.email}</div>
              {m.specialty && <div className="text-sm text-muted-foreground">{m.specialty}</div>}
              {m.services?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {m.services.slice(0,4).map(s => (
                    <span key={s} className="text-xs bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full font-medium">{s}</span>
                  ))}
                  {m.services.length > 4 && <span className="text-xs text-muted-foreground">+{m.services.length-4}</span>}
                </div>
              )}
            </div>
            <div className="hidden md:flex items-center gap-4 text-sm text-muted-foreground flex-shrink-0">
              <span>{m._count.appointments} citas</span>
              <span>{m._count.records} exp.</span>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button onClick={() => openEdit(m)}
                className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Edit className="w-4 h-4"/>
              </button>
              {m.id !== currentUserId && (
                <>
                  <button onClick={() => toggleActive(m)}
                    className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    {m.isActive ? <UserX className="w-4 h-4"/> : <UserCheck className="w-4 h-4"/>}
                  </button>
                  <button onClick={() => deleteMember(m)}
                    className="p-2 rounded-xl hover:bg-rose-50 text-muted-foreground hover:text-rose-600 transition-colors">
                    <Trash2 className="w-4 h-4"/>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* New modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background:"rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h2 className="text-lg font-bold">Agregar doctor</h2>
              <button onClick={() => setShowNew(false)} className="p-1.5 rounded-xl hover:bg-muted">
                <X className="w-5 h-5"/>
              </button>
            </div>
            <MemberForm
              form={form} setForm={setForm}
              onSubmit={createDoctor} onCancel={() => setShowNew(false)}
              loading={loading} isEdit={false}
            />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editMember && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background:"rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) setEditMember(null); }}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h2 className="text-lg font-bold">Editar — {editMember.firstName} {editMember.lastName}</h2>
              <button onClick={() => setEditMember(null)} className="p-1.5 rounded-xl hover:bg-muted">
                <X className="w-5 h-5"/>
              </button>
            </div>
            <MemberForm
              form={form} setForm={setForm}
              onSubmit={updateDoctor} onCancel={() => setEditMember(null)}
              loading={loading} isEdit={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
