"use client";
// Pediatrics — timeline de fotos de erupción agrupadas por edad del
// paciente al momento de captura. Cada foto puede tener anotaciones
// con coordenadas relativas (eg. "diente 51 erupcionando").

import { useMemo, useState } from "react";
import { Camera, ChevronLeft, ChevronRight } from "lucide-react";
import { calculateAge } from "@/lib/pediatrics/age";
import type {
  ClinicalPhotoDTO,
  PhotoAnnotation,
} from "@/lib/clinical-shared/photos/types";

export interface PediatricsEruptionPhotoTimelineProps {
  patientDob: Date | string;
  /** Solo fotos con photoType in {oral_general, eruption_check}. */
  photos: ClinicalPhotoDTO[];
}

interface AgeGroup {
  bucketLabel: string;
  bucketKey: string;
  ageDecimalAvg: number;
  photos: Array<ClinicalPhotoDTO & { ageAtCaptureLabel: string }>;
}

export function PediatricsEruptionPhotoTimeline(
  props: PediatricsEruptionPhotoTimelineProps,
) {
  const dob = useMemo(
    () => (props.patientDob instanceof Date ? props.patientDob : new Date(props.patientDob)),
    [props.patientDob],
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const eruptionPhotos = useMemo(
    () =>
      props.photos
        .filter(
          (p) => p.photoType === "eruption_check" || p.photoType === "oral_general",
        )
        .sort(
          (a, b) =>
            new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
        ),
    [props.photos],
  );

  const groups = useMemo<AgeGroup[]>(() => {
    if (!eruptionPhotos.length) return [];
    const map = new Map<string, AgeGroup>();
    for (const p of eruptionPhotos) {
      const ageAtCapture = calculateAge(dob, new Date(p.capturedAt));
      const bucketKey = bucketForAge(ageAtCapture.years, ageAtCapture.months);
      const bucketLabel = bucketLabelFor(bucketKey);
      const photoEnriched = { ...p, ageAtCaptureLabel: ageAtCapture.formatted };
      let g = map.get(bucketKey);
      if (!g) {
        g = {
          bucketKey,
          bucketLabel,
          ageDecimalAvg: ageAtCapture.decimal,
          photos: [],
        };
        map.set(bucketKey, g);
      }
      g.photos.push(photoEnriched);
    }
    return Array.from(map.values()).sort((a, b) => a.ageDecimalAvg - b.ageDecimalAvg);
  }, [eruptionPhotos, dob]);

  if (groups.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-2)",
          fontSize: 13,
        }}
      >
        Sin fotos de erupción registradas todavía.
      </div>
    );
  }

  const flat = groups.flatMap((g) => g.photos);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Camera size={16} aria-hidden style={{ color: "var(--text-2)" }} />
        <h3 style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>
          Línea de tiempo de erupción
        </h3>
      </header>

      <div
        style={{
          display: "flex",
          gap: 14,
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {groups.map((g) => (
          <div
            key={g.bucketKey}
            style={{
              minWidth: 200,
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 12, color: "var(--text-1)" }}>
              {g.bucketLabel} ({g.photos.length})
            </strong>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
              }}
            >
              {g.photos.map((p) => {
                const flatIdx = flat.findIndex((x) => x.id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenIndex(flatIdx)}
                    aria-label={`Foto de erupción a ${p.ageAtCaptureLabel}`}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: 0,
                      cursor: "pointer",
                      overflow: "hidden",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.thumbnailUrl ?? p.blobUrl}
                      alt={p.notes ?? "Erupción"}
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    <span
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "var(--text-2)",
                        padding: "2px 4px",
                      }}
                    >
                      {p.ageAtCaptureLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {openIndex !== null ? (
        <ErruptionLightbox
          photos={flat}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
        />
      ) : null}
    </section>
  );
}

function ErruptionLightbox(props: {
  photos: Array<ClinicalPhotoDTO & { ageAtCaptureLabel: string }>;
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const photo = props.photos[props.index];
  if (!photo) return null;
  const total = props.photos.length;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={props.onClose}
    >
      <header
        style={{
          color: "#fff",
          padding: "10px 16px",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          {props.index + 1} / {total} · {photo.ageAtCaptureLabel}
          {photo.toothFdi != null ? ` · diente ${photo.toothFdi}` : ""}
        </span>
        <button
          type="button"
          onClick={props.onClose}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff",
            borderRadius: 4,
            padding: "2px 10px",
            cursor: "pointer",
          }}
        >
          Cerrar
        </button>
      </header>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 12,
        }}
      >
        {props.index > 0 ? (
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => props.onNavigate(props.index - 1)}
            style={navBtn}
          >
            <ChevronLeft size={28} aria-hidden />
          </button>
        ) : (
          <div style={{ width: 48 }} />
        )}

        <div style={{ position: "relative", maxWidth: "80vw", maxHeight: "76vh" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.blobUrl}
            alt={photo.notes ?? `Erupción a ${photo.ageAtCaptureLabel}`}
            style={{
              maxWidth: "80vw",
              maxHeight: "76vh",
              objectFit: "contain",
              borderRadius: 6,
            }}
          />
          {photo.annotations?.map((a: PhotoAnnotation, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                transform: "translate(-50%, -50%)",
                background: a.color ?? "var(--accent)",
                color: "#fff",
                fontSize: 11,
                padding: "3px 7px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {a.label}
            </div>
          ))}
        </div>

        {props.index < total - 1 ? (
          <button
            type="button"
            aria-label="Siguiente"
            onClick={() => props.onNavigate(props.index + 1)}
            style={navBtn}
          >
            <ChevronRight size={28} aria-hidden />
          </button>
        ) : (
          <div style={{ width: 48 }} />
        )}
      </div>
      {photo.notes ? (
        <footer
          style={{
            color: "#fff",
            opacity: 0.85,
            textAlign: "center",
            fontSize: 13,
            padding: "8px 16px 18px",
          }}
        >
          {photo.notes}
        </footer>
      ) : null}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 24,
  background: "rgba(255,255,255,0.1)",
  border: "none",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * Agrupa por bucket de edad. Buckets pequeños (cada 6m) hasta los 6
 * años (período crítico de erupción mixta), después anuales.
 */
function bucketForAge(years: number, months: number): string {
  if (years < 6) {
    const half = months >= 6 ? "h2" : "h1";
    return `y${years}-${half}`;
  }
  return `y${years}-h0`;
}

function bucketLabelFor(bucketKey: string): string {
  const m = bucketKey.match(/^y(\d+)-(h0|h1|h2)$/);
  if (!m) return bucketKey;
  const y = parseInt(m[1] ?? "0", 10);
  const h = m[2];
  if (h === "h0") return `${y} años`;
  if (h === "h1") return `${y} a 0–5 m`;
  return `${y} a 6–11 m`;
}
