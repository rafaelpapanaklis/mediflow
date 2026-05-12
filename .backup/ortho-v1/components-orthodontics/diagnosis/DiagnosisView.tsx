"use client";
// Orthodontics — vista lectura del diagnóstico. SPEC §6.5.

import { Edit2 } from "lucide-react";
import type { OrthodonticDiagnosisRow } from "@/lib/types/orthodontics";

export function DiagnosisView(props: {
  diagnosis: OrthodonticDiagnosisRow;
  onEdit?: () => void;
}) {
  const dx = props.diagnosis;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>Diagnóstico inicial</h3>
        {props.onEdit ? (
          <button
            type="button"
            onClick={props.onEdit}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            <Edit2 size={12} aria-hidden /> Editar
          </button>
        ) : null}
      </header>

      <Section title="Análisis Angle">
        <Row label="Clase derecha" value={dx.angleClassRight} />
        <Row label="Clase izquierda" value={dx.angleClassLeft} />
        <Row label="Overbite" value={`${dx.overbiteMm} mm · ${dx.overbitePercentage}%`} />
        <Row label="Overjet" value={`${dx.overjetMm} mm`} />
        {dx.midlineDeviationMm != null ? (
          <Row label="Desviación línea media" value={`${dx.midlineDeviationMm} mm`} />
        ) : null}
        {dx.crossbite ? (
          <Row label="Mordida cruzada" value={dx.crossbiteDetails ?? "Sí"} />
        ) : null}
        {dx.openBite ? (
          <Row label="Mordida abierta" value={dx.openBiteDetails ?? "Sí"} />
        ) : null}
      </Section>

      <Section title="Apiñamiento + etiología">
        {dx.crowdingUpperMm != null ? (
          <Row label="Apiñamiento superior" value={`${dx.crowdingUpperMm} mm`} />
        ) : null}
        {dx.crowdingLowerMm != null ? (
          <Row label="Apiñamiento inferior" value={`${dx.crowdingLowerMm} mm`} />
        ) : null}
        <Row
          label="Etiología"
          value={[
            dx.etiologySkeletal && "Esquelética",
            dx.etiologyDental && "Dental",
            dx.etiologyFunctional && "Funcional",
          ]
            .filter(Boolean)
            .join(", ") || "—"}
        />
        {dx.etiologyNotes ? <Row label="Notas etiología" value={dx.etiologyNotes} /> : null}
      </Section>

      <Section title="Hábitos + ATM + fase dental">
        <Row
          label="Fase dental"
          value={dx.dentalPhase.replace("_", " ").toLowerCase()}
        />
        <Row label="Hábitos" value={dx.habits.length > 0 ? dx.habits.join(", ") : "Sin reportar"} />
        {dx.habitsDescription ? <Row label="Descripción" value={dx.habitsDescription} /> : null}
        <Row
          label="ATM"
          value={
            [
              dx.tmjPainPresent && "Dolor",
              dx.tmjClickingPresent && "Chasquido",
            ]
              .filter(Boolean)
              .join(", ") || "Sin hallazgos"
          }
        />
        {dx.tmjNotes ? <Row label="Notas ATM" value={dx.tmjNotes} /> : null}
      </Section>

      <Section title="Resumen clínico">
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-1)", lineHeight: 1.5 }}>
          {dx.clinicalSummary}
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        padding: 14,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <h4 style={{ margin: 0, fontSize: 11, textTransform: "uppercase", color: "var(--text-2)" }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--text-1)", textAlign: "right" }}>{value}</span>
    </div>
  );
}
