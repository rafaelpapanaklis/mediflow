// Pediatrics — Card de alergias/condiciones especiales. Spec: §1.5.2-1.5.3, §4.A.8

import { AlertTriangle, Sparkle } from "lucide-react";

export interface AlertsCardProps {
  allergies: string[];
  conditions: string[];
}

export function AlertsCard(props: AlertsCardProps) {
  const { allergies, conditions } = props;
  return (
    <div className="pedi-card pedi-alerts-card">
      <h3 className="pedi-card__title">Alergias</h3>
      {allergies.length === 0 ? (
        <p className="pedi-card__empty">Sin alergias registradas.</p>
      ) : (
        <ul className="pedi-alerts-card__list">
          {allergies.map((a, i) => (
            <li key={`a-${i}`}><AlertTriangle size={12} aria-hidden /> {a}</li>
          ))}
        </ul>
      )}

      <h3 className="pedi-card__title pedi-alerts-card__sep">Condiciones especiales</h3>
      {conditions.length === 0 ? (
        <p className="pedi-card__empty">Sin condiciones registradas.</p>
      ) : (
        <ul className="pedi-alerts-card__list">
          {conditions.map((c, i) => (
            <li key={`c-${i}`}><Sparkle size={12} aria-hidden /> {c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
