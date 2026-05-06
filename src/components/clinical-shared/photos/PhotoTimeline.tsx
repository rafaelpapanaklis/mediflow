"use client";
// Clinical-shared — timeline horizontal de fotos por stage.

import type { ClinicalPhotoDTO } from "@/lib/clinical-shared/photos/types";
import { STAGE_LABELS } from "@/lib/clinical-shared/photos/types";
import type { ClinicalPhotoStage } from "@prisma/client";

const STAGE_ORDER: ClinicalPhotoStage[] = ["pre", "during", "post", "control"];

export interface PhotoTimelineProps {
  photos: ClinicalPhotoDTO[];
  onSelect?: (photoId: string) => void;
}

export function PhotoTimeline(props: PhotoTimelineProps) {
  const grouped: Record<ClinicalPhotoStage, ClinicalPhotoDTO[]> = {
    pre: [],
    during: [],
    post: [],
    control: [],
  };
  for (const p of props.photos) grouped[p.stage].push(p);
  for (const k of STAGE_ORDER) {
    grouped[k].sort(
      (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        overflowX: "auto",
        paddingBottom: 8,
      }}
    >
      {STAGE_ORDER.map((stage) => (
        <div
          key={stage}
          style={{
            minWidth: 180,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <strong style={{ fontSize: 12, color: "var(--text-1)" }}>
            {STAGE_LABELS[stage]} ({grouped[stage].length})
          </strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {grouped[stage].length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-2)" }}>—</div>
            ) : (
              grouped[stage].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => props.onSelect?.(p.id)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 4,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    color: "var(--text-1)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailUrl ?? p.blobUrl}
                    alt={p.notes ?? STAGE_LABELS[p.stage]}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: 4,
                    }}
                  />
                  <span style={{ fontSize: 10, color: "var(--text-2)" }}>
                    {new Date(p.capturedAt).toLocaleDateString("es-MX")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
