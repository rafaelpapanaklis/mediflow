import Link from "next/link";

const TRUST = ["Migración incluida", "Soporte en español", "CFDI 4.0 · NOM-024"];

export function FinalCTA() {
  return (
    <section className="lp-section lp-band-violet" aria-labelledby="cta-h">
      <div className="lp-container" style={{ textAlign: "center", maxWidth: 820 }}>
        <h2 id="cta-h" className="lp-h2">
          Lleva toda tu clínica a un solo lugar.
        </h2>
        <p className="lp-lead lp-on-violet-muted" style={{ margin: "18px auto 0", maxWidth: 560 }}>
          Crea tu cuenta, elige tu plan y migra tus datos. Sin contratos forzosos:
          cancela cuando quieras.
        </p>

        <div className="lp-cta-actions">
          <Link href="/signup" className="lp-btn lp-btn--lg lp-btn--on-violet">
            Crear cuenta
          </Link>
          <Link href="/clinicas" className="lp-btn lp-btn--lg lp-btn--ghost-on-violet">
            Ver demo
          </Link>
        </div>

        <ul className="lp-cta-trust lp-mono" aria-label="Incluido en todos los planes">
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

      <style>{`
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
          color: rgba(255,255,255,0.78);
        }
        .lp-cta-trust__item { display: inline-flex; align-items: center; gap: 0.625rem; }
        .lp-cta-trust__sep { color: rgba(255,255,255,0.5); }
      `}</style>
    </section>
  );
}
