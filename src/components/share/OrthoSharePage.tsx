// Vista pública del paciente para módulo Ortodoncia. Render server-safe
// (sin "use client") porque el server action ya resolvió todos los datos.

import type { OrthoShareStats } from "@/lib/clinical-shared/share/summary-orthodontics";

export interface OrthoSharePageProps {
  patientFirstName: string;
  clinicName: string;
  summary: string;
  stats: OrthoShareStats;
}

export function OrthoSharePage(props: OrthoSharePageProps) {
  const progress = computeProgressPercent(props.stats);
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        background: "var(--surface-2, #f5f5f7)",
        color: "var(--text-1, #14101f)",
      }}
    >
      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          background: "var(--surface-1, #ffffff)",
          border: "1px solid var(--border, #e5e5ed)",
          borderRadius: 14,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <header>
          <h1 style={{ margin: 0, fontSize: 24 }}>
            Hola, {props.patientFirstName}
          </h1>
          <small style={{ fontSize: 12, color: "var(--text-2, #6b6b78)" }}>
            {props.clinicName} · Tu progreso ortodóntico
          </small>
        </header>

        {props.stats.estimatedDurationMonths != null ? (
          <section
            aria-label="Progreso del tratamiento"
            style={{
              padding: 16,
              background: "var(--brand-soft, rgba(99,102,241,0.08))",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <strong style={{ fontSize: 14, color: "var(--brand, #6366f1)" }}>
              Mes {props.stats.monthInTreatment ?? 0} /{" "}
              {props.stats.estimatedDurationMonths}
            </strong>
            <div
              style={{
                height: 10,
                borderRadius: 5,
                background: "var(--surface-2, #f5f5f7)",
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "var(--brand, #6366f1)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <small style={{ fontSize: 12, color: "var(--text-2, #6b6b78)" }}>
              Faltan aproximadamente {props.stats.remainingMonths ?? 0} mes(es).
            </small>
          </section>
        ) : null}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Resumen de tu doctor</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0 }}>
            {props.summary}
          </p>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
          }}
        >
          <Stat label="Fase actual" value={props.stats.currentPhase ?? "—"} />
          <Stat label="Técnica" value={props.stats.technique ?? "—"} />
          <Stat
            label="Sesiones de fotos"
            value={String(props.stats.totalPhotoSets)}
          />
        </section>

        <footer
          style={{
            paddingTop: 14,
            borderTop: "1px solid var(--border, #e5e5ed)",
            fontSize: 11,
            color: "var(--text-3, #9b9aa8)",
            textAlign: "center",
          }}
        >
          Información generada por tu clínica vía MediFlow. Si tienes dudas,
          contáctala directamente.
        </footer>
      </article>
    </main>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--surface-2, #f5f5f7)",
        border: "1px solid var(--border, #e5e5ed)",
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-2, #6b6b78)", textTransform: "uppercase" }}>
        {props.label}
      </div>
      <strong style={{ fontSize: 14 }}>{props.value}</strong>
    </div>
  );
}

function computeProgressPercent(stats: OrthoShareStats): number {
  if (stats.monthInTreatment == null || stats.estimatedDurationMonths == null) return 0;
  if (stats.estimatedDurationMonths <= 0) return 0;
  const pct = (stats.monthInTreatment / stats.estimatedDurationMonths) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
