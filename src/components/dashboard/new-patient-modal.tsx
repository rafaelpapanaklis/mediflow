"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, UserPlus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ROPA_ALTA_PACIENTE } from "@/components/dashboard/dialogos-rediseno/vestir-dialogos";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DateField } from "@/components/ui/date-field";
import { PatientVisibilityPicker } from "@/components/dashboard/patient-visibility-picker";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { llevarAlPrimerError } from "@/lib/formularios/primer-campo-con-error";
import { leerDuplicado, textosDuplicado, type Duplicado } from "@/lib/new-patient/paciente-duplicado";
import {
  TEXTOS_CONTACTO,
  correoValido,
  nombreParaAvisoDeAlta,
  telefonoValido,
  textoFaltanCampos,
} from "@/lib/new-patient/validar-contacto";

/**
 * La ROPA de la ventana: la de siempre o la del diseño nuevo (ws1-t5,
 * hallazgo 6). La elige quien la monta con el MISMO interruptor por clínica
 * que el menú de dos niveles (`menu-dos-niveles`): el layout del panel para
 * el NewPatientProvider y la lista de Pacientes para su copia. Apagado llega
 * "clasica", el valor por defecto, y cada pieza recibe exactamente los
 * mismos `className` y `style` de antes: ni un píxel distinto. Encendido, la
 * caja monta los tokens del menú y las clases de `dialogos-rediseno`.
 * ⛔ No toca ni una regla: mismos campos, misma validación, mismo POST.
 */
export type AparienciaNuevoPaciente = "clasica" | "nueva";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (patient: any) => void;
  /** Pre-fill helpers para abrir desde combobox de búsqueda. */
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  apariencia?: AparienciaNuevoPaciente;
}

const emptyForm = {
  firstName: "", lastName: "", email: "", phone: "", gender: "",
  dob: "", address: "", allergies: "", notes: "", isChild: false,
  // NOM-024
  curp: "", curpStatus: "PENDING" as "COMPLETE" | "PENDING" | "FOREIGN", passportNo: "",
  // CRM — adquisición + ciclo de vida (se envían vía spread en el POST).
  source: "", lifecycleStage: "patient",
  // Contacto de emergencia (anamnesis WS1-T2) — se envían vía spread.
  emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "",
};

// Fuentes de adquisición ("¿Cómo nos conoció?"). Valores en español neutro:
// se guardan tal cual y el dashboard CRM los agrupa por este string.
const SOURCE_OPTIONS = [
  "Recomendación",
  "Google",
  "Instagram/Facebook",
  "Pasó por la clínica",
  "Sitio web",
  "Otro",
];

/** ws1-t1 (F8): los campos en el orden en que salen en la ventana — al fallar se lleva la vista al primero. */
export const ORDEN_CAMPOS_NUEVO_PACIENTE = [
  "firstName", "lastName", "dob", "gender", "curp", "passportNo", "email", "phone", "allergies",
] as const;

/** ws1-t1 (C-95): la etiqueta de cada obligatorio, para NOMBRARLO en el aviso. */
const ETIQUETA_OBLIGATORIO: Record<string, string> = {
  firstName: "shell.newPatient.firstName",
  lastName: "shell.newPatient.lastName",
  dob: "shell.newPatient.dob",
  gender: "shell.newPatient.gender",
  phone: "shell.newPatient.phone",
  allergies: "shell.newPatient.allergiesLabel",
};

