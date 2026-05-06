"use client";
// Clinical-shared — uploader drag-drop para ClinicalPhoto.

import { useCallback, useRef, useState } from "react";
import { Camera, Upload } from "lucide-react";
import type {
  ClinicalModule,
  ClinicalPhotoStage,
  ClinicalPhotoType,
} from "@/lib/clinical-shared/photos/types";
import { uploadClinicalPhotoAction } from "@/app/actions/clinical-shared/photos";
import { isFailure } from "@/lib/clinical-shared/result";

export interface PhotoUploaderProps {
  patientId: string;
  module: ClinicalModule;
  defaultPhotoType: ClinicalPhotoType;
  defaultStage?: ClinicalPhotoStage;
  toothFdi?: number | null;
  onUploaded?: (id: string) => void;
}

export function PhotoUploader(props: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploading(true);
      try {
        for (const f of arr) {
          const buffer = await f.arrayBuffer();
          const res = await uploadClinicalPhotoAction({
            patientId: props.patientId,
            module: props.module,
            photoType: props.defaultPhotoType,
            stage: props.defaultStage ?? "pre",
            toothFdi: props.toothFdi ?? null,
            notes: null,
            contentType: f.type || "image/jpeg",
            fileName: f.name,
            size: f.size,
            body: buffer,
          });
          if (isFailure(res)) {
            setError(res.error);
            break;
          } else {
            props.onUploaded?.(res.data.id);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [props],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: 24,
        borderRadius: 10,
        border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
        background: dragOver ? "var(--surface-2)" : "var(--surface-1)",
        cursor: uploading ? "wait" : "pointer",
        color: "var(--text-2)",
        textAlign: "center",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <>
          <Upload size={20} aria-hidden />
          <span>Subiendo...</span>
        </>
      ) : (
        <>
          <Camera size={22} aria-hidden />
          <span style={{ fontSize: 14, color: "var(--text-1)" }}>
            Arrastra fotos o haz clic para seleccionar
          </span>
          <span style={{ fontSize: 12 }}>JPG / PNG / WEBP — máx 8MB</span>
        </>
      )}
      {error ? (
        <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>
      ) : null}
    </div>
  );
}
