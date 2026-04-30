"use client";
// Pediatrics — drawer cuestionario médico inicial (form largo, 4 secciones). Spec: §1.13.1, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { createPediatricRecord, isFailure } from "@/app/actions/pediatrics";

const SPECIAL_CONDITIONS_OPTIONS = [
  { k: "TEA",        label: "TEA (espectro autista)" },
  { k: "TDAH",       label: "TDAH" },
  { k: "Down",       label: "Síndrome de Down" },
  { k: "Cardiopatia",label: "Cardiopatía" },
  { k: "Diabetes",   label: "Diabetes tipo 1" },
  { k: "Asma",       label: "Asma" },
  { k: "Otra",       label: "Otra (especificar en notas)" },
];

export interface PediatricRecordDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
}

export function PediatricRecordDrawer(props: PediatricRecordDrawerProps) {
  const { open, onClose, patientId } = props;
  const [birthWeightKg, setBirthWeightKg] = useState("");
  const [gestationWeeks, setGestationWeeks] = useState("");
  const [prematuro, setPrematuro] = useState(false);
  const [vaccinationStatus, setVaccinationStatus] = useState<"completo" | "incompleto" | "desconocido">("desconocido");
  const [feedingType, setFeedingType] = useState<"materna" | "mixta" | "formula" | "na">("na");
  const [conditions, setConditions] = useState<string[]>([]);
  const [meds, setMeds] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setBirthWeightKg(""); setGestationWeeks(""); setPrematuro(false);
      setVaccinationStatus("desconocido"); setFeedingType("na");
      setConditions([]); setMeds(""); setSaving(false);
    }
  }, [open]);

  async function submit() {
    setSaving(true);
    const medication = meds
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ name: line }));
    const result = await createPediatricRecord({
      patientId,
      birthWeightKg: birthWeightKg ? Number(birthWeightKg) : null,
      gestationWeeks: gestationWeeks ? Number(gestationWeeks) : null,
      prematuro,
      vaccinationStatus,
      feedingType,
      specialConditions: conditions,
      medication,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Cuestionario inicial guardado");
    onClose();
  }

  function toggleCondition(k: string) {
    setConditions((s) => s.includes(k) ? s.filter((x) => x !== k) : [...s, k]);
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Cuestionario médico inicial"
      subtitle="5 minutos · prenatal, vacunas, condiciones, medicación"
      width="lg"
      saving={saving}
      onSubmit={submit}
    >
      <details open className="pedi-form__section">
        <summary>Antecedentes prenatales</summary>
        <div className="pedi-form__grid">
          <label className="pedi-form__field">
            <span>Peso al nacer (kg)</span>
            <input type="number" step="0.01" min={0} max={10}
              value={birthWeightKg} onChange={(e) => setBirthWeightKg(e.target.value)} />
          </label>
          <label className="pedi-form__field">
            <span>Semanas gestación</span>
            <input type="number" min={20} max={45}
              value={gestationWeeks} onChange={(e) => setGestationWeeks(e.target.value)} />
          </label>
        </div>
        <label className="pedi-checkbox">
          <input type="checkbox" checked={prematuro} onChange={(e) => setPrematuro(e.target.checked)} />
          <span>Prematuro</span>
        </label>
      </details>

      <details className="pedi-form__section">
        <summary>Vacunación</summary>
        <fieldset className="pedi-form__fieldset">
          <legend>Estado</legend>
          <div className="pedi-form__pillgroup">
            {(["completo", "incompleto", "desconocido"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`pedi-pill ${vaccinationStatus === v ? "is-active" : ""}`}
                onClick={() => setVaccinationStatus(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>
      </details>

      <details className="pedi-form__section">
        <summary>Alimentación temprana</summary>
        <fieldset className="pedi-form__fieldset">
          <legend>Tipo</legend>
          <div className="pedi-form__pillgroup">
            {(["materna", "mixta", "formula", "na"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`pedi-pill ${feedingType === v ? "is-active" : ""}`}
                onClick={() => setFeedingType(v)}
              >
                {v === "na" ? "N/A" : v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>
      </details>

      <details className="pedi-form__section">
        <summary>Condiciones especiales y medicación</summary>
        <fieldset className="pedi-form__fieldset">
          <legend>Condiciones</legend>
          <div className="pedi-form__checklist">
            {SPECIAL_CONDITIONS_OPTIONS.map((o) => {
              const checked = conditions.includes(o.k);
              return (
                <label key={o.k} className={`pedi-checkbox ${checked ? "is-checked" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleCondition(o.k)} />
                  <span>{o.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="pedi-form__field">
          <span>Medicación actual (una por línea)</span>
          <textarea
            rows={3}
            value={meds}
            onChange={(e) => setMeds(e.target.value)}
            placeholder="Methylphenidate 10 mg c/24h&#10;Salbutamol PRN"
          />
        </label>
      </details>
    </CaptureDrawer>
  );
}
