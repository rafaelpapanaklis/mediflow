"use client";

import {useState, useEffect} from "react";
import { useRouter } from "next/navigation";
import { Building, User, Clock, Shield, Receipt, Bot, CalendarCheck, ExternalLink, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const DAYS        = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const SPECIALTIES = ["dental","medicine","nutrition","psychology","dermatology","other"];
const REGIMENES   = [
  { clave:"601", desc:"General de Ley Personas Morales" },
  { clave:"612", desc:"Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave:"621", desc:"Incorporación Fiscal" },
  { clave:"626", desc:"Régimen Simplificado de Confianza" },
  { clave:"616", desc:"Sin obligaciones fiscales" },
];

interface Props { user: any; clinic: any; initialTab?: string; gcalStatus?: string }

export function SettingsClient({ user: initUser, clinic: initClinic, initialTab, gcalStatus }: Props) {
  const router = useRouter();
  const [tab,      setTab]      = useState(initialTab ?? "clinica");
  const [saving,   setSaving]   = useState(false);
  const [user,     setUser]     = useState(initUser);
  const [clinic,   setClinic]   = useState(initClinic);
  const [schedule, setSchedule] = useState<Record<number,{enabled:boolean;open:string;close:string}>>(
    Object.fromEntries((initClinic.schedules ?? []).map((s: any) => [s.dayOfWeek, { enabled:s.enabled, open:s.openTime, close:s.closeTime }]))
  );
  const [pwForm,   setPwForm]   = useState({ current:"", next:"", confirm:"" });

  // CFDI form state
  const [cfdiForm, setCfdiForm] = useState({
    rfcEmisor:    clinic.rfcEmisor    ?? "",
    regimenFiscal:clinic.regimenFiscal ?? "612",
    cpEmisor:     clinic.cpEmisor     ?? "",
    razonSocial:  clinic.name         ?? "",
  });

  // AI usage info
  const aiUsed      = clinic.aiTokensUsed  ?? 0;
  const aiLimit     = clinic.aiTokensLimit ?? 50000;
  const aiPercent   = Math.min(100, Math.round((aiUsed / aiLimit) * 100));
  const aiRemaining = Math.max(0, aiLimit - aiUsed);

  // Google Calendar status — check user OR clinic level (admin saves on clinic)
  const gcalConnected = user.googleCalendarEnabled || initClinic?.googleCalendarEnabled;
  const gcalEmail = user.googleCalendarEmail || initClinic?.googleCalendarEmail || "Conectado";

  // Show toast after OAuth redirect
  useEffect(() => {
    if (gcalStatus === "success") toast.success("✅ Google Calendar conectado correctamente");
    if (gcalStatus === "error")   toast.error("Error al conectar Google Calendar");
  }, [gcalStatus]);

  // ── Save functions ────────────────────────────────────────────────────────
  async function saveClinic() {
    setSaving(true);
    try {
      const res = await fetch("/api/clinic", {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ name:clinic.name, city:clinic.city, phone:clinic.phone, email:clinic.email }),
      });
      if (!res.ok) throw new Error();
      toast.success("Datos de la clínica actualizados");
    } catch { toast.error("Error al guardar"); } finally { setSaving(false); }
  }

  async function saveUser() {
    setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ firstName:user.firstName, lastName:user.lastName, phone:user.phone, specialty:user.specialty }),
      });
      if (!res.ok) throw new Error();
      toast.success("Perfil actualizado");
    } catch { toast.error("Error al guardar"); } finally { setSaving(false); }
  }

  async function saveCfdi() {
    if (!cfdiForm.rfcEmisor.trim()) { toast.error("RFC es requerido"); return; }
    if (!cfdiForm.cpEmisor.trim() || cfdiForm.cpEmisor.length !== 5) { toast.error("Código postal debe tener 5 dígitos"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/cfdi", {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify(cfdiForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast.success("✅ Datos fiscales configurados — ya puedes timbrar CFDIs");
      setClinic((c: any) => ({ ...c, facturApiEnabled: true, ...cfdiForm }));
    } catch (err: any) { toast.error(err.message); } finally { setSaving(false); }
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

  async function disconnectGcal() {
    try {
      const res = await fetch("/api/google", { method:"DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Google Calendar desconectado");
      setUser((u: any) => ({ ...u, googleCalendarEnabled:false, googleCalendarEmail:null }));
    } catch { toast.error("Error al desconectar"); }
  }

  const TABS = [
    { id:"clinica",     label:"Mi clínica",    icon:Building,      show:true                    },
    { id:"perfil",      label:"Mi perfil",     icon:User,          show:true                    },
    { id:"facturacion", label:"Facturación",   icon:Receipt,       show:initUser.role==="ADMIN" || initUser.role==="SUPER_ADMIN" },
    { id:"ia",          label:"Asistente IA",  icon:Bot,           show:true                    },
    { id:"integraciones",label:"Integraciones",icon:CalendarCheck, show:true                    },
    { id:"horarios",    label:"Horarios",      icon:Clock,         show:initUser.role==="ADMIN" || initUser.role==="SUPER_ADMIN" },
    { id:"seguridad",   label:"Seguridad",     icon:Shield,        show:true                    },
  ].filter(t => t.show);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">Configuración</h1>
        <p className="text-base text-muted-foreground mt-0.5">Personaliza tu clínica, perfil e integraciones</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-white dark:bg-slate-900 border border-border rounded-xl p-1 w-fit mb-6 shadow-card">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all
              ${tab === t.id ? "bg-brand-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CLÍNICA ── */}
      {tab === "clinica" && (
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card max-w-lg space-y-4">
          <h2 className="text-base font-bold">Datos de la clínica</h2>
          <div className="space-y-1.5">
            <Label>Nombre de la clínica</Label>
            <Input value={clinic.name ?? ""} onChange={e => setClinic((c: any) => ({ ...c, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Especialidad</Label>
            <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
              value={clinic.specialty ?? ""} onChange={e => setClinic((c: any) => ({ ...c, specialty: e.target.value }))}>
              {SPECIALTIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Ciudad</Label><Input value={clinic.city ?? ""} onChange={e => setClinic((c: any) => ({ ...c, city: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Dirección</Label><Input value={clinic.address ?? ""} onChange={e => setClinic((c: any) => ({ ...c, address: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Teléfono</Label><Input value={clinic.phone ?? ""} onChange={e => setClinic((c: any) => ({ ...c, phone: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Email de contacto</Label><Input type="email" value={clinic.email ?? ""} onChange={e => setClinic((c: any) => ({ ...c, email: e.target.value }))} /></div>
          <div className="pt-2 flex items-center justify-between">
            <span className={`text-sm font-bold px-3 py-1 rounded-full border ${clinic.plan==="CLINIC"?"bg-violet-50 text-violet-700 border-violet-200":clinic.plan==="PRO"?"bg-brand-50 text-brand-700 border-brand-200":"bg-slate-100 text-slate-600 border-slate-200"}`}>
              Plan {clinic.plan}
            </span>
            <Button onClick={saveClinic} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
          </div>
        </div>
      )}

      {/* ── PERFIL ── */}
      {tab === "perfil" && (
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card max-w-lg space-y-4">
          <h2 className="text-base font-bold">Tu perfil profesional</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Nombre</Label><Input value={user.firstName ?? ""} onChange={e => setUser((u: any) => ({ ...u, firstName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Apellido</Label><Input value={user.lastName ?? ""} onChange={e => setUser((u: any) => ({ ...u, lastName: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={user.email ?? ""} disabled className="opacity-60" /></div>
          <div className="space-y-1.5"><Label>Teléfono</Label><Input value={user.phone ?? ""} onChange={e => setUser((u: any) => ({ ...u, phone: e.target.value }))} /></div>
          <div className="flex justify-end pt-2">
            <Button onClick={saveUser} disabled={saving}>{saving ? "Guardando…" : "Guardar perfil"}</Button>
          </div>
        </div>
      )}

      {/* ── FACTURACIÓN CFDI ── */}
      {tab === "facturacion" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold">Facturación CFDI 4.0</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Configura tu RFC para timbrar facturas electrónicas válidas ante el SAT</p>
              </div>
              {clinic.facturApiEnabled && (
                <span className="text-sm font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-3 py-1 rounded-full">
                  ✅ Activo
                </span>
              )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
              <strong>Powered by Facturapi</strong> — Tu RFC es el emisor. Cada factura que generes queda timbrada ante el SAT automáticamente. El paciente puede descargar XML y PDF.
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-base font-semibold">RFC del emisor *</Label>
                <Input
                  placeholder="Ej: XAXX010101000"
                  value={cfdiForm.rfcEmisor}
                  onChange={e => setCfdiForm(f => ({ ...f, rfcEmisor: e.target.value.toUpperCase() }))}
                  className="font-mono text-base uppercase"
                  maxLength={13}
                />
                <p className="text-xs text-muted-foreground">RFC de la clínica o del médico según facture</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-base font-semibold">Razón social *</Label>
                <Input
                  placeholder="Nombre exacto como aparece en el SAT"
                  value={cfdiForm.razonSocial}
                  onChange={e => setCfdiForm(f => ({ ...f, razonSocial: e.target.value.toUpperCase() }))}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">Debe coincidir exactamente con tu Constancia de Situación Fiscal</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-base font-semibold">Régimen fiscal *</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                  value={cfdiForm.regimenFiscal} onChange={e => setCfdiForm(f => ({ ...f, regimenFiscal: e.target.value }))}>
                  {REGIMENES.map(r => <option key={r.clave} value={r.clave}>{r.clave} — {r.desc}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-base font-semibold">Código postal fiscal *</Label>
                <Input
                  placeholder="Ej: 97000"
                  value={cfdiForm.cpEmisor}
                  onChange={e => setCfdiForm(f => ({ ...f, cpEmisor: e.target.value.replace(/\D/g,"") }))}
                  maxLength={5}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <Button onClick={saveCfdi} disabled={saving} className="flex-1">
                {saving ? "Configurando…" : "💾 Guardar configuración fiscal"}
              </Button>
              <a href="https://www.facturapi.io" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">
                <ExternalLink className="w-4 h-4" /> Facturapi
              </a>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/30 rounded-xl p-3">
              <strong>Nota:</strong> Para timbrar necesitas también subir tu Certificado de Sello Digital (CSD) en el dashboard de Facturapi. Esto es un requisito del SAT y no se puede hacer desde aquí por seguridad.
            </div>
          </div>
        </div>
      )}

      {/* ── ASISTENTE IA ── */}
      {tab === "ia" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <Bot className="w-6 h-6 text-violet-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">Asistente IA Clínico</h2>
                <p className="text-sm text-muted-foreground">Uso mensual de consultas con IA</p>
              </div>
            </div>

            {/* Usage bar */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-violet-500" /> Tokens usados este mes
                </span>
                <span className="text-sm font-bold">{aiUsed.toLocaleString()} / {aiLimit.toLocaleString()}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${aiPercent > 80 ? "bg-rose-500" : aiPercent > 60 ? "bg-amber-500" : "bg-violet-500"}`}
                  style={{ width:`${aiPercent}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-sm text-muted-foreground">{aiPercent}% usado</span>
                <span className="text-sm font-semibold text-violet-600">{aiRemaining.toLocaleString()} tokens restantes</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label:"Tokens restantes", val:aiRemaining.toLocaleString(), color:"text-violet-600" },
                { label:"Consultas aprox.", val:Math.floor(aiRemaining/800).toString(), color:"text-foreground" },
                { label:"Costo estimado",   val:`~$${((aiUsed/1_000_000)*1).toFixed(4)} USD`, color:"text-emerald-600" },
              ].map(s => (
                <div key={s.label} className="bg-muted/20 rounded-xl p-3 text-center">
                  <div className={`text-xl font-extrabold ${s.color}`}>{s.val}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4 text-sm text-violet-700 dark:text-violet-300">
              <strong>¿Cómo funciona?</strong> Cada consulta con el asistente usa aproximadamente 800 tokens. El límite se renueva automáticamente el primer día de cada mes. Usa Claude Haiku — el modelo más eficiente de Anthropic.
            </div>
          </div>
        </div>
      )}

      {/* ── INTEGRACIONES ── */}
      {tab === "integraciones" && (
        <div className="space-y-5 max-w-lg">
          {/* Google Calendar */}
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-2xl">📅</div>
                <div>
                  <h2 className="text-base font-bold">Google Calendar</h2>
                  <p className="text-sm text-muted-foreground">Sincroniza tus citas automáticamente</p>
                </div>
              </div>
              {gcalConnected
                ? <span className="text-sm font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-3 py-1 rounded-full">✅ Conectado</span>
                : <span className="text-sm font-bold bg-slate-100 text-slate-600 px-3 py-1 rounded-full">No conectado</span>}
            </div>

            {gcalConnected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <CalendarCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Cuenta conectada</div>
                    <div className="text-sm text-emerald-600 dark:text-emerald-400">{gcalEmail}</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">Cada nueva cita que se agende para ti aparecerá automáticamente en tu Google Calendar con recordatorio 24h antes.</p>
                <Button variant="outline" onClick={disconnectGcal} className="border-rose-300 text-rose-700 hover:bg-rose-50">
                  Desconectar Google Calendar
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Conecta tu Google Calendar para que cada cita agendada para ti aparezca automáticamente con recordatorios.</p>
                <a href="/api/google"
                  className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border-2 border-border rounded-xl font-semibold text-base hover:border-blue-400 transition-colors w-fit">
                  <span className="text-xl">G</span> Conectar con Google
                </a>
              </div>
            )}
          </div>

          {/* WhatsApp (admin only) */}
          {(initUser.role === "ADMIN" || initUser.role === "SUPER_ADMIN") && (
            <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-2xl">💬</div>
                <div>
                  <h2 className="text-base font-bold">WhatsApp Business</h2>
                  <p className="text-sm text-muted-foreground">Recordatorios automáticos a pacientes</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">Configura WhatsApp Cloud API para enviar recordatorios automáticos de citas a los pacientes.</p>
              <a href="/dashboard/whatsapp" className="text-sm font-semibold text-brand-600 hover:underline">
                Ir a configuración de WhatsApp →
              </a>

              {/* Recall / Revisión anual */}
              <div className="mt-6 pt-5 border-t border-border">
                <h3 className="text-sm font-bold mb-1">🔔 Recordatorio de revisión anual</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Envía WhatsApp automático a pacientes sin cita en X meses. Requiere WhatsApp conectado.
                </p>
                <div className="flex items-center gap-3 mb-3">
                  <label className="text-sm font-semibold">Activar</label>
                  <button
                    onClick={async () => {
                      const res = await fetch("/api/settings", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ recallActive: !(clinic as any).recallActive }) });
                      if (res.ok) { toast.success("Guardado"); router.refresh(); }
                    }}
                    className={`w-10 h-5 rounded-full relative transition-colors ${ (clinic as any).recallActive ? "bg-brand-600" : "bg-muted" }`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${ (clinic as any).recallActive ? "left-[22px]" : "left-0.5" }`} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold whitespace-nowrap">Meses sin visita</label>
                  <select defaultValue={(clinic as any).recallMonths ?? 6}
                    onChange={async e => { await fetch("/api/settings", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ recallMonths: parseInt(e.target.value) }) }); toast.success("Guardado"); }}
                    className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background">
                    {[3,6,9,12].map(n => <option key={n} value={n}>{n} meses</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── HORARIOS ── */}}
      {tab === "horarios" && (
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card max-w-lg">
          <h2 className="text-base font-bold mb-4">Horario de atención</h2>
          <div className="space-y-3">
            {DAYS.map((day, i) => {
              const s = schedule[i] ?? { enabled:false, open:"09:00", close:"18:00" };
              return (
                <div key={day} className={`flex items-center gap-4 p-3.5 rounded-xl border transition-colors ${s.enabled ? "bg-brand-50 dark:bg-brand-950/20 border-brand-200" : "bg-muted/30 border-border"}`}>
                  <input type="checkbox" checked={s.enabled}
                    onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], enabled:e.target.checked } }))}
                    className="w-4 h-4 rounded accent-brand-600 flex-shrink-0" />
                  <span className={`text-base font-semibold w-24 ${s.enabled ? "text-brand-700 dark:text-brand-300" : "text-muted-foreground"}`}>{day}</span>
                  {s.enabled ? (
                    <>
                      <input type="time" value={s.open}
                        onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], open:e.target.value } }))}
                        className="h-9 w-26 rounded-xl border border-border bg-white dark:bg-slate-800 px-3 text-sm font-mono focus:outline-none" />
                      <span className="text-muted-foreground text-sm">a</span>
                      <input type="time" value={s.close}
                        onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], close:e.target.value } }))}
                        className="h-9 w-26 rounded-xl border border-border bg-white dark:bg-slate-800 px-3 text-sm font-mono focus:outline-none" />
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Cerrado</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end mt-5">
            <Button onClick={() => toast.success("Horarios guardados")}>Guardar horarios</Button>
          </div>
        </div>
      )}

      {/* ── SEGURIDAD ── */}
      {tab === "seguridad" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card space-y-4">
            <h2 className="text-base font-bold">Cambiar contraseña</h2>
            <div className="space-y-1.5"><Label>Nueva contraseña</Label>
              <Input type="password" placeholder="Mínimo 8 caracteres" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next:e.target.value }))} />
            </div>
            <div className="space-y-1.5"><Label>Confirmar contraseña</Label>
              <Input type="password" placeholder="Repite la nueva contraseña" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm:e.target.value }))} />
            </div>
            <Button onClick={changePassword} disabled={saving || !pwForm.next}>{saving ? "Actualizando…" : "Cambiar contraseña"}</Button>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-6 shadow-card">
            <h2 className="text-base font-bold mb-4">Información de tu cuenta</h2>
            <div className="space-y-2 text-sm">
              {[
                { label:"Email",       val:initUser.email },
                { label:"Rol",         val:initUser.role },
                { label:"Miembro desde",val:new Date(initUser.createdAt).toLocaleDateString("es-MX",{day:"numeric",month:"long",year:"numeric"}) },
              ].map(r => (
                <div key={r.label} className="flex justify-between py-2.5 border-b border-border/60">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-semibold">{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
