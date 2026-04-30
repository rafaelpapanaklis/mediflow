"use client";
// Pediatrics — drawer registrar/editar hábito oral. Spec: §1.10, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { addHabit, isFailure } from "@/app/actions/pediatrics";

const HABIT_TYPES = [
  { key: "succion_digital",   label: "Succión digital" },
  { key: "chupon",            label: "Chupón" },
  { key: "biberon_nocturno",  label: "Biberón nocturno" },
  { key: "respiracion_bucal", label: "Respiración bucal" },
  { key: "bruxismo_nocturno", label: "Bruxismo nocturno" },
  { key: "onicofagia",        label: "Onicofagia" },
  { key: "deglucion_atipica", label: "Deglución atípica" },
] as const;

const FREQUENCIES = [
  { key: "continua",  label: "Continua" },
  { key: "nocturna",  label: "Nocturna" },
  { key: "ocasional", label: "Ocasional" },
  { key: "na",        label: "N/A" },
] as const;

export interface HabitDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
}

export function HabitDrawer(props: HabitDrawerProps) {
  const { open, onClose, patientId } = props;
  const [habitType, setHabitType] = useState<typeof HABIT_TYPES[number]["key"]>("succion_digital");
  const [frequency, setFrequency] = useState<typeof FREQUENCIES[number]["key"]>("continua");
  const [startedAt, setStartedAt] = useState("");
  const [intervention, setIntervention] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setHabitType("succion_digital");
      setFrequency("continua");
      setStartedAt("");
      setIntervention("");
      setNotes("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    if (!startedAt) {
      toast.error("Indica desde cuándo está presente el hábito.");
      return;
    }
    setSaving(true);
    const result = await addHabit({
      patientId,
      habitType,
      frequency,
      startedAt: new Date(startedAt).toISOString(),
      intervention: intervention.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Hábito guardado");
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Registrar hábito oral"
      saving={saving}
      saveDisabled={!startedAt}
      onSubmit={submit}
    >
      <label className="pedi-form__field">
        <span>Tipo de hábito</span>
        <select value={habitType} onChange={(e) => setHabitType(e.target.value as typeof habitType)}>
          {HABIT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>

      <label className="pedi-form__field">
        <span>Frecuencia</span>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
          {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>

      <label className="pedi-form__field">
        <span>Desde</span>
        <input
          type="date"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          required
        />
      </label>

      <label className="pedi-form__field">
        <span>Intervención (opcional)</span>
        <input
          type="text"
          maxLength={300}
          value={intervention}
          onChange={(e) => setIntervention(e.target.value)}
          placeholder="Dispositivo motivacional, miofuncional, etc."
        />
      </label>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </CaptureDrawer>
  );
}
