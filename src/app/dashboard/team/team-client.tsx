"use client";

import { useState, useMemo } from "react";
import { Plus, X, Edit, UserCheck, UserX, Trash2, Mail, Phone, Stethoscope, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const DOCTOR_COLORS = [
  "#3b82f6","#7c3aed","#059669","#e11d48","#d97706",
  "#0891b2","#db2777","#4338ca","#16a34a","#dc2626",
  "#9333ea","#0284c7","#f97316","#84cc16",
];

const ROLES = [
  { value:"DOCTOR",        label:"Doctor",        icon:"🩺", desc:"Ve y gestiona solo sus pacientes y citas" },
  { value:"ADMIN",         label:"Administrador", icon:"🛡️", desc:"Acceso completo a toda la clínica" },
  { value:"RECEPTIONIST",  label:"Recepcionista", icon:"📋", desc:"Puede ver agenda y crear citas, no expedientes" },
];

const SPECIALTIES = ["Medicina General","Odontología","Psicología","Nutrición","Dermatología","Pediatría","Ginecología","Ortopedia","Cardiología","Otra"];

interface TeamMember {
  id: string; firstName: string; lastName: string; email: string;
  role: string; specialty: string | null; color: string; avatarUrl: string | null;
  phone: string | null; isActive: boolean; createdAt: string;
  _count: { appointments: number; records: number; primaryPatients: number };
}

interface Props { team: TeamMember[]; currentUserId: string; clinicName: string }

export function TeamClient({ team: initialTeam, currentUserId, clinicName }: Props) {
  const [team,      setTeam]      = useState<TeamMember[]>(initialTeam);
  const [showNew,   setShowNew]   = useState(false);
  const [showEdit,  setShowEdit]  = useState<TeamMember | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [filter,    setFilter]    = useState<"all"|"active"|"inactive">("active");

  const emptyForm = { firstName:"", lastName:"", email:"", role:"DOCTOR", specialty:"", color:DOCTOR_COLORS[0], phone:"" };
  const [form, setForm] = useState(emptyForm);
  const setF = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const filtered = useMemo(() => {
    return team.filter(m =>
      filter === "all" ? true :
      filter === "active" ? m.isActive :
      !m.isActive
    );
  }, [team, filter]);

  const activeCount   = team.filter(m => m.isActive).length;
  const doctorCount   = team.filter(m => m.role === "DOCTOR" && m.isActive).length;
  const adminCount    = team.filter(m => m.role === "ADMIN" && m.isActive).length;

  // Auto-assign next available color
  const nextColor = useMemo(() => {
    const used = team.map(m => m.color);
    return DOCTOR_COLORS.find(c => !used.includes(c)) ?? DOCTOR_COLORS[0];
  }, [team]);

  async function inviteMember() {
    if (!form.firstName || !form.lastName || !form.email) { toast.error("Nombre y email son requeridos"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, color: form.color || nextColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTeam(prev => [...prev, { ...data, _count: { appointments:0, records:0, primaryPatients:0 } }]);
      setShowNew(false);
      setForm(emptyForm);
      toast.success(`✅ Invitación enviada a ${form.email}`);
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function updateMember() {
    if (!showEdit) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/team/${showEdit.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTeam(prev => prev.map(m => m.id === showEdit.id ? { ...m, ...form } : m));
      setShowEdit(null);
      toast.success("Datos actualizados");
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function toggleActive(member: TeamMember) {
    if (member.id === currentUserId) { toast.error("No puedes desactivarte a ti mismo"); return; }
    const action = member.isActive ? "desactivar" : "activar";
    if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} a ${member.firstName} ${member.lastName}?`)) return;
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      if (!res.ok) throw new Error("Error");
      setTeam(prev => prev.map(m => m.id === member.id ? { ...m, isActive: !m.isActive } : m));
      toast.success(member.isActive ? "Doctor desactivado" : "Doctor activado");
    } catch { toast.error("Error"); }
  }

  async function deleteMember(member: TeamMember) {
    if (member.id === currentUserId) { toast.error("No puedes eliminarte a ti mismo"); return; }
    if (!confirm(`¿Eliminar a ${member.firstName} ${member.lastName}? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.deactivated) {
        setTeam(prev => prev.map(m => m.id === member.id ? { ...m, isActive: false } : m));
        toast.success("Doctor desactivado (tiene registros históricos)");
      } else {
        setTeam(prev => prev.filter(m => m.id !== member.id));
        toast.success("Doctor eliminado");
      }
    } catch (err: any) { toast.error(err.message); }
  }

  const RoleIcon = ({ role }: { role: string }) => {
    if (role === "ADMIN") return <Shield className="w-3.5 h-3.5" />;
    if (role === "DOCTOR") return <Stethoscope className="w-3.5 h-3.5" />;
    return <User className="w-3.5 h-3.5" />;
  };

  const roleLabel = (role: string) => ROLES.find(r => r.value === role)?.label ?? role;

  const MemberForm = ({ onSubmit, label }: { onSubmit: () => void; label: string }) => (
    <div className="px-6 py-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Nombre *</Label>
          <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Juan" value={form.firstName} onChange={e => setF("firstName", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Apellido *</Label>
          <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="García" value={form.lastName} onChange={e => setF("lastName", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Email *</Label>
        <input type="email" className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="doctor@clinica.com" value={form.email} onChange={e => setF("email", e.target.value)} />
        <p className="text-sm text-muted-foreground">Se enviará una invitación a este email para que cree su contraseña.</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-base font-semibold">Rol en la clínica</Label>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map(r => (
            <button key={r.value} type="button" onClick={() => setF("role", r.value)}
              className={`flex flex-col items-center p-3 rounded-xl border-2 text-center transition-all ${form.role === r.value ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30" : "border-border hover:border-slate-400"}`}>
              <span className="text-xl mb-1">{r.icon}</span>
              <span className="text-sm font-bold">{r.label}</span>
              <span className="text-xs text-muted-foreground mt-0.5">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Especialidad</Label>
          <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
            value={form.specialty} onChange={e => setF("specialty", e.target.value)}>
            <option value="">Sin especialidad</option>
            {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">Teléfono</Label>
          <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
            placeholder="+52 999 000 0000" value={form.phone} onChange={e => setF("phone", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-base font-semibold">Color en agenda</Label>
        <div className="flex gap-2 flex-wrap">
          {DOCTOR_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setF("color", c)}
              className={`w-9 h-9 rounded-xl transition-all hover:scale-110 ${form.color === c ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-110" : ""}`}
              style={{ background: c }} />
          ))}
        </div>
        {form.color && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-4 h-4 rounded" style={{ background: form.color }} />
            Vista previa: así se verán las citas de este doctor en el calendario
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={() => { setShowNew(false); setShowEdit(null); }} className="flex-1 h-12 text-base">Cancelar</Button>
        <Button onClick={onSubmit} disabled={loading} className="flex-1 h-12 text-base">
          {loading ? "Guardando…" : label}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">👥 Equipo médico</h1>
          <p className="text-base text-muted-foreground mt-0.5">{clinicName} · {activeCount} miembro{activeCount !== 1 ? "s" : ""} activo{activeCount !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={() => { setForm({ ...emptyForm, color: nextColor }); setShowNew(true); }}>
          <Plus className="w-5 h-5 mr-2" /> Invitar miembro
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label:"Doctores activos",        val:doctorCount,   color:"text-brand-600",   icon:"🩺" },
          { label:"Administradores",          val:adminCount,    color:"text-violet-600",  icon:"🛡️" },
          { label:"Total miembros activos",   val:activeCount,   color:"text-emerald-600", icon:"👥" },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-slate-900 border border-border rounded-2xl px-5 py-4 shadow-card">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{s.icon}</span>
            </div>
            <div className={`text-3xl font-extrabold ${s.color}`}>{s.val}</div>
            <div className="text-base text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(["active","all","inactive"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-base font-semibold transition-colors ${filter === f ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-900 border border-border hover:border-slate-400"}`}>
            {f === "active" ? "Activos" : f === "all" ? "Todos" : "Inactivos"}
          </button>
        ))}
      </div>

      {/* Team list */}
      <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-base font-semibold">No hay miembros en esta vista</p>
            <button onClick={() => { setForm({ ...emptyForm, color: nextColor }); setShowNew(true); }}
              className="mt-2 text-base text-brand-600 hover:underline font-semibold">
              + Invitar primer miembro
            </button>
          </div>
        ) : filtered.map((member, idx) => (
          <div key={member.id}
            className={`flex items-center gap-4 px-6 py-4 group transition-colors hover:bg-muted/10 ${idx > 0 ? "border-t border-border/50" : ""} ${!member.isActive ? "opacity-60" : ""}`}>

            {/* Avatar with color */}
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-base flex-shrink-0"
              style={{ background: member.color }}>
              {member.firstName[0]}{member.lastName[0]}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold">{member.firstName} {member.lastName}</span>
                {member.id === currentUserId && (
                  <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">Tú</span>
                )}
                <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                  member.role === "ADMIN" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" :
                  member.role === "DOCTOR" ? "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" :
                  "bg-slate-100 text-slate-600 dark:bg-slate-800"
                }`}>
                  <RoleIcon role={member.role} />
                  {roleLabel(member.role)}
                </span>
                {!member.isActive && (
                  <span className="text-xs font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">Inactivo</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />{member.email}
                </span>
                {member.specialty && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Stethoscope className="w-3.5 h-3.5" />{member.specialty}
                  </span>
                )}
                {member.phone && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />{member.phone}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1.5">
                {[
                  { label:"citas",     val:member._count.appointments },
                  { label:"expedientes",val:member._count.records },
                  { label:"pacientes", val:member._count.primaryPatients },
                ].map(s => (
                  <span key={s.label} className="text-sm text-muted-foreground">
                    <strong className="text-foreground">{s.val}</strong> {s.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Color dot */}
            <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: member.color }} title="Color en agenda" />

            {/* Actions */}
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button onClick={() => { setForm({ firstName:member.firstName, lastName:member.lastName, email:member.email, role:member.role, specialty:member.specialty??"", color:member.color, phone:member.phone??"" }); setShowEdit(member); }}
                className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Editar">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => toggleActive(member)}
                className={`p-2 rounded-xl hover:bg-muted transition-colors ${member.isActive ? "text-amber-600 hover:text-amber-700" : "text-emerald-600 hover:text-emerald-700"}`}
                title={member.isActive ? "Desactivar" : "Activar"}>
                {member.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
              </button>
              {member.id !== currentUserId && (
                <button onClick={() => deleteMember(member)}
                  className="p-2 rounded-xl hover:bg-muted text-rose-500 hover:text-rose-700 transition-colors" title="Eliminar">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="mt-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-sm text-blue-700 dark:text-blue-300">
        <strong>¿Cómo funciona la invitación?</strong> Al agregar un miembro, recibirá un email con un enlace para crear su contraseña. Una vez que la cree, podrá acceder al sistema con los permisos de su rol asignado. Los doctores solo verán sus propios pacientes y citas. Los administradores tienen acceso completo a toda la clínica.
      </div>

      {/* New member modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h2 className="text-xl font-bold">Invitar miembro al equipo</h2>
              <button onClick={() => setShowNew(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <MemberForm onSubmit={inviteMember} label="📧 Enviar invitación" />
          </div>
        </div>
      )}

      {/* Edit member modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h2 className="text-xl font-bold">Editar — {showEdit.firstName} {showEdit.lastName}</h2>
              <button onClick={() => setShowEdit(null)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <MemberForm onSubmit={updateMember} label="💾 Guardar cambios" />
          </div>
        </div>
      )}
    </div>
  );
}
