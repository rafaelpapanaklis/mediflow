// Pediatrics — Banner de consentimientos pendientes de firma. Spec: §1.5.4, §4.A.8

import { FileWarning } from "lucide-react";
import type { PediatricConsentRow } from "@/types/pediatrics";

export interface ConsentPendingCardProps {
  pending: PediatricConsentRow[];
  onSign?: (consentId: string) => void;
}

export function ConsentPendingCard(props: ConsentPendingCardProps) {
  const { pending, onSign } = props;

  if (pending.length === 0) return null;

  return (
    <div className="pedi-card pedi-consent-pending-card">
      <h3 className="pedi-card__title">
        <FileWarning size={14} aria-hidden /> Consentimientos pendientes
      </h3>
      <ul className="pedi-consent-pending-card__list">
        {pending.map((c) => (
          <li key={c.id}>
            <span>{labelProcedure(c.procedureType)}</span>
            {onSign ? (
              <button type="button" className="pedi-btn pedi-btn--xs pedi-btn--brand" onClick={() => onSign(c.id)}>
                Firmar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelProcedure(p: string): string {
  const map: Record<string, string> = {
    anestesia_local: "Anestesia local",
    sedacion_consciente: "Sedación consciente",
    oxido_nitroso: "Óxido nitroso",
    extraccion: "Extracción",
    pulpotomia: "Pulpotomía",
    pulpectomia: "Pulpectomía",
    fluorizacion: "Fluorización",
    toma_impresiones: "Toma de impresiones",
    rx_intraoral: "Rx intraoral",
    otro: "Otro",
  };
  return map[p] ?? p;
}
