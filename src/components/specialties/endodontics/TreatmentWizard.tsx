"use client";
// Endodontics — wizard 4 pasos para captura de TC. Spec §6.11, §9

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  completeTreatment,
  isFailure,
  updateTreatmentStep,
} from "@/app/actions/endodontics";
import {
  ACCESS_TYPE,
  INSTRUMENTATION_SYSTEM,
  INSTRUMENTATION_TECHNIQUE,
  IRRIGATION_ACTIVATION,
  OBTURATION_TECHNIQUE,
  SEALER_TYPE,
  POST_OP_RESTORATION_TYPE,
} from "@/lib/validation/endodontics";

type Step = 1 | 2 | 3 | 4;

interface Step1State {
  rubberDamPlaced: boolean;
  accessType: typeof ACCESS_TYPE[number];
}
interface Step2State {
  instrumentationSystem: typeof INSTRUMENTATION_SYSTEM[number];
  technique: typeof INSTRUMENTATION_TECHNIQUE[number];
  motorBrand: string;
  torqueSettings: string;
  rpmSetting: string;
}
interface Irrigant {
  substance: string;
  concentration: string;
  volumeMl: string;
  order: number;
}
interface Step3State {
  irrigants: Irrigant[];
  irrigationActivation: typeof IRRIGATION_ACTIVATION[number];
  totalIrrigationMinutes: string;
}
interface Step4State {
  obturationTechnique: typeof OBTURATION_TECHNIQUE[number];
  sealer: typeof SEALER_TYPE[number];
  masterConePresetIso: string;
  postOpRestorationPlan: typeof POST_OP_RESTORATION_TYPE[number];
  requiresPost: boolean;
  postMaterial: string;
  restorationUrgencyDays: string;
}

const ACCESS_LABEL: Record<string, string> = {
  CONVENCIONAL: "Convencional",
  CONSERVADOR: "Conservador (mínimamente invasivo)",
  RECTIFICACION_PREVIO: "Rectificación de acceso previo",
  POSTE_RETIRADO: "Tras retirar poste",
};
const SYSTEM_LABEL: Record<string, string> = {
  PROTAPER_GOLD: "ProTaper Gold",
  PROTAPER_NEXT: "ProTaper Next",
  WAVEONE_GOLD: "WaveOne Gold",
  RECIPROC_BLUE: "Reciproc Blue",
  BIORACE: "BioRaCe",
  HYFLEX_EDM: "HyFlex EDM",
  TRUNATOMY: "TruNatomy",
  MANUAL_KFILES: "Manual / K-Files",
  OTRO: "Otro",
};
const TECHNIQUE_LABEL: Record<string, string> = {
  ROTACION_CONTINUA: "Rotación continua",
  RECIPROCACION: "Reciprocación",
  MANUAL: "Manual",
  HIBRIDA: "Híbrida",
};
const ACTIVATION_LABEL: Record<string, string> = {
  NINGUNA: "Ninguna",
  SONICA: "Sónica (EndoActivator)",
  ULTRASONICA: "Ultrasónica (PUI)",
  LASER: "Láser (PIPS / SWEEPS)",
  XPF: "XP-Endo Finisher",
};
const OBTURATION_LABEL: Record<string, string> = {
  CONDENSACION_LATERAL: "Condensación lateral",
  CONDENSACION_VERTICAL_CALIENTE: "Condensación vertical caliente",
  OLA_CONTINUA: "Ola continua",
  CONO_UNICO: "Cono único",
  TERMOPLASTICA_INYECTABLE: "Termoplástica inyectable",
  BIOCERAMIC_SINGLE_CONE: "Biocerámico cono único",
};
const SEALER_LABEL: Record<string, string> = {
  AH_PLUS: "AH Plus",
  MTA_FILLAPEX: "MTA Fillapex",
  BIOROOT_RCS: "BioRoot RCS",
  BC_SEALER: "BC Sealer",
  TUBLISEAL: "Tubli-Seal",
  SEALAPEX: "Sealapex",
  OTRO: "Otro",
};
const RESTORATION_LABEL: Record<string, string> = {
  CORONA_PORCELANA_METAL: "Corona porcelana-metal",
  CORONA_ZIRCONIA: "Corona zirconia",
  CORONA_DISILICATO_LITIO: "Corona disilicato de litio",
  ONLAY: "Onlay",
  RESTAURACION_DIRECTA_RESINA: "Resina directa",
  POSTE_FIBRA_CORONA: "Poste fibra + corona",
  POSTE_METALICO_CORONA: "Poste metálico + corona",
};

