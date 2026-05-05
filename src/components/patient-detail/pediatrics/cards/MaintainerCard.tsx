// Pediatrics — Card del mantenedor de espacio activo con progress. Spec: §1.12, §4.A.8

import { Link2 } from "lucide-react";
import type { SpaceMaintainerRow } from "@/types/pediatrics";

export interface MaintainerCardProps {
  active: SpaceMaintainerRow | null;
  onChangeStatus?: (id: string) => void;
}

export function MaintainerCard(props: MaintainerCardProps) {
  const { active, onChangeStatus } = props;

  if (!active) {
    return (
      <div className="pedi-card">
        <h3 className="pedi-card__title">Mantenedor activo</h3>
        <p className="pedi-card__empty">Sin mantenedores activos.</p>
      </div>
    );
  }

  const placedAt = new Date(active.placedAt);
  const expectedRemoval = active.estimatedRemovalAt ? new Date(active.estimatedRemovalAt) : null;
  const totalDays = expectedRemoval ? (expectedRemoval.getTime() - placedAt.getTime()) / (1000 * 60 * 60 * 24) : null;
  const elapsedDays = (Date.now() - placedAt.getTime()) / (1000 * 60 * 60 * 24);
  const progress = totalDays && totalDays > 0 ? Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100)) : 0;
  const remainingDays = expectedRemoval ? Math.max(0, Math.ceil((expectedRemoval.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;

  return (
    <div className="pedi-card pedi-maintainer-card">
      <h3 className="pedi-card__title">Mantenedor activo</h3>
      <div className="pedi-maintainer-card__main">
        <Link2 size={16} aria-hidden />
        <div>
          <div className="pedi-maintainer-card__name">{labelType(active.type)} #{active.replacedToothFdi}</div>
          <div className="pedi-maintainer-card__meta">
            Colocado {placedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
            {expectedRemoval ? ` · Retiro est. ${expectedRemoval.toLocaleDateString("es-MX", { month: "short", year: "numeric" })}` : ""}
          </div>
        </div>
      </div>
      {totalDays != null ? (
        <div className="pedi-maintainer-card__progress" aria-label="Progreso del mantenedor">
          <div className="pedi-maintainer-card__bar">
            <div className="pedi-maintainer-card__fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="pedi-maintainer-card__progress-meta">
            <span>{Math.round(progress)}%</span>
            {remainingDays != null ? <span>{remainingDays} días rest.</span> : null}
          </div>
        </div>
      ) : null}
      {onChangeStatus ? (
        <button type="button" className="pedi-btn pedi-maintainer-card__action" onClick={() => onChangeStatus(active.id)}>
          Cambiar estado
        </button>
      ) : null}
    </div>
  );
}

function labelType(t: string): string {
  const map: Record<string, string> = {
    banda_ansa: "Banda-Ansa",
    corona_ansa: "Corona-Ansa",
    nance: "Nance",
    arco_lingual: "Arco lingual",
    distal_shoe: "Distal-Shoe",
  };
  return map[t] ?? t;
}
