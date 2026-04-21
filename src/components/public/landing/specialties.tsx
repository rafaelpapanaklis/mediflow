"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getSpecialtiesByCategory,
  type Specialty,
  type SpecialtyCategory,
} from "@/lib/specialty-data";
import { SpecIcon } from "./primitives/spec-icon";

const CATEGORIES: SpecialtyCategory[] = [
  "Dental",
  "Médicas",
  "Salud mental",
  "Bienestar",
];

const GROUP_DESC: Record<SpecialtyCategory, string> = {
  "Dental":       "Odontograma · periodontograma · radiografías con IA",
  "Médicas":      "Expediente clínico NOM-024 · recetario electrónico",
  "Salud mental": "Notas SOAP · escalas estandarizadas · teleconsulta",
  "Bienestar":    "Seguimiento visual · planes multi-sesión · antes/después",
};

const GROUP_COLOR: Record<SpecialtyCategory, string> = {
  "Dental":       "#a78bfa",
  "Médicas":      "#34d399",
  "Salud mental": "#38bdf8",
  "Bienestar":    "#fbbf24",
};

const MONO = "var(--font-jetbrains-mono, ui-monospace, monospace)";
const DISPLAY = "var(--font-sora, 'Sora', sans-serif)";

export function Specialties() {
  const [activeCategory, setActiveCategory] = useState<SpecialtyCategory>("Dental");
  const byCategory = getSpecialtiesByCategory();
  const items: Specialty[] = byCategory[activeCategory] ?? [];
  const color = GROUP_COLOR[activeCategory];
  const cols = Math.min(items.length, 4);

  return (
    <section
      id="specialties"
      style={{
        position: "relative",
        padding: "120px 48px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      {/* Section header */}
      <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 56px" }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: "var(--ld-brand-light, var(--brand-light))",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          17 especialidades
        </div>
        <h2
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Hecho para{" "}
          <span style={{ color: "var(--ld-brand-light, var(--brand-light))" }}>
            tu
          </span>{" "}
          especialidad,
          <br />
          no genérico.
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            marginTop: 20,
            lineHeight: 1.55,
          }}
        >
          Cada especialidad tiene expedientes, flujos y reportes propios. Desde
          odontograma interactivo hasta curvas de crecimiento pediátrico.
        </p>
      </div>

      {/* Category tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          marginBottom: 40,
          flexWrap: "wrap",
        }}
      >
        {CATEGORIES.map((cat) => {
          const isActive = cat === activeCategory;
          const c = GROUP_COLOR[cat];
          const count = byCategory[cat]?.length ?? 0;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: "10px 20px",
                borderRadius: 100,
                background: isActive ? `${c}22` : "rgba(255,255,255,0.03)",
                border: `1px solid ${isActive ? `${c}66` : "var(--ld-border, var(--border))"}`,
                color: isActive ? c : "var(--ld-fg-muted, var(--fg-muted))",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.25s",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {cat}
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 7px",
                  borderRadius: 100,
                  background: isActive ? `${c}33` : "rgba(255,255,255,0.05)",
                  fontFamily: MONO,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Group description */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 28,
          fontSize: 14,
          color: "var(--ld-fg-muted, var(--fg-muted))",
          fontFamily: MONO,
          letterSpacing: "0.04em",
        }}
      >
        {GROUP_DESC[activeCategory]}
      </div>

      {/* Cards grid */}
      <div
        className="spec-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 16,
          maxWidth: items.length <= 2 ? 720 : 1100,
          margin: "0 auto",
        }}
      >
        {items.map((s) => (
          <Link
            key={s.slug}
            href={`/${s.slug}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              className="spec-card"
              style={{
                padding: "24px 22px",
                borderRadius: 16,
                background: `linear-gradient(180deg, ${color}0a, transparent 70%), rgba(255,255,255,0.02)`,
                border: `1px solid ${color}22`,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                cursor: "pointer",
                transition: "all 0.25s",
                position: "relative",
                overflow: "hidden",
                minHeight: 160,
                height: "100%",
              }}
            >
              {/* Icon badge */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: `${color}18`,
                  border: `1px solid ${color}33`,
                  display: "grid",
                  placeItems: "center",
                  color,
                }}
              >
                <SpecIcon type={s.icon} size={22} />
              </div>

              {/* Name */}
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 600,
                  fontSize: 17,
                  letterSpacing: "-0.02em",
                  color: "var(--ld-fg, var(--fg))",
                  lineHeight: 1.2,
                }}
              >
                {s.name}
              </div>

              {/* Feature tag */}
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                  lineHeight: 1.4,
                  marginTop: "auto",
                  paddingTop: 12,
                  borderTop: "1px dashed rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ color }}>→</span>
                {s.tagline}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Bottom callout */}
      <div
        className="spec-callout"
        style={{
          marginTop: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 28px",
          borderRadius: 14,
          background:
            "linear-gradient(90deg, rgba(124,58,237,0.08), rgba(52,211,153,0.05))",
          border: "1px solid rgba(124,58,237,0.2)",
          maxWidth: 900,
          margin: "56px auto 0",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: 16,
              color: "var(--ld-fg, var(--fg))",
              marginBottom: 4,
            }}
          >
            ¿Tu clínica es multi-especialidad?
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ld-fg-muted, var(--fg-muted))",
            }}
          >
            Activa todas las especialidades que necesites, sin pagar extra por cada una.
          </div>
        </div>
        <Link
          href="#pricing"
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid var(--ld-border, var(--border))",
            color: "var(--ld-fg, var(--fg))",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Ver todas →
        </Link>
      </div>

      <style>{`
        @media (max-width: 768px) {
          #specialties .spec-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          #specialties .spec-callout {
            flex-direction: column;
            align-items: flex-start !important;
          }
        }
        @media (max-width: 480px) {
          #specialties .spec-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
