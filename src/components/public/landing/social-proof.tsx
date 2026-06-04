const STATS = [
  { value: "−73%", label: "Faltas a citas" },
  { value: "+4 h", label: "Ahorradas por semana" },
  { value: "+28%", label: "Aceptación de tratamientos" },
  { value: "100%", label: "CFDI timbrado" },
] as const;

export function SocialProof() {
  return (
    <section className="lp-section lp-section--tight lp-band-violet" aria-labelledby="proof-h">
      <div className="lp-container" style={{ textAlign: "center" }}>
        <p className="lp-eyebrow" style={{ justifyContent: "center" }}>Resultados reales</p>
        <h2
          id="proof-h"
          className="lp-h2"
          style={{ fontSize: "clamp(24px,3vw,34px)", maxWidth: 640, margin: "0 auto" }}
        >
          Lo que cambia al mes de usar MediFlow
        </h2>

        <ul className="lp-proof-stats" role="list">
          {STATS.map((s) => (
            <li key={s.label} className="lp-proof-stat">
              <span className="lp-proof-stat__value">{s.value}</span>
              <span className="lp-proof-stat__label">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <style>{`
        .lp-proof-stats {
          list-style: none;
          margin: clamp(32px, 4vw, 48px) 0 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1px;
        }
        .lp-proof-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          position: relative;
        }
        .lp-proof-stat + .lp-proof-stat::before {
          content: "";
          position: absolute;
          left: 0;
          top: 12%;
          height: 76%;
          width: 1px;
          background: rgba(255,255,255,0.22);
        }
        .lp-proof-stat__value {
          font-family: var(--font-sans, system-ui, sans-serif);
          font-weight: 700;
          font-size: clamp(30px, 4.4vw, 44px);
          letter-spacing: -0.03em;
          line-height: 1;
          color: #fff;
        }
        .lp-proof-stat__label {
          font-size: 13px;
          line-height: 1.35;
          color: rgba(255,255,255,0.95);
        }
        @media (max-width: 700px) {
          .lp-proof-stats { grid-template-columns: repeat(2, 1fr); gap: 28px 1px; }
          .lp-proof-stat:nth-child(odd)::before { display: none; }
        }
      `}</style>
    </section>
  );
}
