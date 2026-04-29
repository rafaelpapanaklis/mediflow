"use client";

import { useState, useMemo } from "react";
import { Plus, X, Edit, UserCheck, UserX, Trash2, Copy, Check, Stethoscope, Shield, ShieldCheck, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PermissionsModal } from "@/components/dashboard/team/permissions-modal";

type RoleTone = "success" | "info" | "warning" | "brand" | "neutral";
const ROLE_TONE: Record<string, { tone: RoleTone; label: string }> = {
  SUPER_ADMIN:  { tone: "brand",   label: "Super Admin" },
  ADMIN:        { tone: "info",    label: "Admin" },
  DOCTOR:       { tone: "success", label: "Doctor" },
  RECEPTIONIST: { tone: "warning", label: "Recepcionista" },
  READONLY:     { tone: "neutral", label: "Solo lectura" },
};

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
// MediFlow es DENTAL — solo specialties dentales en el selector del
// equipo. Si el SaaS expande a multi-specialty, restaurar la lista
// general aquí.
const SPECIALTIES = [
  "Odontología General",
  "Ortodoncia",
  "Endodoncia",
  "Periodoncia",
  "Cirugía Maxilofacial",
  "Implantología",
  "Odontopediatría",
  "Prostodoncia",
  "Estética Dental",
  "Otra",
];

