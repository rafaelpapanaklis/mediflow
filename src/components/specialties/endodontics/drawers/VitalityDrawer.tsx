"use client";
// Endodontics — drawer registrar prueba de vitalidad. Spec §6.9

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { recordVitalityTest, isFailure } from "@/app/actions/endodontics";
import {
  VITALITY_TEST_TYPE,
  VITALITY_RESULT,
} from "@/lib/validation/endodontics";

const TEST_LABEL: Record<string, string> = {
  FRIO: "Frío", CALOR: "Calor", EPT: "EPT",
  PERCUSION_VERTICAL: "Percusión vertical",
  PERCUSION_HORIZONTAL: "Percusión horizontal",
  PALPACION_APICAL: "Palpación apical",
  MORDIDA_TOOTHSLOOTH: "Mordida (Tooth Slooth)",
};

const RESULT_LABEL: Record<string, string> = {
  POSITIVO: "Positivo (responde dentro de lo esperado)",
  NEGATIVO: "Negativo (sin respuesta o débil)",
  EXAGERADO: "Exagerado / persistente >30 s",
  DIFERIDO: "Diferido (respuesta tardía)",
  SIN_RESPUESTA: "Sin respuesta",
};

export interface VitalityDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  toothFdi: number;
}

export function VitalityDrawer(props: VitalityDrawerProps) {
  const { open, onClose, patientId, toothFdi } = props;
  const [testType, setTestType] = useState<typeof VITALITY_TEST_TYPE[number]>("FRIO");
  const [result, setResult] = useState<typeof VITALITY_RESULT[number]>("POSITIVO");
  const [intensity, setIntensity] = useState<string>("");
  const [controlsRaw, setControlsRaw] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTestType("FRIO");
      setResult("POSITIVO");
      setIntensity("");
      setControlsRaw("");
      setNotes("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    const controlTeeth = controlsRaw
      .split(/[,\s]+/)
      .map((t) => Number(t))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (controlTeeth.length === 0) {
      toast.error("Indica al menos un diente control (1-4 FDIs separados por coma)");
      return;
    }
    setSaving(true);
    const r = await recordVitalityTest({
      patientId,
      toothFdi,
      controlTeeth,
      testType,
      result,
      intensity: intensity ? Number(intensity) : null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(r)) { toast.error(r.error); return; }
    toast.success("Prueba registrada");
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Prueba de vitalidad · diente ${toothFdi}`}
      width="md"
      footer={
        <>
          <button type="button" className="pedi-btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Registrar prueba"}
          </button>
        </>
      }
    >
      <div className="pedi-form">
        <label className="pedi-form__field">
          <span>Tipo de prueba</span>
          <select value={testType} onChange={(e) => setTestType(e.target.value as typeof testType)}>
            {VITALITY_TEST_TYPE.map((t) => (
              <option key={t} value={t}>{TEST_LABEL[t] ?? t}</option>
            ))}
          </select>
        </label>

        <label className="pedi-form__field">
          <span>Dientes control (FDIs separados por coma)</span>
          <input
            type="text"
            value={controlsRaw}
            onChange={(e) => setControlsRaw(e.target.value)}
            placeholder="Ej. 35, 37"
          />
          <small className="pedi-form__hint">1 a 4 dientes adyacentes para comparar respuesta.</small>
        </label>

        <label className="pedi-form__field">
          <span>Resultado</span>
          <select value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
            {VITALITY_RESULT.map((r) => (
              <option key={r} value={r}>{RESULT_LABEL[r] ?? r}</option>
            ))}
          </select>
        </label>

        <label className="pedi-form__field">
          <span>Intensidad (0-10, opcional)</span>
          <input
            type="number"
            min={0}
            max={10}
            value={intensity}
            onChange={(e) => setIntensity(e.target.value)}
            placeholder="Solo para EPT u otros donde aplique"
          />
        </label>

        <label className="pedi-form__field">
          <span>Notas</span>
          <textarea
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
    </Drawer>
  );
}
