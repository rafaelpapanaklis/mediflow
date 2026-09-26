"use client";

export type PlanId = "BASIC" | "PRO" | "CLINIC";
export type Billing = "monthly" | "annual";

interface PlanCardProps {
  plan: PlanId;
  name: string;
  description: string;
  priceMonthly: number;
  priceAnnual: number;
  billing: Billing;
  features: string[];
  popular?: boolean;
  mostComplete?: boolean;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Tarjeta de plan del paso 3, con la misma ropa que las tarjetas de precios
 * de la portada: nombre en versalitas con su punto, cifra grande tabular,
 * la popular en navy con borde azul→violeta. Es un botón-radio: la elegida
 * lleva anillo azul y la palomita en el radio. Estilos en ../auth-v4.css.
 * Precio y tachado se muestran exactamente como antes (misma expresión).
 */
export function PlanCard({
  name,
  description,
  priceMonthly,
  priceAnnual,
  billing,
  features,
  popular,
  mostComplete,
  selected,
  onSelect,
}: PlanCardProps) {
  const price = billing === "annual" ? priceAnnual : priceMonthly;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={["dca-plan", popular ? "is-featured" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
    >
      {popular && <span className="dca-plan__badge">★ Más popular</span>}
      {mostComplete && <span className="dca-plan__badge dca-plan__badge--complete">Más completa</span>}

      <div className="dca-plan__head">
        <span className="dca-plan__name">{name}</span>
        <span className="dca-plan__radio" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6 L5 9 L10 3" stroke={popular ? "#0f172a" : "#fff"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <div className="dca-plan__desc">{description}</div>

      <div className="dca-plan__amount">
        <span className="dca-plan__cur">$</span>
        <span className="dca-plan__num">{price}</span>
        <span className="dca-plan__per">
          <span>MXN</span>
          <span>/ mes</span>
        </span>
      </div>
      {billing === "annual" && priceAnnual < priceMonthly && (
        <div className="dca-plan__was" style={{ marginTop: -6 }}>
          ${priceMonthly}
        </div>
      )}

      <div className="dca-plan__hair" />

      <ul className="dca-plan__feats">
        {features.map((f, i) => (
          <li key={i} className="dca-plan__feat">
            <span className="dca-plan__chk" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 6 L5 9 L10 3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}
