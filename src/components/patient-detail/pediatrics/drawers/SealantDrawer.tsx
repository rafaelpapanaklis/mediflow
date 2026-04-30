"use client";
// Pediatrics — drawer colocar sellante. Spec: §1.12, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { placeSealant, isFailure } from "@/app/actions/pediatrics";

export interface SealantDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  initialFdi?: number | null;
}

const MOLARS_PERMANENT = [16, 26, 36, 46, 17, 27, 37, 47] as const;

export function SealantDrawer(props: SealantDrawerProps) {
  const { open, onClose, patientId, initialFdi } = props;
  const [toothFdi, setToothFdi] = useState<number>(initialFdi ?? 16);
  const [material, setMaterial] = useState<"resina_fotocurada" | "ionomero">("resina_fotocurada");
  const [placedAt, setPlacedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setToothFdi(initialFdi ?? 16);
      setMaterial("resina_fotocurada");
      setPlacedAt(new Date().toISOString().slice(0, 10));
      setNotes("");
      setSaving(false);
    }
  }, [open, initialFdi]);

  async function submit() {
    setSaving(true);
    const result = await placeSealant({
      patientId,
      toothFdi,
      material,
      placedAt: new Date(placedAt).toISOString(),
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Sellante colocado");
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Colocar sellante"
      saving={saving}
      onSubmit={submit}
    >
      <label className="pedi-form__field">
        <span>Diente</span>
        <select value={toothFdi} onChange={(e) => setToothFdi(Number(e.target.value))}>
          {MOLARS_PERMANENT.map((fdi) => <option key={fdi} value={fdi}>{fdi}</option>)}
        </select>
        <small className="pedi-form__hint">Solo molares permanentes para esta vista. Para otros dientes usa "Sellante" desde el odontograma.</small>
      </label>

      <fieldset className="pedi-form__fieldset">
        <legend>Material</legend>
        <div className="pedi-form__pillgroup">
          {[
            { k: "resina_fotocurada" as const, label: "Resina fotocurada" },
            { k: "ionomero"          as const, label: "Ionómero" },
          ].map((m) => (
            <button
              key={m.k}
              type="button"
              className={`pedi-pill ${material === m.k ? "is-active" : ""}`}
              onClick={() => setMaterial(m.k)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="pedi-form__field">
        <span>Fecha de colocación</span>
        <input type="date" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} />
      </label>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </CaptureDrawer>
  );
}
