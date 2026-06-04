const STATS = [
  { value: "−73%", label: "Faltas a citas" },
  { value: "+4 h", label: "Ahorradas por semana" },
  { value: "+28%", label: "Aceptación de tratamientos" },
  { value: "100%", label: "CFDI timbrado" },
] as const;

export function SocialProof() {
  return (
    <section className="lp-section lp-section--tight" aria-labelledby="proof-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Resultados reales</p>
          <h2
            id="proof-h"
            className="lp-h2"
            style={{ fontSize: "clamp(24px,3vw,34px)" }}
          >
            Lo que cambia al mes de usar MediFlow
          </h2>
        </div>
        <div className="lp-stats" role="list">
          {STATS.map((s) => (
            <div className="lp-stat" role="listitem" key={s.label}>
              <div className="lp-stat__value">{s.value}</div>
              <div className="lp-stat__label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
