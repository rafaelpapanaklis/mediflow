"use client";

import { useState, useEffect } from "react";
import { Building, User, Clock, Shield, Receipt, Bot, CalendarCheck, ExternalLink, Zap, CreditCard, Bell, MessageCircle, Handshake, ImagePlus, Trash2, Lock } from "lucide-react";
import { SubscriptionTab } from "@/components/dashboard/subscription-tab";
import { RemindersSection } from "./reminders-section";
import { TwoFactorCard } from "@/components/dashboard/security/two-factor-card";
import { CfdiReadinessCard } from "@/components/dashboard/settings/cfdi-readiness-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";
import { useT } from "@/i18n/i18n-provider";
import toast from "react-hot-toast";
import dynamic from "next/dynamic";
import { RaizConfiguracion } from "@/components/dashboard/configuracion-rediseno/raiz";
import {
  Acciones, Archivo, Area, Aviso, Barra, Bloque, BloqueFila, Boton, BotonGuardar, Campo, Campos2,
  Casilla, Chip, Chips, Columna, Contenido, Cuerpo, Encabezado, Enlace, EnlaceBoton, Entrada,
  Estadistica, Estadisticas, Fila, FilaInterruptor, Filas, Insignia, Navegacion, Opcion, Opciones,
  Persona, Seccion, Selector, SubtituloGrupo, Vacio,
} from "@/components/dashboard/configuracion-rediseno/piezas";
import cr from "@/components/dashboard/configuracion-rediseno/configuracion.module.css";
import { SeccionBloqueos } from "@/components/dashboard/bloqueos/seccion-bloqueos";
import blo from "@/components/dashboard/bloqueos/bloqueos.module.css";

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

/** Tokens promedio de un análisis de consulta con IA (lee expediente completo: paciente,
 *  odontograma, consultas previas, recetas, tratamientos). Medido ~3k-8k; usamos 5k como
 *  promedio conservador para NO inflar la estimación que ve la clínica. El chat corto
 *  (~800) es mucho más barato, así que este número subestima a propósito el total de
 *  interacciones posibles: es la cota realista para la función que más consume. */
const AVG_CONSULT_TOKENS = 5000;

interface TeamMember { id: string; firstName: string; lastName: string; role: string; services: string[] }
interface Props {
  user: any; clinic: any; initialTab?: string; gcalStatus?: string; teamMembers?: TeamMember[];
  /** true = FACTURAPI_ENV=live → el timbrado va al SAT con validez fiscal. Es el
   *  ÚNICO dato del ambiente que llega al cliente (nunca la env completa). */
  cfdiLive?: boolean;
  /** settings.edit resuelto en el servidor (WS1-T6). READONLY llega aquí con
   *  settings.view pero sin esto: la pestaña "Mi clínica" se ve completa y no
   *  se puede tocar, en vez de dejar los controles activos para que el PATCH
   *  responda 403 sin explicación. */
  puedeEditarClinica?: boolean;
  /** REDISEÑO (ws1-t2): el MISMO interruptor `menu-dos-niveles` de la clínica,
   *  resuelto en el servidor. false = la pantalla de siempre, tal cual. */
  rediseno?: boolean;
}

