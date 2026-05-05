// Pediatrics — Card de riesgo cariogénico (CAMBRA). Spec: §1.5, §4.A.8

import { ShieldAlert, ShieldCheck, ShieldX, Shield } from "lucide-react";
import type { CambraCategory } from "@/lib/pediatrics/cambra";

export interface RiskCardProps {
  category: CambraCategory | null;
  recallMonths?: number | null;
  scoredAt?: Date | null;
  nextDueAt?: Date | null;
}

const ICON: Record<CambraCategory, typeof ShieldCheck> = {
  bajo: ShieldCheck,
  moderado: Shield,
  alto: ShieldAlert,
  extremo: ShieldX,
};

export function RiskCard(props: RiskCardProps) {
  const { category, recallMonths, scoredAt, nextDueAt } = props;

  if (!category) {
    return (
      <div className="pedi-card">
        <h3 className="pedi-card__title">Riesgo cariogénico</h3>
        <p className="pedi-card__empty">Sin evaluación CAMBRA. Captura una desde acciones rápidas.</p>
      </div>
    );
  }

  const Icon = ICON[category];

  return (
    <div className="pedi-card pedi-risk-card">
      <h3 className="pedi-card__title">Riesgo cariogénico (CAMBRA)</h3>
      <div className={`cambra-chip cambra-chip--${category}`}>
        <Icon size={12} aria-hidden />
        <span className="cambra-chip__dot" aria-hidden />
        {category.charAt(0).toUpperCase() + category.slice(1)}
      </div>
      <dl className="pedi-risk-card__meta">
        {recallMonths != null && (
          <div>
            <dt>Recall sugerido</dt>
            <dd>{recallMonths} {recallMonths === 1 ? "mes" : "meses"}</dd>
          </div>
        )}
        {scoredAt && (
          <div>
            <dt>Última evaluación</dt>
            <dd>{scoredAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</dd>
          </div>
        )}
        {nextDueAt && (
          <div>
            <dt>Próxima ideal</dt>
            <dd>{nextDueAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
