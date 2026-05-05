"use client";
// Periodontics — sub-tab Mantenimientos. SPEC §6.1.

export interface MantenimientosTabProps {
  recallMonths?: 3 | 4 | 6 | null;
  riskCategory?: "BAJO" | "MODERADO" | "ALTO" | null;
  history: Array<{
    id: string;
    date: string;
    bopPct: number;
    plaquePct: number;
    notes?: string | null;
  }>;
  nextAt?: string | null;
  onSchedule?: () => void;
}

export function MantenimientosTab(props: MantenimientosTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section
        style={{
          padding: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase" }}>
            Próximo mantenimiento
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 4 }}>
            {props.nextAt ?? "Sin agendar"}
          </div>
          {props.recallMonths ? (
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
              Recall cada {props.recallMonths} meses · Riesgo{" "}
              {props.riskCategory?.toLowerCase() ?? "—"}
            </div>
          ) : null}
        </div>
        {props.onSchedule ? (
          <button
            type="button"
            onClick={props.onSchedule}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--brand)",
              background: "var(--brand)",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Agendar
          </button>
        ) : null}
      </section>

      <section>
        <h3
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            color: "var(--text-2)",
            margin: 0,
            marginBottom: 8,
          }}
        >
          Historial de mantenimientos ({props.history.length})
        </h3>
        {props.history.length === 0 ? (
          <div
            style={{
              padding: 18,
              textAlign: "center",
              color: "var(--text-3)",
              background: "var(--bg-elev)",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            Aún no hay mantenimientos completados.
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {props.history.map((m) => (
              <li
                key={m.id}
                style={{
                  padding: 10,
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                  color: "var(--text-1)",
                }}
              >
                <span style={{ fontFamily: "monospace" }}>{m.date}</span>
                <span style={{ display: "flex", gap: 14, color: "var(--text-2)" }}>
                  <span>BoP {m.bopPct}%</span>
                  <span>Plaque {m.plaquePct}%</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
