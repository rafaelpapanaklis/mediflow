"use client";
// Pediatrics — drawer registrar erupción de un diente. Spec: §1.9, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { recordEruption, isFailure } from "@/app/actions/pediatrics";
import { getRangeForFdi } from "@/lib/pediatrics/eruption-data";

export interface EruptionDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  initialFdi?: number | null;
}

export function EruptionDrawer(props: EruptionDrawerProps) {
  const { open, onClose, patientId, initialFdi } = props;
  const [fdiInput, setFdiInput] = useState<string>(initialFdi ? String(initialFdi) : "");
  const [observedAt, setObservedAt] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFdiInput(initialFdi ? String(initialFdi) : "");
      setObservedAt("");
      setNotes("");
      setSaving(false);
    }
  }, [open, initialFdi]);

  const fdiNumber = Number(fdiInput);
  const range = Number.isInteger(fdiNumber) ? getRangeForFdi(fdiNumber) : null;

  async function submit() {
    if (!range) { toast.error("FDI inválido"); return; }
    if (!observedAt) { toast.error("Indica la fecha observada"); return; }
    setSaving(true);
    const result = await recordEruption({
      patientId,
      toothFdi: fdiNumber,
      observedAt: new Date(observedAt).toISOString(),
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`Erupción registrada (${result.data.deviation === "within" ? "en rango" : result.data.deviation})`);
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Registrar erupción"
      subtitle="La desviación se calcula automáticamente según OMS"
      saving={saving}
      saveDisabled={!range || !observedAt}
      onSubmit={submit}
    >
      <label className="pedi-form__field">
        <span>Diente (FDI)</span>
        <input
          type="number"
          inputMode="numeric"
          min={11} max={85}
          value={fdiInput}
          onChange={(e) => setFdiInput(e.target.value)}
          placeholder="51"
        />
        {range ? (
          <small className="pedi-form__hint">
            Rango esperado: {range.minMonths}–{range.maxMonths} meses ({(range.minMonths / 12).toFixed(1)}–{(range.maxMonths / 12).toFixed(1)} años)
          </small>
        ) : fdiInput.length > 0 ? (
          <small className="pedi-form__hint pedi-form__hint--err">Diente FDI inválido</small>
        ) : null}
      </label>

      <label className="pedi-form__field">
        <span>Fecha observada</span>
        <input type="date" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />
      </label>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </CaptureDrawer>
  );
}
