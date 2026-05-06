// Periodontics — vista pública /share/p/[token]. SPEC §11, COMMIT 8.

interface LatestRecord {
  bopPercentage: number | null;
  plaquePercentage: number | null;
  sitesAtRisk: number;
  teethAtRisk: number;
  recordedAt: string;
}

interface Classification {
  stage: string;
  grade: string | null;
  extension: string | null;
  classifiedAt: string;
}

interface Plan {
  currentPhase: string;
  nextEvaluationAt: string | null;
}

export interface PerioShareViewProps {
  patientFirstName: string;
  clinicName: string;
  clinicLogoUrl: string | null;
  latestRecord: LatestRecord | null;
  classification: Classification | null;
  plan: Plan | null;
  lastSrpAt: string | null;
  expiresAt: string;
}

const STAGE_LABEL: Record<string, string> = {
  SALUD: "Encías sanas",
  GINGIVITIS: "Gingivitis",
  STAGE_I: "Periodontitis inicial (Estadio I)",
  STAGE_II: "Periodontitis moderada (Estadio II)",
  STAGE_III: "Periodontitis severa (Estadio III)",
  STAGE_IV: "Periodontitis avanzada (Estadio IV)",
};

const GRADE_LABEL: Record<string, string> = {
  GRADE_A: "Grado A — progresión lenta",
  GRADE_B: "Grado B — progresión moderada",
  GRADE_C: "Grado C — progresión rápida",
};

const PHASE_LABEL: Record<string, string> = {
  PHASE_1: "Fase 1 — Higiene y motivación",
  PHASE_2: "Fase 2 — Raspado y alisado radicular",
  PHASE_3: "Fase 3 — Cirugía periodontal",
  PHASE_4: "Fase 4 — Mantenimiento",
};

export function PerioShareView(props: PerioShareViewProps) {
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-1)",
        color: "var(--text-1)",
        padding: "24px 16px 60px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 18px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 12,
          }}
        >
          {props.clinicLogoUrl ? (
            <img
              src={props.clinicLogoUrl}
              alt={props.clinicName}
              style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              {props.clinicName.charAt(0)}
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase" }}>
              Reporte periodontal
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              Hola, {props.patientFirstName}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              {props.clinicName}
            </div>
          </div>
        </header>

        {props.classification ? (
          <Section title="Diagnóstico actual">
            <Row
              label="Clasificación"
              value={STAGE_LABEL[props.classification.stage] ?? props.classification.stage}
            />
            {props.classification.grade ? (
              <Row
                label="Grado"
                value={GRADE_LABEL[props.classification.grade] ?? props.classification.grade}
              />
            ) : null}
            {props.classification.extension ? (
              <Row
                label="Extensión"
                value={extensionLabel(props.classification.extension)}
              />
            ) : null}
            <Row
              label="Clasificado"
              value={fmtDate(props.classification.classifiedAt)}
            />
          </Section>
        ) : null}

        {props.latestRecord ? (
          <Section title="Métricas de tu última revisión">
            {props.latestRecord.bopPercentage !== null ? (
              <Metric
                label="Sangrado al sondaje"
                value={`${Math.round(props.latestRecord.bopPercentage)}%`}
                hint={hintBop(props.latestRecord.bopPercentage)}
              />
            ) : null}
            {props.latestRecord.plaquePercentage !== null ? (
              <Metric
                label="Índice de placa (O'Leary)"
                value={`${Math.round(props.latestRecord.plaquePercentage)}%`}
                hint={hintPlaque(props.latestRecord.plaquePercentage)}
              />
            ) : null}
            <Metric
              label="Sitios con bolsa profunda (≥4 mm)"
              value={String(props.latestRecord.sitesAtRisk)}
            />
            <Metric
              label="Dientes con bolsa ≥5 mm"
              value={String(props.latestRecord.teethAtRisk)}
            />
            <Row
              label="Fecha del registro"
              value={fmtDate(props.latestRecord.recordedAt)}
            />
          </Section>
        ) : null}

        {props.plan ? (
          <Section title="Tu plan de tratamiento">
            <Row
              label="Fase actual"
              value={PHASE_LABEL[props.plan.currentPhase] ?? props.plan.currentPhase}
            />
            {props.plan.nextEvaluationAt ? (
              <Row
                label="Próxima evaluación"
                value={fmtDate(props.plan.nextEvaluationAt)}
              />
            ) : null}
            {props.lastSrpAt ? (
              <Row label="Último raspado" value={fmtDate(props.lastSrpAt)} />
            ) : null}
          </Section>
        ) : null}

        <footer
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            textAlign: "center",
            padding: 12,
          }}
        >
          Este enlace es válido hasta el {fmtDate(props.expiresAt)}.
          Información compartida por {props.clinicName}.
        </footer>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "var(--text-2)", textTransform: "uppercase" }}>
        {props.title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {props.children}
      </div>
    </section>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        fontSize: 14,
      }}
    >
      <span style={{ color: "var(--text-3)", fontSize: 12 }}>{props.label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: 500, textAlign: "right" }}>{props.value}</span>
    </div>
  );
}

function Metric(props: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>{props.label}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)" }}>{props.value}</span>
      </div>
      {props.hint ? (
        <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>{props.hint}</div>
      ) : null}
    </div>
  );
}

function hintBop(pct: number): string {
  if (pct < 10) return "Excelente. Sigue con tu técnica de cepillado.";
  if (pct < 25) return "Aceptable, hay margen de mejora con hilo dental diario.";
  return "Se recomienda reforzar higiene y uso de hilo dental.";
}

function hintPlaque(pct: number): string {
  if (pct < 20) return "Buena higiene general.";
  if (pct < 40) return "Hay áreas con placa acumulada — pregúntale a tu doctor.";
  return "Acumulación importante: programa una limpieza.";
}

function extensionLabel(ext: string): string {
  switch (ext) {
    case "LOCALIZADA":
      return "Localizada (<30% de sitios)";
    case "GENERALIZADA":
      return "Generalizada (≥30% de sitios)";
    case "PATRON_MOLAR_INCISIVO":
      return "Patrón molar-incisivo";
    default:
      return ext;
  }
}
