"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Edit, UserCheck, UserX, Trash2, Copy, Check, Stethoscope, Shield, ShieldCheck, Users as UsersIcon, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PermissionsModal } from "@/components/dashboard/team/permissions-modal";
import { useT } from "@/i18n/i18n-provider";

type RoleTone = "success" | "info" | "warning" | "brand" | "neutral";
// labelKey -> resolved via t() at render time (never call t() at module scope).
const ROLE_TONE: Record<string, { tone: RoleTone; labelKey: string }> = {
  SUPER_ADMIN:  { tone: "brand",   labelKey: "settings.team.roleSuperAdmin" },
  ADMIN:        { tone: "info",    labelKey: "settings.team.roleAdmin" },
  DOCTOR:       { tone: "success", labelKey: "settings.team.roleDoctor" },
  RECEPTIONIST: { tone: "warning", labelKey: "settings.team.roleReceptionist" },
  READONLY:     { tone: "neutral", labelKey: "settings.team.roleReadonly" },
};

const DOCTOR_COLORS = [
  "#3b82f6","#7c3aed","#059669","#e11d48","#d97706",
  "#0891b2","#db2777","#4338ca","#16a34a","#dc2626",
  "#9333ea","#0284c7","#f97316","#84cc16",
];
// labelKey/descKey -> resolved via t() at render time inside MemberForm.
const ROLES = [
  { value:"DOCTOR",       labelKey:"settings.team.roleDoctor",       icon:"🩺", descKey:"settings.team.roleDoctorDesc" },
  { value:"ADMIN",        labelKey:"settings.team.roleAdmin",        icon:"🛡️", descKey:"settings.team.roleAdminDesc"  },
  { value:"RECEPTIONIST", labelKey:"settings.team.roleReceptionist", icon:"📋", descKey:"settings.team.roleReceptionistDesc" },
];
// DaleControl es DENTAL — solo specialties dentales en el selector del
// equipo. Si el SaaS expande a multi-specialty, restaurar la lista
// general aquí.
// id = código estable; nameKey -> resolved via t() at render time.
const SPECIALTIES: { id: string; nameKey: string }[] = [
  { id: "Odontología General",  nameKey: "settings.team.specGeneral" },
  { id: "Ortodoncia",           nameKey: "settings.team.specOrtho" },
  { id: "Endodoncia",           nameKey: "settings.team.specEndo" },
  { id: "Periodoncia",          nameKey: "settings.team.specPerio" },
  { id: "Cirugía Maxilofacial", nameKey: "settings.team.specMaxillofacial" },
  { id: "Implantología",        nameKey: "settings.team.specImplant" },
  { id: "Odontopediatría",      nameKey: "settings.team.specPediatric" },
  { id: "Prostodoncia",         nameKey: "settings.team.specProstho" },
  { id: "Estética Dental",      nameKey: "settings.team.specEsthetic" },
  { id: "Otra",                 nameKey: "settings.team.specOther" },
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
  form, setForm, onSubmit, onCancel, loading, isEdit, onResetPassword,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: () => void;
  onCancel: () => void;
  loading: boolean;
  isEdit: boolean;
  // Cuando viene definido, el form muestra un botón secundario "Resetear
  // contraseña" debajo. El padre lo provee solo en modo edit y solo si el
  // current user es SUPER_ADMIN editando a un non-SUPER_ADMIN. La logica
  // de confirm + POST + display del tempPassword vive en TeamClient.
  onResetPassword?: () => void;
}) {
  const t = useT();
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
          <Label className="text-base font-semibold">{t("settings.team.firstNameLabel")}</Label>
          <input
            autoFocus
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Juan"
            value={form.firstName}
            onChange={e => set("firstName", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">{t("settings.team.lastNameLabel")}</Label>
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
        <Label className="text-base font-semibold">{t("settings.team.emailLabel")}</Label>
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
            {t("settings.team.emailHint")}
          </p>
        )}
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <Label className="text-base font-semibold">{t("settings.team.roleLabel")}</Label>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map(r => (
            <button key={r.value} type="button" onClick={() => set("role", r.value)}
              className={`flex flex-col items-center p-3 rounded-xl border-2 text-center transition-all ${form.role === r.value ? "border-brand-500 bg-brand-600/15" : "border-border hover:border-slate-400"}`}>
              <span className="text-xl mb-1">{r.icon}</span>
              <span className="text-sm font-bold">{t(r.labelKey)}</span>
              <span className="text-xs text-muted-foreground mt-0.5 leading-tight">{t(r.descKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Specialty + Phone */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">{t("settings.team.specialtyLabel")}</Label>
          <select
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
            value={form.specialty}
            onChange={e => set("specialty", e.target.value)}>
            <option value="">{t("settings.team.noSpecialty")}</option>
            {SPECIALTIES.map(s => <option key={s.id} value={s.id}>{t(s.nameKey)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base font-semibold">{t("settings.team.phoneLabel")}</Label>
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
        <Label className="text-base font-semibold">{t("settings.team.servicesLabel")}</Label>
        <div className="flex gap-2">
          <input
            className="flex h-11 flex-1 rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
            placeholder={t("settings.team.servicesPlaceholder")}
            value={svcInput}
            onChange={e => setSvcInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSvc(); } }}
          />
          <button type="button" onClick={addSvc}
            className="h-11 px-4 rounded-xl border border-border bg-card font-bold text-xl hover:bg-muted transition-colors">
            +
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.team.servicesHint")}</p>
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
        <Label className="text-base font-semibold">{t("settings.team.profIdLabel")}</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">{t("settings.team.cedulaProfLabel")}</Label>
            <input
              className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base font-mono focus:outline-none"
              placeholder="1234567"
              maxLength={15}
              value={form.cedulaProfesional}
              onChange={e => set("cedulaProfesional", e.target.value.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">{t("settings.team.cedulaEspLabel")}</Label>
            <input
              className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base font-mono focus:outline-none"
              placeholder={t("settings.team.cedulaEspPlaceholder")}
              maxLength={15}
              value={form.cedulaEspecialidad}
              onChange={e => set("cedulaEspecialidad", e.target.value.trim())}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm text-muted-foreground">{t("settings.team.especialidadOficialLabel")}</Label>
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
            placeholder={t("settings.team.especialidadOficialPlaceholder")}
            maxLength={100}
            value={form.especialidad}
            onChange={e => set("especialidad", e.target.value)}
          />
        </div>
      </div>

      {/* Color */}
      <div className="space-y-2">
        <Label className="text-base font-semibold">{t("settings.team.colorLabel")}</Label>
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
            {t("settings.team.colorHint")}
          </div>
        )}
      </div>

      {/* Reset password — solo visible cuando el padre nos lo pasa (SUPER_ADMIN
       *  editando a un miembro non-SUPER_ADMIN). El click delega la confirmación
       *  + el POST a TeamClient, que también maneja la visualización del
       *  tempPassword en el banner de arriba. */}
      {isEdit && onResetPassword && (
        <div className="border-t border-border pt-4 mt-2">
          <Label className="text-base font-semibold">{t("settings.team.userAccessLabel")}</Label>
          <p className="text-sm text-muted-foreground mt-1 mb-3">
            {t("settings.team.resetPasswordHint")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onResetPassword}
            disabled={loading}
            className="w-full h-11 text-base"
          >
            {t("settings.team.resetPasswordBtn")}
          </Button>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 h-12 text-base">{t("common.cancel")}</Button>
        <Button onClick={onSubmit} disabled={loading} className="flex-1 h-12 text-base">
          {loading ? t("common.saving") : isEdit ? t("common.saveChanges") : t("settings.team.createDoctorBtn")}
        </Button>
      </div>
    </div>
  );
}

// ── MemberPhoto — avatar con foto subible por miembro ───────────────────────
// Si el miembro tiene avatarUrl muestra la imagen; si no, las iniciales sobre
// su color de agenda. El botón de cámara abre un file picker oculto, sube el
// archivo a POST /api/landing-upload (field="avatar") y persiste la URL con
// PATCH /api/team/[id] {avatarUrl}. "Quitar foto" hace PATCH {avatarUrl:null}.
// El clinic se resuelve por sesión en el server — aquí solo va el id en la URL.
// onChange actualiza el estado del padre para que la foto se vea al instante;
// esas fotos también alimentan la sección "Equipo" de la landing (users[].avatarUrl).
const MAX_AVATAR_BYTES = 8 * 1024 * 1024; // ~8MB en cliente (el server admite hasta 50MB)

function memberInitials(first: string, last: string) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "?";
}

// Las iniciales van sobre el color del doctor (DOCTOR_COLORS). Algunos colores
// son claros (p.ej. lima #84cc16) y el blanco no se lee — elegimos texto oscuro
// o claro según la luminancia del fondo para que siempre tenga contraste.
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#fff";
}

function MemberPhoto({
  member, onChange,
}: {
  member: TeamMember;
  onChange: (avatarUrl: string | null) => void;
}) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fullName = `${member.firstName} ${member.lastName}`;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset para poder volver a elegir el mismo archivo después de un error.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.team.onlyImages"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t("settings.team.imageTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("field", "avatar");
      const up = await fetch("/api/landing-upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error ?? t("settings.team.uploadImageError"));

      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: upData.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("settings.team.savePhotoError"));

      onChange(upData.url);
      toast.success(t("settings.team.photoUpdated"));
    } catch (err: any) {
      toast.error(err.message ?? t("settings.team.uploadPhotoFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    setUploading(true);
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("settings.team.removePhotoError"));
      onChange(null);
      toast.success(t("settings.team.photoRemoved"));
    } catch (err: any) {
      toast.error(err.message ?? t("settings.team.removePhotoFailed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: 64, height: 64 }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: "50%", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: member.color || "var(--brand)",
            color: readableOn(member.color || "#7c3aed"), fontSize: 20, fontWeight: 700, letterSpacing: "0.02em",
          }}
        >
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.avatarUrl}
              alt={t("settings.team.photoOfAlt", { name: fullName })}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            memberInitials(member.firstName, member.lastName)
          )}
        </div>

        {/* Spinner mientras sube */}
        {uploading && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: "rgba(0,0,0,0.45)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <Loader2 size={20} color="#fff" className="animate-spin" />
          </div>
        )}

        {/* Botón cámara */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label={member.avatarUrl ? t("settings.team.changePhotoAria", { name: fullName }) : t("settings.team.uploadPhotoAria", { name: fullName })}
          title={t("settings.team.uploadPhotoTitle")}
          style={{
            position: "absolute", right: -2, bottom: -2,
            width: 26, height: 26, borderRadius: "50%",
            background: "var(--brand)", color: "#fff",
            border: "2px solid var(--bg-elev)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: uploading ? "default" : "pointer",
            padding: 0,
          }}
        >
          <Camera size={13} />
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFile}
        />
      </div>

      {member.avatarUrl && !uploading && (
        <button
          type="button"
          onClick={removePhoto}
          aria-label={t("settings.team.removePhotoAria", { name: fullName })}
          style={{
            fontSize: 11, color: "var(--text-3)", background: "none",
            border: "none", cursor: "pointer", textDecoration: "underline",
          }}
        >
          {t("settings.team.removePhotoBtn")}
        </button>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
interface Props { team: TeamMember[]; currentUserId: string; currentUserRole: string; clinicName: string }

export function TeamClient({ team: initialTeam, currentUserId, currentUserRole, clinicName }: Props) {
  const t = useT();
  const router = useRouter();
  const askConfirm = useConfirm();
  const [team,       setTeam]       = useState<TeamMember[]>(initialTeam);
  const [showNew,    setShowNew]    = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  // Member cuyo modal de permisos está abierto. Solo SUPER_ADMIN puede abrirlo.
  const [permsMember, setPermsMember] = useState<TeamMember | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [filter,     setFilter]     = useState<"active"|"all"|"inactive">("active");
  const [tempPass,   setTempPass]   = useState<string | null>(null);
  // Diferencia el mensaje del banner según el origen: "create" tras invitar
  // un nuevo miembro, "reset" tras resetear password existente. null = sin
  // banner. Cambiar de origen no resetea tempPass — siempre van juntos.
  const [tempPassMode, setTempPassMode] = useState<"create" | "reset" | null>(null);
  const [tempPassFor, setTempPassFor] = useState<string>("");
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
      toast.error(t("settings.team.requiredFields"));
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
      setTempPassMode(data.tempPassword ? "create" : null);
      setTempPassFor(`${data.firstName} ${data.lastName}`);
      setShowNew(false);
      setForm(emptyForm());
      toast.success(t("settings.team.doctorCreatedToast", { name: `${data.firstName} ${data.lastName}` }));
      router.refresh();
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
      toast.success(t("settings.team.dataUpdated"));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(m: TeamMember) {
    if (m.id === currentUserId) { toast.error(t("settings.team.cannotDeactivateSelf")); return; }
    try {
      const res = await fetch(`/api/team/${m.id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      if (!res.ok) throw new Error();
      setTeam(prev => prev.map(mem => mem.id === m.id ? { ...mem, isActive: !m.isActive } : mem));
      toast.success(m.isActive ? t("settings.team.doctorDeactivated") : t("settings.team.doctorReactivated"));
      router.refresh();
    } catch { toast.error(t("common.genericError")); }
  }

  // Reset de contraseña vía Supabase Admin API. Solo SUPER_ADMIN, target
  // non-SUPER_ADMIN. La verificación real vive en el endpoint server-side
  // (defensa en profundidad) — aquí gateamos la UI para no exponer el botón
  // a quien no debería verlo.
  async function resetPassword(m: TeamMember) {
    if (!isSuperAdmin) return;
    if (m.role === "SUPER_ADMIN") {
      toast.error(t("settings.team.cannotResetSuperAdmin"));
      return;
    }
    if (!(await askConfirm({
      title: t("settings.team.resetPasswordConfirmTitle", { name: `${m.firstName} ${m.lastName}` }),
      description: t("settings.team.resetPasswordConfirmDesc"),
      variant: "danger",
      confirmText: t("settings.team.resetPasswordBtn"),
    }))) return;

    try {
      const res = await fetch(`/api/team/${m.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("settings.team.resetPasswordError"));
      // Cerramos el modal de edit y mostramos el banner amarillo de tempPassword
      // (mismo componente que se usa cuando se crea un doctor nuevo).
      setEditMember(null);
      setTempPass(data.tempPassword ?? null);
      setTempPassMode(data.tempPassword ? "reset" : null);
      setTempPassFor(`${m.firstName} ${m.lastName}`);
      toast.success(t("settings.team.passwordResetForToast", { name: `${m.firstName} ${m.lastName}` }));
    } catch (err: any) {
      toast.error(err.message ?? t("settings.team.resetPasswordError"));
    }
  }

  async function deleteMember(m: TeamMember) {
    if (m.id === currentUserId) { toast.error(t("settings.team.cannotDeleteSelf")); return; }
    if (!(await askConfirm({
      title: t("settings.team.deleteConfirmTitle", { name: `${m.firstName} ${m.lastName}` }),
      description: t("settings.team.deleteConfirmDesc"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      const res = await fetch(`/api/team/${m.id}`, { method:"DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.deactivated) {
        setTeam(prev => prev.map(mem => mem.id === m.id ? { ...mem, isActive:false } : mem));
        toast.success(t("settings.team.doctorDeactivatedHasRecords"));
      } else {
        setTeam(prev => prev.filter(mem => mem.id !== m.id));
        toast.success(t("settings.team.doctorDeleted"));
      }
      router.refresh();
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
            {t("settings.team.title")}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {clinicName} · {t("settings.team.activeMembersCount", { count: active })}
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => { setForm(emptyForm()); setShowNew(true); }}>
          {t("settings.team.inviteMember")}
        </ButtonNew>
      </div>

      {/* Temp password banner — sirve para create (alta de miembro) y para
       *  reset (SUPER_ADMIN reseteando password). Mismo bloque visual, copy
       *  diferenciado segun tempPassMode. La password se ve UNA vez. */}
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
                {tempPassMode === "reset"
                  ? (tempPassFor
                      ? t("settings.team.bannerResetTitleNamed", { name: tempPassFor })
                      : t("settings.team.bannerResetTitle"))
                  : t("settings.team.bannerCreateTitle")}
              </div>
              <div style={{ fontSize: 11, color: "#fcd34d", opacity: 0.8, marginBottom: 10 }}>
                {tempPassMode === "reset"
                  ? t("settings.team.bannerResetDesc")
                  : t("settings.team.bannerCreateDesc")}
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
                  {copied ? t("settings.team.copied") : t("settings.team.copy")}
                </ButtonNew>
              </div>
            </div>
            <button
              onClick={() => { setTempPass(null); setTempPassMode(null); setTempPassFor(""); }}
              type="button"
              className="btn-new btn-new--ghost btn-new--sm"
              aria-label={t("common.close")}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label={t("settings.team.kpiTotalActive")}  value={String(active)}   icon={UsersIcon} />
        <KpiCard label={t("settings.team.kpiDoctors")}      value={String(doctors)}  icon={Stethoscope} />
        <KpiCard label={t("settings.team.kpiAdmins")}       value={String(admins)}   icon={Shield} />
        <KpiCard label={t("settings.team.kpiTotalMembers")} value={String(team.length)} icon={UsersIcon} />
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
              {f === "active" ? t("settings.team.filterActive") : f === "all" ? t("common.all") : t("settings.team.filterInactive")}
            </button>
          ))}
        </div>
      </div>

      {/* List — grid de tarjetas */}
      {filtered.length === 0 ? (
        <CardNew>
          <div style={{ padding: 40, textAlign: "center" }}>
            <UsersIcon size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-2)", fontSize: 14, fontWeight: 500 }}>{t("settings.team.noMembers")}</p>
            <div style={{ marginTop: 12 }}>
              <ButtonNew
                variant="primary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => { setForm(emptyForm()); setShowNew(true); }}
              >
                {t("settings.team.addFirstDoctor")}
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
                  <MemberPhoto
                    member={m}
                    onChange={url =>
                      setTeam(prev => prev.map(mem => (mem.id === m.id ? { ...mem, avatarUrl: url } : mem)))
                    }
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
                    <h3 style={{ fontSize: 14, color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
                      {fullName}
                    </h3>
                    {m.id === currentUserId && (
                      <span className="tag-new" style={{ color: "#c4b5fd", borderColor: "rgba(124,58,237,0.2)", background: "var(--brand-soft)" }}>{t("settings.team.youTag")}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{m.email}</div>
                  {m.specialty && (
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{m.specialty}</div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    <BadgeNew tone={roleCfg.tone} dot>{t(roleCfg.labelKey)}</BadgeNew>
                    {!m.isActive && <BadgeNew tone="danger" dot>{t("settings.team.inactiveBadge")}</BadgeNew>}
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
                      <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("settings.team.statsAppointments")}</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", marginTop: 2 }}>
                        {m._count.appointments}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("settings.team.statsRecords")}</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", marginTop: 2 }}>
                        {m._count.records}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
                    <ButtonNew size="sm" variant="secondary" icon={<Edit size={12} />} onClick={() => openEdit(m)}>
                      {t("common.edit")}
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
                        {t("settings.team.permissions")}
                      </ButtonNew>
                    )}
                    {m.id !== currentUserId && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleActive(m)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          title={m.isActive ? t("settings.team.deactivateTitle") : t("settings.team.activateTitle")}
                        >
                          {m.isActive ? <UserX size={12} /> : <UserCheck size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMember(m)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          title={t("common.delete")}
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
              <h2 className="text-lg font-bold">{t("settings.team.addDoctorTitle")}</h2>
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
              <h2 className="text-lg font-bold">{t("settings.team.editTitle", { name: `${editMember.firstName} ${editMember.lastName}` })}</h2>
              <button onClick={() => setEditMember(null)} className="p-1.5 rounded-xl hover:bg-muted">
                <X className="w-5 h-5"/>
              </button>
            </div>
            <MemberForm
              form={form} setForm={setForm}
              onSubmit={updateDoctor} onCancel={() => setEditMember(null)}
              loading={loading} isEdit={true}
              // Reset password solo aparece cuando el actor es SUPER_ADMIN
              // y el target NO es SUPER_ADMIN. El backend valida lo mismo.
              onResetPassword={
                isSuperAdmin && editMember.role !== "SUPER_ADMIN"
                  ? () => resetPassword(editMember)
                  : undefined
              }
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
