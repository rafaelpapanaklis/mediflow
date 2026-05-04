"use client";
// Periodontics — widget que lista pacientes con mantenimiento vencido. SPEC §11.

import Link from "next/link";

export interface OverdueMaintenanceRow {
  patientId: string;
  patientName: string;
  riskCategory: "BAJO" | "MODERADO" | "ALTO";
  daysOverdue: number;
  recallMonths: number;
}

export function OverdueMaintenanceWidget(props: {
  rows: OverdueMaintenanceRow[];
}) {
  if (props.rows.length === 0) {
    return (
      <section
        style={{
          padding: 16,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <h3
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            color: "var(--text-2)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          Mantenimientos vencidos
        </h3>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Ningún paciente con mantenimiento vencido. ✓
        </div>
      </section>
    );
  }

  return (
    <section
      style={{
        padding: 16,
        background: "var(--warning-soft, rgba(234,179,8,0.08))",
        border: "1px solid var(--warning, #eab308)",
        borderRadius: 8,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          color: "var(--warning, #eab308)",
          margin: 0,
          marginBottom: 8,
        }}
      >
        Mantenimientos vencidos ({props.rows.length})
      </h3>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {props.rows.map((r) => (
          <li
            key={r.patientId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Link
              href={`/dashboard/specialties/periodontics/${r.patientId}`}
              style={{
                fontSize: 13,
                color: "var(--text-1)",
                textDecoration: "none",
              }}
            >
              {r.patientName}
            </Link>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>
              {r.daysOverdue} días vencido · riesgo {r.riskCategory.toLowerCase()} · recall {r.recallMonths}m
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