export interface TreatmentWizardProps {
  open: boolean;
  onClose: () => void;
  treatmentId: string;
  toothFdi: number;
  startStep?: Step;
}

const INITIAL_STEP1: Step1State = { rubberDamPlaced: false, accessType: "CONVENCIONAL" };
const INITIAL_STEP2: Step2State = {
  instrumentationSystem: "PROTAPER_GOLD",
  technique: "ROTACION_CONTINUA",
  motorBrand: "", torqueSettings: "", rpmSetting: "",
};
const INITIAL_STEP3: Step3State = {
  irrigants: [{ substance: "NaOCl", concentration: "5.25%", volumeMl: "10", order: 1 }],
  irrigationActivation: "ULTRASONICA",
  totalIrrigationMinutes: "20",
};
const INITIAL_STEP4: Step4State = {
  obturationTechnique: "CONDENSACION_LATERAL",
  sealer: "AH_PLUS",
  masterConePresetIso: "30",
  postOpRestorationPlan: "CORONA_ZIRCONIA",
  requiresPost: false,
  postMaterial: "",
  restorationUrgencyDays: "30",
};

export function TreatmentWizard(props: TreatmentWizardProps) {
  const { open, onClose, treatmentId, toothFdi, startStep = 1 } = props;
  const titleId = useId();

  const [step, setStep] = useState<Step>(startStep);
  const [s1, setS1] = useState<Step1State>(INITIAL_STEP1);
  const [s2, setS2] = useState<Step2State>(INITIAL_STEP2);
  const [s3, setS3] = useState<Step3State>(INITIAL_STEP3);
  const [s4, setS4] = useState<Step4State>(INITIAL_STEP4);
  const [saving, setSaving] = useState(false);

  // Autosave draft del wizard en localStorage. Spec §9.5.
  const draftKey = `endo:wizard:${treatmentId}`;

  useEffect(() => {
    if (!open) return;
    setStep(startStep);
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{ s1: Step1State; s2: Step2State; s3: Step3State; s4: Step4State; step: Step }>;
        if (parsed.s1) setS1(parsed.s1);
        if (parsed.s2) setS2(parsed.s2);
        if (parsed.s3) setS3(parsed.s3);
        if (parsed.s4) setS4(parsed.s4);
        if (parsed.step) setStep(parsed.step);
      }
    } catch { /* ignora draft corrupto */ }
  }, [open, draftKey, startStep]);

  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ step, s1, s2, s3, s4 }));
    } catch { /* quota exceeded */ }
  }, [open, draftKey, step, s1, s2, s3, s4]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function persistStep(target: Step) {
    setSaving(true);
    let result;
    if (target === 1) {
      result = await updateTreatmentStep(1, { treatmentId, ...s1 });
    } else if (target === 2) {
      result = await updateTreatmentStep(2, {
        treatmentId,
        instrumentationSystem: s2.instrumentationSystem,
        technique: s2.technique,
        motorBrand: s2.motorBrand || null,
        torqueSettings: s2.torqueSettings || null,
        rpmSetting: s2.rpmSetting ? Number(s2.rpmSetting) : null,
      });
    } else if (target === 3) {
      result = await updateTreatmentStep(3, {
        treatmentId,
        irrigants: s3.irrigants.map((i) => ({
          substance: i.substance,
          concentration: i.concentration,
          volumeMl: Number(i.volumeMl) || 0,
          order: i.order,
        })),
        irrigationActivation: s3.irrigationActivation,
        totalIrrigationMinutes: s3.totalIrrigationMinutes ? Number(s3.totalIrrigationMinutes) : null,
      });
    } else {
      result = await updateTreatmentStep(4, {
        treatmentId,
        obturationTechnique: s4.obturationTechnique,
        sealer: s4.sealer,
        masterConePresetIso: s4.masterConePresetIso ? Number(s4.masterConePresetIso) : null,
        postOpRestorationPlan: s4.postOpRestorationPlan,
        requiresPost: s4.requiresPost,
        postMaterial: s4.postMaterial || null,
        restorationUrgencyDays: Number(s4.restorationUrgencyDays) || 30,
        restorationDoctorId: null,
      });
    }
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  async function next() {
    const ok = await persistStep(step);
    if (!ok) return;
    if (step < 4) setStep((step + 1) as Step);
  }

  async function finish() {
    const ok = await persistStep(4);
    if (!ok) return;
    setSaving(true);
    const r = await completeTreatment({ treatmentId });
    setSaving(false);
    if (isFailure(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`TC completado · ${r.data.followUpsCreated} controles agendados`);
    try { window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ped-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="ped-modal modal--full ped-onboarding endo-wizard">
        <header className="ped-modal__header">
          <div>
            <p className="ped-modal__breadcrumb">Endodoncia · diente {toothFdi}</p>
            <h2 id={titleId} className="ped-modal__title">Tratamiento de conductos · paso {step}/4</h2>
          </div>
          <button type="button" className="ped-modal__close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </header>

        <div className="ped-onboarding__stepper" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step}>
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className={`ped-onboarding__step ${step === s ? "is-active" : ""} ${step > s ? "is-done" : ""}`}>
              <span className="ped-onboarding__step-num">{step > s ? <Check size={12} aria-hidden /> : s}</span>
              <span className="ped-onboarding__step-label">
                {s === 1 ? "Acceso" : s === 2 ? "Instrumentación" : s === 3 ? "Irrigación" : "Obturación"}
              </span>
            </div>
          ))}
        </div>

        <div className="ped-modal__body ped-onboarding__body">
          {step === 1 && <Step1 value={s1} onChange={setS1} />}
          {step === 2 && <Step2 value={s2} onChange={setS2} />}
          {step === 3 && <Step3 value={s3} onChange={setS3} />}
          {step === 4 && <Step4 value={s4} onChange={setS4} />}
        </div>

        <footer className="ped-modal__footer ped-onboarding__footer">
          <button type="button" className="pedi-btn" onClick={onClose} disabled={saving}>Cancelar</button>
          {step > 1 && (
            <button type="button" className="pedi-btn" onClick={() => setStep((step - 1) as Step)} disabled={saving}>
              <ArrowLeft size={14} aria-hidden /> Atrás
            </button>
          )}
          {step < 4 ? (
            <button type="button" className="pedi-btn pedi-btn--brand" onClick={next} disabled={saving}>
              {saving ? "Guardando…" : "Siguiente"} <ArrowRight size={14} aria-hidden />
            </button>
          ) : (
            <button type="button" className="pedi-btn pedi-btn--brand" onClick={finish} disabled={saving}>
              {saving ? "Guardando…" : "Completar tratamiento"}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────

function Step1(props: { value: Step1State; onChange: (v: Step1State) => void }) {
  const { value: v, onChange } = props;
  return (
    <div className="pedi-form">
      <p className="pedi-form__hint">Paso 1: aislamiento absoluto y tipo de acceso al sistema canalicular.</p>
      <label className="pedi-checkbox">
        <input
          type="checkbox"
          checked={v.rubberDamPlaced}
          onChange={(e) => onChange({ ...v, rubberDamPlaced: e.target.checked })}
        />
        <span>Dique de hule colocado (aislamiento absoluto)</span>
      </label>
      <fieldset className="pedi-form__fieldset">
        <legend>Tipo de acceso</legend>
        <div className="pedi-form__pillgroup pedi-form__pillgroup--wrap">
          {ACCESS_TYPE.map((a) => (
            <button
              type="button"
              key={a}
              className={`pedi-pill ${v.accessType === a ? "is-active" : ""}`}
              onClick={() => onChange({ ...v, accessType: a })}
            >
              {ACCESS_LABEL[a] ?? a}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function Step2(props: { value: Step2State; onChange: (v: Step2State) => void }) {
  const { value: v, onChange } = props;
  const set = <K extends keyof Step2State>(k: K, val: Step2State[K]) => onChange({ ...v, [k]: val });
  return (
    <div className="pedi-form">
      <p className="pedi-form__hint">Paso 2: sistema de instrumentación, técnica y parámetros del motor.</p>
      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Sistema de instrumentación</span>
          <select value={v.instrumentationSystem} onChange={(e) => set("instrumentationSystem", e.target.value as typeof v.instrumentationSystem)}>
            {INSTRUMENTATION_SYSTEM.map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s] ?? s}</option>)}
          </select>
        </label>
        <label className="pedi-form__field">
          <span>Técnica</span>
          <select value={v.technique} onChange={(e) => set("technique", e.target.value as typeof v.technique)}>
            {INSTRUMENTATION_TECHNIQUE.map((t) => <option key={t} value={t}>{TECHNIQUE_LABEL[t] ?? t}</option>)}
          </select>
        </label>
      </div>
      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Marca del motor</span>
          <input type="text" maxLength={100} value={v.motorBrand} onChange={(e) => set("motorBrand", e.target.value)} placeholder="Dentsply, NSK, VDW, etc." />
        </label>
        <label className="pedi-form__field">
          <span>RPM</span>
          <input type="number" min={50} max={1500} value={v.rpmSetting} onChange={(e) => set("rpmSetting", e.target.value)} />
        </label>
      </div>
      <label className="pedi-form__field">
        <span>Configuración de torque</span>
        <input
          type="text" maxLength={100}
          value={v.torqueSettings}
          onChange={(e) => set("torqueSettings", e.target.value)}
          placeholder="Ej. SX 2.0 N/cm, S1 1.5 N/cm…"
        />
      </label>
    </div>
  );
}

function Step3(props: { value: Step3State; onChange: (v: Step3State) => void }) {
  const { value: v, onChange } = props;
  const set = <K extends keyof Step3State>(k: K, val: Step3State[K]) => onChange({ ...v, [k]: val });
  function setIrrigant(idx: number, patch: Partial<Irrigant>) {
    const next = v.irrigants.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    set("irrigants", next);
  }
  function addIrrigant() {
    if (v.irrigants.length >= 8) return;
    set("irrigants", [...v.irrigants, { substance: "EDTA", concentration: "17%", volumeMl: "5", order: v.irrigants.length + 1 }]);
  }
  function removeIrrigant(idx: number) {
    set("irrigants", v.irrigants.filter((_, i) => i !== idx).map((it, i) => ({ ...it, order: i + 1 })));
  }
  return (
    <div className="pedi-form">
      <p className="pedi-form__hint">Paso 3: irrigantes en orden, técnica de activación y minutos totales.</p>
      <fieldset className="pedi-form__fieldset">
        <legend>Irrigantes (en orden de uso)</legend>
        <div className="endo-wizard__irrigants">
          {v.irrigants.map((ir, i) => (
            <div key={i} className="endo-wizard__irrigant-row">
              <span className="endo-wizard__irrigant-order">#{ir.order}</span>
              <input
                type="text" placeholder="Sustancia" value={ir.substance}
                onChange={(e) => setIrrigant(i, { substance: e.target.value })}
              />
              <input
                type="text" placeholder="Concentración" value={ir.concentration}
                onChange={(e) => setIrrigant(i, { concentration: e.target.value })}
              />
              <input
                type="number" min={0} max={50} placeholder="ml" value={ir.volumeMl}
                onChange={(e) => setIrrigant(i, { volumeMl: e.target.value })}
              />
              <button type="button" className="pedi-btn pedi-btn--xs" onClick={() => removeIrrigant(i)} aria-label="Eliminar">
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="pedi-btn pedi-btn--xs" onClick={addIrrigant} disabled={v.irrigants.length >= 8}>
          <Plus size={12} aria-hidden /> Agregar irrigante
        </button>
      </fieldset>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Activación</span>
          <select value={v.irrigationActivation} onChange={(e) => set("irrigationActivation", e.target.value as typeof v.irrigationActivation)}>
            {IRRIGATION_ACTIVATION.map((a) => <option key={a} value={a}>{ACTIVATION_LABEL[a] ?? a}</option>)}
          </select>
        </label>
        <label className="pedi-form__field">
          <span>Minutos totales de irrigación</span>
          <input type="number" min={1} max={60} value={v.totalIrrigationMinutes} onChange={(e) => set("totalIrrigationMinutes", e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function Step4(props: { value: Step4State; onChange: (v: Step4State) => void }) {
  const { value: v, onChange } = props;
  const set = <K extends keyof Step4State>(k: K, val: Step4State[K]) => onChange({ ...v, [k]: val });
  return (
    <div className="pedi-form">
      <p className="pedi-form__hint">Paso 4: técnica de obturación + cemento + plan de restauración pos-TC.</p>
      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Técnica de obturación</span>
          <select value={v.obturationTechnique} onChange={(e) => set("obturationTechnique", e.target.value as typeof v.obturationTechnique)}>
            {OBTURATION_TECHNIQUE.map((t) => <option key={t} value={t}>{OBTURATION_LABEL[t] ?? t}</option>)}
          </select>
        </label>
        <label className="pedi-form__field">
          <span>Cemento (sealer)</span>
          <select value={v.sealer} onChange={(e) => set("sealer", e.target.value as typeof v.sealer)}>
            {SEALER_TYPE.map((s) => <option key={s} value={s}>{SEALER_LABEL[s] ?? s}</option>)}
          </select>
        </label>
      </div>
      <label className="pedi-form__field">
        <span>Cono maestro ISO</span>
        <input type="number" min={10} max={80} value={v.masterConePresetIso} onChange={(e) => set("masterConePresetIso", e.target.value)} />
      </label>
      <label className="pedi-form__field">
        <span>Plan de restauración pos-TC</span>
        <select value={v.postOpRestorationPlan} onChange={(e) => set("postOpRestorationPlan", e.target.value as typeof v.postOpRestorationPlan)}>
          {POST_OP_RESTORATION_TYPE.map((p) => <option key={p} value={p}>{RESTORATION_LABEL[p] ?? p}</option>)}
        </select>
      </label>
      <div className="pedi-form__row-checks">
        <label className="pedi-checkbox">
          <input type="checkbox" checked={v.requiresPost} onChange={(e) => set("requiresPost", e.target.checked)} />
          <span>Requiere poste intrarradicular</span>
        </label>
      </div>
      {v.requiresPost && (
        <label className="pedi-form__field">
          <span>Material del poste</span>
          <input type="text" maxLength={100} value={v.postMaterial} onChange={(e) => set("postMaterial", e.target.value)} placeholder="Fibra de vidrio, metal colado…" />
        </label>
      )}
      <label className="pedi-form__field">
        <span>Urgencia de restauración (días)</span>
        <input type="number" min={1} max={90} value={v.restorationUrgencyDays} onChange={(e) => set("restorationUrgencyDays", e.target.value)} />
        <small className="pedi-form__hint">Default 30 días. ≥ 30 dispara recordatorio WhatsApp a 21 días.</small>
      </label>
    </div>
  );
}
