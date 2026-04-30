"use client";
// Pediatrics — drawer wizard CAMBRA en 3 pasos. Spec: §1.14, §4.A.8

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { captureCambra, isFailure } from "@/app/actions/pediatrics";
import {
  CAMBRA_INDIC_OPTIONS,
  CAMBRA_PROT_OPTIONS,
  CAMBRA_RISK_OPTIONS,
  scoreCambra,
} from "@/lib/pediatrics/cambra";

export interface CambraDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
}

export function CambraDrawer(props: CambraDrawerProps) {
  const { open, onClose, patientId } = props;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [risk, setRisk] = useState<string[]>([]);
  const [prot, setProt] = useState<string[]>([]);
  const [indic, setIndic] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(1); setRisk([]); setProt([]); setIndic([]); setSaving(false);
    }
  }, [open]);

  const preview = useMemo(
    () => scoreCambra({ riskFactors: risk, protectiveFactors: prot, diseaseIndicators: indic }),
    [risk, prot, indic],
  );

  function toggle(arr: string[], setArr: (v: string[]) => void, key: string) {
    setArr(arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]);
  }

  async function submit() {
    setSaving(true);
    const result = await captureCambra({
      patientId,
      riskFactors: risk,
      protectiveFactors: prot,
      diseaseIndicators: indic,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`CAMBRA: ${result.data.category} (recall ${result.data.recallMonths} m)`);
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Evaluar riesgo cariogénico (CAMBRA)"
      subtitle={step === 3 ? "Paso 3 de 3 · revisión" : `Paso ${step} de 3`}
      width="lg"
      saving={saving}
      saveLabel={step === 3 ? "Guardar evaluación" : "Siguiente"}
      onSubmit={() => {
        if (step < 3) {
          setStep((step + 1) as 1 | 2 | 3);
        } else {
          submit();
        }
      }}
    >
      {step === 1 && (
        <FactorList
          legend="Factores de RIESGO"
          subtitle="Marca todos los presentes."
          options={CAMBRA_RISK_OPTIONS}
          selected={risk}
          onToggle={(k) => toggle(risk, setRisk, k)}
        />
      )}
      {step === 2 && (
        <FactorList
          legend="Factores PROTECTORES"
          subtitle="Marca los que el paciente sí tiene."
          options={CAMBRA_PROT_OPTIONS}
          selected={prot}
          onToggle={(k) => toggle(prot, setProt, k)}
        />
      )}
      {step === 3 && (
        <>
          <FactorList
            legend="INDICADORES de enfermedad"
            subtitle="Lesiones cavitarias, manchas blancas, restauraciones recientes."
            options={CAMBRA_INDIC_OPTIONS}
            selected={indic}
            onToggle={(k) => toggle(indic, setIndic, k)}
          />
          <div className="pedi-cambra-preview">
            <div className={`cambra-chip cambra-chip--${preview.category}`}>
              <span className="cambra-chip__dot" aria-hidden />
              {preview.category.charAt(0).toUpperCase() + preview.category.slice(1)}
            </div>
            <p>Recall sugerido: <strong>{preview.recallMonths} meses</strong></p>
            <p className="pedi-cambra-preview__rationale">{preview.rationale}</p>
          </div>
        </>
      )}
      {step > 1 && (
        <button type="button" className="pedi-btn pedi-cambra-back" onClick={() => setStep((step - 1) as 1 | 2 | 3)} disabled={saving}>
          Volver
        </button>
      )}
    </CaptureDrawer>
  );
}

function FactorList(props: {
  legend: string;
  subtitle: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <fieldset className="pedi-form__fieldset">
      <legend>{props.legend}</legend>
      <p className="pedi-form__hint">{props.subtitle}</p>
      <div className="pedi-form__checklist">
        {props.options.map((o) => {
          const checked = props.selected.includes(o.key);
          return (
            <label key={o.key} className={`pedi-checkbox ${checked ? "is-checked" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => props.onToggle(o.key)}
              />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
