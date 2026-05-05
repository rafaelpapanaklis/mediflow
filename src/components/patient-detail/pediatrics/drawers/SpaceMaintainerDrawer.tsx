"use client";
// Pediatrics — drawer colocar mantenedor de espacio. Spec: §1.12, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { placeMaintainer, isFailure } from "@/app/actions/pediatrics";

const TYPES = [
  { k: "banda_ansa",  label: "Banda-Ansa" },
  { k: "corona_ansa", label: "Corona-Ansa" },
  { k: "nance",       label: "Nance" },
  { k: "arco_lingual",label: "Arco lingual" },
  { k: "distal_shoe", label: "Distal-Shoe" },
] as const;

export interface SpaceMaintainerDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  initialFdi?: number;
}

export function SpaceMaintainerDrawer(props: SpaceMaintainerDrawerProps) {
  const { open, onClose, patientId, initialFdi } = props;
  const [type, setType] = useState<typeof TYPES[number]["k"]>("banda_ansa");
  const [replacedToothFdi, setReplacedToothFdi] = useState<number>(initialFdi ?? 75);
  const [placedAt, setPlacedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [estimatedRemovalAt, setEstimatedRemovalAt] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType("banda_ansa");
      setReplacedToothFdi(initialFdi ?? 75);
      setPlacedAt(new Date().toISOString().slice(0, 10));
      setEstimatedRemovalAt("");
      setNotes("");
      setSaving(false);
    }
  }, [open, initialFdi]);

  async function submit() {
    setSaving(true);
    const result = await placeMaintainer({
      patientId,
      type,
      replacedToothFdi,
      placedAt: new Date(placedAt).toISOString(),
      estimatedRemovalAt: estimatedRemovalAt ? new Date(estimatedRemovalAt).toISOString() : null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Mantenedor colocado");
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Mantenedor de espacio"
      saving={saving}
      onSubmit={submit}
    >
      <label className="pedi-form__field">
        <span>Tipo</span>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          {TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}
        </select>
      </label>

      <label className="pedi-form__field">
        <span>Diente reemplazado (FDI)</span>
        <input
          type="number"
          inputMode="numeric"
          min={51} max={85}
          value={replacedToothFdi}
          onChange={(e) => setReplacedToothFdi(Number(e.target.value))}
        />
      </label>

      <label className="pedi-form__field">
        <span>Colocación</span>
        <input type="date" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} />
      </label>

      <label className="pedi-form__field">
        <span>Retiro estimado (opcional)</span>
        <input type="date" value={estimatedRemovalAt} onChange={(e) => setEstimatedRemovalAt(e.target.value)} />
      </label>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </CaptureDrawer>
  );
}
