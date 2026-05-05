"use client";
// Pediatrics — drawer dinámico abierto desde click en odontograma. Spec: §1.8, §4.A.8

import { useState } from "react";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { SealantDrawer } from "./SealantDrawer";
import { EndodonticDrawer } from "./EndodonticDrawer";
import { EruptionDrawer } from "./EruptionDrawer";

export interface ToothDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  fdi: number | null;
}

type Tab = "sellante" | "endo" | "erupcion" | "extraccion";

export function ToothDrawer(props: ToothDrawerProps) {
  const { open, onClose, patientId, fdi } = props;
  const [tab, setTab] = useState<Tab>("sellante");

  if (!fdi) return null;

  if (tab === "sellante") {
    return <SealantDrawer open={open} onClose={onClose} patientId={patientId} initialFdi={fdi} />;
  }
  if (tab === "endo") {
    return <EndodonticDrawer open={open} onClose={onClose} patientId={patientId} initialFdi={fdi} />;
  }
  if (tab === "erupcion") {
    return <EruptionDrawer open={open} onClose={onClose} patientId={patientId} initialFdi={fdi} />;
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Diente ${fdi}`}
      subtitle="Selecciona la acción a registrar"
    >
      <div className="pedi-tooth-drawer__tabs" role="tablist" aria-label="Acciones por diente">
        {(["sellante", "endo", "erupcion", "extraccion"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={`pedi-pill ${tab === t ? "is-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {labelTab(t)}
          </button>
        ))}
      </div>
      <p className="pedi-form__hint">
        La extracción se registra desde el odontograma legacy (futuro v1.1).
        Para sellante, endodoncia o erupción, selecciona la pestaña arriba.
      </p>
    </Drawer>
  );
}

function labelTab(t: Tab): string {
  if (t === "sellante") return "Sellante";
  if (t === "endo") return "Endo";
  if (t === "erupcion") return "Erupción";
  return "Extracción";
}
