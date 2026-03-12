"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getInitials, avatarColor } from "@/lib/utils";
import toast from "react-hot-toast";

const PLAN_INFO: Record<string, { name: string; price: string; features: string[] }> = {
  BASIC:  { name: "Básico",        price: "$49/mes",  features: ["1 profesional","200 pacientes","Agenda básica"] },
  PRO:    { name: "Profesional",   price: "$99/mes",  features: ["3 profesionales","Pacientes ilimitados","WhatsApp","Reportes"] },
  CLINIC: { name: "Clínica",       price: "$249/mes", features: ["Ilimitado todo","IA diagnóstica","Telemedicina","API"] },
};

interface Props {
  user:   { id: string; firstName: string; lastName: string; email: string; role: string; specialty: string | null; phone: string | null };
  clinic: { id: string; name: string; specialty: string; country: string; city: string | null; phone: string | null; email: string | null; plan: string; trialEndsAt: string | null };
}

export function SettingsClient({ user, clinic }: Props) {
  const [tab, setTab]         = useState<"profile"|"clinic"|"plan">("profile");
  const [saving, setSaving]   = useState(false);
  const [profile, setProfile] = useState({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? "", specialty: user.specialty ?? "" });
  const [clinicForm, setClinicForm] = useState({ name: clinic.name, phone: clinic.phone ?? "", email: clinic.email ?? "", city: clinic.city ?? "" });

  const plan   = PLAN_INFO[clinic.plan] ?? PLAN_INFO.PRO;
  const initials = getInitials(user.firstName, user.lastName);
  const color    = avatarColor(user.id);
  const trialEnd = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : 0;

  async function saveProfile() {
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    toast.success("Perfil actualizado");
  }

  async function saveClinic() {
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    toast.success("Datos de clínica actualizados");
  }

  const TABS = [
    { id: "profile", label: "Mi perfil"   },
    { id: "clinic",  label: "Mi clínica"  },
    { id: "plan",    label: "Plan & Pago" },
  ] as const;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold">Configuración</h1>
        <p className="text-sm text-muted-foreground">Administra tu cuenta y clínica</p>
      </div>

      <div className="flex gap-1 mb-6 bg-muted rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.id ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="rounded-xl border border-border bg-white p-6 shadow-card max-w-lg animate-fade-up">
          <div className="flex items-center gap-4 mb-6 pb-5 border-b border-border">
            <div className={`w-14 h-14 rounded-full ${color} flex items-center justify-center text-lg font-bold text-white`}>{initials}</div>
            <div>
              <div className="font-bold">{user.firstName} {user.lastName}</div>
              <div className="text-sm text-muted-foreground">{user.email}</div>
              <div className="text-xs text-muted-foreground">{user.role}</div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input value={profile.firstName} onChange={e => setProfile(f => ({ ...f, firstName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Apellido</Label>
                <Input value={profile.lastName} onChange={e => setProfile(f => ({ ...f, lastName: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Especialidad</Label>
              <Input value={profile.specialty} onChange={e => setProfile(f => ({ ...f, specialty: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={profile.phone} onChange={e => setProfile(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <Button className="mt-5" disabled={saving} onClick={saveProfile}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
      )}

      {tab === "clinic" && (
        <div className="rounded-xl border border-border bg-white p-6 shadow-card max-w-lg animate-fade-up">
          <h2 className="text-base font-bold mb-5">{clinic.name}</h2>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre de la clínica</Label>
              <Input value={clinicForm.name} onChange={e => setClinicForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ciudad</Label>
                <Input value={clinicForm.city} onChange={e => setClinicForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input value={clinicForm.phone} onChange={e => setClinicForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email de contacto</Label>
              <Input type="email" value={clinicForm.email} onChange={e => setClinicForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <Button className="mt-5" disabled={saving} onClick={saveClinic}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
      )}

      {tab === "plan" && (
        <div className="space-y-4 max-w-lg animate-fade-up">
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-lg font-extrabold text-brand-700">Plan {plan.name}</div>
                <div className="text-sm text-muted-foreground">{plan.price}</div>
              </div>
              {trialEnd && daysLeft > 0 && (
                <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200">
                  {daysLeft} días de trial
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {plan.features.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <span className="text-emerald-500">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-white p-5 shadow-card">
            <h3 className="font-bold mb-3 text-sm">Cambiar plan</h3>
            <div className="space-y-2.5">
              {Object.entries(PLAN_INFO).map(([key, info]) => (
                <div key={key} className={`flex items-center justify-between p-3 rounded-xl border ${key === clinic.plan ? "border-brand-300 bg-brand-50" : "border-border"}`}>
                  <div>
                    <div className="text-sm font-bold">{info.name}</div>
                    <div className="text-xs text-muted-foreground">{info.price}</div>
                  </div>
                  {key === clinic.plan ? (
                    <span className="text-xs font-bold text-brand-600">Plan actual</span>
                  ) : (
                    <button onClick={() => toast("Contacta soporte para cambiar tu plan")} className="text-xs font-semibold text-brand-600 hover:underline">Seleccionar</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
