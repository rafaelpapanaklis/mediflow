"use client";
// Orthodontics — wizard de captura de set fotográfico (8 vistas + tipo). SPEC §6.7 + F9.5.
//
// Cableado real con /api/orthodontics/photos/upload (sharp + Supabase Storage).
// Por cada vista:
//   1. Cliente abre file picker (mobile capture=environment).
//   2. POST multipart {file, setId, view} al endpoint.
//   3. Recibe {fileId, path, thumbPath} y llama uploadPhotoToSet action.
//   4. Marca foto como uploaded en estado local.
// Si una foto falla, el banner permite reintentar sin bloquear el resto.

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, CheckCircle2, RefreshCw, Upload } from "lucide-react";
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

type ViewStatus =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "uploaded"; fileId: string; previewUrl?: string }
  | { state: "error"; message: string };

export function PhotoSetWizard(props: PhotoSetWizardProps) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);

  // Step 1 — meta del set
  const [setType, setSetType] = useState<OrthoPhotoSetType>(
    props.defaultType ?? props.availableTypes[0] ?? "T0",
  );
  const [capturedAt, setCapturedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // Step 2-9 — uploads
  const [setId, setSetId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<OrthoPhotoView, ViewStatus>>>({});

  const totalSteps = 1 + PHOTO_VIEW_ORDER.length;
  const currentView = step >= 2 ? PHOTO_VIEW_ORDER[step - 2] : null;

  const isMobile =
    typeof window !== "undefined" &&
    /android|iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadedCount = Object.values(statuses).filter(
    (s) => s?.state === "uploaded",
  ).length;
  const errorCount = Object.values(statuses).filter(
    (s) => s?.state === "error",
  ).length;

  const next = async () => {
    if (step === 1 && !setId) {
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
    if (errorCount > 0) {
      toast(
        `Set guardado con ${errorCount} foto(s) pendiente(s). Reintenta antes de cerrar.`,
        { icon: "⚠️" },
      );
    } else {
      toast.success(
        `Set ${setType} completo (${uploadedCount}/${PHOTO_VIEW_ORDER.length} fotos).`,
      );
    }
    if (setId) props.onCompleted?.(setId);
    props.onClose();
  };

  const uploadFile = async (view: OrthoPhotoView, file: File) => {
    if (!setId) return;
    setStatuses((s) => ({ ...s, [view]: { state: "uploading" } }));
    const localPreview = URL.createObjectURL(file);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("setId", setId);
      fd.append("view", view);

      const res = await fetch("/api/orthodontics/photos/upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string })?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { fileId?: string; path?: string };
      if (!data.fileId) throw new Error("Respuesta sin fileId");

      const linked = await uploadPhotoToSet({
        setId,
        view,
        fileId: data.fileId,
      });
      if (isFailure(linked)) {
        throw new Error(linked.error);
      }

      setStatuses((s) => ({
        ...s,
        [view]: {
          state: "uploaded",
          fileId: data.fileId!,
          previewUrl: localPreview,
        },
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error subiendo la foto";
      console.error("[PhotoSetWizard] upload failed:", e);
      setStatuses((s) => ({ ...s, [view]: { state: "error", message } }));
      toast.error(`Falló ${VIEW_LABELS[view]}: ${message}`);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentView) return;
    void uploadFile(currentView, file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!currentView) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(currentView, file);
  };

  const triggerPicker = () => {
    fileInputRef.current?.click();
  };

  const retry = (view: OrthoPhotoView) => {
    setStatuses((s) => ({ ...s, [view]: { state: "idle" } }));
    if (view === currentView) triggerPicker();
  };

  const status: ViewStatus = currentView
    ? statuses[currentView] ?? { state: "idle" }
    : { state: "idle" };

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
          {errorCount > 0 ? (
            <div
              role="status"
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(245,158,11,0.10)",
                border: "1px solid rgba(245,158,11,0.40)",
                borderRadius: 6,
                fontSize: 12,
                color: "#F59E0B",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{errorCount} foto(s) pendiente(s) — reintenta antes de cerrar.</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {uploadedCount}/{PHOTO_VIEW_ORDER.length} subidas
              </span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            {...(isMobile ? { capture: "environment" as const } : {})}
            onChange={onFileChange}
            style={{ display: "none" }}
          />

          <div
            onClick={status.state === "uploaded" ? undefined : triggerPicker}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            aria-label={
              status.state === "uploaded"
                ? `Foto ${VIEW_LABELS[currentView]} subida`
                : `Subir foto ${VIEW_LABELS[currentView]}`
            }
            style={{
              width: "100%",
              maxWidth: 480,
              aspectRatio: "1 / 1",
              background: previewBg(status),
              backgroundImage:
                status.state === "uploaded" && status.previewUrl
                  ? `url("${status.previewUrl}")`
                  : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: previewBorder(status),
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 8,
              fontSize: 13,
              color: previewColor(status),
              cursor: status.state === "uploaded" ? "default" : "pointer",
              position: "relative",
            }}
          >
            {status.state === "idle" ? (
              <>
                <Upload size={28} aria-hidden />
                <span>{VIEW_LABELS[currentView]}</span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {isMobile ? "Toca para abrir cámara" : "Click o arrastra una imagen aquí"}
                </span>
              </>
            ) : null}
            {status.state === "uploading" ? (
              <>
                <RefreshCw
                  size={28}
                  aria-hidden
                  style={{ animation: "spin 1s linear infinite" }}
                />
                <span>Subiendo…</span>
              </>
            ) : null}
            {status.state === "uploaded" ? (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "rgba(34,197,94,0.20)",
                  color: "#22C55E",
                  padding: "4px 8px",
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <CheckCircle2 size={12} aria-hidden /> Subida
              </span>
            ) : null}
            {status.state === "error" ? (
              <>
                <AlertCircle size={28} aria-hidden />
                <span>Error: {status.message}</span>
              </>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            {status.state === "uploaded" ? (
              <button type="button" onClick={triggerPicker} style={btnSecondary}>
                Reemplazar foto
              </button>
            ) : status.state === "error" ? (
              <button
                type="button"
                onClick={() => retry(currentView)}
                style={btnPrimary}
              >
                Reintentar
              </button>
            ) : (
              <button
                type="button"
                onClick={triggerPicker}
                disabled={status.state === "uploading"}
                style={btnPrimary}
              >
                {status.state === "uploading" ? "Subiendo…" : "Seleccionar foto"}
              </button>
            )}
          </div>

          <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)", textAlign: "center" }}>
            Server-side: sharp resize 2400×2400 jpeg q85 + thumbnail 300×300 webp.
          </p>
        </div>
      ) : null}
    </WizardShell>
  );
}

function previewBg(s: ViewStatus): string {
  if (s.state === "uploaded") return "var(--bg)";
  if (s.state === "error") return "rgba(239,68,68,0.08)";
  return "rgba(0,0,0,0.20)";
}
function previewBorder(s: ViewStatus): string {
  if (s.state === "uploaded") return "1px solid rgba(34,197,94,0.40)";
  if (s.state === "error") return "1px solid rgba(239,68,68,0.40)";
  return "1px dashed var(--border)";
}
function previewColor(s: ViewStatus): string {
  if (s.state === "uploaded") return "#22C55E";
  if (s.state === "error") return "#EF4444";
  return "var(--text-3)";
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
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--brand, #6366f1)",
  background: "var(--brand, #6366f1)",
  color: "white",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  fontSize: 12,
  cursor: "pointer",
};
