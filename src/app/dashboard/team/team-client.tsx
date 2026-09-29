"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Edit, UserCheck, UserX, Trash2, Copy, Check, Stethoscope, Shield, ShieldCheck, ClipboardList, Users as UsersIcon, Camera, Loader2, Sparkles, Clock, Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PermissionsModal } from "@/components/dashboard/team/permissions-modal";
import { SabinaPermissionsModal } from "@/components/dashboard/team/sabina-permissions-modal";
import { ModalHorarioDoctor } from "@/components/dashboard/horario-doctor/modal-horario-doctor";
import type { Dia } from "@/components/dashboard/horario-doctor/tipos";
import { RaizRediseno } from "@/components/dashboard/equipo-rediseno/raiz";
import { useT } from "@/i18n/i18n-provider";
import { leerRespuestaEquipo } from "@/lib/team/leer-respuesta";
import { ModulosEspecialidades } from "./modulos-especialidades";
import { tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { accesoParaAlta, accesoQueViaja, seccionModulosVisible, type RespuestaModulo } from "@/lib/team/modulos-especialidades";
import { prepararImagen } from "@/lib/image-client";
import { useTextosEquipo } from "./textos-equipo";
import { validarContrasenaNueva, MAXIMO_CONTRASENA } from "@/lib/team/contrasena-nueva";
import {
  formDeMiembro, parcheDeCambios, rolLlevaDatosClinicos,
  type DatosEditablesDeMiembro,
} from "@/lib/team/parche-miembro";

type RoleTone = "success" | "info" | "warning" | "brand" | "neutral";
// labelKey -> resolved via t() at render time (never call t() at module scope).
// Mapeo semántico de rol → tono del badge del sistema (Variante A):
// owner/admin = brand · doctor = info · recepción/solo-lectura = neutral.
const ROLE_TONE: Record<string, { tone: RoleTone; labelKey: string }> = {
  SUPER_ADMIN:  { tone: "brand",   labelKey: "settings.team.roleSuperAdmin" },
  ADMIN:        { tone: "brand",   labelKey: "settings.team.roleAdmin" },
  DOCTOR:       { tone: "info",    labelKey: "settings.team.roleDoctor" },
  RECEPTIONIST: { tone: "neutral", labelKey: "settings.team.roleReceptionist" },
  READONLY:     { tone: "neutral", labelKey: "settings.team.roleReadonly" },
};

const DOCTOR_COLORS = [
  "#3b82f6","#7c3aed","#059669","#e11d48","#d97706",
  "#0891b2","#db2777","#4338ca","#16a34a","#dc2626",
  "#9333ea","#0284c7","#f97316","#84cc16",
];
// labelKey/descKey -> resolved via t() at render time inside MemberForm.
// icon = lucide (sin emojis estructurales, spec Variante A).
const ROLES = [
  { value:"DOCTOR",       labelKey:"settings.team.roleDoctor",       icon: Stethoscope,   descKey:"settings.team.roleDoctorDesc" },
  { value:"ADMIN",        labelKey:"settings.team.roleAdmin",        icon: Shield,        descKey:"settings.team.roleAdminDesc"  },
  { value:"RECEPTIONIST", labelKey:"settings.team.roleReceptionist", icon: ClipboardList, descKey:"settings.team.roleReceptionistDesc" },
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
  // ws1-t3: «¿solo dental o también ortodoncista?». "" = no aplica / sin contestar.
  accesoOrtodoncia: RespuestaModulo;
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

// «Establecer contraseña nueva» (ws1-t4): el dueño escribe la contraseña del
// miembro y la confirma. Se valida aquí y otra vez en el servidor con la MISMA
// función. Los campos viven solo en este estado local y se vacían al guardar o
// cancelar: la contraseña no entra en `form` ni sale en ningún log.
function EstablecerContrasena({
  onGuardar, deshabilitado,
}: {
  onGuardar: (contrasena: string, confirmacion: string) => Promise<boolean>;
  deshabilitado: boolean;
}) {
  const x = useTextosEquipo();
  const [abierto, setAbierto] = useState(false);
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function cerrar() {
    setAbierto(false); setNueva(""); setConfirmacion(""); setVer(false); setError(null);
  }

  async function guardar() {
    const problema = validarContrasenaNueva(nueva, confirmacion);
    if (problema) { setError(problema); return; }
    setError(null);
    setGuardando(true);
    try {
      if (await onGuardar(nueva, confirmacion)) cerrar();
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setAbierto(true)}
        disabled={deshabilitado}
        className="w-full h-11 text-base"
      >
        <KeyRound size={16} strokeWidth={1.75} aria-hidden style={{ marginRight: 8 }} />
        {x.establecerBtn}
      </Button>
    );
  }

  const tipo = ver ? "text" : "password";
  return (
    <div className="space-y-3" data-establecer-contrasena>
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>{x.establecerHint}</p>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" htmlFor="establecer-nueva">{x.establecerNueva}</Label>
        <div style={{ position: "relative" }}>
          <input
            id="establecer-nueva"
            type={tipo}
            autoComplete="new-password"
            autoFocus
            maxLength={MAXIMO_CONTRASENA}
            className="input-new" style={{ height: 42, fontSize: 13.5, paddingRight: 44, width: "100%" }}
            value={nueva}
            onChange={e => { setNueva(e.target.value); setError(null); }}
          />
          <button
            type="button"
            onClick={() => setVer(v => !v)}
            className="btn-new btn-new--ghost btn-new--sm"
            aria-label={ver ? x.establecerOcultar : x.establecerMostrar}
            style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", padding: 0, width: 34 }}
          >
            {ver ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>{x.establecerRegla}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" htmlFor="establecer-confirmar">{x.establecerConfirmar}</Label>
        <input
          id="establecer-confirmar"
          type={tipo}
          autoComplete="new-password"
          maxLength={MAXIMO_CONTRASENA}
          className="input-new" style={{ height: 42, fontSize: 13.5, width: "100%" }}
          value={confirmacion}
          onChange={e => { setConfirmacion(e.target.value); setError(null); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void guardar(); } }}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ margin: 0, color: "var(--danger)" }}>{error}</p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={cerrar} disabled={guardando} className="flex-1 h-11">
          {x.establecerCancelar}
        </Button>
        <Button type="button" onClick={guardar} disabled={guardando || deshabilitado} className="flex-1 h-11">
          {guardando ? x.establecerGuardando : x.establecerGuardar}
        </Button>
      </div>
    </div>
  );
}