const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function NewPatientModal({ open, onClose, onCreated, initialName, initialPhone, initialEmail, apariencia = "clasica" }: Props) {
  const t = useT();
  const nueva = apariencia === "nueva";
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin I18nProvider: español
  }
  const textosDup = textosDuplicado(locale);
  /** ws1-t1 (E2): el 409 DUPLICATE_PATIENT que se está preguntando, o null. */
  const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
  const abrirFichaExistente = (id: string) => {
    setDuplicado(null);
    onClose();
    router.push(`/dashboard/patients/${id}`);
  };
  /** ws1-t1 (F8): marca los errores y lleva la vista y el foco al primero (tras pintarse el borde rojo). */
  const marcarErrores = (nuevos: Record<string, boolean>) => {
    setErrors(nuevos);
    requestAnimationFrame(() => llevarAlPrimerError(formRef.current, ORDEN_CAMPOS_NUEVO_PACIENTE, nuevos));
  };
  const [noAllergies, setNoAllergies] = useState(false);
  /**
   * Cupo de pacientes agotado (402 PLAN_LIMIT_PATIENTS del POST). Vive DENTRO
   * del modal a propósito: éste se monta en dos lugares (la lista de pacientes y
   * el NewPatientProvider global que usan sidebar/paleta/atajo N), así que el
   * bloqueo y su CTA tienen que viajar con el modal, no con cada opener.
   * `isAdmin` lo dicta el server en la respuesta: el tab de suscripción es
   * admin-only y a un rol operativo no le sirve el link.
   */
  const [limitInfo, setLimitInfo] = useState<{ limit: number | null; isAdmin: boolean } | null>(null);
  // Visibilidad por paciente. [] = todos lo ven (default, sin restricción).
  const [visibleUserIds, setVisibleUserIds] = useState<string[]>([]);
  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => { const next = { ...e }; delete next[k]; return next; });
  };

  // Hoy en ISO local (yyyy-mm-dd) — tope para la fecha de nacimiento: sin futuro
  // y con el año máximo del calendario fijado al actual.
  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  useEffect(() => {
    if (!open) return;
    const next = { ...emptyForm };
    if (initialName) {
      const { firstName, lastName } = splitName(initialName);
      next.firstName = firstName;
      next.lastName = lastName;
    }
    if (initialPhone) next.phone = initialPhone;
    if (initialEmail) next.email = initialEmail;
    setForm(next);
    setNoAllergies(false);
    setVisibleUserIds([]);
    setErrors({});
    setLimitInfo(null);
    setDuplicado(null);
  }, [open, initialName, initialPhone, initialEmail]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, boolean> = {};
    if (!form.firstName.trim()) newErrors.firstName = true;
    if (!form.lastName.trim()) newErrors.lastName = true;
    if (!form.dob) newErrors.dob = true;
    if (!form.phone.trim()) newErrors.phone = true;
    if (!form.allergies.trim()) newErrors.allergies = true;
    if (!form.gender) newErrors.gender = true;
    if (Object.keys(newErrors).length > 0) {
      marcarErrores(newErrors);
      // ws1-t1 (C-95): el aviso NOMBRA lo que falta (antes: «marcados en rojo» y adivina cuál).
      const faltan = ORDEN_CAMPOS_NUEVO_PACIENTE.filter((k) => newErrors[k] && ETIQUETA_OBLIGATORIO[k]).map((k) => t(ETIQUETA_OBLIGATORIO[k]));
      toast.error(textoFaltanCampos(faltan, locale));
      return;
    }
    // ws1-t1 (C-88, C-95): teléfono y correo con forma de teléfono y de correo — la misma regla que el servidor.
    const textosContacto = locale.toLowerCase().startsWith("en") ? TEXTOS_CONTACTO.en : TEXTOS_CONTACTO.es;
    if (form.dob > todayISO) {
      marcarErrores({ dob: true });
      toast.error(textosContacto.fechaFutura);
      return;
    }
    if (!telefonoValido(form.phone)) {
      marcarErrores({ phone: true });
      toast.error(textosContacto.telefono);
      return;
    }
    if (form.email.trim() && !correoValido(form.email)) {
      marcarErrores({ email: true });
      toast.error(textosContacto.correo);
      return;
    }
    if (form.curpStatus === "COMPLETE") {
      if (!form.curp) { marcarErrores({ curp: true }); toast.error(t("shell.newPatient.errCurpRequired")); return; }
      if (!CURP_RE.test(form.curp.toUpperCase())) { marcarErrores({ curp: true }); toast.error(t("shell.newPatient.errCurpFormat")); return; }
    }
    if (form.curpStatus === "FOREIGN" && !form.passportNo) {
      marcarErrores({ passportNo: true });
      toast.error(t("shell.newPatient.errPassportRequired"));
      return;
    }
    await enviar(false);
  }

  /** El POST del alta. `allowDuplicate` = «Crear igual» desde el aviso de duplicado. */
  async function enviar(allowDuplicate: boolean) {
    setLoading(true);
    try {
      // AVISO DE DUPLICADO (hallazgo 37). Antes se preguntaba aquí al GET de
      // pacientes con el nombre completo y SIN `v=2`, y eso caía en el handler
      // legacy, que hace `contains` de la frase ENTERA contra cada columna por
      // separado: firstName "Ana" no contiene "Ana García" → cero resultados →
      // el aviso no saltó nunca y el gemelo se creaba en silencio.
      //
      // Ahora quien avisa es el SERVIDOR: el POST responde 409
      // DUPLICATE_PATIENT y aquí se pregunta al usuario. Se hizo así y no
      // arreglando la llamada previa por dos motivos: entre un GET de
      // comprobación y el POST cabe otra alta (y la comprobación del cliente se
      // la salta cualquier otro llamador), y un solo viaje evita que el aviso y
      // el alta puedan discrepar. `allowDuplicate: true` es el "sí, créalo
      // igual" tras confirmar — el aviso avisa, NO prohíbe: dos personas pueden
      // llamarse igual y recepción tiene que poder seguir.
      const crear = async (allowDuplicate: boolean) => fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          isChild: form.isChild,
          allergies: form.allergies ? form.allergies.split(",").map(s => s.trim()).filter(Boolean) : [],
          curp:        form.curpStatus === "COMPLETE" ? form.curp.toUpperCase() : null,
          curpStatus:  form.curpStatus,
          passportNo:  form.curpStatus === "FOREIGN" ? form.passportNo : null,
          // Solo si quedó restringida: omitido = todos lo ven (default).
          ...(visibleUserIds.length > 0 && { visibleUserIds }),
          ...(allowDuplicate && { allowDuplicate: true }),
        }),
      });

      const res = await crear(allowDuplicate);
      // Un solo json(): leerlo dos veces (uno para el error, otro para el
      // paciente) consume el body y perdía `code`/`limit` del 402.
      const data = await res.json().catch(() => ({} as any));

      // ws1-t1 (E2): el `window.confirm` del navegador («Aceptar/Cancelar», sin decir quién) pasa a una ventana
      // propia que nombra al gemelo y deja ABRIR SU FICHA, que es casi siempre lo que se quiere.
      const duplicadoLeido = !res.ok && !allowDuplicate ? leerDuplicado(data) : null;
      if (duplicadoLeido) {
        setDuplicado(duplicadoLeido);
        return;
      }
      // Cualquier otra respuesta (creado, cupo agotado, error) cierra el aviso: lo que pase se ve en el alta.
      setDuplicado(null);

      if (!res.ok) {
        if (data?.code === "PLAN_LIMIT_PATIENTS") {
          // NO cerramos el modal ni tiramos toast: el banner explica el tope y
          // ofrece el upgrade sin que el usuario pierda lo que ya capturó.
          setLimitInfo({
            limit: typeof data.limit === "number" ? data.limit : null,
            isAdmin: data.isAdmin === true,
          });
          return;
        }
        // Si el backend no mandó `error` (500 con cuerpo vacío), al menos el
        // status: "Error al crear paciente" a secas no dice NADA y el usuario
        // no puede reportar qué pasó.
        throw new Error(
          data?.error ?? `${t("shell.newPatient.errCreate")} (HTTP ${res.status})`,
        );
      }
      const patient = data;
      onCreated(patient);
      setForm(emptyForm);
      // ws1-t1 (C-95): nombre completo y folio (antes solo el nombre de pila: «Paciente Audit creado»).
      toast.success(t("shell.newPatient.created", { name: nombreParaAvisoDeAlta(patient) }));
    } catch (err: any) {
      toast.error(mensajeDeError(err, t, { porDefecto: t("shell.newPatient.errCreate") }));
    } finally { setLoading(false); }
  }

  return (
    <>
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={nueva ? ROPA_ALTA_PACIENTE.velo : undefined}
          style={nueva ? undefined : {
            position: "fixed",
            inset: 0,
            background: "rgba(15,10,30,0.55)",
            backdropFilter: "blur(4px)",
            zIndex: 90,
          }}
        />
        <Dialog.Content
          className={nueva ? ROPA_ALTA_PACIENTE.caja : "modal"}
          onEscapeKeyDown={onClose}
          // El popover del DateField vive en un portal a <body> → Radix lo vería como
          // "afuera" y cerraría el modal al clic en mes/año/día. Lo excluimos.
          onPointerDownOutside={(e) => {
            if (((e.detail?.originalEvent?.target ?? e.target) as HTMLElement | null)?.closest?.("[data-datefield-popover]")) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (((e.detail?.originalEvent?.target ?? e.target) as HTMLElement | null)?.closest?.("[data-datefield-popover]")) e.preventDefault();
          }}
          aria-describedby={undefined}
          style={nueva ? undefined : {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 91,
            maxHeight: "92vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Dialog.Title className="modal__title" style={{ display: "none" }}>{t("shell.newPatient.title")}</Dialog.Title>
          <div className="modal__header" style={{ flexShrink: 0 }}>
            <div className="modal__title">
              {nueva && <UserPlus size={22} strokeWidth={2} className={ROPA_ALTA_PACIENTE.tituloIcono} aria-hidden />}
              {t("shell.newPatient.title")}
            </div>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

        {/* noValidate (ws1-t1, C-95): con la validación nativa, un correo inválido paraba el envío con una burbuja del
            navegador que casi no se ve; ahora lo dice nuestro aviso, nombrando el campo. */}
        <form ref={formRef} onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div className="modal__body" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {/* Sección: Identidad */}
            <div style={{ marginBottom: 22 }}>
              <div className="form-section__title">
                {t("shell.newPatient.sectionIdentity")}
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                <div className="field-new" data-campo="firstName">
                  <label className="field-new__label">{t("shell.newPatient.firstName")} <span className="req">*</span></label>
                  <input className="input-new" placeholder="Ana" value={form.firstName} onChange={e => set("firstName", e.target.value)} style={{ borderColor: errors.firstName ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new" data-campo="lastName">
                  <label className="field-new__label">{t("shell.newPatient.lastName")} <span className="req">*</span></label>
                  <input className="input-new" placeholder="García" value={form.lastName} onChange={e => set("lastName", e.target.value)} style={{ borderColor: errors.lastName ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new" data-campo="dob">
                  <label className="field-new__label">{t("shell.newPatient.dob")} <span className="req">*</span></label>
                  <DateField className="input-new" value={form.dob} max={todayISO} onChange={e => set("dob", e.target.value)} style={{ borderColor: errors.dob ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new" data-campo="gender">
                  <label className="field-new__label">{t("shell.newPatient.gender")} <span className="req">*</span></label>
                  <select className="input-new" value={form.gender} onChange={e => set("gender", e.target.value)} style={{ borderColor: errors.gender ? '#ef4444' : undefined }}>
                    <option value="">{t("shell.newPatient.selectOption")}</option>
                    <option value="M">{t("shell.newPatient.genderMale")}</option>
                    <option value="F">{t("shell.newPatient.genderFemale")}</option>
                    <option value="OTHER">{t("shell.newPatient.genderOther")}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sección: Identificación oficial — NOM-024 */}
            <div style={{ marginBottom: 22 }}>
              <div className="form-section__title">
                {t("shell.newPatient.sectionOfficialId")}
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {([
                  { id: "COMPLETE", label: t("shell.newPatient.curpHave") },
                  { id: "PENDING",  label: t("shell.newPatient.curpNotNow") },
                  { id: "FOREIGN",  label: t("shell.newPatient.curpForeign") },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => set("curpStatus", opt.id)}
                    className={`btn-new ${form.curpStatus === opt.id ? "btn-new--primary" : "btn-new--secondary"}`}
                    style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {form.curpStatus === "COMPLETE" && (
                <div className="field-new" data-campo="curp">
                  <label className="field-new__label">
                    CURP <span className="req">*</span>
                  </label>
                  <input
                    className="input-new"
                    // Con la ropa nueva la CURP va en la letra del panel, como
                    // el resto de datos administrativos (ver tipografia-panel).
                    style={nueva
                      ? { textTransform: "uppercase", letterSpacing: "0.04em" }
                      : { fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.04em" }}
                    placeholder="GOPA850623HDFRRR03"
                    maxLength={18}
                    value={form.curp}
                    onChange={(e) => set("curp", e.target.value.toUpperCase())}
                  />
                </div>
              )}
              {form.curpStatus === "FOREIGN" && (
                <div className="field-new" data-campo="passportNo">
                  <label className="field-new__label">{t("shell.newPatient.passport")} <span className="req">*</span></label>
                  <input
                    className="input-new"
                    placeholder="A12345678"
                    maxLength={20}
                    value={form.passportNo}
                    onChange={(e) => set("passportNo", e.target.value.trim())}
                  />
                </div>
              )}
              {form.curpStatus === "PENDING" && (
                <div {...(nueva ? { className: ROPA_ALTA_PACIENTE.pista } : { style: { fontSize: 11, color: "var(--text-3)", padding: "6px 4px" } })}>
                  {t("shell.newPatient.curpPendingHint")}
                </div>
              )}
            </div>

            {/* Sección: Contacto */}
            <div style={{ marginBottom: 22 }}>
              <div className="form-section__title">
                {t("shell.newPatient.sectionContact")}
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                <div className="field-new" data-campo="email">
                  <label className="field-new__label">{t("shell.newPatient.email")}</label>
                  <input className="input-new" type="email" placeholder="ana@email.com" value={form.email} onChange={e => set("email", e.target.value)} style={{ borderColor: errors.email ? 'var(--danger)' : undefined }} />
                </div>
                <div className="field-new" data-campo="phone">
                  <label className="field-new__label">{t("shell.newPatient.phone")} <span className="req">*</span></label>
                  <input className="input-new" placeholder="+52 55…" value={form.phone} onChange={e => set("phone", e.target.value)} style={{ borderColor: errors.phone ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                  <label className="field-new__label">{t("shell.newPatient.address")}</label>
                  <input className="input-new" placeholder={t("shell.newPatient.addressPlaceholder")} value={form.address} onChange={e => set("address", e.target.value)} />
                </div>
                {/* Contacto de emergencia (anamnesis WS1-T2) */}
                <div className="field-new">
                  <label className="field-new__label">Contacto de emergencia</label>
                  <input className="input-new" placeholder="Nombre" value={form.emergencyContactName} onChange={e => set("emergencyContactName", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Tel. de emergencia</label>
                  <input className="input-new" placeholder="+52 55…" value={form.emergencyContactPhone} onChange={e => set("emergencyContactPhone", e.target.value)} />
                </div>
                <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                  <label className="field-new__label">Parentesco</label>
                  <input className="input-new" placeholder="Ej. Cónyuge, madre, hijo…" value={form.emergencyContactRelation} onChange={e => set("emergencyContactRelation", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Sección: Tipo + Clínico */}
            <div style={{ marginBottom: 6 }}>
              <div className="form-section__title">
                {t("shell.newPatient.sectionClinical")}
                <span className="form-section__rule" />
              </div>
              {/* CRM — fuente de adquisición + etapa de ciclo de vida */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 12 }}>
                <div className="field-new">
                  <label className="field-new__label">¿Cómo nos conoció?</label>
                  <select className="input-new" value={form.source} onChange={e => set("source", e.target.value)}>
                    <option value="">Selecciona…</option>
                    {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Tipo de contacto</label>
                  <select className="input-new" value={form.lifecycleStage} onChange={e => set("lifecycleStage", e.target.value)}>
                    <option value="patient">Paciente</option>
                    <option value="prospect">Prospecto</option>
                  </select>
                </div>
              </div>
              <div className="field-new" style={{ marginBottom: 12 }}>
                <label className="field-new__label">{t("shell.newPatient.patientType")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => set("isChild", false)}
                    className={`btn-new ${!form.isChild ? "btn-new--primary" : "btn-new--secondary"}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t("shell.newPatient.typeAdult")}
                  </button>
                  <button
                    type="button"
                    onClick={() => set("isChild", true)}
                    className={`btn-new ${form.isChild ? "btn-new--primary" : "btn-new--secondary"}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t("shell.newPatient.typeChild")}
                  </button>
                </div>
              </div>
              <div className="field-new" style={{ marginBottom: 12 }}>
                <label className="field-new__label">{t("shell.newPatient.allergiesLabel")} <span className="req">*</span></label>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    id="no-allergies"
                    checked={noAllergies}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setNoAllergies(checked);
                      if (checked) { set("allergies", "N/A"); }
                      else { set("allergies", ""); }
                    }}
                  />
                  <label htmlFor="no-allergies" {...(nueva ? { className: ROPA_ALTA_PACIENTE.rotuloSuave } : { style: { fontSize: 12, color: "var(--text-2)", cursor: "pointer" } })}>
                    {t("shell.newPatient.noAllergies")}
                  </label>
                </div>
                <input
                  className="input-new"
                  // ws1-t1 (F8): la marca va en el campo de texto y no en la envoltura — el primer enfocable de
                  // ésta es la casilla «Sin alergias», y el foco tiene que caer donde se escribe.
                  data-campo="allergies"
                  placeholder={t("shell.newPatient.allergiesPlaceholder")}
                  value={form.allergies}
                  onChange={e => set("allergies", e.target.value)}
                  disabled={noAllergies}
                  style={{ borderColor: errors.allergies ? '#ef4444' : undefined, opacity: noAllergies ? 0.6 : 1 }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("common.notes")}</label>
                <textarea
                  className="input-new"
                  style={nueva ? { resize: "vertical" } : { height: 64, paddingTop: 8, resize: "vertical" }}
                  placeholder={t("shell.newPatient.notesPlaceholder")}
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Cupo de pacientes del plan agotado → explicación + CTA de upgrade.
              Va FUERA del cuerpo scrolleable (justo sobre las acciones) para que
              se vea sin scrollear después de darle a "Crear paciente". Mismo
              patrón visual que la cuota de storage en patient-photos-tab. */}
          {limitInfo && (
            <div style={{ flexShrink: 0, padding: "0 22px 14px" }}>
              <div className="flex items-start justify-between gap-3 flex-wrap rounded-[var(--radius-lg)] border border-[var(--warning-border-strong)] bg-[var(--warning-soft)] px-4 py-3">
                <div
                  className="flex items-start gap-2 text-sm text-[var(--warning-strong)]"
                  style={{ flex: "1 1 240px", minWidth: 0 }}
                >
                  <AlertTriangle size={16} strokeWidth={1.75} className="flex-shrink-0" style={{ marginTop: 2 }} aria-hidden />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>
                      {limitInfo.limit != null
                        ? t("shell.newPatient.limitTitle", { limit: limitInfo.limit.toLocaleString() })
                        : t("shell.newPatient.limitTitleGeneric")}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, lineHeight: 1.45 }}>
                      {t("shell.newPatient.limitBodyLead")}{" "}
                      <strong>{t("shell.newPatient.limitBodyHighlight")}</strong>
                    </div>
                  </div>
                </div>
                {limitInfo.isAdmin ? (
                  <Link
                    href="/dashboard/settings?tab=subscription"
                    // Cierra el modal al navegar: cuando se monta desde el
                    // NewPatientProvider (sidebar/paleta/atajo N) el provider vive
                    // en el layout del dashboard y sobrevive al cambio de ruta, así
                    // que sin esto el modal quedaría encima de Configuración.
                    onClick={onClose}
                    className={nueva
                      ? ROPA_ALTA_PACIENTE.limiteCta
                      : "text-xs font-bold px-3.5 py-2.5 rounded-lg bg-[var(--brand)] text-white hover:bg-[var(--violet-700)] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] active:scale-[.98] transition duration-150 flex-shrink-0 no-underline"}
                  >
                    {t("shell.newPatient.limitCta")}
                  </Link>
                ) : (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--warning-strong)", flex: "1 1 200px" }}>
                    {t("shell.newPatient.limitAskAdmin")}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* justify-content: space-between pisa el flex-end de .modal__footer
              para dejar la visibilidad a la IZQUIERDA y las acciones a la
              derecha, sin tocar la clase compartida en globals.css. */}
          <div className="modal__footer" style={{ flexShrink: 0, justifyContent: "space-between", flexWrap: "wrap" }}>
            <PatientVisibilityPicker
              value={visibleUserIds}
              onChange={setVisibleUserIds}
              disabled={loading}
            />
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <ButtonNew variant="ghost" onClick={onClose} type="button">{t("common.cancel")}</ButtonNew>
              {/* Con el cupo agotado el submit queda muerto: reintentar sólo
                  volvería a chocar con el 402 de la API. */}
              <ButtonNew variant="primary" type="submit" disabled={loading || limitInfo !== null}>
                {loading ? t("common.saving") : t("shell.newPatient.createPatient")}
              </ButtonNew>
            </div>
          </div>
        </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
      {/* ws1-t1 (E2) — «Ya existe … ¿Abrir su ficha o crear igual?». Una ventana encima del alta: lo capturado
          no se pierde y «Cancelar» vuelve al formulario tal cual. */}
      <Dialog.Root open={duplicado !== null} onOpenChange={(o) => { if (!o && !loading) setDuplicado(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay style={{ position: "fixed", inset: 0, background: "color-mix(in srgb, var(--text-1) 35%, transparent)", zIndex: 120 }} />
          <Dialog.Content
            data-aviso-duplicado
            aria-describedby="aviso-duplicado-cuerpo"
            onEscapeKeyDown={(e) => { if (loading) e.preventDefault(); }}
            style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 121,
              width: "min(440px, calc(100vw - 32px))", maxHeight: "86vh", overflowY: "auto",
              background: "var(--bg-elev)", color: "var(--text-1)", border: "1px solid var(--border-soft)",
              borderRadius: 14, boxShadow: "var(--shadow-3)", padding: 20,
              display: "flex", flexDirection: "column", gap: 14,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <AlertTriangle size={20} strokeWidth={2} style={{ color: "var(--warning)", flex: "none", marginTop: 1 }} aria-hidden />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <Dialog.Title style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{textosDup.titulo}</Dialog.Title>
                <p id="aviso-duplicado-cuerpo" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-2)" }}>
                  {duplicado && duplicado.gemelos.length > 0
                    ? textosDup.cuerpoVisible(`${form.firstName} ${form.lastName}`.trim(), duplicado.gemelos.length)
                    : textosDup.cuerpoOculto}
                </p>
              </div>
            </div>
            {duplicado && duplicado.gemelos.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {duplicado.gemelos.map((g) => (
                  <li
                    key={g.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                      padding: "10px 12px", border: "1px solid var(--border-soft)", borderRadius: 10,
                      background: "var(--bg-elev-2)",
                    }}
                  >
                    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{g.fullName}</div>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {[g.patientNumber, g.phone].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <ButtonNew variant="primary" type="button" onClick={() => abrirFichaExistente(g.id)} disabled={loading}>
                      {textosDup.abrirFicha}
                    </ButtonNew>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <ButtonNew variant="ghost" type="button" onClick={() => setDuplicado(null)} disabled={loading}>
                {textosDup.cancelar}
              </ButtonNew>
              <ButtonNew variant="secondary" type="button" onClick={() => { void enviar(true); }} disabled={loading}>
                {loading ? textosDup.creando : textosDup.crearIgual}
              </ButtonNew>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
