"use client";
// EndodonticProcedurePhotoTimeline — fotos cronológicas agrupadas por
// sesión y fase (acceso → conductometría → preparación → obturación →
// control). Anotación opcional de conducto (MV, ML, MB2, D, …) sobre
// cada thumbnail. Click → PhotoLightbox compartido.
//
// Spec: cierre del módulo endo. Reusa ClinicalPhotoDTO de main y los
// componentes canónicos.

import { useMemo, useState } from "react";
import { Calendar, Lightbulb } from "lucide-react";
import type { ClinicalPhotoDTO, PhotoAnnotation } from "@/lib/clinical-shared/photos/types";
import { PhotoLightbox } from "@/components/clinical-shared/photos/PhotoLightbox";
import {
  ENDO_CANAL_LABELS,
  PHASE_LABEL,
  extractCanalLabel,
  groupPhotosBySession,
  type EndoCanalLabel,
  type ProcedurePhoto,
} from "@/lib/endodontics/procedure-timeline/grouping";

export interface EndodonticProcedurePhotoTimelineProps {
  toothFdi: number;
  photos: ClinicalPhotoDTO[];
  /** Si está set, los thumbnails muestran un botón para anotar el conducto. */
  onAnnotateCanal?: (photoId: string, canal: EndoCanalLabel | null) => void | Promise<void>;
  emptyHint?: string;
}

export function EndodonticProcedurePhotoTimeline(
  props: EndodonticProcedurePhotoTimelineProps,
) {
  const procedurePhotos: ProcedurePhoto[] = useMemo(
    () =>
      props.photos.map((p) => ({
        id: p.id,
        photoType: p.photoType,
        stage: p.stage,
        blobUrl: p.blobUrl,
        thumbnailUrl: p.thumbnailUrl,
        capturedAt: p.capturedAt,
        toothFdi: p.toothFdi,
        notes: p.notes,
        canalLabel: extractCanalLabel(p.annotations as PhotoAnnotation[] | null | undefined),
      })),
    [props.photos],
  );

  const groups = useMemo(() => groupPhotosBySession(procedurePhotos), [procedurePhotos]);
  const flat = useMemo(() => groups.flatMap((g) => g.phases.flatMap((p) => p.photos)), [groups]);

  const flatDtoIndex = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [flat]);

  const flatDtos: ClinicalPhotoDTO[] = useMemo(
    () => flat.map((f) => props.photos.find((p) => p.id === f.id)!).filter(Boolean),
    [flat, props.photos],
  );

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (flat.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-2)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
          background: "var(--surface-1)",
          fontSize: 13,
        }}
      >
        {props.emptyHint ?? `Sin fotos del procedimiento para la pieza ${props.toothFdi}.`}
      </div>
    );
  }

  return (
    <>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {groups.map((g, i) => (
          <li
            key={g.sessionKey}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 12,
              background: "var(--surface-1)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-1)",
                fontWeight: 600,
              }}
            >
              <Calendar size={14} />
              <span>
                Sesión {i + 1} ·{" "}
                {g.sessionDate.toLocaleDateString("es-MX", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <span style={{ marginLeft: "auto", color: "var(--text-2)", fontWeight: 400 }}>
                {g.totalPhotos} foto{g.totalPhotos === 1 ? "" : "s"}
              </span>
            </header>

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
              {g.phases.map((p) => (
                <PhaseRow
                  key={p.phase}
                  phaseLabel={PHASE_LABEL[p.phase]}
                  photos={p.photos}
                  onClick={(photoId) => {
                    const idx = flatDtoIndex.get(photoId);
                    if (idx !== undefined) setLightboxIndex(idx);
                  }}
                  onAnnotateCanal={props.onAnnotateCanal}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>

      {lightboxIndex !== null ? (
        <PhotoLightbox
          photos={flatDtos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}
    </>
  );
}

function PhaseRow(props: {
  phaseLabel: string;
  photos: ProcedurePhoto[];
  onClick: (photoId: string) => void;
  onAnnotateCanal?: (photoId: string, canal: EndoCanalLabel | null) => void | Promise<void>;
}) {
  return (
    <>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          color: "var(--text-2)",
          fontWeight: 600,
          alignSelf: "start",
          paddingTop: 4,
          minWidth: 110,
        }}
      >
        {props.phaseLabel}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {props.photos.length === 0 ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              fontStyle: "italic",
              alignSelf: "center",
            }}
          >
            Sin fotos en esta fase
          </span>
        ) : (
          props.photos.map((p) => (
            <PhotoTile
              key={p.id}
              photo={p}
              onClick={() => props.onClick(p.id)}
              onAnnotateCanal={props.onAnnotateCanal}
            />
          ))
        )}
      </div>
    </>
  );
}

function PhotoTile(props: {
  photo: ProcedurePhoto;
  onClick: () => void;
  onAnnotateCanal?: (photoId: string, canal: EndoCanalLabel | null) => void | Promise<void>;
}) {
  const [annotating, setAnnotating] = useState(false);
  const thumb = props.photo.thumbnailUrl ?? props.photo.blobUrl;
  return (
    <div
      style={{
        position: "relative",
        width: 110,
        height: 110,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <button
        type="button"
        onClick={props.onClick}
        aria-label={`Abrir foto ${props.photo.photoType}`}
        style={{
          all: "unset",
          width: "100%",
          height: "100%",
          cursor: "pointer",
          display: "block",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb}
          alt={props.photo.notes ?? props.photo.photoType}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </button>
      {props.photo.canalLabel ? (
        <div
          aria-label={`Conducto ${props.photo.canalLabel}`}
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            background: "rgba(37, 99, 235, 0.92)",
            color: "#fff",
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 700,
          }}
        >
          {props.photo.canalLabel}
        </div>
      ) : null}
      {props.onAnnotateCanal ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAnnotating((v) => !v);
          }}
          aria-label="Anotar conducto"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: 4,
            cursor: "pointer",
          }}
        >
          <Lightbulb size={12} />
        </button>
      ) : null}
      {annotating && props.onAnnotateCanal ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: 6,
            alignContent: "center",
            justifyContent: "center",
          }}
        >
          {ENDO_CANAL_LABELS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={async () => {
                await props.onAnnotateCanal?.(props.photo.id, c);
                setAnnotating(false);
              }}
              style={{
                background: "var(--accent, #2563eb)",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                fontSize: 10,
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={async () => {
              await props.onAnnotateCanal?.(props.photo.id, null);
              setAnnotating(false);
            }}
            style={{
              background: "var(--surface-2)",
              color: "var(--text-1)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 10,
              padding: "2px 6px",
              cursor: "pointer",
            }}
          >
            Quitar
          </button>
        </div>
      ) : null}
    </div>
  );
}
