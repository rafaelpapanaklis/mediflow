"use client";
// Pediatrics — sub-tab Plan preventivo. Spec: §1.12, §4.A.5

import { useState } from "react";
import { Plus } from "lucide-react";
import { RiskCard } from "../cards/RiskCard";
import { SealantCard } from "../cards/SealantCard";
import { MaintainerCard } from "../cards/MaintainerCard";
import { FluorideDrawer } from "../drawers/FluorideDrawer";
import { SealantDrawer } from "../drawers/SealantDrawer";
import { SpaceMaintainerDrawer } from "../drawers/SpaceMaintainerDrawer";
import type { CariesRiskAssessmentRow, FluorideApplicationRow, SealantRow, SpaceMaintainerRow } from "@/types/pediatrics";
import type { CambraCategory } from "@/lib/pediatrics/cambra";

export interface PreventivePlanSectionProps {
  patientId: string;
  latestCambra: CariesRiskAssessmentRow | null;
  sealants: SealantRow[];
  maintainers: SpaceMaintainerRow[];
  fluorideHistory: FluorideApplicationRow[];
}

export function PreventivePlanSection(props: PreventivePlanSectionProps) {
  const [fluorideOpen, setFluorideOpen] = useState(false);
  const [sealantOpen, setSealantOpen] = useState(false);
  const [maintainerOpen, setMaintainerOpen] = useState(false);

  const lastFluoride = props.fluorideHistory.find((f) => !f.deletedAt) ?? null;
  const activeMaintainer = props.maintainers.find((m) => !m.deletedAt && m.currentStatus === "activo") ?? null;
  const nextFluoride = lastFluoride ? new Date(lastFluoride.appliedAt.getTime() + 1000 * 60 * 60 * 24 * 30 * 6) : null;

  return (
    <div className="pedi-section">
      <div className="pedi-section__header">
        <h2 className="pedi-section__title">Plan preventivo personalizado</h2>
        <div className="pedi-section__actions">
          <button type="button" className="pedi-btn" onClick={() => setFluorideOpen(true)}>
            <Plus size={14} aria-hidden /> Flúor
          </button>
          <button type="button" className="pedi-btn" onClick={() => setSealantOpen(true)}>
            <Plus size={14} aria-hidden /> Sellante
          </button>
          <button type="button" className="pedi-btn" onClick={() => setMaintainerOpen(true)}>
            <Plus size={14} aria-hidden /> Mantenedor
          </button>
        </div>
      </div>

      <div className="pedi-summary-grid">
        <RiskCard
          category={(props.latestCambra?.category as CambraCategory | undefined) ?? null}
          recallMonths={props.latestCambra?.recommendedRecallMonths}
          scoredAt={props.latestCambra?.scoredAt}
          nextDueAt={props.latestCambra?.nextDueAt}
        />
        <div className="pedi-card">
          <h3 className="pedi-card__title">Próxima fluorización</h3>
          {lastFluoride ? (
            <>
              <p style={{ margin: 0 }}>
                Última: {lastFluoride.appliedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
              <p style={{ margin: "6px 0 0", color: "var(--text-2)", fontSize: 12 }}>
                Producto: {labelProduct(lastFluoride.product)}
              </p>
              {nextFluoride ? (
                <p style={{ margin: "6px 0 0", fontWeight: 600 }}>
                  Próxima sugerida: {nextFluoride.toLocaleDateString("es-MX", { month: "short", year: "numeric" })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="pedi-card__empty">Sin aplicaciones todavía.</p>
          )}
        </div>
        <SealantCard sealants={props.sealants} />
        <MaintainerCard active={activeMaintainer} />
      </div>

      <FluorideDrawer open={fluorideOpen} onClose={() => setFluorideOpen(false)} patientId={props.patientId} />
      <SealantDrawer open={sealantOpen} onClose={() => setSealantOpen(false)} patientId={props.patientId} />
      <SpaceMaintainerDrawer open={maintainerOpen} onClose={() => setMaintainerOpen(false)} patientId={props.patientId} />
    </div>
  );
}

function labelProduct(p: string): string {
  if (p === "barniz_5pct_naf") return "Barniz 5% NaF";
  if (p === "gel_apf") return "Gel APF";
  if (p === "sdf") return "SDF";
  if (p === "fosfato_acido") return "Fosfato ácido";
  return p;
}
