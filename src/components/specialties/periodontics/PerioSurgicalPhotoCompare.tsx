"use client";
// Periodontics — comparativo pre/post de fotos quirúrgicas y SRP. SPEC §6, COMMIT 13.

import { useMemo, useState } from "react";
import {
  buildPerioComparePairs,
  parseAnnotations,
  type PerioPhotoComparePair,
  type PhotoAnnotation,
} from "@/lib/periodontics/photo-compare";
import { PERIO_PHOTO_LABEL } from "@/lib/periodontics/photo-types";
import type { PerioPhotoListItem } from "@/lib/periodontics/photo-load";

export interface PerioSurgicalPhotoCompareProps {
  photos: PerioPhotoListItem[];
  /** Anotaciones por photoId (Json del campo `annotations` de ClinicalPhoto). */
  annotationsByPhotoId?: Record<string, unknown>;
}

export function PerioSurgicalPhotoCompare(props: PerioSurgicalPhotoCompareProps) {
  const teethWithPhotos = useMemo(() => {
    const set = new Set<number>();
    for (const p of props.photos) {
      if (typeof p.toothFdi === "number") set.add(p.toothFdi);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [props.photos]);

  const [toothFilter, setToothFilter] = useState<number | "all">("all");

  const pairs = useMemo(
    () =>
      buildPerioComparePairs(
        props.photos,
        toothFilter === "all" ? undefined : { toothFdi: toothFilter },
      ),
    [props.photos, toothFilter],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {teethWithPhotos.length > 0 ? (
        <ToothFilter
          teeth={teethWithPhotos}
          value={toothFilter}
          onChange={setToothFilter}
        />
      ) : null}

      {pairs.length === 0 ? (
        <EmptyState />
      ) : (
        pairs.map((pair) => (
          <ComparePairCard
            key={`${pair.beforeKind}-${pair.afterKind}`}
            pair={pair}
            annotationsByPhotoId={props.annotationsByPhotoId}
          />
        ))
      )}
    </div>
  );
}

function ToothFilter(props: {
  teeth: number[];
  value: number | "all";
  onChange: (v: number | "all") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        padding: 8,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center" }}>
        Filtrar por diente:
      </span>
      <FilterChip active={props.value === "all"} onClick={() => props.onChange("all")}>
        Todos
      </FilterChip>
      {props.teeth.map((t) => (
        <FilterChip
          key={t}
          active={props.value === t}
          onClick={() => props.onChange(t)}
        >
          {t}
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        fontSize: 12,
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${props.active ? "var(--accent)" : "var(--border)"}`,
        background: props.active ? "var(--accent-soft)" : "transparent",
        color: props.active ? "var(--accent)" : "var(--text-2)",
        cursor: "pointer",
      }}
    >
      {props.children}
    </button>
  );
}

function ComparePairCard(props: {
  pair: PerioPhotoComparePair;
  annotationsByPhotoId?: Record<string, unknown>;
}) {
  const { pair } = props;
  return (
    <section
      style={{
        padding: 12,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-2)",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {pair.label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <PhotoSlot
          photo={pair.before}
          kind={pair.beforeKind}
          annotations={
            pair.before
              ? parseAnnotations(props.annotationsByPhotoId?.[pair.before.id])
              : []
          }
        />
        <PhotoSlot
          photo={pair.after}
          kind={pair.afterKind}
          annotations={
            pair.after
              ? parseAnnotations(props.annotationsByPhotoId?.[pair.after.id])
              : []
          }
        />
      </div>
    </section>
  );
}

function PhotoSlot(props: {
  photo: PerioPhotoListItem | null;
  kind: keyof typeof PERIO_PHOTO_LABEL;
  annotations: PhotoAnnotation[];
}) {
  const label = PERIO_PHOTO_LABEL[props.kind];
  if (!props.photo) {
    return (
      <div
        style={{
          aspectRatio: "1 / 1",
          border: "1px dashed var(--border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-3)",
          fontSize: 12,
          padding: 8,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase" }}>
          {label}
        </div>
        <div style={{ marginTop: 4 }}>Sin foto registrada</div>
      </div>
    );
  }
  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <img
        src={props.photo.blobUrl}
        alt={label}
        loading="lazy"
        style={{
          display: "block",
          width: "100%",
          aspectRatio: "1 / 1",
          objectFit: "cover",
        }}
      />
      {props.annotations.map((a, i) => (
        <AnnotationDot key={i} annotation={a} />
      ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "6px 8px",
          background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)",
          color: "white",
          fontSize: 11,
        }}
      >
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ opacity: 0.85 }}>
          {props.photo.capturedAt.toLocaleDateString("es-MX")}
          {props.photo.toothFdi ? ` · D${props.photo.toothFdi}` : ""}
        </div>
      </div>
    </div>
  );
}

function AnnotationDot(props: { annotation: PhotoAnnotation }) {
  const { annotation } = props;
  const color = annotation.color ?? "rgb(239, 68, 68)";
  return (
    <div
      style={{
        position: "absolute",
        left: `${annotation.x * 100}%`,
        top: `${annotation.y * 100}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        pointerEvents: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: color,
          border: "2px solid white",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
        }}
      />
      <span
        style={{
          marginTop: 2,
          padding: "2px 6px",
          background: "rgba(0,0,0,0.75)",
          color: "white",
          fontSize: 10,
          borderRadius: 4,
          maxWidth: 140,
          textAlign: "center",
        }}
      >
        {annotation.label}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        color: "var(--text-3)",
        fontSize: 13,
      }}
    >
      No hay fotos pre/post para comparar todavía. Sube fotos pre y post
      de raspado o cirugía desde la galería para activar esta vista.
    </div>
  );
}
