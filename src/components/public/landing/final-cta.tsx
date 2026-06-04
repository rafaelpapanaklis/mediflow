import Link from "next/link";

const TRUST = ["Migración incluida", "Soporte en español", "CFDI 4.0"];

export function FinalCTA() {
  return (
    <section className="lp-section" aria-labelledby="cta-h">
      <div className="lp-container">
        <div
          className="lp-card lp-cta-panel"
          style={{
            background: "var(--ld-brand-weak)",
            borderColor: "var(--ld-brand-weak-border)",
            borderRadius: "var(--lp-radius-lg, 22px)",
            textAlign: "center",
            maxWidth: 880,
            margin: "0 auto",
          }}
        >
          <h2 id="cta-h" className="lp-h2">
            ¿Listo para ver MediFlow en tu clínica?
          </h2>
          <p className="lp-lead" style={{ margin: "0 auto" }}>
            Empieza gratis hoy. 14 días, sin tarjeta. Cancela cuando quieras.
          </p>

          <div className="lp-cta-actions">
            <Link href="/signup" className="lp-btn lp-btn--primary lp-btn--lg">
              Empieza gratis
            </Link>
            <Link href="/clinicas" className="lp-btn lp-btn--secondary lp-btn--lg">
              Ver demo
            </Link>
          </div>

          <ul className="lp-cta-trust lp-mono" aria-label="Beneficios incluidos">
            {TRUST.map((item, i) => (
              <li key={item} className="lp-cta-trust__item">
                {i > 0 && (
                  <span className="lp-cta-trust__sep" aria-hidden="true">
                    ·
                  </span>
                )}
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style>{`
        .lp-cta-panel {
          padding: clamp(2.5rem, 6vw, 4rem);
        }
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
        .lp-cta-trust__item {
          display: inline-flex;
          align-items: center;
          gap: 0.625rem;
        }
        .lp-cta-trust__sep {
          color: var(--ld-fg-subtle);
        }
      `}</style>
    </section>
  );
}
