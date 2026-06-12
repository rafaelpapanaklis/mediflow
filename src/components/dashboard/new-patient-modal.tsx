"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DateField } from "@/components/ui/date-field";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (patient: any) => void;
  /** Pre-fill helpers para abrir desde combobox de búsqueda. */
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
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

const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function NewPatientModal({ open, onClose, onCreated, initialName, initialPhone, initialEmail }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [noAllergies, setNoAllergies] = useState(false);
  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => { const next = { ...e }; delete next[k]; return next; });
  };

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
    setErrors({});
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
      setErrors(newErrors);
      toast.error(t("shell.newPatient.errRequiredFields"));
      return;
    }
    if (form.curpStatus === "COMPLETE") {
      if (!form.curp) { toast.error(t("shell.newPatient.errCurpRequired")); return; }
      if (!CURP_RE.test(form.curp.toUpperCase())) { toast.error(t("shell.newPatient.errCurpFormat")); return; }
    }
    if (form.curpStatus === "FOREIGN" && !form.passportNo) {
      toast.error(t("shell.newPatient.errPassportRequired"));
      return;
    }
    setLoading(true);
    try {
      const dupeCheck = await fetch(`/api/patients?search=${encodeURIComponent(form.firstName + " " + form.lastName)}`);
      if (dupeCheck.ok) {
        const existing = await dupeCheck.json();
        if (Array.isArray(existing) && existing.length > 0) {
          const confirmed = window.confirm(t("shell.newPatient.confirmDuplicate", { name: `${form.firstName} ${form.lastName}` }));
          if (!confirmed) { setLoading(false); return; }
        }
      }
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          isChild: form.isChild,
          allergies: form.allergies ? form.allergies.split(",").map(s => s.trim()).filter(Boolean) : [],
          curp:        form.curpStatus === "COMPLETE" ? form.curp.toUpperCase() : null,
          curpStatus:  form.curpStatus,
          passportNo:  form.curpStatus === "FOREIGN" ? form.passportNo : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const patient = await res.json();
      onCreated(patient);
      setForm(emptyForm);
      toast.success(t("shell.newPatient.created", { name: patient.firstName }));
    } catch (err: any) {
      toast.error(err.message ?? t("shell.newPatient.errCreate"));
    } finally { setLoading(false); }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,10,30,0.55)",
            backdropFilter: "blur(4px)",
            zIndex: 90,
          }}
        />
        <Dialog.Content
          className="modal"
          onEscapeKeyDown={onClose}
          aria-describedby={undefined}
          style={{
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
            <div className="modal__title">{t("shell.newPatient.title")}</div>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div className="modal__body" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {/* Sección: Identidad */}
            <div style={{ marginBottom: 22 }}>
              <div className="form-section__title">
                {t("shell.newPatient.sectionIdentity")}
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                <div className="field-new">
                  <label className="field-new__label">{t("shell.newPatient.firstName")} <span className="req">*</span></label>
                  <input className="input-new" placeholder="Ana" value={form.firstName} onChange={e => set("firstName", e.target.value)} style={{ borderColor: errors.firstName ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("shell.newPatient.lastName")} <span className="req">*</span></label>
                  <input className="input-new" placeholder="García" value={form.lastName} onChange={e => set("lastName", e.target.value)} style={{ borderColor: errors.lastName ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("shell.newPatient.dob")} <span className="req">*</span></label>
                  <DateField className="input-new" value={form.dob} onChange={e => set("dob", e.target.value)} style={{ borderColor: errors.dob ? '#ef4444' : undefined }} />
                </div>
                <div className="field-new">
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
                <div className="field-new">
                  <label className="field-new__label">
                    CURP <span className="req">*</span>
                  </label>
                  <input
                    className="input-new"
                    style={{ fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.04em" }}
                    placeholder="GOPA850623HDFRRR03"
                    maxLength={18}
                    value={form.curp}
                    onChange={(e) => set("curp", e.target.value.toUpperCase())}
                  />
                </div>
              )}
              {form.curpStatus === "FOREIGN" && (
                <div className="field-new">
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
                <div style={{ fontSize: 11, color: "var(--text-3)", padding: "6px 4px" }}>
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
                <div className="field-new">
                  <label className="field-new__label">{t("shell.newPatient.email")}</label>
                  <input className="input-new" type="email" placeholder="ana@email.com" value={form.email} onChange={e => set("email", e.target.value)} />
                </div>
                <div className="field-new">
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
                  <label htmlFor="no-allergies" style={{ fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                    {t("shell.newPatient.noAllergies")}
                  </label>
                </div>
                <input
                  className="input-new"
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
                  style={{ height: 64, paddingTop: 8, resize: "vertical" }}
                  placeholder={t("shell.newPatient.notesPlaceholder")}
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="modal__footer" style={{ flexShrink: 0 }}>
            <ButtonNew variant="ghost" onClick={onClose} type="button">{t("common.cancel")}</ButtonNew>
            <ButtonNew variant="primary" type="submit" disabled={loading}>
              {loading ? t("common.saving") : t("shell.newPatient.createPatient")}
            </ButtonNew>
          </div>
        </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
