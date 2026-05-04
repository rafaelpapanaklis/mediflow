"use client";
// Periodontics — shell del módulo: combina sub-tabs + contenido. SPEC §6.1.

import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import type { PerioMetrics } from "@/lib/periodontics/periodontogram-math";
import type { SitePos } from "@/lib/periodontics/site-helpers";
import { PerioSubTabs, usePerioTab } from "./PerioSubTabs";
import { ResumenTab } from "./ResumenTab";
import { PlanTab } from "./PlanTab";
import { CirugiasTab } from "./CirugiasTab";
import { MantenimientosTab } from "./MantenimientosTab";
import { PeriodontogramGrid } from "./periodontogram/PeriodontogramGrid";
import { LiveIndicators } from "./periodontogram/LiveIndicators";
import { ClassificationFooter } from "./periodontogram/ClassificationFooter";
import { KeyboardCaptureLayer } from "./periodontogram/KeyboardCaptureLayer";
import { ToothDetailDrawer } from "./periodontogram/ToothDetailDrawer";
import {
  MobileFallbackBanner,
  useIsMobilePerio,
} from "./periodontogram/MobileFallback";

export interface PeriodonticsTabProps {
  patientId: string;
  patientName: string;
  recordId?: string;
  initialSites: Site[];
  initialTeeth: ToothLevel[];
  initialMetrics?: PerioMetrics | null;
  classification?: {
    id: string;
    stage: string;
    grade?: string | null;
    extension?: string | null;
    overridden?: boolean;
  } | null;
  riskCategory?: "BAJO" | "MODERADO" | "ALTO" | null;
  recallMonths?: 3 | 4 | 6 | null;
  nextMaintenanceAt?: string | null;
  bopHistory?: Array<{ date: string; bopPct: number }>;
  alerts?: string[];
  systemicFactors?: string[];
  plan?: {
    currentPhase: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4";
    phaseDates?: Record<string, string | null>;
  } | null;
  surgeries: Array<{
    id: string;
    surgeryDate: string;
    surgeryType: string;
    teeth: number[];
    sutureRemovalDate?: string | null;
    hasConsent: boolean;
  }>;
  maintenanceHistory: Array<{
    id: string;
    date: string;
    bopPct: number;
    plaquePct: number;
  }>;
  /** Persistencia (server actions empaquetadas como callbacks). */
  onPersistSite: (site: Site) => Promise<void>;
  onPersistTooth: (tooth: ToothLevel) => Promise<void>;
  onClassify?: () => Promise<void>;
  onAdvancePhase?: (toPhase: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4") => Promise<void>;
  onCreateRecession?: (data: {
    toothFdi: number;
    surface: "vestibular" | "lingual";
    recessionHeightMm: number;
    recessionWidthMm: number;
    keratinizedTissueMm: number;
    cairoClassification: "RT1" | "RT2" | "RT3";
    gingivalPhenotype: "DELGADO" | "GRUESO";
  }) => Promise<void>;
  onScheduleMaintenance?: () => Promise<void>;
  onCreateSurgery?: () => void;
  onSignSurgeryConsent?: (surgeryId: string) => void;
}

export function PeriodonticsTab(props: PeriodonticsTabProps) {
  const [tab, setTab] = usePerioTab(props.recordId ? "periodontograma" : "resumen");
  const [metrics, setMetrics] = useState<PerioMetrics | null>(props.initialMetrics ?? null);
  const [cursor, setCursor] = useState<{ fdi: number; position: SitePos } | null>(null);
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [classifying, setClassifying] = useState(false);

  const isMobile = useIsMobilePerio();

  const resolveSite = useCallback(
    (fdi: number, position: SitePos) =>
      props.initialSites.find((s) => s.fdi === fdi && s.position === position),
    [props.initialSites],
  );

  const handleClassify = useCallback(async () => {
    if (!props.onClassify) return;
    setClassifying(true);
    try {
      await props.onClassify();
      toast.success("Paciente clasificado");
    } catch {
      toast.error("No se pudo clasificar");
    } finally {
      setClassifying(false);
    }
  }, [props]);

  return (
    <div>
      <PerioSubTabs active={tab} onChange={setTab} />

      {tab === "resumen" ? (
        <ResumenTab
          classification={props.classification}
          metrics={metrics ?? props.initialMetrics ?? null}
          bopHistory={props.bopHistory}
          nextMaintenanceAt={props.nextMaintenanceAt ?? null}
          riskCategory={props.riskCategory ?? null}
          recallMonths={props.recallMonths ?? null}
          alerts={props.alerts}
          systemicFactors={props.systemicFactors}
        />
      ) : null}

      {tab === "periodontograma" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {isMobile ? <MobileFallbackBanner /> : null}
          {metrics ? <LiveIndicators metrics={metrics} /> : null}

          {props.recordId ? (
            <PeriodontogramGrid
              recordId={props.recordId}
              initialSites={props.initialSites}
              initialTeeth={props.initialTeeth}
              onPersistSite={props.onPersistSite}
              onPersistTooth={props.onPersistTooth}
              onMetricsChange={setMetrics}
              onCursorChange={setCursor}
              onToothClick={setSelectedTooth}
              readOnly={isMobile}
            />
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                background: "var(--bg-elev)",
                border: "1px dashed var(--border)",
                borderRadius: 8,
                color: "var(--text-2)",
                fontSize: 13,
              }}
            >
              Aún no hay sondaje para este paciente. Crea uno desde el botón en la parte superior.
            </div>
          )}

          <ClassificationFooter
            stage={props.classification?.stage}
            grade={props.classification?.grade}
            extension={props.classification?.extension}
            overridden={props.classification?.overridden}
            onClassify={props.onClassify ? handleClassify : undefined}
            isClassifying={classifying}
          />

          {!isMobile ? (
            <KeyboardCaptureLayer
              cursor={cursor}
              resolveSite={resolveSite}
              disabled={isMobile}
            />
          ) : null}

          <ToothDetailDrawer
            fdi={selectedTooth}
            initialTooth={
              selectedTooth != null
                ? props.initialTeeth.find((t) => t.fdi === selectedTooth)
                : undefined
            }
            onClose={() => setSelectedTooth(null)}
            onCreateRecession={props.onCreateRecession}
          />
        </div>
      ) : null}

      {tab === "plan" ? (
        <PlanTab
          currentPhase={props.plan?.currentPhase ?? null}
          phaseDates={props.plan?.phaseDates}
          onAdvance={props.onAdvancePhase}
        />
      ) : null}

      {tab === "cirugias" ? (
        <CirugiasTab
          surgeries={props.surgeries.map((s) => ({
            ...s,
            onSignConsent: s.hasConsent
              ? undefined
              : () => props.onSignSurgeryConsent?.(s.id),
          }))}
          onCreateSurgery={props.onCreateSurgery}
        />
      ) : null}

      {tab === "mantenimientos" ? (
        <MantenimientosTab
          recallMonths={props.recallMonths ?? null}
          riskCategory={props.riskCategory ?? null}
          history={props.maintenanceHistory}
          nextAt={props.nextMaintenanceAt ?? null}
          onSchedule={props.onScheduleMaintenance ? () => void props.onScheduleMaintenance!() : undefined}
        />
      ) : null}
    </div>
  );
}
