"use client";

import { useState } from "react";
import type { Specialty } from "@/lib/specialty-data";

export function SpecFAQ({ spec }: { spec: Specialty }) {
  const [open, setOpen] = useState<number>(0);
  const accent = spec.accent;
  const roleLabel = spec.eyebrow.toLowerCase().replace("para ", "");
  return (
    <section style={{ padding: "100px 48px", maxWidth: 860, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div
          style={{
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            fontSize: 11,
            color: accent,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Preguntas frecuentes
        </div>
        <h2
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: 40,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Lo que los {roleLabel} más preguntan.
        </h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {spec.faqs.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div
              key={i}
              onClick={() => setOpen(isOpen ? -1 : i)}
              style={{
                padding: "20px 24px",
                borderRadius: 12,
                background: isOpen
                  ? "linear-gradient(180deg, rgba(124,58,237,0.1), rgba(124,58,237,0.02))"
                  : "rgba(255,255,255,0.02)",
                border: `1px solid ${
                  isOpen ? "rgba(124,58,237,0.3)" : "var(--ld-border, var(--border))"
                }`,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                    fontWeight: 500,
                    fontSize: 16,
                    color: "var(--ld-fg, var(--fg))",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {q}
                </div>
                <div
                  style={{
                    color: accent,
                    fontSize: 18,
                    transition: "transform 0.2s",
                    transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                  }}
                >
                  +
                </div>
              </div>
              {isOpen && (
                <div
                  style={{
                    marginTop: 14,
                    fontSize: 14,
                    color: "var(--ld-fg-muted, var(--fg-muted))",
                    lineHeight: 1.6,
                  }}
                >
                  {a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
