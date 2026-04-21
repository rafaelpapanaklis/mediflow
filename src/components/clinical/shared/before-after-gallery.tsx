"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface GalleryImage {
  id: string;
  url: string;
  date: string;
  label: string;
  intensity?: number;
}

interface BeforeAfterGalleryProps {
  images: GalleryImage[];
  sessionLabel?: string;
  improvement?: number;
  tags?: string[];
}

export function BeforeAfterGallery({
  images,
  sessionLabel,
  improvement,
  tags,
}: BeforeAfterGalleryProps) {
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const main = images.slice(0, 2);
  const rest = images.slice(2);

  return (
    <>
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-1)",
            }}
          >
            {sessionLabel || "Comparativa"}
          </div>
          {improvement !== undefined && (
            <span
              className="badge-new"
              style={{
                background: "#34d39914",
                color: "#34d399",
                border: "1px solid #34d39966",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              +{improvement}% mejora
            </span>
          )}
        </div>

        {tags && tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {tags.map((t, i) => (
              <span key={i} className="tag-new">
                {t}
              </span>
            ))}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {main.map((img) => (
            <div
              key={img.id}
              onClick={() => setSelected(img)}
              style={{ cursor: "pointer" }}
            >
              <div
                style={{
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  aspectRatio: "1/1",
                  background: "var(--bg-elev)",
                }}
              >
                <img
                  src={img.url}
                  alt={img.label}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500 }}>
                  {img.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: "ui-monospace, monospace",
                    color: "var(--text-2)",
                  }}
                >
                  {img.date}
                </div>
              </div>
            </div>
          ))}
        </div>

        {rest.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              marginTop: 12,
              paddingBottom: 4,
            }}
          >
            {rest.map((img) => (
              <div
                key={img.id}
                onClick={() => setSelected(img)}
                style={{ flexShrink: 0, cursor: "pointer" }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 6,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                  }}
                >
                  <img
                    src={img.url}
                    alt={img.label}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    fontFamily: "ui-monospace, monospace",
                    color: "var(--text-2)",
                    textAlign: "center",
                  }}
                >
                  {img.date}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <button
            onClick={() => setSelected(null)}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 8,
              cursor: "pointer",
              color: "var(--text-1)",
            }}
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh" }}
          >
            <img
              src={selected.url}
              alt={selected.label}
              style={{
                maxWidth: "100%",
                maxHeight: "85vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
            />
            <div
              style={{
                marginTop: 8,
                color: "#fff",
                textAlign: "center",
                fontSize: 12,
              }}
            >
              {selected.label} ·{" "}
              <span style={{ fontFamily: "ui-monospace, monospace", color: "rgba(255,255,255,0.7)" }}>
                {selected.date}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