interface FormState {
  firstName: string; lastName: string; email: string;
  role: string; specialty: string; color: string;
  phone: string; services: string[];
  // NOM-024
  cedulaProfesional: string;
  especialidad: string;
  cedulaEspecialidad: string;
}
interface TeamMember {
  id: string; firstName: string; lastName: string; email: string;
  role: string; specialty: string | null; color: string; services: string[];
  avatarUrl: string | null; phone: string | null;
  isActive: boolean; createdAt: string;
  cedulaProfesional?: string | null;
  especialidad?: string | null;
  cedulaEspecialidad?: string | null;
  permissionsOverride?: string[];
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
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Juan"
            value={form.firstName}
            onChange={e => set("firstName", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Apellido *</Label>
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
          className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
              className={`flex flex-col items-center p-3 rounded-xl border-2 text-center transition-all ${form.role === r.value ? "border-brand-500 bg-brand-600/15" : "border-border hover:border-slate-400"}`}>
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
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
            value={form.specialty}
            onChange={e => set("specialty", e.target.value)}>
            <option value="">Sin especialidad</option>
            {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Teléfono</Label>
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
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
            className="flex h-11 flex-1 rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
            placeholder="Ej: Ortodoncia, Implantes, Limpieza…"
            value={svcInput}
            onChange={e => setSvcInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSvc(); } }}
          />
          <button type="button" onClick={addSvc}
            className="h-11 px-4 rounded-xl border border-border bg-card font-bold text-xl hover:bg-muted transition-colors">
            +
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Presiona Enter o coma para agregar cada servicio</p>
        {form.services.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {form.services.map(s => (
              <span key={s} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-500/15 text-brand-700 dark:text-brand-300 px-3 py-1 rounded-full">
                {s}
                <button type="button" onClick={() => set("services", form.services.filter(x => x !== s))}
                  className="text-brand-500 hover:text-brand-900 font-bold leading-none ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* NOM-024 — Datos del médico */}
      <div className="space-y-3 pt-1">
        <Label className="text-base font-semibold">Identificación profesional (NOM-024)</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Cédula profesional</Label>
            <input
              className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base font-mono focus:outline-none"
              placeholder="1234567"
              maxLength={15}
              value={form.cedulaProfesional}
              onChange={e => set("cedulaProfesional", e.target.value.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Cédula de especialidad</Label>
            <input
              className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base font-mono focus:outline-none"
              placeholder="Si tiene"
              maxLength={15}
              value={form.cedulaEspecialidad}
              onChange={e => set("cedulaEspecialidad", e.target.value.trim())}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm text-muted-foreground">Especialidad oficial (NOM-024)</Label>
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
            placeholder="Ej. Odontología, Pediatría — texto formal para recetas"
            maxLength={100}
            value={form.especialidad}
            onChange={e => set("especialidad", e.target.value)}
          />
        </div>
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
interface Props { team: TeamMember[]; currentUserId: string; currentUserRole: string; clinicName: string }

export function TeamClient({ team: initialTeam, currentUserId, currentUserRole, clinicName }: Props) {
  const askConfirm = useConfirm();
  const [team,       setTeam]       = useState<TeamMember[]>(initialTeam);
  const [showNew,    setShowNew]    = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  // Member cuyo modal de permisos está abierto. Solo SUPER_ADMIN puede abrirlo.
  const [permsMember, setPermsMember] = useState<TeamMember | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [filter,     setFilter]     = useState<"active"|"all"|"inactive">("active");
  const [tempPass,   setTempPass]   = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  const isSuperAdmin = currentUserRole === "SUPER_ADMIN";

  const usedColors = team.map(m => m.color);
  const nextColor  = DOCTOR_COLORS.find(c => !usedColors.includes(c)) ?? DOCTOR_COLORS[0];

  const emptyForm = (): FormState => ({
    firstName:"", lastName:"", email:"", role:"DOCTOR",
    specialty:"", color: nextColor, phone:"", services:[],
    cedulaProfesional: "", especialidad: "", cedulaEspecialidad: "",
  });

  const [form, setForm] = useState<FormState>(emptyForm);

  const filtered = useMemo(() =>
    team.filter(m => filter === "all" ? true : filter === "active" ? m.isActive : !m.isActive),
    [team, filter]
  );

  const active  = team.filter(m => m.isActive).length;
  const doctors = team.filter(m => m.role === "DOCTOR" && m.isActive).length;
  const admins  = team.filter(m => (m.role === "ADMIN" || m.role === "SUPER_ADMIN") && m.isActive).length;

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
    if (!(await askConfirm({
      title: `¿Eliminar a ${m.firstName} ${m.lastName}?`,
      description: "Si tiene citas o registros, será desactivado en lugar de eliminado.",
      variant: "danger",
      confirmText: "Eliminar",
    }))) return;
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
      cedulaProfesional:  m.cedulaProfesional  ?? "",
      especialidad:       m.especialidad       ?? "",
      cedulaEspecialidad: m.cedulaEspecialidad ?? "",
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
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Equipo médico
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {clinicName} · {active} miembro{active !== 1 ? "s" : ""} activo{active !== 1 ? "s" : ""}
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => { setForm(emptyForm()); setShowNew(true); }}>
          Invitar miembro
        </ButtonNew>
      </div>

      {/* Temp password banner */}
      {tempPass && (
        <div style={{
          background: "var(--warning-soft)",
          border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: "var(--radius-lg)",
          padding: 16, marginBottom: 18,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fcd34d", marginBottom: 4 }}>
                Doctor creado — contraseña temporal
              </div>
              <div style={{ fontSize: 11, color: "#fcd34d", opacity: 0.8, marginBottom: 10 }}>
                Comparte esta contraseña con el doctor. Puede cambiarla en Configuración → Seguridad.
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <code className="mono" style={{
                  fontSize: 13, fontWeight: 700,
                  background: "rgba(245,158,11,0.2)",
                  color: "#fde68a",
                  padding: "6px 14px",
                  borderRadius: 8,
                  letterSpacing: 2,
                }}>{tempPass}</code>
                <ButtonNew variant="secondary" size="sm" onClick={copyPass} icon={copied ? <Check size={12} /> : <Copy size={12} />}>
                  {copied ? "Copiado" : "Copiar"}
                </ButtonNew>
              </div>
            </div>
            <button
              onClick={() => setTempPass(null)}
              type="button"
              className="btn-new btn-new--ghost btn-new--sm"
              aria-label="Cerrar"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Total activos"      value={String(active)}   icon={UsersIcon} />
        <KpiCard label="Doctores"           value={String(doctors)}  icon={Stethoscope} />
        <KpiCard label="Administradores"    value={String(admins)}   icon={Shield} />
        <KpiCard label="Total miembros"     value={String(team.length)} icon={UsersIcon} />
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="segment-new">
          {(["active", "all", "inactive"] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`segment-new__btn ${filter === f ? "segment-new__btn--active" : ""}`}
            >
              {f === "active" ? "Activos" : f === "all" ? "Todos" : "Inactivos"}
            </button>
          ))}
        </div>
      </div>

      {/* List — grid de tarjetas */}
      {filtered.length === 0 ? (
        <CardNew>
          <div style={{ padding: 40, textAlign: "center" }}>
            <UsersIcon size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-2)", fontSize: 14, fontWeight: 500 }}>No hay miembros</p>
            <div style={{ marginTop: 12 }}>
              <ButtonNew
                variant="primary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => { setForm(emptyForm()); setShowNew(true); }}
              >
                Agregar primer doctor
              </ButtonNew>
            </div>
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {filtered.map(m => {
            const fullName = `${m.firstName} ${m.lastName}`;
            const roleCfg = ROLE_TONE[m.role] ?? ROLE_TONE.DOCTOR;
            return (
              <div key={m.id} className="card" style={{ padding: 20, opacity: m.isActive ? 1 : 0.5 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                  <AvatarNew name={fullName} size="lg" />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
                    <h3 style={{ fontSize: 14, color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
                      {fullName}
                    </h3>
                    {m.id === currentUserId && (
                      <span className="tag-new" style={{ color: "#c4b5fd", borderColor: "rgba(124,58,237,0.2)", background: "var(--brand-soft)" }}>Tú</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{m.email}</div>
                  {m.specialty && (
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{m.specialty}</div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    <BadgeNew tone={roleCfg.tone} dot>{roleCfg.label}</BadgeNew>
                    {!m.isActive && <BadgeNew tone="danger" dot>Inactivo</BadgeNew>}
                  </div>

                  {m.services?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10, justifyContent: "center" }}>
                      {m.services.slice(0, 4).map(s => (
                        <span key={s} className="tag-new">{s}</span>
                      ))}
                      {m.services.length > 4 && (
                        <span style={{ fontSize: 10, color: "var(--text-3)" }}>+{m.services.length - 4}</span>
                      )}
                    </div>
                  )}

                  {/* Stats mini */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: 10,
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: "1px solid var(--border-soft)",
                    width: "100%",
                  }}>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Citas</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", marginTop: 2 }}>
                        {m._count.appointments}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Expedientes</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", marginTop: 2 }}>
                        {m._count.records}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
                    <ButtonNew size="sm" variant="secondary" icon={<Edit size={12} />} onClick={() => openEdit(m)}>
                      Editar
                    </ButtonNew>
                    {/* Permisos: solo visible para SUPER_ADMIN, y NO sobre otros
                     *  SUPER_ADMIN (defensa contra lock-out cruzado en endpoint).
                     *  Sobre el propio user igual lo permitimos — útil para
                     *  un super que quiera bajarse permisos de prueba. */}
                    {isSuperAdmin && m.role !== "SUPER_ADMIN" && (
                      <ButtonNew
                        size="sm"
                        variant="secondary"
                        icon={<ShieldCheck size={12} />}
                        onClick={() => setPermsMember(m)}
                      >
                        Permisos
                      </ButtonNew>
                    )}
                    {m.id !== currentUserId && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleActive(m)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          title={m.isActive ? "Desactivar" : "Activar"}
                        >
                          {m.isActive ? <UserX size={12} /> : <UserCheck size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMember(m)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          title="Eliminar"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background:"rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="bg-card rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
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
          <div className="bg-card rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
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

      {/* Permisos granulares — solo SUPER_ADMIN. El modal ya gatea su propia
       *  lógica (toggle "usar default", agrupado por categoría, validación). */}
      <PermissionsModal
        open={permsMember !== null}
        member={permsMember}
        onClose={() => setPermsMember(null)}
        onSaved={(memberId, newOverride) => {
          setTeam(prev => prev.map(m =>
            m.id === memberId ? { ...m, permissionsOverride: newOverride } : m,
          ));
        }}
      />
    </div>
  );
}
