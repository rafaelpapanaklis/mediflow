"use client";
// Pediatrics — wizard 3 pasos para crear paciente pediátrico + tutor + antecedentes. Spec: §7 (sprint 2)

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  createPediatricPatient,
  isFailure,
  type CreatePediatricPatientInput,
} from "@/app/actions/pediatrics";
import { calculateAge } from "@/lib/pediatrics/age";
import { DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";

export interface NewPediatricPatientDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

interface PatientFormState {
  firstName: string;
  lastName: string;
  dob: string;
  gender: "M" | "F" | "OTHER";
  phone: string;
  email: string;
  address: string;
  allergies: string;
  chronicConditions: string;
  insuranceProvider: string;
  insurancePolicy: string;
}

interface GuardianFormState {
  fullName: string;
  parentesco: "madre" | "padre" | "tutor_legal" | "abuelo" | "abuela" | "tio" | "tia" | "hermano" | "hermana" | "otro";
  phone: string;
  email: string;
  address: string;
  esResponsableLegal: boolean;
}

interface RecordFormState {
  enabled: boolean;
  birthWeightKg: string;
  gestationWeeks: string;
  prematuro: boolean;
  vaccinationStatus: "completo" | "incompleto" | "desconocido";
  feedingType: "materna" | "mixta" | "formula" | "na";
  specialConditions: string[];
}

const SPECIAL_CONDITIONS_OPTIONS = [
  { k: "TEA",         label: "TEA (espectro autista)" },
  { k: "TDAH",        label: "TDAH" },
  { k: "Down",        label: "Síndrome de Down" },
  { k: "Cardiopatia", label: "Cardiopatía" },
  { k: "Diabetes",    label: "Diabetes tipo 1" },
  { k: "Asma",        label: "Asma" },
  { k: "Otra",        label: "Otra (especificar al doctor)" },
];

const PARENTESCO_OPTIONS: { k: GuardianFormState["parentesco"]; label: string }[] = [
  { k: "madre",       label: "Madre" },
  { k: "padre",       label: "Padre" },
  { k: "tutor_legal", label: "Tutor legal" },
  { k: "abuelo",      label: "Abuelo" },
  { k: "abuela",      label: "Abuela" },
  { k: "tio",         label: "Tío" },
  { k: "tia",         label: "Tía" },
  { k: "hermano",     label: "Hermano" },
  { k: "hermana",     label: "Hermana" },
  { k: "otro",        label: "Otro" },
];

const INITIAL_PATIENT: PatientFormState = {
  firstName: "", lastName: "", dob: "", gender: "OTHER",
  phone: "", email: "", address: "",
  allergies: "", chronicConditions: "",
  insuranceProvider: "", insurancePolicy: "",
};
const INITIAL_GUARDIAN: GuardianFormState = {
  fullName: "", parentesco: "madre", phone: "", email: "", address: "",
  esResponsableLegal: true,
};
const INITIAL_RECORD: RecordFormState = {
  enabled: false,
  birthWeightKg: "", gestationWeeks: "", prematuro: false,
  vaccinationStatus: "desconocido", feedingType: "na",
  specialConditions: [],
};

export function NewPediatricPatientDialog(props: NewPediatricPatientDialogProps) {
  const { open, onClose } = props;
  const router = useRouter();
  const titleId = useId();

  const [step, setStep] = useState<Step>(1);
  const [patient, setPatient] = useState<PatientFormState>(INITIAL_PATIENT);
  const [guardian, setGuardian] = useState<GuardianFormState>(INITIAL_GUARDIAN);
  const [record, setRecord] = useState<RecordFormState>(INITIAL_RECORD);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    setStep(1);
    setPatient(INITIAL_PATIENT);
    setGuardian(INITIAL_GUARDIAN);
    setRecord(INITIAL_RECORD);
    setSubmitting(false);
  }, [open]);

  // Lock body scroll mientras el modal está abierto.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Esc cierra (con confirmación si hay datos sin guardar).
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (hasUnsavedData(patient, guardian, record)) {
        if (!window.confirm("¿Cerrar sin guardar? Perderás los datos ingresados.")) return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, patient, guardian, record, onClose]);

  const ageInfo = useMemo(() => {
    if (!patient.dob) return null;
    const dob = new Date(patient.dob);
    if (Number.isNaN(dob.getTime())) return null;
    const age = calculateAge(dob);
    return { ...age, eligible: age.decimal < DEFAULT_PEDIATRICS_CUTOFF_YEARS };
  }, [patient.dob]);

  const step1Valid =
    patient.firstName.trim().length > 0 &&
    patient.lastName.trim().length > 0 &&
    Boolean(ageInfo?.eligible);
  const step2Valid =
    guardian.fullName.trim().length >= 2 &&
    guardian.phone.trim().length >= 7;

  function next() {
    if (step === 1 && !step1Valid) {
      if (!patient.firstName.trim() || !patient.lastName.trim()) {
        toast.error("Nombre y apellido son obligatorios");
      } else if (!ageInfo) {
        toast.error("Indica la fecha de nacimiento");
      } else if (!ageInfo.eligible) {
        toast.error(`El paciente debe ser menor de ${DEFAULT_PEDIATRICS_CUTOFF_YEARS} años`);
      }
      return;
    }
    if (step === 2 && !step2Valid) {
      toast.error("Nombre completo y teléfono del tutor son obligatorios");
      return;
    }
    setStep((s) => (s === 3 ? s : ((s + 1) as Step)));
  }

  function back() {
    setStep((s) => (s === 1 ? s : ((s - 1) as Step)));
  }

  async function submit(includeRecord: boolean) {
    if (!step1Valid || !step2Valid) {
      toast.error("Completa los pasos previos antes de crear");
      return;
    }
    setSubmitting(true);
    const payload: CreatePediatricPatientInput = {
      patient: {
        firstName: patient.firstName.trim(),
        lastName: patient.lastName.trim(),
        dob: new Date(patient.dob).toISOString(),
        gender: patient.gender,
        phone: patient.phone.trim() || null,
        email: patient.email.trim() || null,
        address: patient.address.trim() || null,
        allergies: parseList(patient.allergies),
        chronicConditions: parseList(patient.chronicConditions),
        insuranceProvider: patient.insuranceProvider.trim() || null,
        insurancePolicy: patient.insurancePolicy.trim() || null,
      },
      guardian: {
        fullName: guardian.fullName.trim(),
        parentesco: guardian.parentesco,
        phone: guardian.phone.trim(),
        email: guardian.email.trim() || null,
        address: guardian.address.trim() || null,
        esResponsableLegal: guardian.esResponsableLegal,
      },
      record: includeRecord && record.enabled
        ? {
            birthWeightKg: record.birthWeightKg ? Number(record.birthWeightKg) : null,
            gestationWeeks: record.gestationWeeks ? Number(record.gestationWeeks) : null,
            prematuro: record.prematuro,
            vaccinationStatus: record.vaccinationStatus,
            feedingType: record.feedingType,
            specialConditions: record.specialConditions,
          }
        : undefined,
    };

    const result = await createPediatricPatient(payload);
    setSubmitting(false);

    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Paciente pediátrico creado");
    onClose();
    router.push(`/dashboard/specialties/pediatrics/${result.data.patientId}`);
    router.refresh();
  }

  function handleClose() {
    if (hasUnsavedData(patient, guardian, record)) {
      if (!window.confirm("¿Cerrar sin guardar? Perderás los datos ingresados.")) return;
    }
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ped-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        handleClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="ped-modal modal--full ped-onboarding">
        <header className="ped-modal__header">
          <div>
            <p className="ped-modal__breadcrumb">Odontopediatría</p>
            <h2 id={titleId} className="ped-modal__title">Nuevo paciente pediátrico</h2>
            <p className="ped-modal__sub">Wizard de 3 pasos · datos del paciente, tutor responsable y antecedentes opcionales.</p>
          </div>
          <button type="button" className="ped-modal__close" aria-label="Cerrar" onClick={handleClose}>
            <X size={20} aria-hidden />
          </button>
        </header>

        <div className="ped-onboarding__stepper" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`ped-onboarding__step ${step === s ? "is-active" : ""} ${step > s ? "is-done" : ""}`}
            >
              <span className="ped-onboarding__step-num">{step > s ? <Check size={12} aria-hidden /> : s}</span>
              <span className="ped-onboarding__step-label">
                {s === 1 ? "Paciente" : s === 2 ? "Tutor" : "Antecedentes"}
              </span>
            </div>
          ))}
        </div>

        <div className="ped-modal__body ped-onboarding__body">
          {step === 1 && (
            <PatientStep value={patient} onChange={setPatient} ageInfo={ageInfo} />
          )}
          {step === 2 && (
            <GuardianStep value={guardian} onChange={setGuardian} />
          )}
          {step === 3 && (
            <RecordStep value={record} onChange={setRecord} />
          )}
        </div>

        <footer className="ped-modal__footer ped-onboarding__footer">
          <button type="button" className="pedi-btn" onClick={handleClose} disabled={submitting}>
            Cancelar
          </button>
          {step > 1 && (
            <button type="button" className="pedi-btn" onClick={back} disabled={submitting}>
              <ArrowLeft size={14} aria-hidden /> Atrás
            </button>
          )}
          {step < 3 && (
            <button type="button" className="pedi-btn pedi-btn--brand" onClick={next} disabled={submitting}>
              Siguiente <ArrowRight size={14} aria-hidden />
            </button>
          )}
          {step === 3 && (
            <>
              <button
                type="button"
                className="pedi-btn"
                onClick={() => submit(false)}
                disabled={submitting}
              >
                Saltar antecedentes
              </button>
              <button
                type="button"
                className="pedi-btn pedi-btn--brand"
                onClick={() => submit(true)}
                disabled={submitting}
              >
                {submitting ? "Creando…" : "Crear paciente"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────
// Subcomponentes por paso
// ─────────────────────────────────────────────────────────────────

function PatientStep(props: {
  value: PatientFormState;
  onChange: (v: PatientFormState) => void;
  ageInfo: { formatted: string; long: string; eligible: boolean } | null;
}) {
  const { value: v, onChange, ageInfo } = props;
  const set = <K extends keyof PatientFormState>(key: K, val: PatientFormState[K]) =>
    onChange({ ...v, [key]: val });

  return (
    <div className="pedi-form">
      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Nombre(s) *</span>
          <input
            type="text"
            value={v.firstName}
            maxLength={60}
            onChange={(e) => set("firstName", e.target.value)}
            required
          />
        </label>
        <label className="pedi-form__field">
          <span>Apellidos *</span>
          <input
            type="text"
            value={v.lastName}
            maxLength={60}
            onChange={(e) => set("lastName", e.target.value)}
            required
          />
        </label>
      </div>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Fecha de nacimiento *</span>
          <input
            type="date"
            value={v.dob}
            onChange={(e) => set("dob", e.target.value)}
            required
          />
          {ageInfo ? (
            ageInfo.eligible ? (
              <small className="pedi-form__hint">Edad: {ageInfo.long}</small>
            ) : (
              <small className="pedi-form__hint pedi-form__hint--err">
                Mayor de {DEFAULT_PEDIATRICS_CUTOFF_YEARS} años — no aplica al módulo pediátrico
              </small>
            )
          ) : null}
        </label>
        <label className="pedi-form__field">
          <span>Sexo</span>
          <select value={v.gender} onChange={(e) => set("gender", e.target.value as PatientFormState["gender"])}>
            <option value="OTHER">Sin especificar</option>
            <option value="F">Femenino</option>
            <option value="M">Masculino</option>
          </select>
        </label>
      </div>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Teléfono del paciente</span>
          <input
            type="tel"
            value={v.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="Solo si tiene teléfono propio"
          />
        </label>
        <label className="pedi-form__field">
          <span>Email del paciente</span>
          <input
            type="email"
            value={v.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </label>
      </div>

      <label className="pedi-form__field">
        <span>Dirección</span>
        <input
          type="text"
          maxLength={300}
          value={v.address}
          onChange={(e) => set("address", e.target.value)}
        />
      </label>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Alergias (separadas por coma)</span>
          <textarea
            rows={2}
            value={v.allergies}
            onChange={(e) => set("allergies", e.target.value)}
            placeholder="Penicilina, látex, frutos secos…"
          />
        </label>
        <label className="pedi-form__field">
          <span>Condiciones crónicas</span>
          <textarea
            rows={2}
            value={v.chronicConditions}
            onChange={(e) => set("chronicConditions", e.target.value)}
            placeholder="Asma, diabetes, etc."
          />
        </label>
      </div>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Aseguradora</span>
          <input
            type="text"
            maxLength={120}
            value={v.insuranceProvider}
            onChange={(e) => set("insuranceProvider", e.target.value)}
          />
        </label>
        <label className="pedi-form__field">
          <span>Número de póliza</span>
          <input
            type="text"
            maxLength={60}
            value={v.insurancePolicy}
            onChange={(e) => set("insurancePolicy", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function GuardianStep(props: {
  value: GuardianFormState;
  onChange: (v: GuardianFormState) => void;
}) {
  const { value: v, onChange } = props;
  const set = <K extends keyof GuardianFormState>(key: K, val: GuardianFormState[K]) =>
    onChange({ ...v, [key]: val });

  return (
    <div className="pedi-form">
      <p className="pedi-form__hint">
        Tutor que firmará consentimientos y recibirá comunicaciones (WhatsApp, recordatorios).
      </p>

      <label className="pedi-form__field">
        <span>Nombre completo *</span>
        <input
          type="text"
          maxLength={120}
          value={v.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          required
        />
      </label>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Parentesco *</span>
          <select
            value={v.parentesco}
            onChange={(e) => set("parentesco", e.target.value as GuardianFormState["parentesco"])}
          >
            {PARENTESCO_OPTIONS.map((p) => (
              <option key={p.k} value={p.k}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="pedi-form__field">
          <span>Teléfono *</span>
          <input
            type="tel"
            value={v.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+52 999 123 4567"
            required
          />
        </label>
      </div>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Email</span>
          <input
            type="email"
            value={v.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </label>
        <label className="pedi-form__field">
          <span>Dirección</span>
          <input
            type="text"
            maxLength={300}
            value={v.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </label>
      </div>

      <label className="pedi-checkbox">
        <input
          type="checkbox"
          checked={v.esResponsableLegal}
          onChange={(e) => set("esResponsableLegal", e.target.checked)}
        />
        <span>Es responsable legal del menor</span>
      </label>
    </div>
  );
}

function RecordStep(props: {
  value: RecordFormState;
  onChange: (v: RecordFormState) => void;
}) {
  const { value: v, onChange } = props;
  const set = <K extends keyof RecordFormState>(key: K, val: RecordFormState[K]) =>
    onChange({ ...v, [key]: val });

  function toggleCondition(k: string) {
    const next = v.specialConditions.includes(k)
      ? v.specialConditions.filter((x) => x !== k)
      : [...v.specialConditions, k];
    set("specialConditions", next);
  }

  return (
    <div className="pedi-form">
      <p className="pedi-form__hint">
        Antecedentes pediátricos opcionales. Puedes saltarlos y completarlos
        después desde el expediente pediátrico.
      </p>

      <label className="pedi-checkbox">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        <span>Capturar antecedentes ahora</span>
      </label>

      {v.enabled && (
        <>
          <fieldset className="pedi-form__fieldset">
            <legend>Datos prenatales</legend>
            <div className="pedi-form__grid">
              <label className="pedi-form__field">
                <span>Peso al nacer (kg)</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={10}
                  value={v.birthWeightKg}
                  onChange={(e) => set("birthWeightKg", e.target.value)}
                />
              </label>
              <label className="pedi-form__field">
                <span>Semanas de gestación</span>
                <input
                  type="number"
                  min={20}
                  max={45}
                  value={v.gestationWeeks}
                  onChange={(e) => set("gestationWeeks", e.target.value)}
                />
              </label>
            </div>
            <label className="pedi-checkbox">
              <input
                type="checkbox"
                checked={v.prematuro}
                onChange={(e) => set("prematuro", e.target.checked)}
              />
              <span>Prematuro</span>
            </label>
          </fieldset>

          <fieldset className="pedi-form__fieldset">
            <legend>Vacunación y alimentación</legend>
            <div className="pedi-form__grid">
              <label className="pedi-form__field">
                <span>Estado de vacunación</span>
                <select
                  value={v.vaccinationStatus}
                  onChange={(e) => set("vaccinationStatus", e.target.value as RecordFormState["vaccinationStatus"])}
                >
                  <option value="completo">Completo</option>
                  <option value="incompleto">Incompleto</option>
                  <option value="desconocido">Desconocido</option>
                </select>
              </label>
              <label className="pedi-form__field">
                <span>Tipo de alimentación temprana</span>
                <select
                  value={v.feedingType}
                  onChange={(e) => set("feedingType", e.target.value as RecordFormState["feedingType"])}
                >
                  <option value="materna">Materna</option>
                  <option value="mixta">Mixta</option>
                  <option value="formula">Fórmula</option>
                  <option value="na">N/A</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="pedi-form__fieldset">
            <legend>Condiciones especiales</legend>
            <div className="pedi-form__checklist">
              {SPECIAL_CONDITIONS_OPTIONS.map((o) => {
                const checked = v.specialConditions.includes(o.k);
                return (
                  <label key={o.k} className={`pedi-checkbox ${checked ? "is-checked" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCondition(o.k)} />
                    <span>{o.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasUnsavedData(p: PatientFormState, g: GuardianFormState, r: RecordFormState): boolean {
  if (p.firstName.trim() || p.lastName.trim() || p.dob || p.phone.trim() || p.email.trim()) return true;
  if (g.fullName.trim() || g.phone.trim() || g.email.trim()) return true;
  if (r.enabled) return true;
  return false;
}
