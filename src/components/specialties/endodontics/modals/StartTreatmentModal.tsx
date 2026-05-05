"use client";
// Endodontics — modal mínimo para arrancar un EndodonticTreatment (tipo + multi-sesión)
// y entregar el treatmentId al TreatmentWizard. Spec §6.11

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { startTreatment, isFailure } from "@/app/actions/endodontics";
import { ENDO_TREATMENT_TYPE } from "@/lib/validation/endodontics";

const TREATMENT_LABEL: Record<string, string> = {
  TC_PRIMARIO: "Tratamiento de conductos primario",
  RETRATAMIENTO: "Retratamiento endodóntico",
  APICECTOMIA: "Apicectomía / cirugía apical",
  PULPOTOMIA_EMERGENCIA: "Pulpotomía de emergencia",
  TERAPIA_REGENERATIVA: "Terapia regenerativa",
};

export interface StartTreatmentModalProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  toothFdi: number;
  diagnosisId?: string | null;
  /** Se llama cuando el server action devolvió ok — el caller abre el wizard. */
  onCreated: (treatmentId: string) => void;
}

export function StartTreatmentModal(props: StartTreatmentModalProps) {
  const { open, onClose, patientId, toothFdi, diagnosisId, onCreated } = props;
  const titleId = useId();
  const [treatmentType, setTreatmentType] =
    useState<typeof ENDO_TREATMENT_TYPE[number]>("TC_PRIMARIO");
  const [isMultiSession, setIsMultiSession] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTreatmentType("TC_PRIMARIO");
      setIsMultiSession(false);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  async function submit() {
    setSaving(true);
    const r = await startTreatment({
      patientId,
      toothFdi,
      treatmentType,
      diagnosisId: diagnosisId ?? null,
      isMultiSession,
    });
    setSaving(false);
    if (isFailure(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Tratamiento creado — abriendo wizard");
    onCreated(r.data.id);
    onClose();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "min(480px, 92vw)",
          boxShadow: "0 24px 48px rgba(15,23,42,0.25)",
        }}
      >
        <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Iniciar tratamiento — diente {toothFdi}
        </h2>
        <p style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>
          Selecciona el tipo de tratamiento. El wizard de 4 pasos se abrirá a continuación.
        </p>

        <div className="pedi-form">
          <label className="pedi-form__field">
            <span>Tipo de tratamiento</span>
            <select
              value={treatmentType}
              onChange={(e) => setTreatmentType(e.target.value as typeof treatmentType)}
            >
              {ENDO_TREATMENT_TYPE.map((t) => (
                <option key={t} value={t}>
                  {TREATMENT_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </label>

          <label className="pedi-checkbox">
            <input
              type="checkbox"
              checked={isMultiSession}
              onChange={(e) => setIsMultiSession(e.target.checked)}
            />
            <span>Multi-sesión (con medicación intraconducto)</span>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="pedi-btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Creando…" : "Crear y abrir wizard"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