export function SettingsClient({ user: initUser, clinic: initClinic, initialTab, gcalStatus, teamMembers: initTeam = [], cfdiLive = false, puedeEditarClinica = true, rediseno = false }: Props) {
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
    // "exempt" (servicios médicos/dentales exentos, art. 15 LIVA) | "iva16".
    cfdiTaxMode:  clinic.cfdiTaxMode  ?? "exempt",
  });
  // Sube al guardar datos fiscales o subir el CSD → el checklist de Facturapi
  // se vuelve a consultar sin recargar la página.
  const [cfdiStatusKey, setCfdiStatusKey] = useState(0);

  // CSD (Certificado de Sello Digital) — subida a Facturapi
  const [cerFile, setCerFile]         = useState<File | null>(null);
  const [keyFile, setKeyFile]         = useState<File | null>(null);
  const [csdPassword, setCsdPassword] = useState("");
  const [csdUploading, setCsdUploading] = useState(false);

  // AI usage info — los props del servidor pintan el tab de inmediato, pero el
  // contador de la clínica puede venir de un mes anterior (el reseteo del cupo
  // es perezoso: lo escribe la siguiente llamada de IA, no el render). GET
  // /api/ai/usage ya aplica ese corte mensual y además trae el desglose por
  // feature, así que sus números mandan en cuanto resuelve.
  const [aiUsage, setAiUsage] = useState<{
    used: number; limit: number; remaining: number; percent: number;
    byFeature: { feature: string; label: string; tokens: number; percent: number }[];
    byFeatureTotal: number;
  } | null>(null);

  useEffect(() => {
    // Solo cuesta la consulta si el usuario está mirando el tab de IA — no en
    // cada carga de Configuración.
    if (tab !== "ia") return;
    let alive = true;
    // Fail-open: si la red o el endpoint fallan NO tocamos el estado y el tab
    // se sigue rindiendo con los props del servidor.
    const num = (v: any, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);
    (async () => {
      try {
        const res = await fetch("/api/ai/usage");
        if (!res.ok) return;
        const d = await res.json();
        // Exige used+limit numéricos: con un payload raro preferimos quedarnos
        // con los props del servidor antes que pintar un límite 0 falso (que se
        // vería como "tu plan no incluye IA" en una clínica que sí la tiene).
        if (!alive || !d || typeof d.used !== "number" || typeof d.limit !== "number") return;
        const used  = Math.max(0, num(d.used, 0));
        const limit = Math.max(0, num(d.limit, 0));
        const rows: { feature: string; label: string; tokens: number; percent: number }[] = [];
        const raw = Array.isArray(d.byFeature) ? d.byFeature : [];
        // El endpoint ya las manda ordenadas desc y con el label traducido: se
        // conserva el orden tal cual (índices, sin re-ordenar ni iterables).
        for (let i = 0; i < raw.length; i++) {
          const r = raw[i] || {};
          rows.push({
            feature: typeof r.feature === "string" ? r.feature : `f${i}`,
            label:   typeof r.label   === "string" ? r.label   : "",
            tokens:  Math.max(0, num(r.tokens, 0)),
            percent: Math.max(0, Math.min(100, Math.round(num(r.percent, 0)))),
          });
        }
        setAiUsage({
          used, limit,
          remaining: Math.max(0, num(d.remaining, Math.max(0, limit - used))),
          percent:   limit > 0 ? Math.max(0, Math.min(100, Math.round(num(d.percent, 0)))) : 0,
          byFeature: rows,
          byFeatureTotal: Math.max(0, num(d.byFeatureTotal, 0)),
        });
      } catch { /* silencioso: el tab ya está pintado con los props del servidor */ }
    })();
    return () => { alive = false; };
  }, [tab]);

  const aiUsed      = aiUsage ? aiUsage.used  : (clinic.aiTokensUsed  ?? 0);
  // `?? 50000` solo atrapa null/undefined: un plan BÁSICO trae 0 y debe quedarse
  // en 0 (es la señal de "sin IA"), por eso el porcentaje se calcula únicamente
  // cuando el límite es > 0 — si no, 0/0 daba NaN y pintaba `width: NaN%`.
  const aiLimit     = aiUsage ? aiUsage.limit : (clinic.aiTokensLimit ?? 50000);
  const aiRemaining = aiUsage ? aiUsage.remaining : Math.max(0, aiLimit - aiUsed);
  const aiPercent   = aiUsage
    ? aiUsage.percent
    : (aiLimit > 0 ? Math.min(100, Math.round((aiUsed / aiLimit) * 100)) : 0);

  // Filas del desglose. La diferencia entre lo consumido y la suma del desglose
  // (IA gastada antes de que el desglose existiera) se muestra como una fila
  // "sin detalle".
  //
  // TODOS los porcentajes se recalculan aquí sobre el MISMO denominador. El
  // `percent` que manda el endpoint va sobre el total del desglose, y la fila
  // "sin detalle" no está en ese total: mezclarlos hacía que las barras
  // sumaran >100% y que una fila de 500 tokens se dibujara más larga que una
  // de 5,000. El denominador es max(consumido, suma del desglose) — el max
  // cubre el caso de un contador reseteado con filas del mes ya escritas.
  const aiBreakdownRows: { key: string; label: string; tokens: number; percent: number }[] = [];
  if (aiUsage) {
    const aiTotal = Math.max(aiUsage.used, aiUsage.byFeatureTotal);
    const pctOf = (n: number) =>
      aiTotal > 0 ? Math.max(0, Math.min(100, Math.round((n / aiTotal) * 100))) : 0;
    for (let i = 0; i < aiUsage.byFeature.length; i++) {
      const r = aiUsage.byFeature[i];
      aiBreakdownRows.push({ key: r.feature, label: r.label, tokens: r.tokens, percent: pctOf(r.tokens) });
    }
    const aiUntracked = aiUsage.used - aiUsage.byFeatureTotal;
    if (aiUntracked > 0) {
      aiBreakdownRows.push({
        key: "__untracked",
        label: t("settings.client.aiBreakdownUntracked"),
        tokens: aiUntracked,
        percent: pctOf(aiUntracked),
      });
    }
  }

  // Google Calendar status
  const gcalConnected = !!user.googleCalendarEnabled;

  // Logo de la clínica (WS1-T6) — el MISMO Clinic.logoUrl que usa la mini-web
  // (/dashboard/landing). Se sube por /api/landing-upload (destino "logo") y
  // se guarda por /api/settings, que ya tenía logoUrl en su whitelist y el
  // mismo gate "settings.edit" que el resto de esta pestaña.
  const [uploadingLogo, setUploadingLogo] = useState(false);

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("field", "logo");
      const up = await fetch("/api/landing-upload", { method: "POST", body: formData });
      const upData = await up.json().catch(() => null);
      if (!up.ok) throw new Error(upData?.error ?? "No pudimos subir el logo.");
      const res = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: upData.url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No pudimos guardar el logo.");
      setClinic((c: any) => ({ ...c, logoUrl: upData.url }));
      toast.success("Logo actualizado");
    } catch (err: any) {
      toast.error(err?.message ?? "Error al subir el logo");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function removeLogo() {
    const prev = clinic.logoUrl;
    setClinic((c: any) => ({ ...c, logoUrl: null }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Logo eliminado");
    } catch {
      setClinic((c: any) => ({ ...c, logoUrl: prev }));
      toast.error("Error al quitar el logo");
    }
  }

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
      setCfdiStatusKey((k) => k + 1);
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
      setCfdiStatusKey((k) => k + 1);
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
  // BLOQUEOS DE AGENDA (ws1-t3) — la pestaña «Horarios y bloqueos» se le abre
  // también al DOCTOR, pero RECORTADA: ver `SeccionBloqueos`. Las demás
  // pestañas de Configuración siguen saliéndole exactamente igual que hoy.
  const esDoctor = initUser.role === "DOCTOR";
  // La puerta de esta pestaña, en UN sitio: la barra de navegación y los dos
  // caminos de render la leen de aquí.
  //
  // 🔴 Y se comprueba TAMBIÉN en el render, no solo en `TABS`. Cada apartado
  // de esta pantalla se decide con `tab === "…"`, que es independiente de la
  // lista de pestañas: quitar una de `TABS` la borra de la barra pero NO
  // impide que su contenido se pinte si `tab` acaba valiendo eso (por
  // ejemplo, con `?tab=horarios` en la URL). El apartado de Suscripción ya lo
  // resuelve así desde antes (`tab === "subscription" && isAdminUser`); esto
  // sigue ese mismo patrón en vez de inventar otro.
  const verHorarios = isAdminUser || esDoctor;
  // Quien no es admin ve el horario semanal en SOLO LECTURA: lo necesita para
  // saber contra qué bloquea, pero la jornada de la clínica no es suya.
  // Fail-closed: cualquier rol que no sea admin cae aquí, no solo DOCTOR.
  const horarioEditable = isAdminUser;
  const doctoresParaBloqueo = team.map((m) => ({
    id: m.id,
    nombre: `${m.firstName} ${m.lastName}`.trim() || m.id,
  }));

  const TABS = [
    { id:"clinica",      label:t("settings.client.tabClinic"),       icon:Building,      show:true        },
    { id:"subscription", label:t("settings.client.tabSubscription"), icon:CreditCard,    show:isAdminUser },
    { id:"servicios",    label:t("settings.client.tabServices"),     icon:Zap,           show:isAdminUser },
    { id:"perfil",       label:t("settings.client.tabProfile"),      icon:User,          show:true        },
    { id:"facturacion",  label:t("settings.client.tabBilling"),      icon:Receipt,       show:isAdminUser },
    { id:"ia",           label:t("settings.client.tabAi"),           icon:Bot,           show:true        },
    { id:"integraciones",label:t("settings.client.tabIntegrations"), icon:CalendarCheck, show:true        },
    { id:"recordatorios",label:t("settings.client.tabReminders"),    icon:Bell,          show:isAdminUser },
    { id:"horarios",     label:t("settings.client.tabHours"),        icon:Clock,         show:verHorarios },
    { id:"seguridad",    label:t("settings.client.tabSecurity"),     icon:Shield,        show:true        },
  ].filter(item => item.show);

  // ── REDISEÑO (ws1-t2) ──────────────────────────────────────────────────
  // Mismo estado, mismas funciones de guardado, mismos apartados y mismos
  // textos que el camino de siempre (abajo): aquí solo cambia la ropa. Se
  // entra ÚNICAMENTE con el interruptor `menu-dos-niveles` encendido para la
  // clínica; apagado, este bloque ni se evalúa y la pantalla es la de hoy.
  if (rediseno) {
    const navItems = TABS.map((item) => ({
      id: item.id,
      label: item.label,
      icono: <item.icon size={16} strokeWidth={1.75} aria-hidden />,
    }));
    const cityOk = Boolean((clinic.city ?? "").trim());
    const catOk = Boolean(clinic.category) && clinic.category !== "OTHER";
    const alternarPublica = () => {
      if (!isPublic && !(cityOk && catOk)) {
        toast.error("Completa ciudad y categoría para aparecer en el directorio.");
        return;
      }
      setIsPublic((p: boolean) => !p);
    };
    const rolDe = (m: TeamMember) =>
      m.role === "SUPER_ADMIN" ? t("settings.client.roleSuperAdmin")
      : m.role === "ADMIN" ? t("settings.client.roleAdmin")
      : m.role === "RECEPTIONIST" ? t("settings.client.roleReceptionist")
      : t("settings.client.roleDoctor");

    return (
      <RaizConfiguracion>
        <Encabezado titulo={t("settings.client.pageTitle")} subtitulo={t("settings.client.pageSubtitle")} />
        <Cuerpo>
          <Navegacion items={navItems} activo={tab} onCambiar={setTab} />
          <Contenido>

            {/* ── SUSCRIPCIÓN ── */}
            {tab === "subscription" && isAdminUser && <SubscriptionTab clinic={clinic} rediseno />}

            {/* ── CLÍNICA ── */}
            {tab === "clinica" && (
              <Columna>
                <Seccion
                  titulo={t("settings.client.clinicDataTitle")}
                  nota={!puedeEditarClinica ? (
                    <Aviso icono={<Lock size={14} strokeWidth={1.75} aria-hidden />}>
                      Puedes ver estos datos, pero no editarlos. Pídele a un administrador que haga el cambio.
                    </Aviso>
                  ) : undefined}
                  apagada={!puedeEditarClinica}
                  pieIzquierda={
                    <Insignia tono={clinic.plan === "CLINIC" || clinic.plan === "PRO" ? "violeta" : "neutro"}>
                      {t("settings.client.planBadge", { plan: clinic.plan })}
                    </Insignia>
                  }
                  pie={
                    <BotonGuardar
                      onClick={saveClinic}
                      guardando={saving}
                      disabled={!puedeEditarClinica}
                      texto={t("common.saveChanges")}
                      textoGuardando={t("common.saving")}
                    />
                  }
                >
                  <Campo etiqueta={t("settings.client.clinicNameLabel")}>
                    <Entrada value={clinic.name ?? ""} onChange={e => setClinic((c: any) => ({ ...c, name: e.target.value }))} />
                  </Campo>

                  {/* Logo — el MISMO Clinic.logoUrl que usa la mini-web pública. */}
                  <Campo
                    etiqueta="Logo de la clínica"
                    ayuda="Aparece en tu página pública y en la cabecera de tus facturas, recetas, órdenes de laboratorio y cartas de referencia. Usa PNG o JPG — son los únicos formatos que también se ven bien en tus documentos."
                  >
                    {clinic.logoUrl ? (
                      <Acciones>
                        {/* eslint-disable-next-line @next/next/no-img-element -- logo subido por la clínica, mismo patrón que el camino de siempre */}
                        <img src={clinic.logoUrl} alt="Logo de la clínica" className={cr.logo} />
                        <div className={cr.columna} style={{ gap: 6 }}>
                          <label className={`${cr.boton} ${cr.botonCorto}`}>
                            {uploadingLogo ? "Subiendo…" : "Cambiar logo"}
                            <input type="file" accept="image/png,image/jpeg" className={cr.oculto} disabled={uploadingLogo}
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                          </label>
                          <Enlace peligro onClick={removeLogo} disabled={uploadingLogo}>
                            <Trash2 size={13} strokeWidth={1.75} aria-hidden /> Quitar logo
                          </Enlace>
                        </div>
                      </Acciones>
                    ) : (
                      <>
                        <Aviso tono="alerta">
                          Aún no tienes logo. Tus facturas, recetas y demás documentos van a salir solo con
                          el nombre de la clínica hasta que subas uno.
                        </Aviso>
                        <label className={cr.subirZona}>
                          <ImagePlus size={20} strokeWidth={1.75} aria-hidden />
                          <span>{uploadingLogo ? "Subiendo…" : "Subir logo"}</span>
                          <input type="file" accept="image/png,image/jpeg" className={cr.oculto} disabled={uploadingLogo}
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                        </label>
                      </>
                    )}
                  </Campo>

                  <Campos2>
                    <Campo etiqueta={t("settings.client.categoryLabel")}>
                      <Selector value={clinic.category ?? "OTHER"} onChange={e => setClinic((c: any) => ({ ...c, category: e.target.value }))}>
                        {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </Selector>
                    </Campo>
                    <Campo etiqueta={t("settings.client.timezoneLabel")} ayuda={t("settings.client.timezoneHelp")}>
                      <Selector value={clinic.timezone ?? "America/Mexico_City"} onChange={e => setClinic((c: any) => ({ ...c, timezone: e.target.value }))}>
                        {TIMEZONES.map(tz => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
                      </Selector>
                    </Campo>
                  </Campos2>

                  <Campo
                    etiqueta="Idioma del panel · Panel language"
                    ayuda="Cambia el idioma de todo el panel para tu clínica. Al guardar, la página se recargará."
                  >
                    <Selector value={clinic.locale ?? "es"} onChange={e => saveLocale(e.target.value)}>
                      <option value="es">Español</option>
                      <option value="en">English</option>
                    </Selector>
                  </Campo>

                  <Campos2>
                    <Campo etiqueta={t("settings.client.cityLabel")}>
                      <Entrada value={clinic.city ?? ""} onChange={e => setClinic((c: any) => ({ ...c, city: e.target.value }))} />
                    </Campo>
                    <Campo etiqueta={t("settings.client.addressLabel")}>
                      <Entrada value={clinic.address ?? ""} onChange={e => setClinic((c: any) => ({ ...c, address: e.target.value }))} />
                    </Campo>
                  </Campos2>

                  <Campo etiqueta={t("settings.client.mapsLinkLabel")} ayuda={t("settings.client.mapsLinkHelp")}>
                    <Entrada
                      placeholder="https://maps.app.goo.gl/…"
                      value={clinic.mapsUrl ?? ""}
                      onChange={e => setClinic((c: any) => ({ ...c, mapsUrl: e.target.value }))}
                    />
                  </Campo>

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

                  <Campos2>
                    <Campo etiqueta={t("settings.client.phoneLabel")}>
                      <Entrada value={clinic.phone ?? ""} onChange={e => setClinic((c: any) => ({ ...c, phone: e.target.value }))} />
                    </Campo>
                    <Campo etiqueta={t("settings.client.contactEmailLabel")}>
                      <Entrada type="email" value={clinic.email ?? ""} onChange={e => setClinic((c: any) => ({ ...c, email: e.target.value }))} />
                    </Campo>
                  </Campos2>

                  {/* NOM-024 — CLUES Sector Salud */}
                  <Campo etiqueta={t("settings.client.cluesLabel")} ayuda={t("settings.client.cluesHelp")}>
                    <Entrada
                      maxLength={11}
                      placeholder={t("settings.client.cluesPlaceholder")}
                      value={clinic.clues ?? ""}
                      onChange={e => setClinic((c: any) => ({ ...c, clues: e.target.value.toUpperCase().trim() }))}
                    />
                  </Campo>

                  <Campo etiqueta={t("settings.client.descriptionLabel")}>
                    <Area
                      rows={2}
                      placeholder={t("settings.client.descriptionPlaceholder")}
                      value={clinic.description ?? ""}
                      onChange={e => setClinic((c: any) => ({ ...c, description: e.target.value }))}
                    />
                  </Campo>

                  <div>
                    {/* Gate: solo se ACTIVA con ciudad + categoría real (≠ OTHER). */}
                    <FilaInterruptor
                      titulo={isPublic ? t("settings.client.publicClinicLabel") : t("settings.client.privateClinicLabel")}
                      descripcion={isPublic ? t("settings.client.publicClinicDesc") : t("settings.client.privateClinicDesc")}
                      activo={isPublic}
                      onCambiar={alternarPublica}
                    />
                    {!(cityOk && catOk) && (
                      <p className={cr.campoAyuda} style={{ marginTop: 8, color: isPublic ? "var(--warning-strong)" : undefined }}>
                        {isPublic ? "Completa " : "Agrega "}
                        {!cityOk && !catOk ? "tu ciudad y categoría" : !cityOk ? "tu ciudad" : "tu categoría"}
                        {isPublic
                          ? " (campos de arriba) para que tu clínica aparezca en el directorio."
                          : " (campos de arriba) para poder publicar tu clínica en el directorio."}
                      </p>
                    )}
                  </div>
                </Seccion>

                {/* Portal del paciente — cambios de cita. Solo admins: guardan al instante. */}
                {isAdminUser && (
                  <Seccion
                    titulo="Portal del paciente — cambios de cita"
                    subtitulo="Controla cómo se manejan las solicitudes de reagendar o cancelar que tus pacientes envían desde su portal."
                  >
                    <FilaInterruptor
                      titulo="Auto-aprobar cambios de pacientes"
                      descripcion="Si está apagado, las solicitudes llegan a tu agenda para aprobarlas."
                      activo={Boolean(clinic.patientChangesAutoApprove)}
                      onCambiar={() => savePortalAutoApprove(!(clinic.patientChangesAutoApprove ?? false))}
                    />
                    <Campo etiqueta="Ventana mínima (horas)" ayuda="Los pacientes no pueden pedir cambios a menos de estas horas de su cita.">
                      <Entrada
                        type="number"
                        min={0}
                        max={720}
                        step={1}
                        corta
                        value={minHoursDraft}
                        onChange={e => setMinHoursDraft(e.target.value)}
                        onBlur={savePortalMinHours}
                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </Campo>
                  </Seccion>
                )}

                {/* Programa de afiliados — sin gate de plan ni de rol, a propósito. */}
                <Seccion
                  icono={<Handshake size={18} strokeWidth={1.75} aria-hidden />}
                  titulo="Programa de afiliados"
                  subtitulo="Recomienda DaleControl a otras clínicas y gana una comisión recurrente por cada una que se suscriba."
                >
                  <Acciones>
                    <EnlaceBoton href="/afiliados" externo>Conocer el programa →</EnlaceBoton>
                    <EnlaceBoton href="/afiliados/registro" externo>Activar mi cuenta de afiliado →</EnlaceBoton>
                  </Acciones>
                </Seccion>
              </Columna>
            )}

            {/* ── SERVICIOS POR DOCTOR ── */}
            {tab === "servicios" && (
              <Seccion titulo={t("settings.client.servicesTitle")} subtitulo={t("settings.client.servicesSubtitle")}>
                {team.length === 0 ? (
                  <Vacio>{t("settings.client.noActiveProfessionals")}</Vacio>
                ) : (
                  team.map(member => (
                    <Bloque key={member.id}>
                      <Persona iniciales={`${member.firstName[0]}${member.lastName[0]}`} nombre={`${member.firstName} ${member.lastName}`} sub={rolDe(member)} />
                      <Chips>
                        {member.services.length === 0 && (
                          <span className={cr.campoAyuda}>{t("settings.client.noServicesAssigned")}</span>
                        )}
                        {member.services.map(svc => (
                          <Chip key={svc} onQuitar={() => removeServiceFromMember(member.id, svc)} tituloQuitar={t("settings.client.removeServiceTitle")}>
                            {svc}
                          </Chip>
                        ))}
                      </Chips>
                      <Acciones>
                        <Entrada
                          style={{ flex: 1, minWidth: 200 }}
                          placeholder={t("settings.client.servicePlaceholder")}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              addServiceToMember(member.id, (e.target as HTMLInputElement).value);
                              (e.target as HTMLInputElement).value = "";
                            }
                          }}
                        />
                        <Boton
                          variante="principal"
                          disabled={savingServices === member.id}
                          onClick={e => {
                            const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                            addServiceToMember(member.id, input.value);
                            input.value = "";
                          }}>
                          {savingServices === member.id ? "…" : t("settings.client.addServiceBtn")}
                        </Boton>
                      </Acciones>
                    </Bloque>
                  ))
                )}
              </Seccion>
            )}

            {/* ── PERFIL ── */}
            {tab === "perfil" && (
              <Seccion
                titulo={t("settings.client.profileTitle")}
                pie={<BotonGuardar onClick={saveUser} guardando={saving} texto={t("settings.client.saveProfileBtn")} textoGuardando={t("common.saving")} />}
              >
                <Campos2>
                  <Campo etiqueta={t("settings.client.firstNameLabel")}>
                    <Entrada value={user.firstName ?? ""} onChange={e => setUser((u: any) => ({ ...u, firstName: e.target.value }))} />
                  </Campo>
                  <Campo etiqueta={t("settings.client.lastNameLabel")}>
                    <Entrada value={user.lastName ?? ""} onChange={e => setUser((u: any) => ({ ...u, lastName: e.target.value }))} />
                  </Campo>
                </Campos2>
                <Campos2>
                  <Campo etiqueta={t("settings.client.emailLabel")}>
                    <Entrada value={user.email ?? ""} disabled />
                  </Campo>
                  <Campo etiqueta={t("settings.client.phoneLabel")}>
                    <Entrada value={user.phone ?? ""} onChange={e => setUser((u: any) => ({ ...u, phone: e.target.value }))} />
                  </Campo>
                </Campos2>
              </Seccion>
            )}

            {/* ── FACTURACIÓN CFDI ── (isAdminUser explícito: ?tab=facturacion se escribe a mano) */}
            {tab === "facturacion" && isAdminUser && (
              <Columna>
                <Seccion
                  titulo={t("settings.client.cfdiTitle")}
                  subtitulo={t("settings.client.cfdiSubtitle")}
                  extra={clinic.facturApiEnabled ? <Insignia tono="exito" punto>{t("settings.client.cfdiActiveBadge")}</Insignia> : undefined}
                  pieIzquierda={
                    <EnlaceBoton href="https://www.facturapi.io" externo>
                      <ExternalLink size={16} strokeWidth={1.75} aria-hidden /> Facturapi
                    </EnlaceBoton>
                  }
                  pie={<BotonGuardar onClick={saveCfdi} guardando={saving} texto={t("settings.client.cfdiSaveBtn")} textoGuardando={t("settings.client.cfdiSavingBtn")} />}
                >
                  <Aviso tono="info">
                    <strong>{t("settings.client.cfdiPoweredByTitle")}</strong>{t("settings.client.cfdiPoweredByBody")}
                  </Aviso>
                  <Campos2>
                    <Campo etiqueta={t("settings.client.rfcLabel")} ayuda={t("settings.client.rfcHelp")}>
                      <Entrada
                        placeholder="Ej: XAXX010101000"
                        value={cfdiForm.rfcEmisor}
                        onChange={e => setCfdiForm(f => ({ ...f, rfcEmisor: e.target.value.toUpperCase() }))}
                        mayusculas
                        maxLength={13}
                      />
                    </Campo>
                    <Campo etiqueta={t("settings.client.cpFiscalLabel")}>
                      <Entrada
                        placeholder="Ej: 97000"
                        value={cfdiForm.cpEmisor}
                        onChange={e => setCfdiForm(f => ({ ...f, cpEmisor: e.target.value.replace(/\D/g,"") }))}
                        maxLength={5}
                      />
                    </Campo>
                  </Campos2>
                  <Campo etiqueta={t("settings.client.razonSocialLabel")} ayuda={t("settings.client.razonSocialHelp")}>
                    <Entrada
                      placeholder={t("settings.client.razonSocialPlaceholder")}
                      value={cfdiForm.razonSocial}
                      onChange={e => setCfdiForm(f => ({ ...f, razonSocial: e.target.value.toUpperCase() }))}
                      mayusculas
                    />
                  </Campo>
                  <Campo etiqueta={t("settings.client.regimenLabel")}>
                    <Selector value={cfdiForm.regimenFiscal} onChange={e => setCfdiForm(f => ({ ...f, regimenFiscal: e.target.value }))}>
                      {REGIMENES.map(r => <option key={r.clave} value={r.clave}>{r.clave} — {r.desc}</option>)}
                    </Selector>
                  </Campo>
                  {/* Impuestos por default del timbrado (exento art. 15 LIVA es el caso común). */}
                  <Campo etiqueta={t("settings.client.taxModeLabel")} ayuda={t("settings.client.taxModeHelp")}>
                    <Opciones>
                      {[
                        { value: "exempt", label: t("settings.client.taxModeExempt") },
                        { value: "iva16",  label: t("settings.client.taxModeIva16")  },
                      ].map(opt => (
                        <Opcion
                          key={opt.value}
                          type="radio"
                          name="cfdiTaxMode"
                          value={opt.value}
                          checked={cfdiForm.cfdiTaxMode === opt.value}
                          onChange={() => setCfdiForm(f => ({ ...f, cfdiTaxMode: opt.value }))}
                        >
                          {opt.label}
                        </Opcion>
                      ))}
                    </Opciones>
                  </Campo>
                  <Aviso>
                    <strong>{t("settings.client.cfdiNoteLabel")}</strong>
                    {cfdiLive ? t("settings.client.cfdiNoteBodyLive") : t("settings.client.cfdiNoteBody")}
                  </Aviso>
                </Seccion>

                {/* Checklist real de Facturapi, entre la captura fiscal y el CSD. */}
                <CfdiReadinessCard refreshKey={cfdiStatusKey} />

                <Seccion
                  titulo={t("settings.client.csdTitle")}
                  subtitulo={t("settings.client.csdSubtitle")}
                  extra={clinic.csdUploaded ? <Insignia tono="exito" punto>{t("settings.client.csdActiveBadge")}</Insignia> : undefined}
                  pie={<BotonGuardar onClick={uploadCsd} guardando={csdUploading} texto={t("settings.client.csdUploadBtn")} textoGuardando={t("settings.client.csdUploadingBtn")} />}
                >
                  <Aviso>
                    {clinic.csdUploaded
                      ? (clinic.csdValidUntil
                          ? t("settings.client.csdValidUntilLabel", { date: new Date(clinic.csdValidUntil).toLocaleDateString() })
                          : t("settings.client.csdActiveBadge"))
                      : t("settings.client.csdNoneYet")}
                  </Aviso>
                  <Campos2>
                    <Campo etiqueta={t("settings.client.csdCerLabel")}>
                      <Archivo accept=".cer,application/x-x509-ca-cert,application/octet-stream" onChange={e => setCerFile(e.target.files?.[0] ?? null)} />
                    </Campo>
                    <Campo etiqueta={t("settings.client.csdKeyLabel")}>
                      <Archivo accept=".key,application/octet-stream" onChange={e => setKeyFile(e.target.files?.[0] ?? null)} />
                    </Campo>
                  </Campos2>
                  <Campo etiqueta={t("settings.client.csdPasswordLabel")}>
                    <Entrada type="password" value={csdPassword} onChange={e => setCsdPassword(e.target.value)}
                      placeholder={t("settings.client.csdPasswordPlaceholder")} autoComplete="off" />
                  </Campo>
                  <Aviso tono="info">{cfdiLive ? t("settings.client.csdLiveNote") : t("settings.client.csdTestNote")}</Aviso>
                </Seccion>
              </Columna>
            )}

            {/* ── ASISTENTE IA ── */}
            {tab === "ia" && (
              <Seccion
                icono={<Bot size={18} strokeWidth={1.75} aria-hidden />}
                titulo={t("settings.client.aiTitle")}
                subtitulo={t("settings.client.aiSubtitle")}
              >
                {/* Un plan sin IA (BÁSICO) tiene límite 0: se explica en vez de medir 0/0. */}
                {aiLimit > 0 ? (
                  <>
                    <div>
                      <div className={cr.medidorCabeza}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Zap size={15} strokeWidth={1.75} aria-hidden style={{ color: "var(--m2-activo)" }} /> {t("settings.client.aiTokensUsedThisMonth")}
                        </span>
                        <strong>{aiUsed.toLocaleString()} / {aiLimit.toLocaleString()}</strong>
                      </div>
                      <Barra porcentaje={aiPercent} nivel={aiPercent > 80 ? "critico" : aiPercent > 60 ? "alto" : undefined} />
                      <div className={cr.medidorPie}>
                        <span>{t("settings.client.aiPercentUsed", { percent: aiPercent })}</span>
                        <strong>{t("settings.client.aiTokensRemaining", { count: aiRemaining.toLocaleString() })}</strong>
                      </div>
                    </div>
                    <Estadisticas>
                      <Estadistica valor={aiRemaining.toLocaleString()} etiqueta={t("settings.client.aiStatTokensRemaining")} tono="violeta" />
                      <Estadistica valor={Math.floor(aiRemaining/AVG_CONSULT_TOKENS).toString()} etiqueta={t("settings.client.aiStatConsultations")} />
                      <Estadistica valor={`~$${((aiUsed/1_000_000)*1).toFixed(4)} USD`} etiqueta={t("settings.client.aiStatEstimatedCost")} tono="exito" />
                    </Estadisticas>
                    <div>
                      <SubtituloGrupo>{t("settings.client.aiBreakdownTitle")}</SubtituloGrupo>
                      {aiBreakdownRows.length === 0 ? (
                        <p className={cr.campoAyuda}>{t("settings.client.aiBreakdownEmpty")}</p>
                      ) : (
                        <div className={cr.columna} style={{ gap: 10 }}>
                          {aiBreakdownRows.map(row => (
                            <div key={row.key}>
                              <div className={cr.desgloseFila}>
                                <span className={cr.desgloseNombre}>{row.label}</span>
                                <span className={cr.desgloseDato}>{t("settings.client.aiBreakdownTokens", { count: row.tokens.toLocaleString() })}</span>
                                <span className={cr.desglosePorcentaje}>{row.percent}%</span>
                              </div>
                              <Barra porcentaje={row.percent} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <Aviso tono="alerta">{t("settings.client.aiNoPlanNotice")}</Aviso>
                )}
                <Aviso tono="violeta">
                  <strong>{t("settings.client.aiHowItWorksTitle")}</strong>{t("settings.client.aiHowItWorksBody")}
                </Aviso>
              </Seccion>
            )}

            {/* ── INTEGRACIONES ── */}
            {tab === "integraciones" && (
              <Columna>
                <Seccion
                  icono={<CalendarCheck size={18} strokeWidth={1.75} aria-hidden />}
                  titulo="Google Calendar"
                  subtitulo={t("settings.client.gcalSubtitle")}
                  extra={gcalConnected
                    ? <Insignia tono="exito" punto>{t("settings.client.gcalConnectedBadge")}</Insignia>
                    : <Insignia>{t("settings.client.gcalNotConnectedBadge")}</Insignia>}
                >
                  {gcalConnected ? (
                    <>
                      <Aviso tono="exito" icono={<CalendarCheck size={16} strokeWidth={1.75} aria-hidden />}>
                        <strong>{t("settings.client.gcalAccountConnected")}</strong>
                        <div>{user.googleCalendarEmail}</div>
                      </Aviso>
                      <p className={cr.campoAyuda} style={{ fontSize: 13 }}>{t("settings.client.gcalConnectedDesc")}</p>
                      <Acciones>
                        <Boton variante="peligro" onClick={disconnectGcal}>{t("settings.client.gcalDisconnectBtn")}</Boton>
                      </Acciones>
                    </>
                  ) : (
                    <>
                      <p className={cr.campoAyuda} style={{ fontSize: 13 }}>{t("settings.client.gcalConnectDesc")}</p>
                      <Acciones>
                        <EnlaceBoton href="/api/google">
                          <span style={{ fontSize: 17, fontWeight: 700 }}>G</span> {t("settings.client.gcalConnectBtn")}
                        </EnlaceBoton>
                      </Acciones>
                    </>
                  )}
                </Seccion>

                {/* WhatsApp (admin only) */}
                {isAdminUser && (
                  <Seccion
                    icono={<MessageCircle size={18} strokeWidth={1.75} aria-hidden />}
                    titulo="WhatsApp Business"
                    subtitulo={t("settings.client.whatsappSubtitle")}
                  >
                    <p className={cr.campoAyuda} style={{ fontSize: 13 }}>{t("settings.client.whatsappDesc")}</p>
                    <Acciones>
                      <Enlace href="/dashboard/whatsapp">{t("settings.client.whatsappLink")}</Enlace>
                    </Acciones>
                  </Seccion>
                )}

                {/* Automatizaciones CRM (admin only) — gated, default OFF */}
                {isAdminUser && (
                  <Seccion
                    icono={<Bot size={18} strokeWidth={1.75} aria-hidden />}
                    titulo="Automatizaciones (CRM)"
                    subtitulo="Mensajes y tareas automáticas para retener pacientes."
                  >
                    <p className={cr.campoAyuda}>
                      Los mensajes por WhatsApp solo se envían si tu clínica tiene WhatsApp conectado. Todo está apagado por defecto.
                    </p>
                    {([
                      { key: "birthdayMsgActive",      label: "Mensaje de cumpleaños",        desc: "Felicita por WhatsApp a tus pacientes el día de su cumpleaños." },
                      { key: "postApptFollowupActive", label: "Seguimiento post-cita",        desc: "Pregunta cómo estuvo la visita ~24 h después de una cita completada." },
                      { key: "noShowTaskActive",       label: "Tarea por riesgo de no-show",  desc: "Crea una tarea al equipo para confirmar citas próximas de alto riesgo." },
                    ] as const).map((row) => {
                      const active = Boolean(clinic[row.key]);
                      return (
                        <FilaInterruptor
                          key={row.key}
                          titulo={row.label}
                          descripcion={row.desc}
                          activo={active}
                          onCambiar={() => saveAutomation({ [row.key]: !active })}
                        />
                      );
                    })}
                  </Seccion>
                )}
              </Columna>
            )}

            {/* ── RECORDATORIOS ── */}
            {tab === "recordatorios" && <RemindersSection clinic={clinic} rediseno />}

            {/* ── HORARIOS Y BLOQUEOS ──
                ① El horario semanal, TAL CUAL estaba: es la jornada normal y
                   funciona. Lo único nuevo es que quien no es admin (el doctor)
                   lo ve en SOLO LECTURA — sin casillas, sin `type=time` y sin
                   botón de guardar — porque necesita saber contra qué bloquea.
                ② Debajo, la sección de bloqueos (ws1-t3). */}
            {tab === "horarios" && verHorarios && (
              <Columna>
                <Seccion
                  titulo={t("settings.client.hoursTitle")}
                  pie={horarioEditable
                    ? <BotonGuardar onClick={saveSchedule} guardando={savingSchedule} texto={t("settings.client.hoursSaveBtn")} textoGuardando={t("common.saving")} />
                    : undefined}
                >
                  <div className={cr.columna} style={{ gap: 8 }}>
                    {DAYS.map((day, i) => {
                      const sd = schedule[i] ?? { enabled:false, open:"09:00", close:"18:00" };
                      return (
                        <BloqueFila key={day} activo={sd.enabled}>
                          <div className={cr.horaFila}>
                            {horarioEditable && (
                              <Casilla checked={sd.enabled}
                                onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...(sc[i] ?? { enabled:false, open:"09:00", close:"18:00" }), enabled:e.target.checked } }))} />
                            )}
                            <span className={cr.horaDia}>{t(day)}</span>
                            {!sd.enabled ? (
                              <span className={cr.horaHasta}>{t("settings.client.hoursClosed")}</span>
                            ) : horarioEditable ? (
                              <>
                                <Entrada type="time" corta value={sd.open}
                                  onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], open:e.target.value } }))} />
                                <span className={cr.horaHasta}>{t("settings.client.hoursTo")}</span>
                                <Entrada type="time" corta value={sd.close}
                                  onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...sc[i], close:e.target.value } }))} />
                              </>
                            ) : (
                              <span className={cr.horaHasta}>
                                {sd.open} {t("settings.client.hoursTo")} {sd.close}
                              </span>
                            )}
                          </div>
                        </BloqueFila>
                      );
                    })}
                  </div>
                  {!horarioEditable && (
                    <span className={blo.notaSoloLectura}>{t("settings.bloqueos.horarioSoloLectura")}</span>
                  )}
                </Seccion>

                <SeccionBloqueos
                  timezone={clinic.timezone ?? "America/Mexico_City"}
                  doctores={doctoresParaBloqueo}
                  modoDoctor={!isAdminUser}
                />
              </Columna>
            )}

            {/* ── SEGURIDAD ── */}
            {tab === "seguridad" && (
              <Columna>
                <Seccion
                  titulo={t("settings.client.changePasswordTitle")}
                  pie={<BotonGuardar onClick={changePassword} guardando={saving} disabled={!pwForm.next} texto={t("settings.client.changePasswordBtn")} textoGuardando={t("settings.client.changingPasswordBtn")} />}
                >
                  <Campos2>
                    <Campo etiqueta={t("settings.client.newPasswordLabel")}>
                      <Entrada type="password" autoComplete="new-password" placeholder={t("settings.client.newPasswordPlaceholder")} value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next:e.target.value }))} />
                    </Campo>
                    <Campo etiqueta={t("settings.client.confirmPasswordLabel")}>
                      <Entrada type="password" autoComplete="new-password" placeholder={t("settings.client.confirmPasswordPlaceholder")} value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm:e.target.value }))} />
                    </Campo>
                  </Campos2>
                </Seccion>
                <TwoFactorCard
                  initialEnabled={!!(user as any).totpEnabled}
                  initialRequire2fa={!!(clinic as any)?.require2fa}
                  isAdmin={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
                />
                <Seccion titulo={t("settings.client.accountInfoTitle")}>
                  <Filas>
                    <Fila etiqueta={t("settings.client.accountEmailLabel")}>{initUser.email}</Fila>
                    <Fila etiqueta={t("settings.client.accountRoleLabel")}>{initUser.role}</Fila>
                    <Fila etiqueta={t("settings.client.accountMemberSinceLabel")}>
                      {new Date(initUser.createdAt).toLocaleDateString("es-MX",{day:"numeric",month:"long",year:"numeric"})}
                    </Fila>
                  </Filas>
                </Seccion>
              </Columna>
            )}
          </Contenido>
        </Cuerpo>
      </RaizConfiguracion>
    );
  }

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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: 220, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, position: "sticky", top: 24 }}>
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`vnav-item ${tab === item.id ? "vnav-item--active" : ""}`}
              style={{ minHeight: 40 }}
            >
              <item.icon size={16} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: "1 1 480px", minWidth: 0 }}>

      {/* ── SUSCRIPCIÓN ── */}
      {tab === "subscription" && isAdminUser && <SubscriptionTab clinic={clinic} />}

      {/* ── CLÍNICA ── */}
      {tab === "clinica" && (
        <>
        <div className="card max-w-lg">
          <div className="card__header">
            <div className="card__title">{t("settings.client.clinicDataTitle")}</div>
          </div>
          {/* Solo lectura: mismo permiso que exige el PATCH (settings.edit),
              resuelto en el servidor. Sin esto, un rol de solo lectura veía
              los campos activos y el guardado le devolvía un 403 mudo. */}
          {!puedeEditarClinica && (
            <div className="mx-5 mt-4 flex items-center gap-2 rounded-[var(--radius)] px-3 py-2.5 text-xs font-medium"
              style={{ background: "var(--bg-elev-2)", color: "var(--text-3)" }}>
              <Lock size={14} strokeWidth={1.75} />
              Puedes ver estos datos, pero no editarlos. Pídele a un administrador que haga el cambio.
            </div>
          )}
          <div className="card__body space-y-4" style={puedeEditarClinica ? undefined : { opacity: 0.65, pointerEvents: "none" }}>
          <div className="field-new">
            <label className="field-new__label">{t("settings.client.clinicNameLabel")}</label>
            <Input value={clinic.name ?? ""} onChange={e => setClinic((c: any) => ({ ...c, name: e.target.value }))} />
          </div>

          {/* Logo — el MISMO Clinic.logoUrl que usa la mini-web pública
              (/dashboard/landing): cambiarlo aquí lo cambia allá también. */}
          <div className="field-new">
            <label className="field-new__label">Logo de la clínica</label>
            <p className="text-[11px] text-muted-foreground -mt-0.5 mb-2">
              Aparece en tu página pública y en la cabecera de tus facturas, recetas, órdenes de
              laboratorio y cartas de referencia. Usa PNG o JPG — son los únicos formatos que también
              se ven bien en tus documentos.
            </p>
            {clinic.logoUrl ? (
              <div className="flex items-center gap-3">
                <img src={clinic.logoUrl} alt="Logo de la clínica"
                  className="h-16 w-16 object-contain rounded-[var(--radius)] border border-[color:var(--border-soft)] bg-white" />
                <div className="flex flex-col gap-1.5">
                  <label className="btn-new btn-new--secondary text-xs cursor-pointer">
                    {uploadingLogo ? "Subiendo…" : "Cambiar logo"}
                    <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploadingLogo}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                  </label>
                  <button type="button" onClick={removeLogo} disabled={uploadingLogo}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--danger)] hover:underline disabled:opacity-50">
                    <Trash2 size={13} strokeWidth={1.75} /> Quitar logo
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--warning-strong)" }}>
                  Aún no tienes logo. Tus facturas, recetas y demás documentos van a salir solo con
                  el nombre de la clínica hasta que subas uno.
                </p>
                <label className="flex flex-col items-center justify-center gap-2 text-center border border-dashed border-[color:var(--border-strong)] rounded-[var(--radius-lg)] py-6 px-4 cursor-pointer text-[color:var(--text-2)] hover:border-[color:var(--border-brand)] hover:bg-[color:var(--brand-softer)] transition-colors">
                  <ImagePlus size={20} strokeWidth={1.75} className="text-[color:var(--brand)]" />
                  <span className="text-sm font-semibold">{uploadingLogo ? "Subiendo…" : "Subir logo"}</span>
                  <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploadingLogo}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                </label>
              </div>
            )}
          </div>

          <div className="field-new">
            <label className="field-new__label">{t("settings.client.categoryLabel")}</label>
            <select className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-colors"
              value={clinic.category ?? "OTHER"} onChange={e => setClinic((c: any) => ({ ...c, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("settings.client.timezoneLabel")}</label>
            <select
              className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-colors"
              value={clinic.timezone ?? "America/Mexico_City"}
              onChange={e => setClinic((c: any) => ({ ...c, timezone: e.target.value }))}
            >
              {TIMEZONES.map(tz => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
            </select>
            <div className="text-[11px] text-muted-foreground">
              {t("settings.client.timezoneHelp")}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">Idioma del panel · Panel language</label>
            <select
              className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-colors"
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
            <div className="field-new"><label className="field-new__label">{t("settings.client.cityLabel")}</label><Input value={clinic.city ?? ""} onChange={e => setClinic((c: any) => ({ ...c, city: e.target.value }))} /></div>
            <div className="field-new"><label className="field-new__label">{t("settings.client.addressLabel")}</label><Input value={clinic.address ?? ""} onChange={e => setClinic((c: any) => ({ ...c, address: e.target.value }))} /></div>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("settings.client.mapsLinkLabel")}</label>
            <Input
              placeholder="https://maps.app.goo.gl/…"
              value={clinic.mapsUrl ?? ""}
              onChange={e => setClinic((c: any) => ({ ...c, mapsUrl: e.target.value }))}
            />
            <div className="text-[11px] text-muted-foreground">
              {t("settings.client.mapsLinkHelp")}
            </div>
          </div>
          <div className="field-new">
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
          <div className="field-new"><label className="field-new__label">{t("settings.client.phoneLabel")}</label><Input value={clinic.phone ?? ""} onChange={e => setClinic((c: any) => ({ ...c, phone: e.target.value }))} /></div>
          <div className="field-new"><label className="field-new__label">{t("settings.client.contactEmailLabel")}</label><Input type="email" value={clinic.email ?? ""} onChange={e => setClinic((c: any) => ({ ...c, email: e.target.value }))} /></div>
          {/* NOM-024 — CLUES Sector Salud */}
          <div className="field-new">
            <label className="field-new__label">{t("settings.client.cluesLabel")}</label>
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
          <div className="field-new">
            <label className="field-new__label">{t("settings.client.descriptionLabel")}</label>
            <textarea
              className="flex w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-colors resize-none"
              rows={2}
              placeholder={t("settings.client.descriptionPlaceholder")}
              value={clinic.description ?? ""}
              onChange={e => setClinic((c: any) => ({ ...c, description: e.target.value }))}
            />
          </div>
          <div>
            <div className="flex items-center justify-between p-4" style={{ borderRadius: "var(--radius)", border: `1px solid ${isPublic ? "var(--consult-active-border)" : "var(--border-soft)"}`, background: isPublic ? "var(--brand-softer)" : "transparent", transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)" }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                  {isPublic ? t("settings.client.publicClinicLabel") : t("settings.client.privateClinicLabel")}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
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
                aria-label={isPublic ? t("settings.client.publicClinicLabel") : t("settings.client.privateClinicLabel")}
                className={`switch ml-4 ${isPublic ? "switch--on" : ""}`}>
                <span className="switch__thumb" />
              </button>
            </div>
            {!(Boolean((clinic.city ?? "").trim()) && Boolean(clinic.category) && clinic.category !== "OTHER") && (
              <p className="text-xs mt-2" style={{ color: isPublic ? "var(--warning-strong)" : "var(--text-3)" }}>
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
            <span className={`badge-new ${clinic.plan === "CLINIC" || clinic.plan === "PRO" ? "badge-new--brand" : "badge-new--neutral"}`}>
              {t("settings.client.planBadge", { plan: clinic.plan })}
            </span>
            <Button onClick={saveClinic} disabled={saving || !puedeEditarClinica}>{saving ? t("common.saving") : t("common.saveChanges")}</Button>
          </div>
          </div>
        </div>

        {/* Portal del paciente — cambios de cita (WS1-T5). Solo admins: el
            PATCH /api/clinic rechaza otros roles y estos toggles guardan al
            instante. */}
        {isAdminUser && (
          <div className="card max-w-lg mt-5">
            <div className="card__header">
              <div>
                <div className="card__title">Portal del paciente — cambios de cita</div>
                <div className="card__sub">
                  Controla cómo se manejan las solicitudes de reagendar o cancelar que tus pacientes envían desde su portal.
                </div>
              </div>
            </div>
            <div className="card__body space-y-4">
            <div className="flex items-center justify-between p-4" style={{ borderRadius: "var(--radius)", border: `1px solid ${clinic.patientChangesAutoApprove ? "var(--consult-active-border)" : "var(--border-soft)"}`, background: clinic.patientChangesAutoApprove ? "var(--brand-softer)" : "transparent", transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)" }}>
              <div className="pr-4">
                <div className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Auto-aprobar cambios de pacientes</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>Si está apagado, las solicitudes llegan a tu agenda para aprobarlas.</div>
              </div>
              <button type="button" onClick={() => savePortalAutoApprove(!(clinic.patientChangesAutoApprove ?? false))}
                aria-label="Auto-aprobar cambios de pacientes"
                className={`switch ${clinic.patientChangesAutoApprove ? "switch--on" : ""}`}>
                <span className="switch__thumb" />
              </button>
            </div>
            <div className="field-new">
              <label className="field-new__label">Ventana mínima (horas)</label>
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
          </div>
        )}

        {/* Programa de afiliados — punto de entrada discreto a la landing
            pública. A propósito SIN gate de plan ni de rol: cualquier clínica,
            en cualquier plan, puede recomendar DaleControl. No lee montos: las
            cifras viven en la config del programa y escribirlas aquí a mano se
            desincronizaría. */}
        <div className="card max-w-lg mt-5">
          <div className="card__header">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <Handshake size={16} strokeWidth={1.75} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} aria-hidden />
              <div>
                <div className="card__title">Programa de afiliados</div>
                <div className="card__sub">
                  Recomienda DaleControl a otras clínicas y gana una comisión recurrente por cada una que se suscriba.
                </div>
              </div>
            </div>
          </div>
          <div className="card__body" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="/afiliados" target="_blank" rel="noopener noreferrer"
              className="btn-new btn-new--secondary">
              Conocer el programa →
            </a>
            {/* Atajo directo: /afiliados/registro detecta la sesión abierta y
                ofrece activar el rol de afiliado en un clic, sin pedir de nuevo
                correo ni contraseña (clínicas y afiliados comparten Supabase
                Auth, así que el alta normal rechazaría este correo). */}
            <a href="/afiliados/registro" target="_blank" rel="noopener noreferrer"
              className="btn-new btn-new--secondary">
              Activar mi cuenta de afiliado →
            </a>
          </div>
        </div>
        </>
      )}

      {/* ── SERVICIOS POR DOCTOR ── */}
      {tab === "servicios" && (
        <div className="space-y-5 max-w-2xl">
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">{t("settings.client.servicesTitle")}</div>
                <div className="card__sub">{t("settings.client.servicesSubtitle")}</div>
              </div>
            </div>
            <div className="card__body">

            {team.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">{t("settings.client.noActiveProfessionals")}</div>
            ) : (
              <div className="space-y-4">
                {team.map(member => (
                  <div key={member.id} style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 16 }}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="avatar-new">
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
                        className="flex-1 h-10 rounded-[var(--radius)] border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-colors"
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
        </div>
      )}

      {/* ── PERFIL ── */}
      {tab === "perfil" && (
        <div className="card max-w-lg">
          <div className="card__header">
            <div className="card__title">{t("settings.client.profileTitle")}</div>
          </div>
          <div className="card__body space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="field-new"><label className="field-new__label">{t("settings.client.firstNameLabel")}</label><Input value={user.firstName ?? ""} onChange={e => setUser((u: any) => ({ ...u, firstName: e.target.value }))} /></div>
            <div className="field-new"><label className="field-new__label">{t("settings.client.lastNameLabel")}</label><Input value={user.lastName ?? ""} onChange={e => setUser((u: any) => ({ ...u, lastName: e.target.value }))} /></div>
          </div>
          <div className="field-new"><label className="field-new__label">{t("settings.client.emailLabel")}</label><Input value={user.email ?? ""} disabled className="opacity-60" /></div>
          <div className="field-new"><label className="field-new__label">{t("settings.client.phoneLabel")}</label><Input value={user.phone ?? ""} onChange={e => setUser((u: any) => ({ ...u, phone: e.target.value }))} /></div>
          <div className="flex justify-end pt-2">
            <Button onClick={saveUser} disabled={saving}>{saving ? t("common.saving") : t("settings.client.saveProfileBtn")}</Button>
          </div>
          </div>
        </div>
      )}

      {/* ── FACTURACIÓN CFDI ── */}
      {/* isAdminUser explícito además del filtro de TABS: ?tab=facturacion se
          puede escribir a mano y el inicializador de `tab` solo protegía
          "subscription". La configuración fiscal es solo del dueño/admin. */}
      {tab === "facturacion" && isAdminUser && (
        <div className="space-y-5 max-w-lg">
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">{t("settings.client.cfdiTitle")}</div>
                <div className="card__sub">{t("settings.client.cfdiSubtitle")}</div>
              </div>
              {clinic.facturApiEnabled && (
                <span className="badge-new badge-new--success">
                  {t("settings.client.cfdiActiveBadge")}
                </span>
              )}
            </div>
            <div className="card__body space-y-4">

            <div className="text-sm" style={{ background: "var(--info-soft)", border: "1px solid var(--info-soft)", color: "var(--info-strong)", borderRadius: "var(--radius)", padding: 14 }}>
              <strong>{t("settings.client.cfdiPoweredByTitle")}</strong>{t("settings.client.cfdiPoweredByBody")}
            </div>

            <div className="space-y-4">
              <div className="field-new">
                <label className="field-new__label">{t("settings.client.rfcLabel")}</label>
                <Input
                  placeholder="Ej: XAXX010101000"
                  value={cfdiForm.rfcEmisor}
                  onChange={e => setCfdiForm(f => ({ ...f, rfcEmisor: e.target.value.toUpperCase() }))}
                  className="font-mono text-base uppercase"
                  maxLength={13}
                />
                <p className="text-xs text-muted-foreground">{t("settings.client.rfcHelp")}</p>
              </div>

              <div className="field-new">
                <label className="field-new__label">{t("settings.client.razonSocialLabel")}</label>
                <Input
                  placeholder={t("settings.client.razonSocialPlaceholder")}
                  value={cfdiForm.razonSocial}
                  onChange={e => setCfdiForm(f => ({ ...f, razonSocial: e.target.value.toUpperCase() }))}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">{t("settings.client.razonSocialHelp")}</p>
              </div>

              <div className="field-new">
                <label className="field-new__label">{t("settings.client.regimenLabel")}</label>
                <select className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-colors"
                  value={cfdiForm.regimenFiscal} onChange={e => setCfdiForm(f => ({ ...f, regimenFiscal: e.target.value }))}>
                  {REGIMENES.map(r => <option key={r.clave} value={r.clave}>{r.clave} — {r.desc}</option>)}
                </select>
              </div>

              <div className="field-new">
                <label className="field-new__label">{t("settings.client.cpFiscalLabel")}</label>
                <Input
                  placeholder="Ej: 97000"
                  value={cfdiForm.cpEmisor}
                  onChange={e => setCfdiForm(f => ({ ...f, cpEmisor: e.target.value.replace(/\D/g,"") }))}
                  maxLength={5}
                  className="font-mono"
                />
              </div>

              {/* Impuestos por default del timbrado. La odontología es exenta de
                  IVA (art. 15 LIVA) y es el caso común, así que ese es el default;
                  el modal de timbrado lo puede sobreescribir factura por factura
                  (p. ej. venta de productos al 16% en una clínica exenta). */}
              <div className="field-new">
                <label className="field-new__label">{t("settings.client.taxModeLabel")}</label>
                <div className="space-y-2 pt-1">
                  {[
                    { value: "exempt", label: t("settings.client.taxModeExempt") },
                    { value: "iva16",  label: t("settings.client.taxModeIva16")  },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="cfdiTaxMode"
                        value={opt.value}
                        checked={cfdiForm.cfdiTaxMode === opt.value}
                        onChange={() => setCfdiForm(f => ({ ...f, cfdiTaxMode: opt.value }))}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <span style={{ color: "var(--text-1)" }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("settings.client.taxModeHelp")}</p>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <Button onClick={saveCfdi} disabled={saving} className="flex-1">
                {saving ? t("settings.client.cfdiSavingBtn") : t("settings.client.cfdiSaveBtn")}
              </Button>
              <a href="https://www.facturapi.io" target="_blank" rel="noopener noreferrer"
                className="btn-new btn-new--secondary">
                <ExternalLink size={16} strokeWidth={1.75} /> Facturapi
              </a>
            </div>

            <div className="text-xs" style={{ color: "var(--text-3)", background: "var(--bg-elev-2)", borderRadius: "var(--radius)", padding: 12 }}>
              <strong>{t("settings.client.cfdiNoteLabel")}</strong>
              {cfdiLive ? t("settings.client.cfdiNoteBodyLive") : t("settings.client.cfdiNoteBody")}
            </div>
            </div>
          </div>

          {/* ── LISTO PARA FACTURAR ANTE EL SAT ──
              Checklist real de la organización en Facturapi (is_production_ready /
              pending_steps). Va entre la captura fiscal y la subida del CSD: dice
              qué falta justo antes de la card que resuelve el paso más común. */}
          <CfdiReadinessCard refreshKey={cfdiStatusKey} />

          {/* ── CERTIFICADOS CSD ── */}
          <div className="card">
            <div className="card__header">
              <div>
                <div className="card__title">{t("settings.client.csdTitle")}</div>
                <div className="card__sub">{t("settings.client.csdSubtitle")}</div>
              </div>
              {clinic.csdUploaded && (
                <span className="badge-new badge-new--success whitespace-nowrap">
                  {t("settings.client.csdActiveBadge")}
                </span>
              )}
            </div>
            <div className="card__body space-y-4">

            <div className="text-sm" style={{ borderRadius: "var(--radius)", padding: 12, background: "var(--bg-elev-2)", color: "var(--text-2)" }}>
              {clinic.csdUploaded
                ? (clinic.csdValidUntil
                    ? t("settings.client.csdValidUntilLabel", { date: new Date(clinic.csdValidUntil).toLocaleDateString() })
                    : t("settings.client.csdActiveBadge"))
                : t("settings.client.csdNoneYet")}
            </div>

            <div className="space-y-4">
              <div className="field-new">
                <label className="field-new__label">{t("settings.client.csdCerLabel")}</label>
                <input type="file" accept=".cer,application/x-x509-ca-cert,application/octet-stream"
                  onChange={e => setCerFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground hover:file:bg-muted/70" />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("settings.client.csdKeyLabel")}</label>
                <input type="file" accept=".key,application/octet-stream"
                  onChange={e => setKeyFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground hover:file:bg-muted/70" />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("settings.client.csdPasswordLabel")}</label>
                <Input type="password" value={csdPassword} onChange={e => setCsdPassword(e.target.value)}
                  placeholder={t("settings.client.csdPasswordPlaceholder")} autoComplete="off" />
              </div>
            </div>

            <div className="pt-1">
              <Button onClick={uploadCsd} disabled={csdUploading} className="w-full sm:w-auto">
                {csdUploading ? t("settings.client.csdUploadingBtn") : t("settings.client.csdUploadBtn")}
              </Button>
            </div>

            <div className="text-xs" style={{ background: "var(--info-soft)", border: "1px solid var(--info-soft)", color: "var(--info-strong)", borderRadius: "var(--radius)", padding: 12 }}>
              {cfdiLive ? t("settings.client.csdLiveNote") : t("settings.client.csdTestNote")}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ASISTENTE IA ── */}
      {tab === "ia" && (
        <div className="space-y-5 max-w-lg">
          <div className="card">
            <div className="card__header">
              <div className="flex items-center gap-3">
                <div style={{ width: 40, height: 40, borderRadius: "var(--radius)", background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Bot size={20} strokeWidth={1.75} />
                </div>
                <div>
                  <div className="card__title">{t("settings.client.aiTitle")}</div>
                  <div className="card__sub">{t("settings.client.aiSubtitle")}</div>
                </div>
              </div>
            </div>
            <div className="card__body">

            {/* Un plan sin IA (BÁSICO) tiene límite 0: en vez de un medidor 0/0
                se explica por qué no hay nada que medir. */}
            {aiLimit > 0 ? (
              <>
              {/* Usage bar */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Zap size={16} strokeWidth={1.75} style={{ color: "var(--brand)" }} /> {t("settings.client.aiTokensUsedThisMonth")}
                  </span>
                  <span className="text-sm font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{aiUsed.toLocaleString()} / {aiLimit.toLocaleString()}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-elev-2)" }}>
                  <div className="h-full rounded-full"
                    style={{ width:`${aiPercent}%`, background: aiPercent > 80 ? "var(--danger)" : aiPercent > 60 ? "var(--warning)" : "var(--brand)", transition: "width var(--dur-2) var(--ease)" }} />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-sm text-muted-foreground">{t("settings.client.aiPercentUsed", { percent: aiPercent })}</span>
                  <span className="text-sm font-semibold text-violet-600 dark:text-violet-300">{t("settings.client.aiTokensRemaining", { count: aiRemaining.toLocaleString() })}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label:t("settings.client.aiStatTokensRemaining"), val:aiRemaining.toLocaleString(), color:"text-violet-600 dark:text-violet-300" },
                  { label:t("settings.client.aiStatConsultations"), val:Math.floor(aiRemaining/AVG_CONSULT_TOKENS).toString(), color:"text-foreground" },
                  { label:t("settings.client.aiStatEstimatedCost"),   val:`~$${((aiUsed/1_000_000)*1).toFixed(4)} USD`, color:"text-emerald-600 dark:text-emerald-300" },
                ].map(s => (
                  <div key={s.label} className="text-center" style={{ background: "var(--bg-elev-2)", borderRadius: "var(--radius)", padding: 12 }}>
                    <div className={`text-xl font-bold ${s.color}`} style={{ fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Desglose por feature — el orden desc y el label ya vienen del endpoint */}
              <div className="mb-5">
                <div className="text-sm font-semibold text-muted-foreground mb-2">{t("settings.client.aiBreakdownTitle")}</div>
                {aiBreakdownRows.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t("settings.client.aiBreakdownEmpty")}</div>
                ) : (
                  <div className="space-y-2.5">
                    {aiBreakdownRows.map(row => (
                      <div key={row.key}>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1">
                          <span className="text-sm flex-1 min-w-0">{row.label}</span>
                          <span className="text-xs text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                            {t("settings.client.aiBreakdownTokens", { count: row.tokens.toLocaleString() })}
                          </span>
                          <span className="text-xs font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{row.percent}%</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-elev-2)" }}>
                          <div className="h-full rounded-full"
                            style={{ width: `${row.percent}%`, background: "var(--brand)", transition: "width var(--dur-2) var(--ease)" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </>
            ) : (
              <div className="text-sm mb-5" style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-border-strong)", color: "var(--warning-strong)", borderRadius: "var(--radius)", padding: 14 }}>
                {t("settings.client.aiNoPlanNotice")}
              </div>
            )}

            <div className="text-sm" style={{ background: "var(--brand-softer)", border: "1px solid var(--brand-soft)", color: "var(--text-2)", borderRadius: "var(--radius)", padding: 14 }}>
              <strong style={{ color: "var(--text-1)" }}>{t("settings.client.aiHowItWorksTitle")}</strong>{t("settings.client.aiHowItWorksBody")}
            </div>
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

      {/* ── HORARIOS Y BLOQUEOS ──
          ① El horario semanal, TAL CUAL estaba (misma tarjeta `max-w-lg`, mismos
             7 días): es la jornada normal y funciona. Lo único nuevo es que quien
             no es admin —el doctor, a quien ahora se le abre esta pestaña— lo ve
             en SOLO LECTURA: sin casillas, sin `type=time` y sin botón de guardar.
             Lo ve porque necesita saber contra qué está bloqueando.
          ② Debajo, la sección de bloqueos (ws1-t3), que trae su propio CSS y es
             la MISMA en los dos caminos de render de esta pantalla. */}
      {tab === "horarios" && verHorarios && (
        <>
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg">
          <h2 className="text-base font-bold mb-4">{t("settings.client.hoursTitle")}</h2>
          <div className="space-y-3">
            {DAYS.map((day, i) => {
              const s = schedule[i] ?? { enabled:false, open:"09:00", close:"18:00" };
              return (
                <div key={day} className={`flex items-center gap-4 p-3.5 rounded-xl border transition-colors ${s.enabled ? "bg-brand-600/15 border-brand-200" : "bg-muted/30 border-border"}`}>
                  {horarioEditable && (
                    <input type="checkbox" checked={s.enabled}
                      onChange={e => setSchedule(sc => ({ ...sc, [i]:{ ...(sc[i] ?? { enabled:false, open:"09:00", close:"18:00" }), enabled:e.target.checked } }))}
                      className="w-4 h-4 rounded accent-brand-600 flex-shrink-0" />
                  )}
                  <span className={`text-base font-semibold w-24 ${s.enabled ? "text-brand-700 dark:text-brand-300" : "text-muted-foreground"}`}>{t(day)}</span>
                  {!s.enabled ? (
                    <span className="text-sm text-muted-foreground">{t("settings.client.hoursClosed")}</span>
                  ) : horarioEditable ? (
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
                    <span className="text-sm font-mono text-muted-foreground">
                      {s.open} {t("settings.client.hoursTo")} {s.close}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {horarioEditable ? (
            <div className="flex justify-end mt-5">
              <Button onClick={saveSchedule} disabled={savingSchedule}>{savingSchedule ? t("common.saving") : t("settings.client.hoursSaveBtn")}</Button>
            </div>
          ) : (
            <span className={blo.notaSoloLectura}>{t("settings.bloqueos.horarioSoloLectura")}</span>
          )}
        </div>

        <SeccionBloqueos
          timezone={clinic.timezone ?? "America/Mexico_City"}
          doctores={doctoresParaBloqueo}
          modoDoctor={!isAdminUser}
        />
        </>
      )}

      {/* ── SEGURIDAD ── */}
      {tab === "seguridad" && (
        <div className="space-y-5 max-w-lg">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
            <h2 className="text-base font-bold">{t("settings.client.changePasswordTitle")}</h2>
            <div className="field-new"><label className="field-new__label">{t("settings.client.newPasswordLabel")}</label>
              <Input type="password" autoComplete="new-password" placeholder={t("settings.client.newPasswordPlaceholder")} value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next:e.target.value }))} />
            </div>
            <div className="field-new"><label className="field-new__label">{t("settings.client.confirmPasswordLabel")}</label>
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
