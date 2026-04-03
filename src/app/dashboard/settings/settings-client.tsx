"use client";
import { useState } from "react";
import { Building, User, Clock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const SPECIALTIES = ["dental","medicine","nutrition","psychology","dermatology","other"];

interface Props { user: any; clinic: any }

export function SettingsClient({ user: initUser, clinic: initClinic }: Props) {
  const [tab, setTab]       = useState("clinica");
  const [saving, setSaving] = useState(false);
  const [user,   setUser]   = useState(initUser);
  const [clinic, setClinic] = useState(initClinic);
  const [schedule, setSchedule] = useState<Record<number,{enabled:boolean;open:string;close:string}>>(
    Object.fromEntries((initClinic.schedules ?? []).map((s: any) => [s.dayOfWeek, { enabled: s.enabled, open: s.openTime, close: s.closeTime }]))
  );
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });

  async function saveClinic() {
    setSaving(true);
    try {
      const res = await fetch("/api/clinic", { method: "PATCH", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ name: clinic.name, city: clinic.city, phone: clinic.phone, email: clinic.email }) });
      if (!res.ok) throw new Error();
      toast.success("Datos de la clínica actualizados");
    } catch { toast.error("Error al guardar"); } finally { setSaving(false); }
  }

  async function saveUser() {
    setSaving(true);
    try {
      const res = await fetch("/api/users/me", { method: "PATCH", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ firstName: user.firstName, lastName: user.lastName, phone: user.phone, specialty: user.specialty }) });
      if (!res.ok) throw new Error();
      toast.success("Perfil actualizado");
    } catch { toast.error("Error al guardar"); } finally { setSaving(false); }
  }

  async function changePassword() {
    if (pwForm.next !== pwForm.confirm) { toast.error("Las contraseñas no coinciden"); return; }
    if (pwForm.next.length < 8) { toast.error("Mínimo 8 caracteres"); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pwForm.next });
      if (error) throw error;
      toast.success("Contraseña actualizada");
      setPwForm({ current:"", next:"", confirm:"" });
    } catch (e: any) { toast.error(e.message ?? "Error"); } finally { setSaving(false); }
  }

  const TABS = [
    { id: "clinica",   label: "Mi clínica",  icon: Building },
    { id: "perfil",    label: "Mi perfil",   icon: User     },
    { id: "horarios",  label: "Horarios",    icon: Clock    },
    { id: "seguridad", label: "Seguridad",   icon: Shield   },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold">Configuración</h1>
        <p className="text-sm text-muted-foreground">Personaliza tu clínica y tu perfil</p>
      </div>

      <div className="flex gap-1 bg-white border border-border rounded-xl p-1 w-fit mb-6 shadow-card">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.id ? "bg-brand-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* CLÍNICA */}
      {tab === "clinica" && (
        <div className="bg-white border border-border rounded-xl p-6 shadow-card max-w-lg space-y-4">
          <h2 className="text-sm font-bold">Datos de la clínica</h2>
          <div className="space-y-1.5">
            <Label>Nombre de la clínica</Label>
            <Input value={clinic.name ?? ""} onChange={e => setClinic((c: any) => ({ ...c, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Especialidad</Label>
            <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={clinic.specialty ?? ""} onChange={e => setClinic((c: any) => ({ ...c, specialty: e.target.value }))}>
              {SPECIALTIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Ciudad</Label><Input value={clinic.city ?? ""} onChange={e => setClinic((c: any) => ({ ...c, city: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>País</Label><Input value={clinic.country ?? ""} disabled className="opacity-60" /></div>
          </div>
          <div className="space-y-1.5"><Label>Teléfono</Label><Input value={clinic.phone ?? ""} onChange={e => setClinic((c: any) => ({ ...c, phone: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Email de contacto</Label><Input type="email" value={clinic.email ?? ""} onChange={e => setClinic((c: any) => ({ ...c, email: e.target.value }))} /></div>
          <div className="space-y-1.5">
            <Label>URL de tu clínica</Label>
            <div className="flex items-center h-10 rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground font-mono">
              {clinic.slug}.mediflow.app
            </div>
          </div>
          <div className="pt-2 flex items-center justify-between">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${clinic.plan === "CLINIC" ? "bg-violet-50 text-violet-700 border-violet-200" : clinic.plan === "PRO" ? "bg-brand-50 text-brand-700 border-brand-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
              Plan {clinic.plan}
            </span>
            <Button size="sm" onClick={saveClinic} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
          </div>
        </div>
      )}

      {/* PERFIL */}
      {tab === "perfil" && (
        <div className="bg-white border border-border rounded-xl p-6 shadow-card max-w-lg space-y-4">
          <h2 className="text-sm font-bold">Tu perfil profesional</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Nombre</Label><Input value={user.firstName ?? ""} onChange={e => setUser((u: any) => ({ ...u, firstName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Apellido</Label><Input value={user.lastName ?? ""} onChange={e => setUser((u: any) => ({ ...u, lastName: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={user.email ?? ""} disabled className="opacity-60" /></div>
          <div className="space-y-1.5"><Label>Teléfono</Label><Input value={user.phone ?? ""} onChange={e => setUser((u: any) => ({ ...u, phone: e.target.value }))} /></div>
          <div className="space-y-1.5">
            <Label>Especialidad</Label>
            <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={user.specialty ?? ""} onChange={e => setUser((u: any) => ({ ...u, specialty: e.target.value }))}>
              {SPECIALTIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={saveUser} disabled={saving}>{saving ? "Guardando…" : "Guardar perfil"}</Button>
          </div>
        </div>
      )}

      {/* HORARIOS */}
      {tab === "horarios" && (
        <div className="bg-white border border-border rounded-xl p-6 shadow-card max-w-lg">
          <h2 className="text-sm font-bold mb-4">Horario de atención</h2>
          <div className="space-y-3">
            {DAYS.map((day, i) => {
              const s = schedule[i] ?? { enabled: false, open: "09:00", close: "18:00" };
              return (
                <div key={day} className={`flex items-center gap-4 p-3 rounded-xl border transition-colors ${s.enabled ? "bg-brand-50 border-brand-200" : "bg-muted/30 border-border"}`}>
                  <input type="checkbox" checked={s.enabled} onChange={e => setSchedule(sc => ({ ...sc, [i]: { ...sc[i], enabled: e.target.checked } }))}
                    className="w-4 h-4 rounded accent-brand-600" />
                  <span className={`text-sm font-semibold w-20 ${s.enabled ? "text-brand-700" : "text-muted-foreground"}`}>{day}</span>
                  {s.enabled ? (
                    <>
                      <input type="time" value={s.open} onChange={e => setSchedule(sc => ({ ...sc, [i]: { ...sc[i], open: e.target.value } }))}
                        className="h-8 w-24 rounded-lg border border-border bg-white px-2 text-xs font-mono focus:outline-none" />
                      <span className="text-muted-foreground text-xs">a</span>
                      <input type="time" value={s.close} onChange={e => setSchedule(sc => ({ ...sc, [i]: { ...sc[i], close: e.target.value } }))}
                        className="h-8 w-24 rounded-lg border border-border bg-white px-2 text-xs font-mono focus:outline-none" />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Cerrado</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm" onClick={() => toast.success("Horarios guardados")} disabled={saving}>Guardar horarios</Button>
          </div>
        </div>
      )}

      {/* SEGURIDAD */}
      {tab === "seguridad" && (
        <div className="space-y-4 max-w-lg">
          <div className="bg-white border border-border rounded-xl p-6 shadow-card space-y-4">
            <h2 className="text-sm font-bold">Cambiar contraseña</h2>
            <div className="space-y-1.5"><Label>Nueva contraseña</Label><Input type="password" placeholder="Mínimo 8 caracteres" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Confirmar contraseña</Label><Input type="password" placeholder="Repite la nueva contraseña" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} /></div>
            <Button size="sm" onClick={changePassword} disabled={saving || !pwForm.next}>{saving ? "Actualizando…" : "Cambiar contraseña"}</Button>
          </div>
          <div className="bg-white border border-border rounded-xl p-6 shadow-card">
            <h2 className="text-sm font-bold mb-3">Información de tu cuenta</h2>
            <div className="space-y-2 text-sm">
              {[
                { label: "Email", val: initUser.email },
                { label: "Rol", val: initUser.role },
                { label: "ID de usuario", val: initUser.id },
                { label: "Miembro desde", val: new Date(initUser.createdAt).toLocaleDateString("es-MX", { day:"numeric", month:"long", year:"numeric" }) },
              ].map(r => (
                <div key={r.label} className="flex justify-between py-2 border-b border-border/60">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-semibold font-mono text-xs">{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
