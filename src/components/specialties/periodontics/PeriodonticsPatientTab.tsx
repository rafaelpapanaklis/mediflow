"use client";
// Periodontics — wrapper embebido para usar dentro del patient-detail.
// Empty state grande con CTA "Iniciar primer sondaje" cuando el paciente
// aún no tiene PeriodontalRecord; cuando ya tiene, monta el cliente
// completo del módulo (PeriodonticsClient).

import Link from "next/link";
import { Activity, ExternalLink } from "lucide-react";
import {
  PeriodonticsClient,
  type PeriodonticsClientProps,
} from "./PeriodonticsClient";

export interface PeriodonticsPatientTabProps {
  data: PeriodonticsClientProps & { recordsCount: number };
}

export function PeriodonticsPatientTab({ data }: PeriodonticsPatientTabProps) {
  if (data.recordsCount === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "48px 24px",
          textAlign: "center",
          background: "var(--bg-elev)",
          border: "1px dashed var(--border)",
          borderRadius: 12,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            width: 48,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            background: "var(--brand-soft, rgba(99,102,241,0.18))",
            color: "var(--brand, #6366f1)",
          }}
        >
          <Activity size={22} aria-hidden />
        </span>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
            Sin periodontograma todavía
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--text-2)",
              maxWidth: 460,
            }}
          >
            Captura el primer sondaje del paciente para clasificarlo según AAP/EFP 2017,
            calcular el riesgo Berna y abrir su plan de 4 fases.
          </p>
        </div>
        <Link
          href={`/dashboard/specialties/periodontics/${data.patientId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 18px",
            borderRadius: 6,
            border: "1px solid var(--brand, #6366f1)",
            background: "var(--brand, #6366f1)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <ExternalLink size={14} aria-hidden /> Iniciar primer sondaje
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-2)" }}>
          Periodoncia · vista embebida
        </span>
        <Link
          href={`/dashboard/specialties/periodontics/${data.patientId}`}
          style={{
            fontSize: 11,
            color: "var(--brand, #6366f1)",
            textDecoration: "none",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          Abrir página dedicada <ExternalLink size={12} aria-hidden />
        </Link>
      </div>

      <PeriodonticsClient
        patientId={data.patientId}
        patientName={data.patientName}
        recordId={data.recordId}
        initialSites={data.initialSites}
        initialTeeth={data.initialTeeth}
        initialMetrics={data.initialMetrics}
        classification={data.classification}
        riskCategory={data.riskCategory}
        recallMonths={data.recallMonths}
        nextMaintenanceAt={data.nextMaintenanceAt}
        bopHistory={data.bopHistory}
        alerts={data.alerts}
        systemicFactors={data.systemicFactors}
        plan={data.plan}
        surgeries={data.surgeries}
        maintenanceHistory={data.maintenanceHistory}
      />
    </div>
  );
}
