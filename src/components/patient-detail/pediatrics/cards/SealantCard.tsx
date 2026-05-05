// Pediatrics — Card de sellantes en grid 2x2 de molares permanentes. Spec: §1.12, §4.A.8

import { Shield, AlertTriangle } from "lucide-react";
import type { SealantRow } from "@/types/pediatrics";

export interface SealantCardProps {
  sealants: SealantRow[];
  onReapply?: (id: string) => void;
}

const MOLARS = [16, 26, 36, 46];

export function SealantCard(props: SealantCardProps) {
  const { sealants, onReapply } = props;

  const byFdi = new Map<number, SealantRow>();
  for (const s of sealants) {
    if (!s.deletedAt) byFdi.set(s.toothFdi, s);
  }

  return (
    <div className="pedi-card pedi-sealant-card">
      <h3 className="pedi-card__title">Sellantes — molares perm.</h3>
      <div className="pedi-sealant-card__grid">
        {MOLARS.map((fdi) => {
          const s = byFdi.get(fdi);
          const status = s?.retentionStatus ?? null;
          const cls = status === "completo" ? "ok" : status === "parcial" ? "warn" : status === "perdido" ? "danger" : "empty";

          return (
            <div key={fdi} className={`pedi-sealant-card__cell pedi-sealant-card__cell--${cls}`}>
              <div className="pedi-sealant-card__fdi">{fdi}</div>
              {s ? (
                <>
                  <div className="pedi-sealant-card__status">
                    {status === "completo" ? <Shield size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
                    <span>{status}</span>
                  </div>
                  <div className="pedi-sealant-card__material">{labelMaterial(s.material)}</div>
                  {status !== "completo" && onReapply ? (
                    <button type="button" className="pedi-btn pedi-btn--xs" onClick={() => onReapply(s.id)}>
                      Reaplicar
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="pedi-sealant-card__missing">Sin colocar</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelMaterial(m: string): string {
  if (m === "resina_fotocurada") return "Resina";
  if (m === "ionomero") return "Ionómero";
  return m;
}
