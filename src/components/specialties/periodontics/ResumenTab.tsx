"use client";
// Periodontics — sub-tab Resumen. 5 cards. SPEC §6.1.

import type { PerioMetrics } from "@/lib/periodontics/periodontogram-math";

export interface ResumenTabProps {
  classification?: {
    stage: string;
    grade?: string | null;
    extension?: string | null;
    overridden?: boolean;
    classifiedAt?: string;
  } | null;
  metrics?: PerioMetrics | null;
  bopHistory?: Array<{ date: string; bopPct: number }>;
  nextMaintenanceAt?: string | null;
  riskCategory?: "BAJO" | "MODERADO" | "ALTO" | null;
  recallMonths?: 3 | 4 | 6 | null;
  alerts?: string[];
  systemicFactors?: string[];
}

export function ResumenTab(props: ResumenTabProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      <Card title="Clasificación actual">
        {props.classification ? (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
              {props.classification.stage}
              {props.classification.grade ? ` · ${props.classification.grade}` : ""}
              {props.classification.extension ? ` · ${props.classification.extension}` : ""}
            </div>
            {props.classification.overridden ? (
              <span
                style={{
                  fontSize: 10,
                  marginTop: 4,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: "var(--brand-soft)",
                  color: "var(--brand)",
                  textTransform: "uppercase",
                  display: "inline-block",
                }}
              >
                Sobrescrita por doctor
              </span>
            ) : null}
            {props.classification.classifiedAt ? (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                Clasificado el {props.classification.classifiedAt}
              </div>
            ) : null}
          </div>
        ) : (
          <Empty>Sin clasificación todavía.</Empty>
        )}
      </Card>

      <Card title="Tendencia BoP">
        {props.bopHistory && props.bopHistory.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {props.bopHistory.slice(0, 5).map((point, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--text-1)",
                  padding: "3px 0",
                  borderBottom:
                    i < props.bopHistory!.length - 1
                      ? "1px solid var(--border)"
                      : undefined,
                }}
              >
                <span>{point.date}</span>
                <span style={{ fontFamily: "monospace" }}>{point.bopPct}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Aún no hay sondajes registrados.</Empty>
        )}
      </Card>

      <Card title="Próximo mantenimiento">
        {props.nextMaintenanceAt ? (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
              {props.nextMaintenanceAt}
            </div>
            {props.riskCategory ? (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                Riesgo {props.riskCategory.toLowerCase()} · recall cada{" "}
                {props.recallMonths ?? "—"} meses
              </div>
            ) : null}
          </div>
        ) : (
          <Empty>Sin mantenimiento agendado.</Empty>
        )}
      </Card>

      <Card title="Alertas clínicas">
        {props.alerts && props.alerts.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {props.alerts.map((a, i) => (
              <li key={i} style={{ fontSize: 12, color: "var(--text-1)", marginBottom: 4 }}>
                {a}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Sin alertas.</Empty>
        )}
      </Card>

      <Card title="Factores sistémicos">
        {props.systemicFactors && props.systemicFactors.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {props.systemicFactors.map((f, i) => (
              <li key={i} style={{ fontSize: 12, color: "var(--text-1)", marginBottom: 4 }}>
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Sin condiciones sistémicas relevantes registradas.</Empty>
        )}
      </Card>

      <Card title="Métricas actuales">
        {props.metrics ? (
          <div style={{ fontSize: 12, color: "var(--text-1)" }}>
            <Row label="BoP" value={`${props.metrics.bopPct}%`} />
            <Row label="Plaque" value={`${props.metrics.plaquePct}%`} />
            <Row label="Sitios 1-3 mm" value={String(props.metrics.sites1to3)} />
            <Row label="Sitios 4-5 mm" value={String(props.metrics.sites4to5)} />
            <Row label="Sitios ≥6 mm" value={String(props.metrics.sites6plus)} />
            <Row
              label="Bolsas ≥5 mm"
              value={String(props.metrics.teethWithPockets5plus)}
            />
            <Row label="PD promedio" value={`${props.metrics.avgPd} mm`} />
          </div>
        ) : (
          <Empty>Sin métricas todavía.</Empty>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        padding: 14,
        background: "var(--bg-elev, #11151c)",
        border: "1px solid var(--border, #1f2937)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          color: "var(--text-2, #94a3b8)",
          margin: 0,
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: "var(--text-3, #64748b)" }}>{children}</span>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "2px 0",
      }}
    >
      <span style={{ color: "var(--text-2, #94a3b8)" }}>{label}</span>
      <span style={{ fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}
