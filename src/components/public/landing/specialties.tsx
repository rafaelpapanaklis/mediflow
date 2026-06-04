"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";
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

// Acento por categoría. `tint` (claro) se usa SOLO como fondo translúcido
// (`${tint}14`); `ink` es una versión oscurecida que SÍ pasa contraste AA
// sobre blanco (>=4.5:1) y se usa para icono / borde / flecha. El texto del
// tab activo usa siempre var(--ld-fg) (tinta), nunca el acento, para legibilidad.
const CAT: Record<SpecialtyCategory, { tint: string; ink: string }> = {
  "Dental":       { tint: "#a78bfa", ink: "#6d28d9" },
  "Médicas":      { tint: "#34d399", ink: "#0d8f60" },
  "Salud mental": { tint: "#38bdf8", ink: "#0369a1" },
  "Bienestar":    { tint: "#fbbf24", ink: "#b45309" },
};

export function Specialties() {
  const [active, setActive] = useState<SpecialtyCategory>("Dental");
  // Mapa estático: se calcula una sola vez (no depende del estado).
  const byCategory = useMemo(() => getSpecialtiesByCategory(), []);
  const items: Specialty[] = byCategory[active] ?? [];
  const { tint, ink } = CAT[active];

  return (
    <section className="lp-section" id="specialties" aria-labelledby="spec-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">17 especialidades</p>
          <h2 id="spec-h" className="lp-h2">
            Hecho para <span className="lp-accent">tu</span> especialidad, no
            genérico.
          </h2>
          <p className="lp-lead">
            Cada especialidad tiene expedientes, flujos y reportes propios — del
            odontograma a las curvas de crecimiento.
          </p>
        </div>

        {/* Filtros de categoría: botones de alternancia (no tabs ARIA). */}
        <div
          className="lp-spec-tabs"
          role="group"
          aria-label="Filtrar especialidades por categoría"
        >
          {CATEGORIES.map((cat) => {
            const isActive = cat === active;
            const c = CAT[cat];
            const count = byCategory[cat]?.length ?? 0;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActive(cat)}
                className="lp-chip lp-spec-tab"
                style={
                  isActive
                    ? {
                        background: `${c.tint}24`,
                        borderColor: c.ink,
                        color: "var(--ld-fg)",
                        fontWeight: 600,
                      }
                    : undefined
                }
              >
                <span
                  className="lp-spec-tab__dot"
                  aria-hidden="true"
                  style={{ background: isActive ? c.ink : "var(--ld-fg-subtle)" }}
                />
                {cat}
                <span className="lp-spec-tab__count lp-mono" aria-hidden="true">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Rejilla de tarjetas → cada una enlaza a /[slug] */}
        <ul className="lp-spec-grid" aria-label={`Especialidades de ${active}`}>
          {items.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/${s.slug}`}
                className="lp-card lp-card--hover lp-spec-card"
              >
                <span
                  className="lp-spec-card__icon"
                  aria-hidden="true"
                  style={{ background: `${tint}14`, color: ink }}
                >
                  <SpecIcon type={s.icon} size={22} />
                </span>
                <span className="lp-card__title lp-spec-card__name">
                  {s.name}
                </span>
                <span className="lp-spec-card__tag">
                  <ArrowUpRight
                    size={15}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    style={{ color: ink }}
                  />
                  {s.tagline}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Callout final */}
        <div className="lp-card lp-spec-callout">
          <span className="lp-spec-callout__icon" aria-hidden="true">
            <Layers size={22} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="lp-spec-callout__copy">
            <h3 className="lp-h3 lp-spec-callout__title">
              ¿Tu clínica es multi-especialidad?
            </h3>
            <p className="lp-spec-callout__desc">
              Activa todas las especialidades que necesites en un solo
              expediente. Sin pagar extra por cada una.
            </p>
          </div>
          <Link href="#pricing" className="lp-btn lp-btn--secondary">
            Ver planes
          </Link>
        </div>
      </div>

      <style>{`
        .lp-spec-tabs {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 40px;
          margin-bottom: 36px;
        }
        .lp-spec-tab {
          cursor: pointer;
          font-family: var(--font-sans, system-ui, sans-serif);
          transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
        }
        .lp-spec-tab__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .lp-spec-tab__count {
          font-size: 11px;
          padding: 1px 7px;
          border-radius: 100px;
          background: var(--ld-surface-2);
          color: var(--ld-fg-subtle);
        }
        .lp-spec-grid {
          display: grid;
          gap: 18px;
          grid-template-columns: repeat(4, 1fr);
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .lp-spec-card {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 22px;
          text-decoration: none;
          color: inherit;
        }
        .lp-spec-card__icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          margin-bottom: 16px;
        }
        .lp-spec-card__name { margin: 0; }
        .lp-spec-card__tag {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: auto;
          padding-top: 14px;
          font-size: 13px;
          line-height: 1.4;
          color: var(--ld-fg-muted);
        }
        .lp-spec-callout {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-top: 44px;
          padding: 26px 28px;
        }
        .lp-spec-callout__icon {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 46px;
          height: 46px;
          border-radius: 13px;
          background: var(--ld-brand-weak);
          border: 1px solid var(--ld-brand-weak-border);
          color: var(--ld-brand-strong);
        }
        .lp-spec-callout__copy { flex: 1 1 auto; min-width: 0; }
        .lp-spec-callout__title { margin: 0 0 4px; font-size: 18px; }
        .lp-spec-callout__desc {
          margin: 0;
          font-size: 14px;
          line-height: 1.55;
          color: var(--ld-fg-muted);
        }
        @media (max-width: 900px) {
          .lp-spec-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .lp-spec-callout { flex-direction: column; align-items: flex-start; text-align: left; }
        }
        @media (max-width: 560px) {
          .lp-spec-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
