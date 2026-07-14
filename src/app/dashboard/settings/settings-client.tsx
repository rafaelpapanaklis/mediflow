"use client";

import { useState, useEffect } from "react";
import { Building, User, Clock, Shield, Receipt, Bot, CalendarCheck, ExternalLink, Zap, CreditCard, Bell } from "lucide-react";
import { SubscriptionTab } from "@/components/dashboard/subscription-tab";
import { RemindersSection } from "./reminders-section";
import { TwoFactorCard } from "@/components/dashboard/security/two-factor-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";
import { useT } from "@/i18n/i18n-provider";
import toast from "react-hot-toast";
import dynamic from "next/dynamic";

const ClinicLocationPicker = dynamic(
  () => import("@/components/dashboard/ClinicLocationPicker").then((m) => m.ClinicLocationPicker),
  { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-xl border border-border bg-muted/20" /> },
);

// Días de la semana: el id apunta a una llave i18n; la etiqueta visible se
// resuelve con t(id) en el render (nunca a nivel de módulo).
const DAYS        = [
  "settings.clientDays.monday",
  "settings.clientDays.tuesday",
  "settings.clientDays.wednesday",
  "settings.clientDays.thursday",
  "settings.clientDays.friday",
  "settings.clientDays.saturday",
  "settings.clientDays.sunday",
];
// Selector de categoría de la clínica = las 17 categorías del directorio
// (fuente ÚNICA: DIRECTORY_CATEGORIES) + "Otra". El value es el enum
// ClinicCategory de Prisma. Elegir una categoría REAL es lo que hace que la
// clínica aparezca en su página /descubre/[categoria]; "OTHER" solo sale en
// "Todas". El label ya viene en español del contrato (sin llave i18n).
const CATEGORIES: { id: string; label: string }[] = [
  ...DIRECTORY_CATEGORIES.map((c) => ({ id: c.category, label: c.label })),
  { id: "OTHER", label: "Otra / general" },
];
const TIMEZONES = [
  { id: "America/Mexico_City",  label: "Ciudad de Mexico (GMT-6)" },
  { id: "America/Cancun",       label: "Cancun / Quintana Roo (GMT-5)" },
  { id: "America/Merida",       label: "Merida / Yucatan (GMT-6)" },
  { id: "America/Monterrey",    label: "Monterrey (GMT-6)" },
  { id: "America/Hermosillo",   label: "Hermosillo / Sonora (GMT-7)" },
  { id: "America/Mazatlan",     label: "Mazatlan / Sinaloa (GMT-7)" },
  { id: "America/Tijuana",      label: "Tijuana / BC (GMT-8)" },
  { id: "America/Bogota",       label: "Bogota - Colombia (GMT-5)" },
  { id: "America/Lima",         label: "Lima - Peru (GMT-5)" },
  { id: "America/Guatemala",    label: "Guatemala (GMT-6)" },
  { id: "America/Costa_Rica",   label: "Costa Rica (GMT-6)" },
  { id: "America/Santo_Domingo",label: "Santo Domingo - RD (GMT-4)" },
  { id: "America/Caracas",      label: "Caracas - Venezuela (GMT-4)" },
  { id: "America/La_Paz",       label: "La Paz - Bolivia (GMT-4)" },
  { id: "America/Asuncion",     label: "Asuncion - Paraguay (GMT-4)" },
  { id: "America/Santiago",     label: "Santiago - Chile (GMT-4)" },
  { id: "America/Buenos_Aires", label: "Buenos Aires - Argentina (GMT-3)" },
  { id: "America/Montevideo",   label: "Montevideo - Uruguay (GMT-3)" },
  { id: "America/Sao_Paulo",    label: "Sao Paulo - Brasil (GMT-3)" },
  { id: "Europe/Madrid",        label: "Madrid - Espana (GMT+1)" },
  { id: "America/New_York",     label: "New York - US Eastern (GMT-5)" },
  { id: "America/Los_Angeles",  label: "Los Angeles - US Pacific (GMT-8)" },
];
const REGIMENES   = [
  { clave:"601", desc:"General de Ley Personas Morales" },
  { clave:"612", desc:"Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave:"621", desc:"Incorporación Fiscal" },
  { clave:"626", desc:"Régimen Simplificado de Confianza" },
  { clave:"616", desc:"Sin obligaciones fiscales" },
];

interface TeamMember { id: string; firstName: string; lastName: string; role: string; services: string[] }
interface Props { user: any; clinic: any; initialTab?: string; gcalStatus?: string; teamMembers?: TeamMember[] }

export function SettingsClient({ user: initUser, clinic: initClinic, initialTab, gcalStatus, teamMembers: initTeam = [] }: Props) {
  const t = useT();
  const [tab,      setTab]      = useState(() => {
    const requested = initialTab || "clinica";
    const admin = initUser.role === "ADMIN" || initUser.role === "SUPER_ADMIN";
    // El tab de suscripción es solo para el dueño/admin. Si un rol operativo
    // llega por ?tab=subscription (p. ej. desde el banner de trial), cae al
    // tab por defecto en vez de ver datos de facturación.
    return requested === "subscription" && !admin ? "clinica" : requested;
  });
  const [saving,   setSaving]   = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [user,     setUser]     = useState(initUser);
  const [clinic,   setClinic]   = useState(initClinic);
  const [isPublic, setIsPublic] = useState<boolean>(Boolean(initClinic.isPublic ?? false));
  const [schedule, setSchedule] = useState<Record<number,{enabled:boolean;open:string;close:string}>>(
    Object.fromEntries((initClinic.schedules ?? []).map((s: any) => [s.dayOfWeek, { enabled:s.enabled, open:s.openTime, close:s.closeTime }]))
  );
  const [pwForm,   setPwForm]   = useState({ current:"", next:"", confirm:"" });
  // Portal del paciente — cambios de cita (WS1-T5). Draft local del input de
  // horas; se guarda al blur. `?? 24` tolera clínicas sin los campos nuevos.
  const [minHoursDraft, setMinHoursDraft] = useState<string>(String(initClinic.patientChangesMinHours ?? 24));

  // Show toast feedback from Google Calendar OAuth redirect
  useEffect(() => {
    if (gcalStatus === "success") toast.success(t("settings.client.gcalConnectedToast"));
    if (gcalStatus === "error") toast.error(t("settings.client.gcalConnectErrorToast"));
  }, [gcalStatus]);

  // CFDI form state
  const [cfdiForm, setCfdiForm] = useState({
    rfcEmisor:    clinic.rfcEmisor    ?? "",
    regimenFiscal:clinic.regimenFiscal ?? "612",
    cpEmisor:     clinic.cpEmisor     ?? "",
    razonSocial:  clinic.name         ?? "",
  });

  // CSD (Certificado de Sello Digital) — subida a Facturapi
  const [cerFile, setCerFile]         = useState<File | null>(null);
  const [keyFile, setKeyFile]         = useState<File | null>(null);
  const [csdPassword, setCsdPassword] = useState("");
  const [csdUploading, setCsdUploading] = useState(false);

  // AI usage info
  const aiUsed      = clinic.aiTokensUsed  ?? 0;
  const aiLimit     = clinic.aiTokensLimit ?? 50000;
  const aiPercent   = Math.min(100, Math.round((aiUsed / aiLimit) * 100));
  const aiRemaining = Math.max(0, aiLimit - aiUsed);

  // Google Calendar status
  const gcalConnected = !!user.googleCalendarEnabled;

  // ── Save functions ────────────────────────────────────────────────────────
  async function saveClinic() {
    setSaving(true);
    try {
      const res = await fetch("/api/clinic", {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ name:clinic.name, city:clinic.city, phone:clinic.phone, email:clinic.email, address:clinic.address, mapsUrl:clinic.mapsUrl, description:clinic.description, isPublic, category:clinic.category, clues:clinic.clues, timezone:clinic.timezone, latitude: clinic.latitude ?? null, longitude: clinic.longitude ?? null })
      });
      if (!res.ok) throw new Error();
      toast.success(t("settings.client.clinicSavedToast"));
    } catch { toast.error(t("settings.client.saveErrorToast")); } finally { setSaving(false); }
  }

  // Horarios de atención — manda SIEMPRE los 7 días (0=Lunes...6=Domingo);
  // los días sin fila (sáb/dom del seed) van con defaults y enabled=false.
  async function saveSchedule() {
    setSavingSchedule(true);
    try {
      const schedules = DAYS.map((_, i) => {
        const s = schedule[i] ?? { enabled:false, open:"09:00", close:"18:00" };
        return { dayOfWeek: i, enabled: !!s.enabled, openTime: s.open || "09:00", closeTime: s.close || "18:00" };
      });
      const res = await fetch("/api/settings/schedule", {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ schedules }),
      });
      if (res.ok) {
        toast.success(t("settings.client.hoursSavedToast"));
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || t("settings.client.saveErrorToast"));
      }
    } catch { toast.error(t("settings.client.saveErrorToast")); } finally { setSavingSchedule(false); }
  }

  // Idioma del panel: guarda el locale de la clínica y recarga para cargar el diccionario.
  async function saveLocale(next: string) {
    const locale = next === "en" ? "en" : "es";
    setClinic((c: any) => ({ ...c, locale }));
    try {
      const res = await fetch("/api/clinic", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) throw new Error();
      toast.success(locale === "en" ? "Language updated" : "Idioma actualizado");
      setTimeout(() => window.location.reload(), 600);
    } catch { toast.error("Error al guardar idioma"); }
  }

  // CRM — toggles de automatización (gated). Guardado inmediato al flip;
  // si falla, revierte el estado local.
  async function saveAutomation(patch: Record<string, boolean>) {
    setClinic((c: any) => ({ ...c, ...patch }));
    try {
      const res = await fetch("/api/clinic", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      toast.success("Automatización actualizada");
    } catch {
      setClinic((c: any) => ({ ...c, ...Object.fromEntries(Object.keys(patch).map(k => [k, !patch[k]])) }));
      toast.error("Error al guardar");
    }
  }

  // Portal del paciente — cambios de cita (WS1-T5). Mismo patrón optimista
  // de saveAutomation: guardado inmediato, revierte si falla.
  async function savePortalAutoApprove(next: boolean) {
    setClinic((c: any) => ({ ...c, patientChangesAutoApprove: next }));
    try {
      const res = await fetch("/api/clinic", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientChangesAutoApprove: next }),
      });
      if (!res.ok) throw new Error();
      toast.success("Configuración del portal actualizada");
    } catch {
      setClinic((c: any) => ({ ...c, patientChangesAutoApprove: !next }));
      toast.error("Error al guardar");
    }
  }

  // Ventana mínima en horas (0..720) para que un paciente pida cambios.
  // Guarda al blur; clamp local espejo del clamp del endpoint.
  async function savePortalMinHours() {
    const prev = clinic.patientChangesMinHours ?? 24;
    const parsed = parseInt(minHoursDraft, 10);
    const next = Number.isNaN(parsed) ? 24 : Math.max(0, Math.min(720, parsed));
    setMinHoursDraft(String(next));
    if (next === prev) return;
    setClinic((c: any) => ({ ...c, patientChangesMinHours: next }));
    try {
      const res = await fetch("/api/clinic", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientChangesMinHours: next }),
      });
      if (!res.ok) throw new Error();
      toast.success("Configuración del portal actualizada");
    } catch {
      setClinic((c: any) => ({ ...c, patientChangesMinHours: prev }));
      setMinHoursDraft(String(prev));
      toast.error("Error al guardar");
    }
  }

  async function saveUser() {
    setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ firstName:user.firstName, lastName:user.lastName, phone:user.phone, specialty:user.specialty }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("settings.client.profileSavedToast"));
    } catch { toast.error(t("settings.client.saveErrorToast")); } finally { setSaving(false); }
  }

  async function saveCfdi() {
    if (!cfdiForm.rfcEmisor.trim()) { toast.error(t("settings.client.rfcRequiredToast")); return; }
    if (!cfdiForm.cpEmisor.trim() || cfdiForm.cpEmisor.length !== 5) { toast.error(t("settings.client.cpLengthToast")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/cfdi", {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify(cfdiForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast.success(t("settings.client.cfdiSavedToast"));
      setClinic((c: any) => ({ ...c, facturApiEnabled: true, ...cfdiForm }));
    } catch (err: any) { toast.error(err.message); } finally { setSaving(false); }
  }

  async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    return Buffer.from(new Uint8Array(buf)).toString("base64");
  }

  async function uploadCsd() {
    if (!clinic.facturApiEnabled) { toast.error(t("settings.client.csdNeedRfcFirst")); return; }
    if (!cerFile || !keyFile || !csdPassword.trim()) { toast.error(t("settings.client.csdFilesRequired")); return; }
    setCsdUploading(true);
    try {
      const [cerBase64, keyBase64] = await Promise.all([fileToBase64(cerFile), fileToBase64(keyFile)]);
      const res = await fetch("/api/settings/cfdi/certificate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cerBase64, keyBase64, password: csdPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast.success(t("settings.client.csdUploadedToast"));
      setClinic((c: any) => ({ ...c, csdUploaded: true, csdValidUntil: data.csdValidUntil ?? null }));
      setCerFile(null); setKeyFile(null); setCsdPassword("");
    } catch (err: any) {
      toast.error(err.message ?? t("settings.client.csdUploadError"));
    } finally { setCsdUploading(false); }
  }

  async function changePassword() {
    if (pwForm.next !== pwForm.confirm) { toast.error(t("settings.client.pwMismatchToast")); return; }
    if (pwForm.next.length < 8) { toast.error(t("settings.client.pwMinLengthToast")); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pwForm.next });
      if (error) throw error;
      toast.success(t("settings.client.pwUpdatedToast"));
      setPwForm({ current:"", next:"", confirm:"" });
    } catch (e: any) { toast.error(e.message ?? "Error"); } finally { setSaving(false); }
  }

  async function disconnectGcal() {
    try {
      const res = await fetch("/api/google", { method:"DELETE" });
      if (!res.ok) throw new Error();
      toast.success(t("settings.client.gcalDisconnectedToast"));
      setUser((u: any) => ({ ...u, googleCalendarEnabled:false, googleCalendarEmail:null }));
    } catch { toast.error(t("settings.client.gcalDisconnectErrorToast")); }
  }

  const [team, setTeam] = useState<TeamMember[]>(initTeam);
  const [newService, setNewService] = useState("");
  const [savingServices, setSavingServices] = useState<string | null>(null);

  async function addServiceToMember(memberId: string, service: string) {
    if (!service.trim()) return;
    const member = team.find(m => m.id === memberId);
    if (!member || member.services.includes(service.trim())) return;
    const updated = [...member.services, service.trim()];
    setSavingServices(memberId);
    try {
      const res = await fetch(`/api/team/${memberId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: updated }),
      });
      if (!res.ok) throw new Error();
      setTeam(prev => prev.map(m => m.id === memberId ? { ...m, services: updated } : m));
      toast.success(t("settings.client.serviceAddedToast"));
    } catch { toast.error(t("settings.client.saveErrorToast")); }
    finally { setSavingServices(null); }
  }

  async function removeServiceFromMember(memberId: string, service: string) {
    const member = team.find(m => m.id === memberId);
    if (!member) return;
    const updated = member.services.filter(s => s !== service);
    setSavingServices(memberId);
    try {
      const res = await fetch(`/api/team/${memberId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: updated }),
      });
      if (!res.ok) throw new Error();
      setTeam(prev => prev.map(m => m.id === memberId ? { ...m, services: updated } : m));
      toast.success(t("settings.client.serviceRemovedToast"));
    } catch { toast.error(t("settings.client.saveErrorToast")); }
    finally { setSavingServices(null); }
  }

  const isAdminUser = initUser.role === "ADMIN" || initUser.role === "SUPER_ADMIN";

  const TABS = [
    { id:"clinica",      label:t("settings.client.tabClinic"),       icon:Building,      show:true        },
    { id:"subscription", label:t("settings.client.tabSubscription"), icon:CreditCard,    show:isAdminUser },
    { id:"servicios",    label:t("settings.client.tabServices"),     icon:Zap,           show:isAdminUser },
    { id:"perfil",       label:t("settings.client.tabProfile"),      icon:User,          show:true        },
    { id:"facturacion",  label:t("settings.client.tabBilling"),      icon:Receipt,       show:isAdminUser },
    { id:"ia",           label:t("settings.client.tabAi"),           icon:Bot,           show:true        },
    { id:"integraciones",label:t("settings.client.tabIntegrations"), icon:CalendarCheck, show:true        },
    { id:"recordatorios",label:t("settings.client.tabReminders"),    icon:Bell,          show:isAdminUser },
    { id:"horarios",     label:t("settings.client.tabHours"),        icon:Clock,         show:isAdminUser },
    { id:"seguridad",    label:t("settings.client.tabSecurity"),     icon:Shield,        show:true        },
  ].filter(item => item.show);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          {t("settings.client.pageTitle")}
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          {t("settings.client.pageSubtitle")}
        </p>
      </div>

      {/* Layout: sidebar vertical + panel */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, position: "sticky", top: 24 }}>
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`vnav-item ${tab === item.id ? "vnav-item--active" : ""}`}
            >
              <item.icon size={14} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>

      {/* ── SUSCRIPCIÓN ── */}
      {tab === "subscription" && isAdminUser && <SubscriptionTab clinic={clinic} />}

      {/* ── CLÍNICA ── */}
      {tab === "clinica" && (
        <>
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg space-y-4">
          <h2 className="text-base font-bold">{t("settings.client.clinicDataTitle")}</h2>
          <div className="space-y-1.5">
            <Label>{t("settings.client.clinicNameLabel")}</Label>
            <Input value={clinic.name ?? ""} onChange={e => setClinic((c: any) => ({ ...c, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.client.categoryLabel")}</Label>
            <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
              value={clinic.category ?? "OTHER"} onChange={e => setClinic((c: any) => ({ ...c, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.client.timezoneLabel")}</Label>
            <select
              className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
              value={clinic.timezone ?? "America/Mexico_City"}
              onChange={e => setClinic((c: any) => ({ ...c, timezone: e.target.value }))}
            >
              {TIMEZONES.map(tz => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
            </select>
            <div className="text-[11px] text-muted-foreground">
              {t("settings.client.timezoneHelp")}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Idioma del panel · Panel language</Label>
            <select
              className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
              value={clinic.locale ?? "es"}
              onChange={e => saveLocale(e.target.value)}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
            <div className="text-[11px] text-muted-foreground">
              Cambia el idioma de todo el panel para tu clínica. Al guardar, la página se recargará.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t("settings.client.cityLabel")}</Label><Input value={clinic.city ?? ""} onChange={e => setClinic((c: any) => ({ ...c, city: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{t("settings.client.addressLabel")}</Label><Input value={clinic.address ?? ""} onChange={e => setClinic((c: any) => ({ ...c, address: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.client.mapsLinkLabel")}</Label>
            <Input
              placeholder="https://maps.app.goo.gl/…"
              value={clinic.mapsUrl ?? ""}
              onChange={e => setClinic((c: any) => ({ ...c, mapsUrl: e.target.value }))}
            />
            <div className="text-[11px] text-muted-foreground">
              {t("settings.client.mapsLinkHelp")}
            </div>
          </div>
          <div className="space-y-1.5">
            <ClinicLocationPicker
              address={clinic.address}
              city={clinic.city}
              state={clinic.state}
              initialLat={clinic.latitude ?? null}
              initialLng={clinic.longitude ?? null}
              onChange={(coords) =>
                setClinic((c: any) => ({ ...c, latitude: coords?.lat ?? null, longitude: coords?.lng ?? null }))
              }
            />
          </div>
          <div className="space-y-1.5"><Label>{t("settings.client.phoneLabel")}</Label><Input value={clinic.phone ?? ""} onChange={e => setClinic((c: any) => ({ ...c, phone: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>{t("settings.client.contactEmailLabel")}</Label><Input type="email" value={clinic.email ?? ""} onChange={e => setClinic((c: any) => ({ ...c, email: e.target.value }))} /></div>
          {/* NOM-024 — CLUES Sector Salud */}
          <div className="space-y-1.5">
            <Label>{t("settings.client.cluesLabel")}</Label>
            <Input
              maxLength={11}
              placeholder={t("settings.client.cluesPlaceholder")}
              value={clinic.clues ?? ""}
              onChange={e => setClinic((c: any) => ({ ...c, clues: e.target.value.toUpperCase().trim() }))}
            />
            <div className="text-[11px] text-muted-foreground">
              {t("settings.client.cluesHelp")}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.client.descriptionLabel")}</Label>
            <textarea
              className="flex w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none resize-none"
              rows={2}
              placeholder={t("settings.client.descriptionPlaceholder")}
              value={clinic.description ?? ""}
              onChange={e => setClinic((c: any) => ({ ...c, description: e.target.value }))}
            />
          </div>
          <div>
            <div className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-colors ${isPublic ? "border-blue-500 bg-blue-600/10" : "border-border bg-transparent"}`}>
              <div>
                <div className={`text-sm font-bold ${isPublic ? "text-blue-700 dark:text-blue-300" : "text-foreground"}`}>
                  {isPublic ? t("settings.client.publicClinicLabel") : t("settings.client.privateClinicLabel")}
                </div>
                <div className={`text-xs mt-0.5 ${isPublic ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                  {isPublic
                    ? t("settings.client.publicClinicDesc")
                    : t("settings.client.privateClinicDesc")}
                </div>
              </div>
              {/* Gate: solo se ACTIVA con ciudad + categoría real (≠ OTHER) — los
                  datos sin los que la clínica no surgiría en el directorio. */}
              <button type="button"
                onClick={() => {
                  const cityOk = Boolean((clinic.city ?? "").trim());
                  const catOk = Boolean(clinic.category) && clinic.category !== "OTHER";
                  if (!isPublic && !(cityOk && catOk)) {
                    toast.error("Completa ciudad y categoría para aparecer en el directorio.");
                    return;
                  }
                  setIsPublic((p: boolean) => !p);
                }}
                className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ml-4 ${isPublic ? "bg-blue-600" : "bg-muted-foreground/30"}`}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full bg-card shadow-sm transition-all"
                  style={{ left: isPublic ? "22px" : "2px" }} />
              </button>
            </div>
            {!(Boolean((clinic.city ?? "").trim()) && Boolean(clinic.category) && clinic.category !== "OTHER") && (
              <p className={`text-xs mt-2 ${isPublic ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {isPublic ? "Completa " : "Agrega "}
                {!((clinic.city ?? "").trim()) && (!clinic.category || clinic.category === "OTHER")
                  ? "tu ciudad y categoría"
                  : !((clinic.city ?? "").trim())
                    ? "tu ciudad"
                    : "tu categoría"}
                {isPublic
                  ? " (campos de arriba) para que tu clínica aparezca en el directorio."
                  : " (campos de arriba) para poder publicar tu clínica en el directorio."}
              </p>
            )}
          </div>
          <div className="pt-2 flex items-center justify-between">
            <span className={`text-sm font-bold px-3 py-1 rounded-full border ${clinic.plan==="CLINIC"?"bg-violet-50 text-violet-700 border-violet-200":clinic.plan==="PRO"?"bg-brand-600/15 text-brand-700 border-brand-200":"bg-muted text-muted-foreground border-border"}`}>
              {t("settings.client.planBadge", { plan: clinic.plan })}
            </span>
            <Button onClick={saveClinic} disabled={saving}>{saving ? t("common.saving") : t("common.saveChanges")}</Button>
          </div>
        </div>

        {/* Portal del paciente — cambios de cita (WS1-T5). Solo admins: el
            PATCH /api/clinic rechaza otros roles y estos toggles guardan al
            instante. */}
        {isAdminUser && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg mt-5 space-y-4">
            <div>
              <h2 className="text-base font-bold">Portal del paciente — cambios de cita</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Controla cómo se manejan las solicitudes de reagendar o cancelar que tus pacientes envían desde su portal.
              </p>
            </div>
            <div className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-colors ${clinic.patientChangesAutoApprove ? "border-violet-500 bg-violet-600/10" : "border-border bg-transparent"}`}>
              <div className="pr-4">
                <div className={`text-sm font-bold ${clinic.patientChangesAutoApprove ? "text-violet-700 dark:text-violet-300" : "text-foreground"}`}>Auto-aprobar cambios de pacientes</div>
                <div className="text-xs mt-0.5 text-muted-foreground">Si está apagado, las solicitudes llegan a tu agenda para aprobarlas.</div>
              </div>
              <button type="button" onClick={() => savePortalAutoApprove(!(clinic.patientChangesAutoApprove ?? false))}
                className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${clinic.patientChangesAutoApprove ? "bg-violet-600" : "bg-muted-foreground/30"}`}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full bg-card shadow-sm transition-all" style={{ left: clinic.patientChangesAutoApprove ? "22px" : "2px" }} />
              </button>
            </div>
            <div className="space-y-1.5">
              <Label>Ventana mínima (horas)</Label>
              <Input
                type="number"
                min={0}
                max={720}
                step={1}
                value={minHoursDraft}
                onChange={e => setMinHoursDraft(e.target.value)}
                onBlur={savePortalMinHours}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
              <div className="text-[11px] text-muted-foreground">
                Los pacientes no pueden pedir cambios a menos de estas horas de su cita.
              </div>
            </div>
          </div>
        )}
        </>
      )}

      {/* ── SERVICIOS POR DOCTOR ── */}
      {tab === "servicios" && (
        <div className="space-y-5 max-w-2xl">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
            <h2 className="text-base font-bold mb-1">{t("settings.client.servicesTitle")}</h2>
            <p className="text-sm text-muted-foreground mb-5">
              {t("settings.client.servicesSubtitle")}
            </p>

            {team.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">{t("settings.client.noActiveProfessionals")}</div>
            ) : (
              <div className="space-y-4">
                {team.map(member => (
                  <div key={member.id} className="border border-border rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                        {member.firstName[0]}{member.lastName[0]}
                      </div>
                      <div>
                        <div className="text-sm font-bold">{member.firstName} {member.lastName}</div>
                        <div className="text-xs text-muted-foreground">{member.role === "SUPER_ADMIN" ? t("settings.client.roleSuperAdmin") : member.role === "ADMIN" ? t("settings.client.roleAdmin") : member.role === "RECEPTIONIST" ? t("settings.client.roleReceptionist") : t("settings.client.roleDoctor")}</div>
                      </div>
                    </div>

                    {/* Current services */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {member.services.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">{t("settings.client.noServicesAssigned")}</span>
                      )}
                      {member.services.map(svc => (
                        <span key={svc} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-600/15 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
                          {svc}
                          <button onClick={() => removeServiceFromMember(member.id, svc)}
                            className="ml-0.5 text-brand-400 hover:text-rose-500 transition-colors" title={t("settings.client.removeServiceTitle")}>×</button>
                        </span>
                      ))}
                    </div>

                    {/* Add service */}
                    <div className="flex gap-2">
                      <input
                        className="flex-1 h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                        placeholder={t("settings.client.servicePlaceholder")}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            addServiceToMember(member.id, (e.target as HTMLInputElement).value);
                            (e.target as HTMLInputElement).value = "";
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={savingServices === member.id}
                        onClick={e => {
                          const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                          addServiceToMember(member.id, input.value);
                          input.value = "";
                        }}>
                        {savingServices === member.id ? "…" : t("settings.client.addServiceBtn")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PERFIL ── */}
      {tab === "perfil" && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg space-y-4">
          <h2 className="text-base font-bold">{t("settings.client.profileTitle")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t("settings.client.firstNameLabel")}</Label><Input value={user.firstName ?? ""} onChange={e => setUser((u: any) => ({ ...u, firstName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{t("settings.client.lastNameLabel")}</Label><Input value={user.lastName ?? ""} onChange={e => setUser((u: any) => ({ ...u, lastName: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>{t("settings.client.emailLabel")}</Label><Input value={user.email ?? ""} disabled className="opacity-60" /></div>
          <div className="space-y-1.5"><Label>{t("settings.client.phoneLabel")}</Label><Input value={user.phone ?? ""} onChange={e => setUser((u: any) => ({ ...u, phone: e.target.value }))} /></div>
          <div className="flex justify-end pt-2">
            <Button onClick={saveUser} disabled={saving}>{saving ? t("common.saving") : t("settings.client.saveProfileBtn")}</Button>
          </div>
        </div>
      )}

      {/* ── FACTURACIÓN CFDI ── */}
      {tab === "facturacion" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold">{t("settings.client.cfdiTitle")}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{t("settings.client.cfdiSubtitle")}</p>
              </div>
              {clinic.facturApiEnabled && (
                <span className="text-sm font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-3 py-1 rounded-full">
                  {t("settings.client.cfdiActiveBadge")}
                </span>
              )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
              <strong>{t("settings.client.cfdiPoweredByTitle")}</strong>{t("settings.client.cfdiPoweredByBody")}
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.rfcLabel")}</Label>
                <Input
                  placeholder="Ej: XAXX010101000"
                  value={cfdiForm.rfcEmisor}
                  onChange={e => setCfdiForm(f => ({ ...f, rfcEmisor: e.target.value.toUpperCase() }))}
                  className="font-mono text-base uppercase"
                  maxLength={13}
                />
                <p className="text-xs text-muted-foreground">{t("settings.client.rfcHelp")}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.razonSocialLabel")}</Label>
                <Input
                  placeholder={t("settings.client.razonSocialPlaceholder")}
                  value={cfdiForm.razonSocial}
                  onChange={e => setCfdiForm(f => ({ ...f, razonSocial: e.target.value.toUpperCase() }))}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">{t("settings.client.razonSocialHelp")}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.regimenLabel")}</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                  value={cfdiForm.regimenFiscal} onChange={e => setCfdiForm(f => ({ ...f, regimenFiscal: e.target.value }))}>
                  {REGIMENES.map(r => <option key={r.clave} value={r.clave}>{r.clave} — {r.desc}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.cpFiscalLabel")}</Label>
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
                {saving ? t("settings.client.cfdiSavingBtn") : t("settings.client.cfdiSaveBtn")}
              </Button>
              <a href="https://www.facturapi.io" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">
                <ExternalLink className="w-4 h-4" /> Facturapi
              </a>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/30 rounded-xl p-3">
              <strong>{t("settings.client.cfdiNoteLabel")}</strong>{t("settings.client.cfdiNoteBody")}
            </div>
          </div>

          {/* ── CERTIFICADOS CSD ── */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">{t("settings.client.csdTitle")}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{t("settings.client.csdSubtitle")}</p>
              </div>
              {clinic.csdUploaded && (
                <span className="text-sm font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-3 py-1 rounded-full whitespace-nowrap">
                  {t("settings.client.csdActiveBadge")}
                </span>
              )}
            </div>

            <div className="text-sm rounded-xl p-3 bg-muted/30 text-muted-foreground">
              {clinic.csdUploaded
                ? (clinic.csdValidUntil
                    ? t("settings.client.csdValidUntilLabel", { date: new Date(clinic.csdValidUntil).toLocaleDateString() })
                    : t("settings.client.csdActiveBadge"))
                : t("settings.client.csdNoneYet")}
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.csdCerLabel")}</Label>
                <input type="file" accept=".cer,application/x-x509-ca-cert,application/octet-stream"
                  onChange={e => setCerFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground hover:file:bg-muted/70" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.csdKeyLabel")}</Label>
                <input type="file" accept=".key,application/octet-stream"
                  onChange={e => setKeyFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground hover:file:bg-muted/70" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-base font-semibold">{t("settings.client.csdPasswordLabel")}</Label>
                <Input type="password" value={csdPassword} onChange={e => setCsdPassword(e.target.value)}
                  placeholder={t("settings.client.csdPasswordPlaceholder")} autoComplete="off" />
              </div>
            </div>

            <div className="pt-1">
              <Button onClick={uploadCsd} disabled={csdUploading} className="w-full sm:w-auto">
                {csdUploading ? t("settings.client.csdUploadingBtn") : t("settings.client.csdUploadBtn")}
              </Button>
            </div>

            <div className="text-xs bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-blue-700 dark:text-blue-300">
              {t("settings.client.csdTestNote")}
            </div>
          </div>
        </div>
      )}

      {/* ── ASISTENTE IA ── */}
      {tab === "ia" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <Bot className="w-6 h-6 text-violet-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">{t("settings.client.aiTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("settings.client.aiSubtitle")}</p>
              </div>
            </div>

            {/* Usage bar */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-violet-500" /> {t("settings.client.aiTokensUsedThisMonth")}
                </span>
                <span className="text-sm font-bold">{aiUsed.toLocaleString()} / {aiLimit.toLocaleString()}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${aiPercent > 80 ? "bg-rose-500" : aiPercent > 60 ? "bg-amber-500" : "bg-violet-500"}`}
                  style={{ width:`${aiPercent}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-sm text-muted-foreground">{t("settings.client.aiPercentUsed", { percent: aiPercent })}</span>
                <span className="text-sm font-semibold text-violet-600">{t("settings.client.aiTokensRemaining", { count: aiRemaining.toLocaleString() })}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label:t("settings.client.aiStatTokensRemaining"), val:aiRemaining.toLocaleString(), color:"text-violet-600" },
                { label:t("settings.client.aiStatConsultations"), val:Math.floor(aiRemaining/800).toString(), color:"text-foreground" },
                { label:t("settings.client.aiStatEstimatedCost"),   val:`~$${((aiUsed/1_000_000)*1).toFixed(4)} USD`, color:"text-emerald-600" },
              ].map(s => (
                <div key={s.label} className="bg-muted/20 rounded-xl p-3 text-center">
                  <div className={`text-xl font-extrabold ${s.color}`}>{s.val}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4 text-sm text-violet-700 dark:text-violet-300">
              <strong>{t("settings.client.aiHowItWorksTitle")}</strong>{t("settings.client.aiHowItWorksBody")}
            </div>
          </div>
        </div>
      )}

      {/* ── INTEGRACIONES ── */}
      {tab === "integraciones" && (
        <div className="space-y-5 max-w-lg">
          {/* Google Calendar */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-2xl">📅</div>
                <div>
                  <h2 className="text-base font-bold">Google Calendar</h2>
                  <p className="text-sm text-muted-foreground">{t("settings.client.gcalSubtitle")}</p>
                </div>
              </div>
              {gcalConnected
                ? <span className="text-sm font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-3 py-1 rounded-full">{t("settings.client.gcalConnectedBadge")}</span>
                : <span className="text-sm font-bold bg-muted text-muted-foreground px-3 py-1 rounded-full">{t("settings.client.gcalNotConnectedBadge")}</span>}
            </div>

            {gcalConnected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <CalendarCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{t("settings.client.gcalAccountConnected")}</div>
                    <div className="text-sm text-emerald-600 dark:text-emerald-400">{user.googleCalendarEmail}</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{t("settings.client.gcalConnectedDesc")}</p>
                <Button variant="outline" onClick={disconnectGcal} className="border-rose-300 text-rose-700 hover:bg-rose-50">
                  {t("settings.client.gcalDisconnectBtn")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("settings.client.gcalConnectDesc")}</p>
                <a href="/api/google"
                  className="flex items-center gap-2 px-4 py-2.5 bg-card border-2 border-border rounded-xl font-semibold text-base hover:border-blue-400 transition-colors w-fit">
                  <span className="text-xl">G</span> {t("settings.client.gcalConnectBtn")}
                </a>
              </div>
            )}
          </div>

          {/* WhatsApp (admin only) */}
          {(initUser.role === "ADMIN" || initUser.role === "SUPER_ADMIN") && (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-2xl">💬</div>
                <div>
                  <h2 className="text-base font-bold">WhatsApp Business</h2>
                  <p className="text-sm text-muted-foreground">{t("settings.client.whatsappSubtitle")}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{t("settings.client.whatsappDesc")}</p>
              <a href="/dashboard/whatsapp" className="text-sm font-semibold text-brand-600 hover:underline">
                {t("settings.client.whatsappLink")}
              </a>
            </div>
          )}

          {/* Automatizaciones CRM (admin only) — gated, default OFF */}
          {(initUser.role === "ADMIN" || initUser.role === "SUPER_ADMIN") && (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-2xl">🤖</div>
                <div>
                  <h2 className="text-base font-bold">Automatizaciones (CRM)</h2>
                  <p className="text-sm text-muted-foreground">Mensajes y tareas automáticas para retener pacientes.</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Los mensajes por WhatsApp solo se envían si tu clínica tiene WhatsApp conectado. Todo está apagado por defecto.
              </p>
              <div className="space-y-3">
                {([
                  { key: "birthdayMsgActive",      label: "Mensaje de cumpleaños",        desc: "Felicita por WhatsApp a tus pacientes el día de su cumpleaños." },
                  { key: "postApptFollowupActive", label: "Seguimiento post-cita",        desc: "Pregunta cómo estuvo la visita ~24 h después de una cita completada." },
                  { key: "noShowTaskActive",       label: "Tarea por riesgo de no-show",  desc: "Crea una tarea al equipo para confirmar citas próximas de alto riesgo." },
                ] as const).map((row) => {
                  const active = Boolean(clinic[row.key]);
                  return (
                    <div key={row.key} className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-colors ${active ? "border-violet-500 bg-violet-600/10" : "border-border bg-transparent"}`}>
                      <div className="pr-4">
                        <div className={`text-sm font-bold ${active ? "text-violet-700 dark:text-violet-300" : "text-foreground"}`}>{row.label}</div>
                        <div className="text-xs mt-0.5 text-muted-foreground">{row.desc}</div>
                      </div>
                      <button type="button" onClick={() => saveAutomation({ [row.key]: !active })}
                        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${active ? "bg-violet-600" : "bg-muted-foreground/30"}`}>
                        <div className="absolute top-0.5 w-5 h-5 rounded-full bg-card shadow-sm transition-all" style={{ left: active ? "22px" : "2px" }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── RECORDATORIOS ── */}
      {tab === "recordatorios" && <RemindersSection clinic={clinic} />}

      {/* ── HORARIOS ── */}
      {tab === "horarios" && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg">
          <h2 className="text-base font-bold mb-4">{t("settings.client.hoursTitle")}</h2>
          <div className="space-y-3">
            {DAYS.map((day, i) => {
              const s = schedule[i] ?? { enabled:false, open:"09:00", close:"18:00" };
              return (
                <div key={day} className={`flex items-center gap-4 p-3.5 rounded-xl border transition-colors ${s.enabled ? "bg-brand-600/15 border-brand-200" : "bg-muted/30 border-border"}`}>
                  <input type="checkbox" checked={s.enabled}
                    onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...(sc[i] ?? { enabled:false, open:"09:00", close:"18:00" }), enabled:e.target.checked } }))}
                    className="w-4 h-4 rounded accent-brand-600 flex-shrink-0" />
                  <span className={`text-base font-semibold w-24 ${s.enabled ? "text-brand-700 dark:text-brand-300" : "text-muted-foreground"}`}>{t(day)}</span>
                  {s.enabled ? (
                    <>
                      <input type="time" value={s.open}
                        onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], open:e.target.value } }))}
                        className="h-9 w-26 rounded-xl border border-border bg-card px-3 text-sm font-mono focus:outline-none" />
                      <span className="text-muted-foreground text-sm">{t("settings.client.hoursTo")}</span>
                      <input type="time" value={s.close}
                        onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], close:e.target.value } }))}
                        className="h-9 w-26 rounded-xl border border-border bg-card px-3 text-sm font-mono focus:outline-none" />
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("settings.client.hoursClosed")}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end mt-5">
            <Button onClick={saveSchedule} disabled={savingSchedule}>{savingSchedule ? t("common.saving") : t("settings.client.hoursSaveBtn")}</Button>
          </div>
        </div>
      )}

      {/* ── SEGURIDAD ── */}
      {tab === "seguridad" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
            <h2 className="text-base font-bold">{t("settings.client.changePasswordTitle")}</h2>
            <div className="space-y-1.5"><Label>{t("settings.client.newPasswordLabel")}</Label>
              <Input type="password" autoComplete="new-password" placeholder={t("settings.client.newPasswordPlaceholder")} value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next:e.target.value }))} />
            </div>
            <div className="space-y-1.5"><Label>{t("settings.client.confirmPasswordLabel")}</Label>
              <Input type="password" autoComplete="new-password" placeholder={t("settings.client.confirmPasswordPlaceholder")} value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm:e.target.value }))} />
            </div>
            <Button onClick={changePassword} disabled={saving || !pwForm.next}>{saving ? t("settings.client.changingPasswordBtn") : t("settings.client.changePasswordBtn")}</Button>
          </div>
          <TwoFactorCard
            initialEnabled={!!(user as any).totpEnabled}
            initialRequire2fa={!!(clinic as any)?.require2fa}
            isAdmin={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
          />
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
            <h2 className="text-base font-bold mb-4">{t("settings.client.accountInfoTitle")}</h2>
            <div className="space-y-2 text-sm">
              {[
                { label:t("settings.client.accountEmailLabel"),       val:initUser.email },
                { label:t("settings.client.accountRoleLabel"),         val:initUser.role },
                { label:t("settings.client.accountMemberSinceLabel"),val:new Date(initUser.createdAt).toLocaleDateString("es-MX",{day:"numeric",month:"long",year:"numeric"}) },
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
      </div>
    </div>
  );
}
