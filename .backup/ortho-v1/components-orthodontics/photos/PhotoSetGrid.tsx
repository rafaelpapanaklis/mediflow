"use client";
// Orthodontics — grid de sets fotográficos agrupados por tipo. SPEC §6.7.

import { Camera } from "lucide-react";
import type { OrthoPhotoSetWithFiles } from "@/lib/types/orthodontics";
import { PHOTO_VIEW_ORDER, VIEW_TO_COLUMN, VIEW_LABELS } from "@/lib/orthodontics/photo-set-helpers";

export interface PhotoSetGridProps {
  sets: OrthoPhotoSetWithFiles[];
  resolveUrl: (fileId: string) => string;
  onAddSet?: () => void;
  onComparePair?: () => void;
}

export function PhotoSetGrid(props: PhotoSetGridProps) {
  const grouped = {
    T0: props.sets.filter((s) => s.setType === "T0"),
    T1: props.sets.filter((s) => s.setType === "T1"),
    T2: props.sets.filter((s) => s.setType === "T2"),
    CONTROL: props.sets.filter((s) => s.setType === "CONTROL"),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
          Series fotográficas ({props.sets.length})
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          {props.onComparePair && grouped.T0.length > 0 ? (
            <button
              type="button"
              onClick={props.onComparePair}
              style={btnSecondary}
            >
              Comparar T0 vs T2
            </button>
          ) : null}
          {props.onAddSet ? (
            <button type="button" onClick={props.onAddSet} style={btnPrimary}>
              <Camera size={12} aria-hidden /> Nueva sesión
            </button>
          ) : null}
        </div>
      </header>

      {props.sets.length === 0 ? (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            color: "var(--text-3)",
            background: "var(--bg-elev)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Aún no hay sesiones fotográficas. Captura el set T0 para empezar el registro visual.
        </div>
      ) : (
        (["T0", "T1", "T2", "CONTROL"] as const).map((type) => {
          const list = grouped[type];
          if (list.length === 0) return null;
          return (
            <section key={type}>
              <h4
                style={{
                  margin: "0 0 8px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  color: "var(--text-2)",
                }}
              >
                {type === "CONTROL" ? "Controles" : type} ({list.length})
              </h4>
              {list.map((set) => (
                <div
                  key={set.id}
                  style={{
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "var(--text-3)",
                      marginBottom: 6,
                    }}
                  >
                    <span>
                      {new Date(set.capturedAt).toLocaleDateString("es-MX")}
                      {set.monthInTreatment != null ? ` · Mes ${set.monthInTreatment}` : ""}
                    </span>
                    <span>
                      {PHOTO_VIEW_ORDER.filter(
                        (v) =>
                          set[VIEW_TO_COLUMN[v] as keyof OrthoPhotoSetWithFiles] != null,
                      ).length}
                      /8 vistas
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 4,
                    }}
                  >
                    {PHOTO_VIEW_ORDER.map((view) => {
                      const col = VIEW_TO_COLUMN[view] as keyof OrthoPhotoSetWithFiles;
                      const file = set[col] as { id: string; url?: string | null } | null;
                      return (
                        <div
                          key={view}
                          title={VIEW_LABELS[view]}
                          style={{
                            aspectRatio: "1 / 1",
                            background: file ? "var(--bg)" : "rgba(0,0,0,0.20)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            color: "var(--text-3)",
                            overflow: "hidden",
                            backgroundImage:
                              file?.id && props.resolveUrl(file.id)
                                ? `url("${props.resolveUrl(file.id)}")`
                                : undefined,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                        >
                          {!file ? "—" : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 12px",
  borderRadius: 4,
  border: "1px solid var(--brand, #6366f1)",
  background: "var(--brand, #6366f1)",
  color: "white",
  fontSize: 11,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  fontSize: 11,
  cursor: "pointer",
};
