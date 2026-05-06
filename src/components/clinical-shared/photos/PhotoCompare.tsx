"use client";
// Clinical-shared — comparación side-by-side de dos fotos.

import { useMemo, useState } from "react";
import type { ClinicalPhotoDTO } from "@/lib/clinical-shared/photos/types";
import { STAGE_LABELS } from "@/lib/clinical-shared/photos/types";

export interface PhotoCompareProps {
  photos: ClinicalPhotoDTO[];
  initialLeftId?: string;
  initialRightId?: string;
}

export function PhotoCompare(props: PhotoCompareProps) {
  const sorted = useMemo(
    () =>
      [...props.photos].sort(
        (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      ),
    [props.photos],
  );
  const [leftId, setLeftId] = useState<string>(
    props.initialLeftId ?? sorted[0]?.id ?? "",
  );
  const [rightId, setRightId] = useState<string>(
    props.initialRightId ?? sorted[sorted.length - 1]?.id ?? "",
  );

  const left = sorted.find((p) => p.id === leftId);
  const right = sorted.find((p) => p.id === rightId);

  if (sorted.length < 2) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-2)",
          fontSize: 13,
        }}
      >
        Se necesitan al menos 2 fotos para comparar.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <ComparePane
          label="Lado A"
          photo={left}
          all={sorted}
          onChange={setLeftId}
        />
        <ComparePane
          label="Lado B"
          photo={right}
          all={sorted}
          onChange={setRightId}
        />
      </div>
    </div>
  );
}

function ComparePane(props: {
  label: string;
  photo: ClinicalPhotoDTO | undefined;
  all: ClinicalPhotoDTO[];
  onChange: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 12, color: "var(--text-1)" }}>{props.label}</strong>
        <select
          value={props.photo?.id ?? ""}
          onChange={(e) => props.onChange(e.target.value)}
          style={{
            background: "var(--surface-2)",
            color: "var(--text-1)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
            padding: "2px 6px",
          }}
        >
          {props.all.map((p) => (
            <option key={p.id} value={p.id}>
              {new Date(p.capturedAt).toLocaleDateString("es-MX")} ·{" "}
              {STAGE_LABELS[p.stage]}
            </option>
          ))}
        </select>
      </div>
      {props.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.photo.blobUrl}
          alt={props.photo.notes ?? props.label}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            objectFit: "cover",
            borderRadius: 6,
          }}
        />
      ) : (
        <div
          style={{
            aspectRatio: "1 / 1",
            background: "var(--surface-2)",
            borderRadius: 6,
          }}
        />
      )}
    </div>
  );
}
