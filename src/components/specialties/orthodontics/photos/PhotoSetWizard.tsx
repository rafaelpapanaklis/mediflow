"use client";
// Orthodontics — wizard de captura de set fotográfico (8 vistas + tipo). SPEC §6.7.

import { useState } from "react";
import toast from "react-hot-toast";
import { WizardShell } from "../shared/WizardShell";
import {
  PHOTO_VIEW_ORDER,
  VIEW_LABELS,
  type OrthoPhotoView,
} from "@/lib/orthodontics/photo-set-helpers";
import { createPhotoSet, uploadPhotoToSet } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { OrthoPhotoSetType } from "@prisma/client";

export interface PhotoSetWizardProps {
  patientId: string;
  treatmentPlanId: string;
  /** Tipos disponibles según photo-set-helpers.availableSetTypes(...) */
  availableTypes: OrthoPhotoSetType[];
  defaultType?: OrthoPhotoSetType;
  monthInTreatment?: number;
  onClose: () => void;
  onCompleted?: (setId: string) => void;
}

export function PhotoSetWizard(props: PhotoSetWizardProps) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);

  // Step 1 — meta del set
  const [setType, setSetType] = useState<OrthoPhotoSetType>(
    props.defaultType ?? props.availableTypes[0] ?? "T0",
  );
  const [capturedAt, setCapturedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // Step 2-9 — uploads (fileId por vista)
  const [setId, setSetId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Partial<Record<OrthoPhotoView, string>>>({});

  const totalSteps = 1 + PHOTO_VIEW_ORDER.length; // meta + 8 fotos
  const currentView = step >= 2 ? PHOTO_VIEW_ORDER[step - 2] : null;

  const next = async () => {
    if (step === 1 && !setId) {
      // Primer "Siguiente" crea el set y prosigue.
      setPending(true);
      try {
        const result = await createPhotoSet({
          treatmentPlanId: props.treatmentPlanId,
          patientId: props.patientId,
          setType,
          capturedAt: new Date(capturedAt).toISOString(),
          monthInTreatment: props.monthInTreatment,
          notes: notes || null,
        });
        if (isFailure(result)) {
          toast.error(result.error);
          return;
        }
        setSetId(result.data.id);
        setStep(2);
      } finally {
        setPending(false);
      }
      return;
    }
    setStep((s) => Math.min(totalSteps, s + 1));
  };

  const prev = () => setStep((s) => Math.max(1, s - 1));

  const submit = () => {
    toast.success(
      `Set ${setType} guardado (${Object.keys(uploads).length}/${PHOTO_VIEW_ORDER.length} fotos)`,
    );
    if (setId) props.onCompleted?.(setId);
    props.onClose();
  };

  const handleUploadStub = async () => {
    if (!setId || !currentView) return;
    // Stub: en producción este botón abre el route handler /api/orthodontics/photos/upload
    // que devuelve el fileId del PatientFile creado tras procesar con sharp.
    // En MVP el wizard recibe el fileId vía URL hash o callback global.
    toast(
      "Stub: integración real con /api/orthodontics/photos/upload pendiente. Marca foto como subida para continuar.",
    );
    setUploads((u) => ({ ...u, [currentView]: `placeholder_${currentView}_${Date.now()}` }));
    // Llamar action si tenemos fileId real
    const fileId = `placeholder_${currentView}_${Date.now()}`;
    const result = await uploadPhotoToSet({
      setId,
      view: currentView,
      fileId,
    });
    if (isFailure(result)) {
      toast.error(result.error);
    }
  };

  return (
    <WizardShell
      title={`Sesión fotográfica${setId ? ` · ${setType}` : ""}`}
      subtitle={
        currentView ? `Vista: ${VIEW_LABELS[currentView]}` : "Configura el tipo de sesión"
      }
      step={step}
      totalSteps={totalSteps}
      onClose={props.onClose}
      onPrev={prev}
      onNext={next}
      onSubmit={submit}
      pending={pending}
    >
      {step === 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>Tipo de sesión</span>
            <select
              value={setType}
              onChange={(e) => setSetType(e.target.value as OrthoPhotoSetType)}
              style={inputStyle}
            >
              {props.availableTypes.map((t) => (
                <option key={t} value={t}>
                  {t === "CONTROL" ? "Control" : t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>Fecha</span>
            <input
              type="date"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>Notas (opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={textareaStyle}
            />
          </label>
        </div>
      ) : null}

      {currentView ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div
            aria-hidden
            style={{
              width: "100%",
              maxWidth: 480,
              aspectRatio: "1 / 1",
              background: uploads[currentView]
                ? "rgba(34,197,94,0.10)"
                : "rgba(0,0,0,0.20)",
              border: uploads[currentView]
                ? "1px solid rgba(34,197,94,0.40)"
                : "1px dashed var(--border)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: uploads[currentView] ? "#22C55E" : "var(--text-3)",
            }}
          >
            {uploads[currentView] ? "Foto recibida ✓" : VIEW_LABELS[currentView]}
          </div>
          <button
            type="button"
            onClick={handleUploadStub}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {uploads[currentView] ? "Reemplazar foto" : "Subir foto"}
          </button>
          <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)", textAlign: "center" }}>
            En producción este botón abre el route handler /api/orthodontics/photos/upload
            que procesa con sharp (2400×2400 jpeg + 300×300 webp thumb) y crea
            PatientFile category={"ORTHO_PHOTO_" + setType + " (o similar)"}.
          </p>
        </div>
      ) : null}
    </WizardShell>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "var(--bg)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", minHeight: 60 };
