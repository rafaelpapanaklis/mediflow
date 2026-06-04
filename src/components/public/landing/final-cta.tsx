import Link from "next/link";

const TRUST = ["Migración incluida", "Soporte en español", "CFDI 4.0 · NOM-024"];

export function FinalCTA() {
  return (
    <section className="lp-section lp-wire" aria-labelledby="cta-h">
      <div className="lp-container">
        <div className="lp-card lp-cta-panel">
          <h2 id="cta-h" className="lp-h2">
            Lleva toda tu clínica dental a un solo lugar.
          </h2>
          <p className="lp-lead lp-cta-panel__lead">
            Crea tu cuenta, elige tu plan y migra tus datos. Sin permanencia:
            cancela cuando quieras.
          </p>

          <div className="lp-cta-actions">
            <Link href="/signup" className="lp-btn lp-btn--lg lp-btn--primary">
              Crear cuenta
            </Link>
            <Link href="#precios" className="lp-btn lp-btn--lg lp-btn--secondary">
              Ver planes
            </Link>
          </div>

          <ul className="lp-cta-trust lp-mono" aria-label="Incluido en todos los planes">
            {TRUST.map((item, i) => (
              <li key={item} className="lp-cta-trust__item">
                {i > 0 && (
                  <span className="lp-cta-trust__sep" aria-hidden="true">·</span>
                )}
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style>{`
        .lp-cta-panel {
          max-width: 820px;
          margin: 0 auto;
          text-align: center;
          padding: clamp(2.5rem, 6vw, 4rem);
        }
        .lp-cta-panel__lead { margin: 18px auto 0; max-width: 560px; }
        .lp-cta-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.875rem;
          margin-top: 2rem;
        }
        .lp-cta-trust {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 0.5rem 0.625rem;
          margin: 1.75rem 0 0;
          padding: 0;
          list-style: none;
          font-size: 12px;
          color: var(--ld-fg-subtle);
        }
        .lp-cta-trust__item { display: inline-flex; align-items: center; gap: 0.625rem; }
        .lp-cta-trust__sep { color: var(--ld-fg-subtle); }
      `}</style>
    </section>
  );
}