// ── MemberForm declared OUTSIDE TeamClient ──────────────────────────────────
// This is the fix for Bug 1 (focus loss) and Bug 2 (validation).
// When defined inside TeamClient as `const MemberForm = ...`, React treats it
// as a new component type on every render and unmounts/remounts the inputs,
// causing focus loss on every keystroke. Defined outside, it is stable.
function MemberForm({
  form, setForm, onSubmit, onCancel, loading, isEdit, onResetPassword, onSetPassword, rediseno, sedeDental, ortoModulo, puedeCambiarAcceso,
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
  // «Establecer contraseña nueva»: misma regla que onResetPassword (solo el
  // dueño, nunca sobre otro dueño). Devuelve true si el servidor la aceptó.
  onSetPassword?: (contrasena: string, confirmacion: string) => Promise<boolean>;
  // Con la bandera apagada, la cédula sigue en `font-mono` tal cual hoy —
  // "byte por byte igual" manda incluso sobre la regla de tipografía, que
  // solo aplica dentro del rediseño (WS1-T5).
  rediseno: boolean;
  // ws1-t2: «Módulos de especialidades». La sede es dental (si no, no hay módulos)…
  sedeDental: boolean;
  // …y tiene el de Ortodoncia contratado (si no, la casilla se ve deshabilitada).
  ortoModulo: boolean;
  // Alta: quien da de alta. Edición: solo el dueño (los permisos son suyos).
  puedeCambiarAcceso: boolean;
}) {
  const t = useT();
  const x = useTextosEquipo();
  // Recepción y solo lectura no llevan datos de médico (especialidad, servicios,
  // NOM-024, color de agenda). El ADMIN y el dueño sí: firman recetas con su cédula.
  const clinico = rolLlevaDatosClinicos(form.role);
  const verModulos = seccionModulosVisible({ role: form.role, sedeDental });
  const [svcInput, setSvcInput] = useState("");
  // Con el rediseño, el acento y los bordes se leen del menú de dos niveles
  // (los `--m2-*` que monta la raíz); apagado, los tokens de siempre.
  const acento = rediseno ? "var(--m2-activo)" : "var(--brand)";
  const acentoSuave = rediseno ? "var(--m2-iniciales-fondo)" : "var(--brand-soft)";
  const bordeSuave = rediseno ? "var(--m2-tarjeta-borde)" : "var(--border-soft)";

  function set(k: keyof FormState, v: any) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function addSvc() {
    const val = svcInput.trim().replace(/,+$/, "");
    if (val && !form.services.includes(val)) set("services", [...form.services, val]);
    setSvcInput("");
  }

  return (
    <div className="modal__body space-y-4">
      {/* Name */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">{t("settings.team.firstNameLabel")}</Label>
          <input
            autoFocus
            className="input-new" style={{ height: 42, fontSize: 13.5 }}
            placeholder="Juan"
            value={form.firstName}
            onChange={e => set("firstName", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">{t("settings.team.lastNameLabel")}</Label>
          <input
            className="input-new" style={{ height: 42, fontSize: 13.5 }}
            placeholder="García"
            value={form.lastName}
            onChange={e => set("lastName", e.target.value)}
          />
        </div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">{t("settings.team.emailLabel")}</Label>
        <input
          type="email"
          className="input-new" style={{ height: 42, fontSize: 13.5 }}
          placeholder="nombre@clinica.com"
          value={form.email}
          onChange={e => set("email", e.target.value)}
        />
        {/* En edición el campo estaba `disabled` — y aun así el PATCH aceptaba
         *  el email del body y lo tiraba a la basura. Ahora se puede cambiar y
         *  el endpoint lo aplica en Supabase Auth + Prisma, así que el hint
         *  tiene que decir que se está tocando el login, no un dato de ficha. */}
        <p className="text-xs text-muted-foreground">
          {isEdit ? t("settings.team.emailHintEdit") : x.emailHintAlta}
        </p>
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">{t("settings.team.roleLabel")}</Label>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map(r => (
            <button key={r.value} type="button" onClick={() => set("role", r.value)}
              className="flex flex-col items-center p-3 text-center"
              style={{
                borderRadius: "var(--radius)",
                border: `2px solid ${form.role === r.value ? acento : bordeSuave}`,
                background: form.role === r.value ? acentoSuave : "transparent",
                transition: "border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease)",
              }}>
              <r.icon size={18} strokeWidth={1.75} aria-hidden style={{ color: form.role === r.value ? acento : "var(--text-3)", marginBottom: 6 }} />
              <span className="text-sm font-bold">{t(r.labelKey)}</span>
              <span className="text-xs text-muted-foreground mt-0.5 leading-tight">{t(r.descKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Specialty + Phone — la especialidad no aplica a recepción. */}
      <div className={clinico ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
        {clinico && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{t("settings.team.specialtyLabel")}</Label>
            <select
              className="input-new" style={{ height: 42, fontSize: 13.5 }}
              value={form.specialty}
              onChange={e => set("specialty", e.target.value)}>
              <option value="">{t("settings.team.noSpecialty")}</option>
              {SPECIALTIES.map(s => <option key={s.id} value={s.id}>{t(s.nameKey)}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">{t("settings.team.phoneLabel")}</Label>
          <input
            className="input-new" style={{ height: 42, fontSize: 13.5 }}
            placeholder="+52 999 000 0000"
            value={form.phone}
            onChange={e => set("phone", e.target.value)}
          />
        </div>
      </div>

      {/* ws1-t2 — un DOCTOR de una sede dental. Recepción y demás roles no la ven. */}
      {verModulos && (
        <ModulosEspecialidades
          respuestas={{ ortodoncia: form.accesoOrtodoncia }}
          contratados={{ ortodoncia: ortoModulo }}
          puedeCambiar={puedeCambiarAcceso}
          esEdicion={isEdit}
          acento={acento} bordeSuave={bordeSuave}
          // La especialidad no se toca: es independiente del módulo.
          onChange={(_modulo, respuesta) => set("accesoOrtodoncia", respuesta)}
        />
      )}

      {/* Services */}
      {clinico && (
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">{t("settings.team.servicesLabel")}</Label>
        <div className="flex gap-2">
          <input
            className="input-new flex-1" style={{ height: 42, fontSize: 13.5 }}
            placeholder={t("settings.team.servicesPlaceholder")}
            value={svcInput}
            onChange={e => setSvcInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSvc(); } }}
          />
          <button type="button" onClick={addSvc}
            className="btn-new btn-new--secondary"
            style={{ height: 42, minWidth: 42, padding: 0, fontSize: 18, fontWeight: 700 }}>
            +
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.team.servicesHint")}</p>
        {form.services.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {form.services.map(s => (
              <span key={s} className="tag-new">
                {s}
                <button type="button" onClick={() => set("services", form.services.filter(x => x !== s))}
                  className="font-bold leading-none ml-0.5 hover:opacity-70"
                  style={{ color: "var(--text-3)" }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      )}

      {/* NOM-024 — Datos del médico */}
      {clinico && (
      <div className="space-y-3 pt-1">
        <div className="form-section__title" style={{ marginBottom: 0 }}>{t("settings.team.profIdLabel")}<span className="form-section__rule" aria-hidden /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("settings.team.cedulaProfLabel")}</Label>
            <input
              className={rediseno ? "input-new" : "input-new font-mono"}
              style={{ height: 42, fontSize: 13.5, ...(rediseno ? { fontVariantNumeric: "tabular-nums" as const } : {}) }}
              placeholder="1234567"
              maxLength={15}
              value={form.cedulaProfesional}
              onChange={e => set("cedulaProfesional", e.target.value.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("settings.team.cedulaEspLabel")}</Label>
            <input
              className={rediseno ? "input-new" : "input-new font-mono"}
              style={{ height: 42, fontSize: 13.5, ...(rediseno ? { fontVariantNumeric: "tabular-nums" as const } : {}) }}
              placeholder={t("settings.team.cedulaEspPlaceholder")}
              maxLength={15}
              value={form.cedulaEspecialidad}
              onChange={e => set("cedulaEspecialidad", e.target.value.trim())}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("settings.team.especialidadOficialLabel")}</Label>
          <input
            className="input-new" style={{ height: 42, fontSize: 13.5 }}
            placeholder={t("settings.team.especialidadOficialPlaceholder")}
            maxLength={100}
            value={form.especialidad}
            onChange={e => set("especialidad", e.target.value)}
          />
        </div>
      </div>

      )}

      {/* Color */}
      {clinico && (
      <div className="space-y-2">
        <Label className="text-xs font-semibold">{t("settings.team.colorLabel")}</Label>
        <div className="flex gap-2 flex-wrap">
          {DOCTOR_COLORS.map(c => (
            <button key={c} type="button" onClick={() => set("color", c)}
              aria-label={c}
              className={`w-10 h-10 transition-transform hover:scale-110 ${form.color === c ? "scale-110" : ""}`}
              style={{
                background: c,
                borderRadius: "var(--radius-sm)",
                boxShadow: form.color === c ? "0 0 0 2px var(--bg-elev), 0 0 0 4px var(--text-1)" : "none",
              }} />
          ))}
        </div>
        {form.color && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-4 h-4 rounded" style={{ background: form.color }} />
            {t("settings.team.colorHint")}
          </div>
        )}
      </div>
      )}

      {/* Reset password — solo visible cuando el padre nos lo pasa (SUPER_ADMIN
       *  editando a un miembro non-SUPER_ADMIN). El click delega la confirmación
       *  + el POST a TeamClient, que también maneja la visualización del
       *  tempPassword en el banner de arriba. */}
      {isEdit && (onResetPassword || onSetPassword) && (
        <div className="pt-4 mt-2" style={{ borderTop: `1px solid ${bordeSuave}` }}>
          <div className="form-section__title" style={{ marginBottom: 0 }}>{t("settings.team.userAccessLabel")}<span className="form-section__rule" aria-hidden /></div>
          {onResetPassword && (
            <>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                {x.restablecerHint}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={onResetPassword}
                disabled={loading}
                className="w-full h-11 text-base"
              >
                {x.restablecerBtn}
              </Button>
            </>
          )}
          {onSetPassword && (
            <div className="mt-3">
              <EstablecerContrasena onGuardar={onSetPassword} deshabilitado={loading} />
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 h-12 text-base">{t("common.cancel")}</Button>
        <Button onClick={onSubmit} disabled={loading} className="flex-1 h-12 text-base">
          {loading ? t("common.saving") : isEdit ? t("common.saveChanges") : x.crearCuenta}
        </Button>
      </div>
    </div>
  );
}

// ── MemberPhoto — avatar con foto subible por miembro ───────────────────────
// Si el miembro tiene avatarUrl muestra la imagen; si no, las iniciales sobre
// su color de agenda. El botón de cámara abre un file picker oculto, sube el
// archivo (comprimido antes en el navegador) a POST /api/landing-upload
// (field="avatar" — el endpoint dejó de reconocerlo en 2a98c3d1 y desde
// entonces ninguna clínica pudo subir la foto de un doctor) y persiste la URL con
// PATCH /api/team/[id] {avatarUrl}. "Quitar foto" hace PATCH {avatarUrl:null}.
// El clinic se resuelve por sesión en el server — aquí solo va el id en la URL.
// onChange actualiza el estado del padre para que la foto se vea al instante;
// esas fotos también alimentan la sección "Equipo" de la landing (users[].avatarUrl).
// Tope de lo que se acepta del disco. La foto se comprime en el navegador antes
// de subirla (prepararImagen: 2000 px, webp), así que 25 MB de entrada acaban
// siendo unos cientos de KB de salida — y el endpoint corta en 4 MB.
const MAX_AVATAR_BYTES = 25 * 1024 * 1024;

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
  member, onChange, rediseno,
}: {
  member: TeamMember;
  onChange: (avatarUrl: string | null) => void;
  rediseno: boolean;
}) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  // Acento del menú de dos niveles con el rediseño; el de siempre, apagado.
  const acento = rediseno ? "var(--m2-activo)" : "var(--brand)";
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
      // Comprimir en el navegador: el runtime corta el cuerpo de la petición en
      // ~4.5 MB y una foto de celular pesa el triple. Además convierte el HEIC
      // del iPhone, que el endpoint no acepta por tipo.
      const listo = await prepararImagen(file);
      const fd = new FormData();
      fd.append("file", listo);
      fd.append("field", "avatar");
      const up = await fetch("/api/landing-upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error ?? t("settings.team.uploadImageError"));

      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: upData.url }),
      });
      const data = await leerRespuestaEquipo(res);
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
      const data = await leerRespuestaEquipo(res);
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
            background: member.color || acento,
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
            position: "absolute", right: -4, bottom: -4,
            width: 28, height: 28, borderRadius: "50%",
            background: acento, color: "#fff",
            border: "2px solid var(--bg-elev)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: uploading ? "default" : "pointer",
            padding: 0,
            transition: "background var(--dur-1) var(--ease)",
          }}
        >
          <Camera size={14} strokeWidth={1.75} />
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

// ws1-t2 — cómo arranca la casilla «Ortodoncia» al editar un miembro: lo que dice
// su permiso HOY (el mismo de Equipo → Permisos). Un doctor que ya trae el módulo
// (por default del rol o porque se lo dieron) arranca marcado; a quien se lo
// quitaron, desmarcado. Vacío si no aplica (la sede no tiene el módulo o no es un
// doctor).
function accesoInicial(m: TeamMember, ortoModulo: boolean): RespuestaModulo {
  if (!ortoModulo || m.role !== "DOCTOR") return "";
  return tieneAccesoOrtodoncia({ role: m.role, permissionsOverride: m.permissionsOverride }) ? "ortodoncista" : "solo_dental";
}

// ── Main component ───────────────────────────────────────────────────────────
interface Props {
  team: TeamMember[]; currentUserId: string; currentUserRole: string; clinicName: string;
  // El mismo interruptor por clínica del menú de dos niveles y de Pacientes.
  // false por defecto: sin la prop (o con la clínica apagada) la pantalla se
  // pinta exactamente igual que hoy.
  rediseno?: boolean;
  /** El horario de la clínica (0=Lunes…6=Domingo), o `null` si no tiene
   *  filas. Lo lee la ventana «Horario» de cada doctor. */
  horarioClinica?: Dia[] | null;
  /** ws1-t2: la sede es dental (solo ahí hay «Módulos de especialidades»). */
  sedeDental?: boolean;
  /** ws1-t3: la sede es dental y tiene el módulo de Ortodoncia contratado de verdad. */
  ortoModulo?: boolean;
}

export function TeamClient({ team: initialTeam, currentUserId, currentUserRole, clinicName, rediseno = false, horarioClinica = null, sedeDental = false, ortoModulo = false }: Props) {
  const t = useT();
  const x = useTextosEquipo();
  const router = useRouter();
  const askConfirm = useConfirm();
  const [team,       setTeam]       = useState<TeamMember[]>(initialTeam);
  const [showNew,    setShowNew]    = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  // Member cuyo modal de permisos está abierto. Solo SUPER_ADMIN puede abrirlo.
  const [permsMember, setPermsMember] = useState<TeamMember | null>(null);
  const [sabinaMember, setSabinaMember] = useState<TeamMember | null>(null);
  // Doctor cuya ventana «Horario» está abierta. Solo ADMIN y SUPER_ADMIN.
  const [horarioMember, setHorarioMember] = useState<TeamMember | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [filter,     setFilter]     = useState<"active"|"all"|"inactive">("active");
  const [tempPass,   setTempPass]   = useState<string | null>(null);
  // Diferencia el mensaje del banner según el origen: "create" tras invitar
  // un nuevo miembro, "reset" tras resetear password existente. null = sin
  // banner. Cambiar de origen no resetea tempPass — siempre van juntos.
  const [tempPassMode, setTempPassMode] = useState<"create" | "reset" | null>(null);
  const [tempPassFor, setTempPassFor] = useState<string>("");
  const [copied,     setCopied]     = useState(false);
  // Aviso persistente tras cambiar el correo de un miembro. Va en banner y no
  // en toast a propósito: el admin tiene que entregarle el dato al doctor (a
  // partir de ahora entra con ese correo) y un toast de 4s se lo come.
  const [emailNotice, setEmailNotice] = useState<{ name: string; email: string } | null>(null);

  const isSuperAdmin = currentUserRole === "SUPER_ADMIN";
  // «Horario» por doctor: lo ponen ADMIN y SUPER_ADMIN (no solo el super,
  // como Permisos). A `team.view` también llega READONLY, que no lo ve.
  const puedeHorario = currentUserRole === "ADMIN" || currentUserRole === "SUPER_ADMIN";

  const usedColors = team.map(m => m.color);
  const nextColor  = DOCTOR_COLORS.find(c => !usedColors.includes(c)) ?? DOCTOR_COLORS[0];

  const emptyForm = (): FormState => ({
    firstName:"", lastName:"", email:"", role:"DOCTOR",
    specialty:"", color: nextColor, phone:"", services:[],
    cedulaProfesional: "", especialidad: "", cedulaEspecialidad: "",
    accesoOrtodoncia: "",
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  // Con qué datos ABRIÓ el modal de edición. Al guardar solo viaja lo que cambió
  // contra esto: un campo que nadie tocó nunca se manda (y nunca se pisa).
  const [formInicial, setFormInicial] = useState<DatosEditablesDeMiembro | null>(null);

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
      // Recepción no lleva datos de médico: no viajan (el modal ni los pide).
      const clinico = rolLlevaDatosClinicos(form.role);
      // La casilla de Ortodoncia viaja siempre en el alta de un doctor con el módulo
      // (desmarcada = sin el módulo); fuera de ese caso, no viaja.
      const acceso = accesoParaAlta({
        aplica: ortoModulo && seccionModulosVisible({ role: form.role, sedeDental }),
        respuesta: form.accesoOrtodoncia,
      });
      const cuerpo = clinico ? { ...form, accesoOrtodoncia: acceso } : {
        ...form, specialty: "", services: [] as string[],
        cedulaProfesional: "", especialidad: "", cedulaEspecialidad: "", accesoOrtodoncia: "",
      };
      const res = await fetch("/api/team", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(cuerpo),
      });
      const data = await leerRespuestaEquipo(res);
      if (!res.ok) throw new Error(data.error);
      setTeam(prev => [...prev, { ...data, _count:{ appointments:0, records:0 } } as TeamMember]);
      setTempPass(data.tempPassword ?? null);
      setTempPassMode(data.tempPassword ? "create" : null);
      setTempPassFor(`${data.firstName} ${data.lastName}`);
      setShowNew(false);
      setForm(emptyForm());
      toast.success(x.altaListo(`${data.firstName} ${data.lastName}`));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateDoctor() {
    if (!editMember) return;
    const { accesoOrtodoncia: _a, ...datosActuales } = form;
    // Solo lo que la persona cambió. Antes viajaba el formulario ENTERO: un campo
    // que llegara vacío al modal (la cédula, que la página no traía) se guardaba
    // como vacío y BORRABA el dato del médico (ws1-t5, T1).
    const parche = formInicial ? parcheDeCambios(formInicial, datosActuales) : (datosActuales as Partial<DatosEditablesDeMiembro>);
    const acceso = accesoQueViaja({ inicial: accesoInicial(editMember, ortoModulo), actual: form.accesoOrtodoncia });
    if (Object.keys(parche).length === 0 && !acceso) {
      setEditMember(null);
      toast(x.sinCambios);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/team/${editMember.id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        // El acceso a Ortodoncia solo viaja si la persona lo CAMBIÓ: guardar otro
        // dato (el teléfono, la cédula) no reescribe los permisos de nadie.
        body: JSON.stringify({
          ...parche,
          accesoOrtodoncia: acceso,
        }),
      });
      const data = await leerRespuestaEquipo(res);
      if (!res.ok) throw new Error(data.error);
      // El email se pinta con el que devolvió el server, no con el del form:
      // el endpoint lo normaliza (trim + minúsculas) antes de guardarlo.
      const savedEmail: string = data.email ?? form.email;
      setTeam(prev => prev.map(m => m.id === editMember.id
        ? {
            ...m, ...parche, email: savedEmail,
            permissionsOverride: data.permissionsOverride ?? m.permissionsOverride,
          }
        : m));
      setEditMember(null);
      toast.success(t("settings.team.dataUpdated"));
      // El cambio de correo es un cambio de LOGIN: el server manda emailChanged
      // y levantamos el banner. El fallback comparando contra el correo previo
      // cubre un deploy en el que el server aún no devuelva el flag.
      const emailChanged: boolean =
        data.emailChanged ?? (savedEmail.trim().toLowerCase() !== editMember.email.trim().toLowerCase());
      // Sin cuenta de acceso el correo solo quedó en la ficha: el banner de
      // «ahora inicia sesión con…» sería falso. En su lugar va el aviso del server.
      if (data.sinCuentaDeAcceso && data.aviso) {
        toast(data.aviso, { duration: 15000, icon: "ℹ️" });
      } else if (emailChanged) {
        setEmailNotice({ name: `${form.firstName} ${form.lastName}`.trim(), email: savedEmail });
      }
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(m: TeamMember) {
    if (m.id === currentUserId) { toast.error(t("settings.team.cannotDeactivateSelf")); return; }
    // Desactivar corta el acceso al instante: se pregunta. Reactivar no hace daño.
    if (m.isActive && !(await askConfirm({
      title: x.desactivarConfirmTitulo(`${m.firstName} ${m.lastName}`),
      description: x.desactivarConfirmDesc,
      variant: "warning",
      confirmText: x.desactivarBtn,
    }))) return;
    try {
      const res = await fetch(`/api/team/${m.id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      if (!res.ok) throw new Error();
      setTeam(prev => prev.map(mem => mem.id === m.id ? { ...mem, isActive: !m.isActive } : mem));
      toast.success(m.isActive ? x.miembroDesactivado : x.miembroReactivado);
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
      toast.error(x.restablecerNoSuper);
      return;
    }
    if (!(await askConfirm({
      title: x.restablecerConfirmTitulo(`${m.firstName} ${m.lastName}`),
      description: x.restablecerConfirmDesc,
      variant: "danger",
      confirmText: x.restablecerBtn,
    }))) return;

    try {
      const res = await fetch(`/api/team/${m.id}/reset-password`, { method: "POST" });
      const data = await leerRespuestaEquipo(res);
      if (!res.ok) throw new Error(data.error ?? x.restablecerError);
      // Cerramos el modal de edit y mostramos el banner amarillo de tempPassword
      // (mismo componente que se usa cuando se crea un doctor nuevo).
      setEditMember(null);
      setTempPass(data.tempPassword ?? null);
      setTempPassMode(data.tempPassword ? "reset" : null);
      setTempPassFor(`${m.firstName} ${m.lastName}`);
      toast.success(x.restablecerListo(`${m.firstName} ${m.lastName}`));
      if (data.aviso) toast(data.aviso, { duration: 15000, icon: "ℹ️" });
    } catch (err: any) {
      toast.error(err.message ?? x.restablecerError);
    }
  }

  // «Establecer contraseña nueva» (ws1-t4). Mismo gate que resetPassword; la
  // regla real (dueño de ESTA clínica, no a sí mismo, no a otro dueño) vive en
  // POST /api/team/[id]/set-password. Devuelve true para que el formulario
  // vacíe los campos; el modal de edición se queda abierto.
  async function setPassword(m: TeamMember, contrasena: string, confirmacion: string): Promise<boolean> {
    if (!isSuperAdmin || m.role === "SUPER_ADMIN" || m.id === currentUserId) return false;
    try {
      const res = await fetch(`/api/team/${m.id}/set-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: contrasena, confirmacion }),
      });
      const data = await leerRespuestaEquipo(res);
      if (!res.ok) throw new Error(data.error ?? x.establecerError);
      toast.success(x.establecerListo, { duration: 6000 });
      if (data.aviso) toast(data.aviso, { duration: 15000, icon: "ℹ️" });
      return true;
    } catch (err: any) {
      toast.error(err.message ?? x.establecerError);
      return false;
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
      const data = await leerRespuestaEquipo(res);
      if (!res.ok) throw new Error(data.error);
      if (data.deactivated) {
        setTeam(prev => prev.map(mem => mem.id === m.id ? { ...mem, isActive:false } : mem));
        toast.success(x.desactivadoConRegistros);
      } else {
        setTeam(prev => prev.filter(mem => mem.id !== m.id));
        toast.success(x.miembroEliminado);
      }
      router.refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  function openEdit(m: TeamMember) {
    // TODO lo guardado, tal cual: la cédula, la especialidad oficial, el teléfono,
    // el color y los servicios (ws1-t5, T1: antes arrancaban vacíos).
    const datos = formDeMiembro(m, nextColor);
    setForm({ ...datos, accesoOrtodoncia: accesoInicial(m, ortoModulo) });
    setFormInicial(datos);
    setEditMember(m);
  }

  function copyPass() {
    if (!tempPass) return;
    navigator.clipboard.writeText(tempPass);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const Raiz = rediseno ? RaizRediseno : "div";

  return (
    <Raiz style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(18px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 700, margin: 0 }}>
            {t("settings.team.title")}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {clinicName} · {t("settings.team.activeMembersCount", { count: active })}
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => { setForm(emptyForm()); setShowNew(true); }}>
          {x.agregarMiembro}
        </ButtonNew>
      </div>

      {/* Contraseña temporal — alta o restablecimiento. Es un DIÁLOGO y no un
       *  banner arriba de la página: con la lista larga el banner quedaba fuera
       *  de vista justo cuando había que copiarla (ws1-t5, T3). Se ve UNA vez, así
       *  que no se cierra por accidente: solo con el botón. */}
      {tempPass && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="temp-pass-titulo" style={{ maxWidth: 480 }}>
            <div className="modal__header">
              <h2 className="modal__title" id="temp-pass-titulo">
                {tempPassMode === "reset" ? x.tempResetTitulo(tempPassFor) : x.tempCreadaTitulo}
              </h2>
            </div>
            <div className="modal__body space-y-4">
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, margin: 0 }}>
                {tempPassMode === "reset" ? x.tempResetDesc : x.tempCreadaDesc(tempPassFor)}
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {/* Contraseña temporal, se copia-pega tal cual: letra de máquina real
                    incluso con Instrument Sans en el resto del panel (WS1-T6). */}
                <code className="mono-tecnico" data-temp-pass style={{
                  fontSize: 15, fontWeight: 700,
                  background: "var(--warning-soft-strong)",
                  color: "var(--warning-strong)",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  letterSpacing: 2,
                  userSelect: "all",
                }}>{tempPass}</code>
                <ButtonNew variant="secondary" size="sm" onClick={copyPass} icon={copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}>
                  {copied ? x.copiado : x.copiar}
                </ButtonNew>
              </div>
            </div>
            <div className="modal__footer">
              <button
                type="button"
                className="btn-new btn-new--primary"
                onClick={() => { setTempPass(null); setTempPassMode(null); setTempPassFor(""); }}
              >
                {x.tempListo}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso de correo de acceso cambiado. Persistente (se cierra a mano)
       *  porque el admin tiene que pasarle el dato al miembro: su contraseña
       *  sigue siendo la misma, pero el correo con el que entra ya no. */}
      {emailNotice && (
        <div style={{
          background: "var(--info-soft)",
          // No hay --info-border-strong (sólo danger/warning lo tienen); este es
          // el par que ya usa reminders-section.tsx para un bloque informativo.
          border: "1px solid var(--info)",
          borderRadius: "var(--radius-lg)",
          padding: 16, marginBottom: 18,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--info-strong)", marginBottom: 4 }}>
                {t("settings.team.emailChangedTitle", { name: emailNotice.name })}
              </div>
              <div style={{ fontSize: 12, color: "var(--info-strong)", opacity: 0.85 }}>
                {t("settings.team.emailChangedDesc", { email: emailNotice.email })}
              </div>
            </div>
            <button
              onClick={() => setEmailNotice(null)}
              type="button"
              className="btn-new btn-new--ghost btn-new--sm"
              aria-label={t("common.close")}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label={t("settings.team.kpiTotalActive")}  value={String(active)}   icon={UsersIcon} hero />
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
            <UsersIcon size={32} strokeWidth={1.75} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-2)", fontSize: 14, fontWeight: 500 }}>{t("settings.team.noMembers")}</p>
            <div style={{ marginTop: 12 }}>
              <ButtonNew
                variant="primary"
                size="sm"
                icon={<Plus size={16} strokeWidth={1.75} />}
                onClick={() => { setForm(emptyForm()); setShowNew(true); }}
              >
                {x.agregarMiembro}
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
              <div key={m.id} className="card transition-[box-shadow,transform] duration-[var(--dur-1)] ease-[var(--ease)] hover:shadow-[var(--shadow-2)] hover:-translate-y-px" style={{ padding: 20, opacity: m.isActive ? 1 : 0.45 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                  <MemberPhoto
                    member={m}
                    rediseno={rediseno}
                    onChange={url =>
                      setTeam(prev => prev.map(mem => (mem.id === m.id ? { ...mem, avatarUrl: url } : mem)))
                    }
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
                    <h3 style={{ fontSize: 15, color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
                      {fullName}
                    </h3>
                    {m.id === currentUserId && (
                      <BadgeNew tone="brand">{t("settings.team.youTag")}</BadgeNew>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                  {m.specialty && (
                    <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.specialty}</div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    <BadgeNew tone={roleCfg.tone} dot={roleCfg.tone !== "neutral"}>{t(roleCfg.labelKey)}</BadgeNew>
                    {!m.isActive && <BadgeNew tone="neutral">{t("settings.team.inactiveBadge")}</BadgeNew>}
                  </div>

                  {m.services?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10, justifyContent: "center" }}>
                      {m.services.slice(0, 4).map(s => (
                        <span key={s} className="tag-new">{s}</span>
                      ))}
                      {m.services.length > 4 && (
                        <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>+{m.services.length - 4}</span>
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
                    borderTop: `1px solid ${rediseno ? "var(--m2-tarjeta-borde)" : "var(--border-soft)"}`,
                    width: "100%",
                  }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("settings.team.statsAppointments")}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                        {m._count.appointments}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("settings.team.statsRecords")}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                        {m._count.records}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
                    <ButtonNew variant="secondary" icon={<Edit size={16} strokeWidth={1.75} />} onClick={() => openEdit(m)}>
                      {t("common.edit")}
                    </ButtonNew>
                    {/* Permisos: solo visible para SUPER_ADMIN, y NO sobre otros
                     *  SUPER_ADMIN (defensa contra lock-out cruzado en endpoint).
                     *  Sobre el propio user igual lo permitimos — útil para
                     *  un super que quiera bajarse permisos de prueba. */}
                    {isSuperAdmin && m.role !== "SUPER_ADMIN" && (
                      <ButtonNew
                        variant="secondary"
                        icon={<ShieldCheck size={16} strokeWidth={1.75} />}
                        onClick={() => setPermsMember(m)}
                      >
                        {t("settings.team.permissions")}
                      </ButtonNew>
                    )}
                    {/* Sabina: qué puede hacer en nombre de este miembro. Mismo
                     *  gate que Permisos (y el endpoint repite las defensas). */}
                    {isSuperAdmin && m.role !== "SUPER_ADMIN" && (
                      <ButtonNew
                        variant="secondary"
                        icon={<Sparkles size={16} strokeWidth={1.75} />}
                        onClick={() => setSabinaMember(m)}
                      >
                        {t("settings.sabinaPermissions.button")}
                      </ButtonNew>
                    )}
                    {/* Horario: solo sobre DOCTOR, que son los que tiene la
                     *  agenda. Sin horario propio, sigue el de la clínica. */}
                    {puedeHorario && m.role === "DOCTOR" && (
                      <ButtonNew
                        variant="secondary"
                        icon={<Clock size={16} strokeWidth={1.75} />}
                        onClick={() => setHorarioMember(m)}
                      >
                        {t("settings.team.horario")}
                      </ButtonNew>
                    )}
                  </div>

                  {/* Desactivar / Eliminar: fila propia y con texto (antes eran dos
                   *  iconos sueltos pegados a Horario, sin decir qué hacían). */}
                  {m.id !== currentUserId && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "center", flexWrap: "wrap" }}>
                      <ButtonNew
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(m)}
                        icon={m.isActive ? <UserX size={16} strokeWidth={1.75} /> : <UserCheck size={16} strokeWidth={1.75} />}
                        title={m.isActive ? t("settings.team.deactivateTitle") : t("settings.team.activateTitle")}
                      >
                        {m.isActive ? x.desactivarBtn : x.reactivarBtn}
                      </ButtonNew>
                      <ButtonNew
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMember(m)}
                        icon={<Trash2 size={16} strokeWidth={1.75} />}
                        title={x.eliminarBtn}
                        style={{ color: "var(--danger)" }}
                      >
                        {x.eliminarBtn}
                      </ButtonNew>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New modal */}
      {showNew && (
        <div className="modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal__header" style={{ position: "sticky", top: 0, background: "var(--bg-elev)", zIndex: 10 }}>
              <h2 className="modal__title">{x.agregarMiembro}</h2>
              <button type="button" onClick={() => setShowNew(false)} className="btn-new btn-new--ghost" style={{ padding: 0, width: 36 }} aria-label={t("common.close")}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground" style={{ padding: "12px 22px 0", margin: 0, lineHeight: 1.5 }} data-alta-intro>
              {x.altaIntro}
            </p>
            <MemberForm
              form={form} setForm={setForm}
              onSubmit={createDoctor} onCancel={() => setShowNew(false)}
              loading={loading} isEdit={false} rediseno={rediseno}
              sedeDental={sedeDental} ortoModulo={ortoModulo} puedeCambiarAcceso
            />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editMember && (
        <div className="modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) setEditMember(null); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal__header" style={{ position: "sticky", top: 0, background: "var(--bg-elev)", zIndex: 10 }}>
              <h2 className="modal__title">{t("settings.team.editTitle", { name: `${editMember.firstName} ${editMember.lastName}` })}</h2>
              <button type="button" onClick={() => setEditMember(null)} className="btn-new btn-new--ghost" style={{ padding: 0, width: 36 }} aria-label={t("common.close")}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <MemberForm
              form={form} setForm={setForm}
              onSubmit={updateDoctor} onCancel={() => setEditMember(null)}
              loading={loading} isEdit={true} rediseno={rediseno}
              sedeDental={sedeDental} ortoModulo={ortoModulo} puedeCambiarAcceso={isSuperAdmin}
              // Reset password solo aparece cuando el actor es SUPER_ADMIN
              // y el target NO es SUPER_ADMIN. El backend valida lo mismo.
              onResetPassword={
                isSuperAdmin && editMember.role !== "SUPER_ADMIN"
                  ? () => resetPassword(editMember)
                  : undefined
              }
              onSetPassword={
                isSuperAdmin && editMember.role !== "SUPER_ADMIN" && editMember.id !== currentUserId
                  ? (contrasena, confirmacion) => setPassword(editMember, contrasena, confirmacion)
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

      {/* Sabina en nombre de cada miembro — solo SUPER_ADMIN. Lee lo guardado
       *  al abrir, así refleja al instante lo que se cambió en Permisos. */}
      <SabinaPermissionsModal
        open={sabinaMember !== null}
        member={sabinaMember}
        onClose={() => setSabinaMember(null)}
      />

      {/* Horario de cada doctor — ADMIN y SUPER_ADMIN. Mismo patrón que
       *  Permisos: el miembro abierto vive aquí y la ventana lee el resto. */}
      <ModalHorarioDoctor
        open={horarioMember !== null}
        member={horarioMember}
        clinica={horarioClinica}
        onClose={() => setHorarioMember(null)}
      />
    </Raiz>
  );
}
