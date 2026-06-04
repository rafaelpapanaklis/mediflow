import { CalendarCheck, Clock, TrendingUp, ReceiptText, type LucideIcon } from "lucide-react";

const STATS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "−73%", label: "Faltas a citas", icon: CalendarCheck },
  { value: "+4 h", label: "Ahorradas por semana", icon: Clock },
  { value: "+28%", label: "Aceptación de tratamientos", icon: TrendingUp },
  { value: "100%", label: "CFDI timbrado", icon: ReceiptText },
];

export function SocialProof() {
  return (
    <section className="lp-section lp-section--tight" aria-labelledby="proof-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">RESULTADOS REALES</p>
          <h2 id="proof-h" className="lp-h2" style={{ fontSize: "clamp(24px,3vw,34px)" }}>
            Lo que cambia al mes de usar MediFlow
          </h2>
        </div>

        <ul className="lp-grid lp-grid-4 lp-proof-grid">
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.label} className="lp-card lp-proof-card">
                <span className="lp-proof-card__icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <span className="lp-proof-card__value">{s.value}</span>
                <span className="lp-proof-card__label">{s.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <style>{`
        .lp-proof-grid { list-style: none; margin: 0; padding: 0; }
        .lp-proof-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 24px;
        }
        .lp-proof-card__icon {
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: var(--ld-brand-weak);
          border: 1px solid var(--ld-brand-weak-border);
          color: var(--ld-brand);
          margin-bottom: 4px;
        }
        .lp-proof-card__value {
          font-family: var(--font-sans, system-ui, sans-serif);
          font-weight: 600;
          font-size: 40px;
          line-height: 1;
          letter-spacing: -0.03em;
          color: var(--ld-fg);
        }
        .lp-proof-card__label {
          font-size: 14px;
          line-height: 1.4;
          color: var(--ld-fg-muted);
        }
      `}</style>
    </section>
  );
}
