"use client";
// Pediatrics — drawer pulpotomía/pulpectomía pediátrica. Spec: §1.12, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { recordEndoTreatment, isFailure } from "@/app/actions/pediatrics";

const TREATMENT_TYPES = [
  { k: "pulpotomia",                label: "Pulpotomía" },
  { k: "pulpectomia",               label: "Pulpectomía" },
  { k: "recubrimiento_indirecto",   label: "Recubrimiento indirecto" },
  { k: "recubrimiento_directo",     label: "Recubrimiento directo" },
] as const;

const MATERIALS = [
  { k: "formocresol",      label: "Formocresol" },
  { k: "mta",              label: "MTA" },
  { k: "sulfato_ferrico",  label: "Sulfato férrico" },
  { k: "hidroxido_calcio", label: "Hidróxido de calcio" },
  { k: "otro",             label: "Otro" },
] as const;

export interface EndodonticDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  initialFdi?: number | null;
}

export function EndodonticDrawer(props: EndodonticDrawerProps) {
  const { open, onClose, patientId, initialFdi } = props;
  const [toothFdi, setToothFdi] = useState<number>(initialFdi ?? 75);
  const [treatmentType, setTreatmentType] = useState<typeof TREATMENT_TYPES[number]["k"]>("pulpotomia");
  const [material, setMaterial] = useState<typeof MATERIALS[number]["k"]>("mta");
  const [performedAt, setPerformedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [residualVitality, setResidualVitality] = useState("");
  const [postOpSymptoms, setPostOpSymptoms] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setToothFdi(initialFdi ?? 75);
      setTreatmentType("pulpotomia");
      setMaterial("mta");
      setPerformedAt(new Date().toISOString().slice(0, 10));
      setResidualVitality(""); setPostOpSymptoms(""); setNotes("");
      setSaving(false);
    }
  }, [open, initialFdi]);

  async function submit() {
    setSaving(true);
    const result = await recordEndoTreatment({
      patientId,
      toothFdi,
      treatmentType,
      material,
      performedAt: new Date(performedAt).toISOString(),
      residualVitality: residualVitality.trim() || null,
      postOpSymptoms: postOpSymptoms.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Tratamiento registrado");
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Pulpotomía / Pulpectomía"
      width="lg"
      saving={saving}
      onSubmit={submit}
    >
      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Diente (FDI)</span>
          <input
            type="number"
            inputMode="numeric"
            value={toothFdi}
            onChange={(e) => setToothFdi(Number(e.target.value))}
            min={11} max={85}
          />
        </label>
        <label className="pedi-form__field">
          <span>Fecha</span>
          <input type="date" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
        </label>
      </div>

      <label className="pedi-form__field">
        <span>Tipo</span>
        <select value={treatmentType} onChange={(e) => setTreatmentType(e.target.value as typeof treatmentType)}>
          {TREATMENT_TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}
        </select>
      </label>

      <label className="pedi-form__field">
        <span>Material</span>
        <select value={material} onChange={(e) => setMaterial(e.target.value as typeof material)}>
          {MATERIALS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
        </select>
      </label>

      <label className="pedi-form__field">
        <span>Vitalidad residual (opcional)</span>
        <input
          type="text"
          maxLength={120}
          value={residualVitality}
          onChange={(e) => setResidualVitality(e.target.value)}
          placeholder="Conservada, parcial, ninguna"
        />
      </label>

      <label className="pedi-form__field">
        <span>Síntomas postoperatorios (opcional)</span>
        <input
          type="text"
          maxLength={300}
          value={postOpSymptoms}
          onChange={(e) => setPostOpSymptoms(e.target.value)}
        />
      </label>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </CaptureDrawer>
  );
}
