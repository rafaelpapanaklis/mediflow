"use client";
// Endodontics — drawer create/update de EndodonticDiagnosis. Spec §6.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { createDiagnosis, isFailure } from "@/app/actions/endodontics";
import {
  PULPAL_DIAGNOSIS,
  PERIAPICAL_DIAGNOSIS,
} from "@/lib/validation/endodontics";

const PULPAL_LABEL: Record<string, string> = {
  PULPA_NORMAL: "Pulpa normal",
  PULPITIS_REVERSIBLE: "Pulpitis reversible",
  PULPITIS_IRREVERSIBLE_SINTOMATICA: "Pulpitis irreversible sintomática",
  PULPITIS_IRREVERSIBLE_ASINTOMATICA: "Pulpitis irreversible asintomática",
  NECROSIS_PULPAR: "Necrosis pulpar",
  PREVIAMENTE_TRATADO: "Previamente tratado",
  PREVIAMENTE_INICIADO: "Previamente iniciado",
};

const PERIAPICAL_LABEL: Record<string, string> = {
  TEJIDOS_PERIAPICALES_NORMALES: "Tejidos periapicales normales",
  PERIODONTITIS_APICAL_SINTOMATICA: "Periodontitis apical sintomática",
  PERIODONTITIS_APICAL_ASINTOMATICA: "Periodontitis apical asintomática",
  ABSCESO_APICAL_AGUDO: "Absceso apical agudo",
  ABSCESO_APICAL_CRONICO: "Absceso apical crónico",
  OSTEITIS_CONDENSANTE: "Osteitis condensante",
};

export interface DiagnosisDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  toothFdi: number;
}

export function DiagnosisDrawer(props: DiagnosisDrawerProps) {
  const { open, onClose, patientId, toothFdi } = props;
  const [pulpal, setPulpal] = useState<typeof PULPAL_DIAGNOSIS[number]>("PULPA_NORMAL");
  const [periapical, setPeriapical] = useState<typeof PERIAPICAL_DIAGNOSIS[number]>("TEJIDOS_PERIAPICALES_NORMALES");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setPulpal("PULPA_NORMAL");
      setPeriapical("TEJIDOS_PERIAPICALES_NORMALES");
      setJustification("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    setSaving(true);
    const result = await createDiagnosis({
      patientId,
      toothFdi,
      pulpalDiagnosis: pulpal,
      periapicalDiagnosis: periapical,
      justification: justification.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Diagnóstico registrado");
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Diagnóstico AAE · diente ${toothFdi}`}
      subtitle="Captura pulpar + periapical"
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
            {saving ? "Guardando…" : "Guardar diagnóstico"}
          </button>
        </>
      }
    >
      <div className="pedi-form">
        <label className="pedi-form__field">
          <span>Diagnóstico pulpar</span>
          <select value={pulpal} onChange={(e) => setPulpal(e.target.value as typeof pulpal)}>
            {PULPAL_DIAGNOSIS.map((p) => (
              <option key={p} value={p}>{PULPAL_LABEL[p] ?? p}</option>
            ))}
          </select>
        </label>

        <label className="pedi-form__field">
          <span>Diagnóstico periapical</span>
          <select value={periapical} onChange={(e) => setPeriapical(e.target.value as typeof periapical)}>
            {PERIAPICAL_DIAGNOSIS.map((p) => (
              <option key={p} value={p}>{PERIAPICAL_LABEL[p] ?? p}</option>
            ))}
          </select>
        </label>

        <label className="pedi-form__field">
          <span>Justificación clínica (opcional)</span>
          <textarea
            rows={4}
            value={justification}
            maxLength={2000}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Ej. dolor pulsátil EVA 8/10, despertar nocturno, frío exagerado y persistente…"
          />
        </label>
      </div>
    </Drawer>
  );
}
