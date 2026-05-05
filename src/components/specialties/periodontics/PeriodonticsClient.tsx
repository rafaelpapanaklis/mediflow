"use client";
// Periodontics — wrapper client del PeriodonticsTab que cablea las server
// actions a los callbacks. SPEC §6.

import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import {
  upsertSiteData,
  upsertToothData,
  classifyPatient,
  advancePhase,
  createGingivalRecession,
  scheduleMaintenance,
  signSurgeryConsent,
  isFailure,
} from "@/app/actions/periodontics";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import type { PerioMetrics } from "@/lib/periodontics/periodontogram-math";
import { PeriodonticsTab } from "./PeriodonticsTab";
import { SurgeryConsentModal } from "./consents/SurgeryConsentModal";

export interface PeriodonticsClientProps {
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
}

export function PeriodonticsClient(props: PeriodonticsClientProps) {
  const [surgeryConsentFor, setSurgeryConsentFor] = useState<{
    id: string;
    type: string;
  } | null>(null);

  const onPersistSite = useCallback(
    async (site: Site) => {
      if (!props.recordId) return;
      const r = await upsertSiteData({ recordId: props.recordId, site });
      if (isFailure(r)) toast.error(r.error);
    },
    [props.recordId],
  );

  const onPersistTooth = useCallback(
    async (tooth: ToothLevel) => {
      if (!props.recordId) return;
      const r = await upsertToothData({ recordId: props.recordId, tooth });
      if (isFailure(r)) toast.error(r.error);
    },
    [props.recordId],
  );

  const onClassify = useCallback(async () => {
    if (!props.recordId) {
      toast.error("Necesitas un sondaje completo para clasificar.");
      return;
    }
    const r = await classifyPatient({
      recordId: props.recordId,
      modifiers: {},
    });
    if (isFailure(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Paciente clasificado");
  }, [props.recordId]);

  const onAdvancePhase = useCallback(
    async (toPhase: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4") => {
      // El cliente no tiene el planId — server action lo recibe directo.
      // En este flujo no hay planId todavía: el botón "Avanzar fase" sólo
      // aparece si props.plan está cargado, así que confiamos en que el
      // padre lo pase. TODO: agregar planId a las props del Tab.
      toast(`Avanzando a ${toPhase} — funcionalidad detrás de plan creado.`);
      await advancePhase({ planId: "", toPhase });
    },
    [],
  );

  const onCreateRecession = useCallback(
    async (data: {
      toothFdi: number;
      surface: "vestibular" | "lingual";
      recessionHeightMm: number;
      recessionWidthMm: number;
      keratinizedTissueMm: number;
      cairoClassification: "RT1" | "RT2" | "RT3";
      gingivalPhenotype: "DELGADO" | "GRUESO";
    }) => {
      const r = await createGingivalRecession({
        patientId: props.patientId,
        ...data,
      });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      toast.success("Recesión registrada");
    },
    [props.patientId],
  );

  const onScheduleMaintenance = useCallback(async () => {
    const next = new Date();
    next.setMonth(next.getMonth() + (props.recallMonths ?? 4));
    const r = await scheduleMaintenance({
      patientId: props.patientId,
      scheduledAt: next.toISOString(),
      recallMonthsUsed: (props.recallMonths ?? 4) as 3 | 4 | 6,
    });
    if (isFailure(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`Mantenimiento agendado para ${next.toLocaleDateString("es-MX")}`);
  }, [props.patientId, props.recallMonths]);

  const onSignSurgeryConsent = useCallback(
    (surgeryId: string) => {
      const surgery = props.surgeries.find((s) => s.id === surgeryId);
      setSurgeryConsentFor(surgery ? { id: surgery.id, type: surgery.surgeryType } : null);
    },
    [props.surgeries],
  );

  const handleSignedSurgery = useCallback(
    async (signatureUrl: string) => {
      if (!surgeryConsentFor) return;
      const r = await signSurgeryConsent({
        surgeryId: surgeryConsentFor.id,
        signatureUrl,
      });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      toast.success("Consentimiento firmado");
      setSurgeryConsentFor(null);
    },
    [surgeryConsentFor],
  );

  return (
    <>
      <PeriodonticsTab
        {...props}
        onPersistSite={onPersistSite}
        onPersistTooth={onPersistTooth}
        onClassify={onClassify}
        onAdvancePhase={onAdvancePhase}
        onCreateRecession={onCreateRecession}
        onScheduleMaintenance={onScheduleMaintenance}
        onSignSurgeryConsent={onSignSurgeryConsent}
      />

      {surgeryConsentFor ? (
        <SurgeryConsentModal
          surgeryType={surgeryConsentFor.type}
          patientName={props.patientName}
          onSign={handleSignedSurgery}
          onClose={() => setSurgeryConsentFor(null)}
        />
      ) : null}
    </>
  );
}
