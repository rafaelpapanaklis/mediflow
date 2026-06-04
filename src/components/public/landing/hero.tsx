import Link from "next/link";
import { PlayCircle, Check } from "lucide-react";

const MONO = "var(--font-mono, ui-monospace, monospace)";

// Datos estáticos del mockup (sin estado: server component).
const AGENDA = [
  { time: "09:00", name: "María Ramírez", type: "Consulta", active: false },
  { time: "10:30", name: "Jorge López", type: "Limpieza", active: true },
  { time: "12:00", name: "Ana Pérez", type: "Control", active: false },
  { time: "14:00", name: "Carlos Silva", type: "Endodoncia", active: false },
] as const;

const KPIS = [
  { label: "Citas hoy", value: "12" },
  { label: "Ingresos", value: "$18,400" },
  { label: "Ocupación", value: "87%" },
] as const;

const TRUST = [
  "800+ clínicas",
  "CFDI 4.0 · NOM-024",
  "Soporte en español",
] as const;

export function Hero() {
  return (
    <section
      className="lp-section"
      aria-labelledby="hero-h"
      style={{ paddingTop: "clamp(48px,7vw,88px)" }}
    >
      <div className="lp-container">
        <div className="lp-hero-grid">
          {/* Columna izquierda: copy + CTAs */}
          <div className="lp-hero-copy">
            <p className="lp-pill lp-animate lp-d1">
              Hecho en México · CFDI 4.0 nativo
            </p>

            <h1 id="hero-h" className="lp-h1 lp-animate lp-d2">
              Toda tu clínica en{" "}
              <span className="lp-accent">una sola plataforma</span>.
            </h1>

            <p className="lp-lead lp-animate lp-d3">
              Deja de hacer malabares con Dentrix, WhatsApp, Excel y un
              facturador aparte. MediFlow es el sistema todo-en-uno para
              clínicas mexicanas.
            </p>

            <div className="lp-hero-cta lp-animate lp-d4">
              <div className="lp-hero-cta__row">
                <Link href="/signup" className="lp-btn lp-btn--primary lp-btn--lg">
                  Empieza gratis
                </Link>
                <Link href="/clinicas" className="lp-btn lp-btn--secondary lp-btn--lg">
                  <PlayCircle size={20} strokeWidth={1.75} aria-hidden="true" />
                  Ver demo
                </Link>
              </div>
              <span
                className="lp-mono"
                style={{ color: "var(--ld-fg-subtle)", fontSize: 12 }}
              >
                14 días · sin tarjeta
              </span>
            </div>

            <ul className="lp-hero-trust lp-animate lp-d5">
              {TRUST.map((item) => (
                <li key={item} className="lp-hero-trust__item">
                  <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Columna derecha: mockup del panel (decorativo) */}
          <figure className="lp-hero-figure lp-animate lp-d3" aria-hidden="true">
            <div className="lp-mockup lp-hero-mockup">
              <div className="lp-mockup__bar">
                <span className="lp-mockup__dot" style={{ background: "#ff5f57" }} />
                <span className="lp-mockup__dot" style={{ background: "#febc2e" }} />
                <span className="lp-mockup__dot" style={{ background: "#28c840" }} />
                <span className="lp-hero-mockup__url lp-mono">app.mediflow.mx</span>
              </div>

              <div className="lp-hero-mockup__body">
                <div className="lp-hero-mockup__head">
                  <span className="lp-hero-mockup__title">Agenda del día</span>
                  <span className="lp-hero-mockup__date lp-mono">lun 4 jun</span>
                </div>

                <div className="lp-hero-agenda">
                  {AGENDA.map((slot) => (
                    <div
                      key={slot.time}
                      className={
                        slot.active
                          ? "lp-hero-slot lp-hero-slot--active"
                          : "lp-hero-slot"
                      }
                    >
                      <span className="lp-hero-slot__time lp-mono">{slot.time}</span>
                      <span className="lp-hero-slot__name">{slot.name}</span>
                      <span className="lp-hero-slot__chip">{slot.type}</span>
                    </div>
                  ))}
                </div>

                <div className="lp-hero-kpis">
                  {KPIS.map((kpi) => (
                    <div key={kpi.label} className="lp-hero-kpi">
                      <span className="lp-hero-kpi__label lp-mono">{kpi.label}</span>
                      <span className="lp-hero-kpi__value">{kpi.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </figure>
        </div>
      </div>

      <style>{`
        .lp-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: clamp(32px, 5vw, 56px);
          align-items: center;
        }
        .lp-hero-copy > * { margin-block: 0; }
        .lp-hero-copy > * + * { margin-top: 22px; }

        .lp-hero-cta {
          display: flex;
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;
        }
        .lp-hero-cta__row {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
        }

        .lp-hero-trust {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 12px 22px;
        }
        .lp-hero-trust__item {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          color: var(--ld-fg-muted);
        }
        .lp-hero-trust__item svg { color: var(--ld-brand-strong); flex-shrink: 0; }

        /* ---- Mockup del panel ---- */
        .lp-hero-figure { margin: 0; min-width: 0; }
        .lp-hero-mockup { width: 100%; }
        .lp-hero-mockup__url {
          margin-left: auto;
          font-size: 12px;
          color: var(--ld-fg-subtle);
        }
        .lp-hero-mockup__body {
          padding: clamp(16px, 2.4vw, 24px);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .lp-hero-mockup__head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .lp-hero-mockup__title {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--ld-fg);
        }
        .lp-hero-mockup__date { font-size: 12px; color: var(--ld-fg-subtle); }

        .lp-hero-agenda { display: flex; flex-direction: column; gap: 8px; }
        .lp-hero-slot {
          display: grid;
          grid-template-columns: 52px 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 11px 13px;
          border-radius: 10px;
          background: var(--ld-surface-2);
          border: 1px solid var(--ld-border);
        }
        .lp-hero-slot--active {
          background: var(--ld-brand-weak);
          border-color: var(--ld-brand-weak-border);
        }
        .lp-hero-slot__time { font-size: 12px; color: var(--ld-fg-muted); }
        .lp-hero-slot__name {
          font-size: 13.5px;
          font-weight: 500;
          color: var(--ld-fg);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lp-hero-slot__chip {
          font-size: 11px;
          color: var(--ld-fg-muted);
          padding: 3px 10px;
          border-radius: 999px;
          background: var(--ld-surface);
          border: 1px solid var(--ld-border);
          white-space: nowrap;
        }
        .lp-hero-slot--active .lp-hero-slot__chip {
          color: var(--ld-brand-strong);
          border-color: var(--ld-brand-weak-border);
          background: var(--ld-surface);
        }

        .lp-hero-kpis {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          padding-top: 4px;
        }
        .lp-hero-kpi {
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding: 13px;
          border-radius: 10px;
          background: var(--ld-surface-2);
          border: 1px solid var(--ld-border);
        }
        .lp-hero-kpi__label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ld-fg-subtle);
        }
        .lp-hero-kpi__value {
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--ld-fg);
        }

        @media (max-width: 900px) {
          .lp-hero-grid { grid-template-columns: 1fr; }
          .lp-hero-figure { order: 2; }
        }
        @media (max-width: 420px) {
          .lp-hero-kpis { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
