"use client";

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

const TABS = [
  { id: "agenda", label: "Agenda" },
  { id: "pacientes", label: "Pacientes" },
  { id: "radiografias", label: "Radiografías" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const AGENDA = [
  { time: "09:00", name: "María Ramírez", type: "Consulta", active: false },
  { time: "10:30", name: "Jorge López", type: "Limpieza", active: true },
  { time: "12:00", name: "Ana Pérez", type: "Control", active: false },
  { time: "14:00", name: "Carlos Silva", type: "Revisión", active: false },
] as const;

const KPIS = [
  { label: "Citas hoy", value: "12" },
  { label: "Ingresos", value: "$18,400" },
  { label: "Ocupación", value: "87%" },
] as const;

const PATIENTS = [
  { initials: "MR", name: "María Ramírez", detail: "Blanqueamiento · sesión 2", next: "Hoy 10:30" },
  { initials: "JL", name: "Jorge López", detail: "Limpieza · control", next: "Mar 18 jun" },
  { initials: "AP", name: "Ana Pérez", detail: "Corona · seguimiento", next: "Jue 27 jun" },
] as const;

// Hallazgos del análisis con IA sobre la radiografía (posición en % sobre el visor).
const XRAY_FINDINGS = [
  { label: "Caries — superficie oclusal", severity: "alta", top: "26%", left: "14%", w: "20%", h: "26%" },
  { label: "Lesión periapical", severity: "alta", top: "52%", left: "63%", w: "22%", h: "30%" },
  { label: "Cálculo", severity: "media", top: "16%", left: "46%", w: "16%", h: "20%" },
] as const;

const TRUST = ["800+ clínicas", "CFDI 4.0 · NOM-024", "Soporte en español"] as const;

export function Hero() {
  const [active, setActive] = useState<TabId>("agenda");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(e: ReactKeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section className="lp-section lp-wire" aria-labelledby="hero-h" style={{ paddingTop: "clamp(48px,7vw,88px)", overflow: "hidden" }}>
      <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
        <div className="lp-hero-grid">
          {/* Columna izquierda: copy + CTAs */}
          <div className="lp-hero-copy">
            <p className="lp-pill lp-animate lp-d1">Hecho en México · CFDI 4.0 nativo</p>

            <h1 id="hero-h" className="lp-h1 lp-animate lp-d2">
              Toda tu clínica dental, en <span className="lp-accent">una sola plataforma</span>.
            </h1>

            <p className="lp-lead lp-animate lp-d3">
              Deja de hacer malabares con otros software, WhatsApp, Excel y un
              facturador aparte. MediFlow es el sistema todo-en-uno para clínicas
              dentales mexicanas.
            </p>

            <div className="lp-hero-cta lp-animate lp-d4">
              <div className="lp-hero-cta__row">
                <Link href="#precios" className="lp-btn lp-btn--primary lp-btn--lg">
                  Ver Precios
                </Link>
                <Link href="#precios" className="lp-btn lp-btn--secondary lp-btn--lg">
                  Ver Planes
                </Link>
              </div>
              <span className="lp-mono" style={{ color: "var(--ld-fg-subtle)", fontSize: 12 }}>
                Sin permanencia · cancela cuando quieras
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

          {/* Columna derecha: vista interactiva del panel */}
          <div className="lp-hero-figure lp-animate lp-d3">
            <div className="lp-mockup lp-hero-mockup">
              <div className="lp-mockup__bar" aria-hidden="true">
                <span className="lp-mockup__dot" style={{ background: "#ff5f57" }} />
                <span className="lp-mockup__dot" style={{ background: "#febc2e" }} />
                <span className="lp-mockup__dot" style={{ background: "#28c840" }} />
                <span className="lp-hero-mockup__url lp-mono">app.mediflow.mx</span>
              </div>

              <div className="lp-hero-mockup__body">
                {/* Tabs (patrón ARIA tabs con navegación por flechas) */}
                <div className="lp-hero-tabs" role="tablist" aria-label="Vista previa del panel">
                  {TABS.map((tab, i) => {
                    const selected = tab.id === active;
                    return (
                      <button
                        key={tab.id}
                        ref={(el) => { tabRefs.current[i] = el; }}
                        type="button"
                        role="tab"
                        id={`hero-tab-${tab.id}`}
                        aria-selected={selected}
                        aria-controls={`hero-panel-${tab.id}`}
                        tabIndex={selected ? 0 : -1}
                        className={selected ? "lp-hero-tab lp-hero-tab--active" : "lp-hero-tab"}
                        onClick={() => setActive(tab.id)}
                        onKeyDown={(e) => onTabKeyDown(e, i)}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Los 3 paneles se montan siempre; los inactivos van con hidden
                    (patrón APG) para que cada aria-controls apunte a un id real. */}
                <div
                  role="tabpanel"
                  id="hero-panel-agenda"
                  aria-labelledby="hero-tab-agenda"
                  hidden={active !== "agenda"}
                  tabIndex={0}
                  className="lp-hero-panel"
                >
                  <div className="lp-hero-agenda">
                    {AGENDA.map((slot) => (
                      <div key={slot.time} className={slot.active ? "lp-hero-slot lp-hero-slot--active" : "lp-hero-slot"}>
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

                <div
                  role="tabpanel"
                  id="hero-panel-pacientes"
                  aria-labelledby="hero-tab-pacientes"
                  hidden={active !== "pacientes"}
                  tabIndex={0}
                  className="lp-hero-panel"
                >
                  <div className="lp-hero-patients">
                    {PATIENTS.map((p, i) => (
                      <div key={p.name} className={i === 0 ? "lp-hero-patient lp-hero-patient--active" : "lp-hero-patient"}>
                        <span className="lp-hero-avatar" aria-hidden="true">{p.initials}</span>
                        <span className="lp-hero-patient__info">
                          <span className="lp-hero-patient__name">{p.name}</span>
                          <span className="lp-hero-patient__detail">{p.detail}</span>
                        </span>
                        <span className="lp-hero-patient__next">
                          <span className="lp-hero-patient__next-label lp-mono">Próxima</span>
                          <span className="lp-hero-patient__next-value">{p.next}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  role="tabpanel"
                  id="hero-panel-radiografias"
                  aria-labelledby="hero-tab-radiografias"
                  hidden={active !== "radiografias"}
                  tabIndex={0}
                  className="lp-hero-panel"
                >
                  <div className="lp-hero-xray-wrap">
                    <figure
                      className="lp-hero-xray"
                      role="img"
                      aria-label="Radiografía con análisis por IA: caries en superficie oclusal (severidad alta), lesión periapical (alta) y cálculo (media)."
                    >
                      <div className="lp-hero-xray__teeth" aria-hidden="true">
                        {Array.from({ length: 7 }).map((_, i) => (
                          <span key={i} className="lp-hero-tooth" />
                        ))}
                      </div>
                      {XRAY_FINDINGS.map((f) => (
                        <span
                          key={f.label}
                          className={`lp-hero-mark lp-hero-mark--${f.severity}`}
                          style={{ top: f.top, left: f.left, width: f.w, height: f.h }}
                          aria-hidden="true"
                        >
                          <span className="lp-hero-mark__tag">{f.label}</span>
                        </span>
                      ))}
                    </figure>
                    <div className="lp-hero-xray__legend" aria-hidden="true">
                      <span className="lp-hero-xray__ai">
                        <span className="lp-hero-xray__pulse" /> Detección con IA
                      </span>
                      <span className="lp-hero-xray__sev"><i className="lp-dot-alta" /> Alta</span>
                      <span className="lp-hero-xray__sev"><i className="lp-dot-media" /> Media</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .lp-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: clamp(32px, 5vw, 56px);
          align-items: center;
        }
        .lp-hero-copy > :global(*) { margin-block: 0; }
        .lp-hero-copy > :global(* + *) { margin-top: 22px; }

        .lp-hero-cta { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
        .lp-hero-cta__row { display: flex; flex-wrap: wrap; gap: 14px; }

        .lp-hero-trust { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 12px 22px; }
        .lp-hero-trust__item { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ld-fg-muted); }
        .lp-hero-trust__item :global(svg) { color: var(--ld-brand-strong); flex-shrink: 0; }

        .lp-hero-figure { margin: 0; min-width: 0; }
        .lp-hero-mockup { width: 100%; }
        .lp-hero-mockup__url { margin-left: auto; font-size: 12px; color: var(--ld-fg-subtle); }
        .lp-hero-mockup__body { padding: clamp(14px, 2.2vw, 22px); display: flex; flex-direction: column; gap: 16px; }

        /* Tabs */
        .lp-hero-tabs {
          display: inline-flex;
          gap: 4px;
          padding: 4px;
          border-radius: 8px;
          background: var(--ld-surface-2);
          border: 1px solid var(--ld-border);
          align-self: flex-start;
        }
        .lp-hero-tab {
          appearance: none;
          border: none;
          background: transparent;
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 13px;
          font-weight: 500;
          color: var(--ld-fg-muted);
          padding: 7px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.18s, color 0.18s, box-shadow 0.18s;
        }
        .lp-hero-tab--active {
          background: var(--ld-surface);
          color: var(--ld-brand-strong);
          box-shadow: var(--ld-shadow-sm);
        }
        .lp-hero-panel { min-height: 232px; display: flex; flex-direction: column; gap: 16px; }
        .lp-hero-panel[hidden] { display: none; }

        /* Agenda */
        .lp-hero-agenda { display: flex; flex-direction: column; gap: 8px; }
        .lp-hero-slot {
          display: grid; grid-template-columns: 52px 1fr auto; align-items: center; gap: 12px;
          padding: 11px 13px; border-radius: 8px; background: var(--ld-surface-2); border: 1px solid var(--ld-border);
        }
        .lp-hero-slot--active { background: var(--ld-brand-weak); border-color: var(--ld-brand-weak-border); }
        .lp-hero-slot__time { font-size: 12px; color: var(--ld-fg-muted); }
        .lp-hero-slot__name { font-size: 13.5px; font-weight: 500; color: var(--ld-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-hero-slot__chip { font-size: 11px; color: var(--ld-fg-muted); padding: 3px 10px; border-radius: 999px; background: var(--ld-surface); border: 1px solid var(--ld-border); white-space: nowrap; }
        .lp-hero-slot--active .lp-hero-slot__chip { color: var(--ld-brand-strong); border-color: var(--ld-brand-weak-border); }

        .lp-hero-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding-top: 4px; }
        .lp-hero-kpi { display: flex; flex-direction: column; gap: 5px; padding: 13px; border-radius: 8px; background: var(--ld-surface-2); border: 1px solid var(--ld-border); }
        .lp-hero-kpi__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ld-fg-subtle); }
        .lp-hero-kpi__value { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; color: var(--ld-fg); }

        /* Pacientes */
        .lp-hero-patients { display: flex; flex-direction: column; gap: 8px; }
        .lp-hero-patient {
          display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 8px; background: var(--ld-surface-2); border: 1px solid var(--ld-border);
        }
        .lp-hero-patient--active { background: var(--ld-brand-weak); border-color: var(--ld-brand-weak-border); }
        .lp-hero-avatar {
          width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
          font-size: 12px; font-weight: 600; color: var(--ld-brand);
          background: var(--ld-brand-weak); border: 1px solid var(--ld-brand-weak-border);
        }
        .lp-hero-patient__info { display: flex; flex-direction: column; min-width: 0; }
        .lp-hero-patient__name { font-size: 13.5px; font-weight: 600; color: var(--ld-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-hero-patient__detail { font-size: 12px; color: var(--ld-fg-muted); }
        .lp-hero-patient__next { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .lp-hero-patient__next-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ld-fg-subtle); }
        .lp-hero-patient__next-value { font-size: 12.5px; font-weight: 500; color: var(--ld-brand-strong); white-space: nowrap; }

        /* Radiografías + overlay IA */
        .lp-hero-xray-wrap { display: flex; flex-direction: column; gap: 12px; }
        .lp-hero-xray {
          position: relative; margin: 0; width: 100%; aspect-ratio: 16 / 9;
          border-radius: 8px; overflow: hidden; border: 1px solid var(--ld-border);
          background: radial-gradient(120% 120% at 50% 30%, #2c2c2c 0%, #161616 70%, #101010 100%);
        }
        .lp-hero-xray__teeth { position: absolute; inset: 18% 6% 14%; display: flex; gap: 4%; align-items: stretch; }
        .lp-hero-tooth {
          flex: 1; border-radius: 40% 40% 28% 28%;
          background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.14));
          box-shadow: inset 0 0 6px rgba(255,255,255,0.18);
        }
        .lp-hero-mark { position: absolute; border-radius: 7px; box-sizing: border-box; }
        .lp-hero-mark--alta { border: 2px solid #f87171; box-shadow: 0 0 0 3px rgba(239,68,68,0.18); }
        .lp-hero-mark--media { border: 2px solid #fbbf24; box-shadow: 0 0 0 3px rgba(245,158,11,0.18); }
        .lp-hero-mark__tag {
          position: absolute; top: -10px; left: -1px; transform: translateY(-100%);
          font-size: 10px; font-weight: 500; white-space: nowrap;
          padding: 3px 7px; border-radius: 6px; color: #fff; background: rgba(10,10,10,0.92);
          border: 1px solid rgba(255,255,255,0.14);
        }
        .lp-hero-mark--alta .lp-hero-mark__tag { box-shadow: -2px 0 0 #f87171 inset; }
        .lp-hero-mark--media .lp-hero-mark__tag { box-shadow: -2px 0 0 #fbbf24 inset; }
        .lp-hero-xray__legend { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; font-size: 12px; color: var(--ld-fg-muted); }
        .lp-hero-xray__ai { display: inline-flex; align-items: center; gap: 7px; color: var(--ld-brand-strong); font-weight: 500; }
        .lp-hero-xray__pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--ld-brand); box-shadow: 0 0 0 0 rgba(103,152,255,0.5); animation: lp-xray-pulse 1.8s ease-out infinite; }
        .lp-hero-xray__sev { display: inline-flex; align-items: center; gap: 6px; }
        .lp-hero-xray__sev :global(.lp-dot-alta),
        .lp-hero-xray__sev :global(.lp-dot-media) { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
        :global(.lp-dot-alta) { background: #ef4444; }
        :global(.lp-dot-media) { background: #f59e0b; }
        @keyframes lp-xray-pulse {
          0% { box-shadow: 0 0 0 0 rgba(103,152,255,0.5); }
          70% { box-shadow: 0 0 0 7px rgba(103,152,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(103,152,255,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-hero-xray__pulse { animation: none; }
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
