// Página pública /share/p/[token] — vista del paciente sin autenticación.
// Usa server action resolvePublicShareToken para validar token + cargar
// resumen del módulo origen.

import { resolvePublicShareToken } from "@/app/actions/clinical-shared/share-links";
import { isFailure } from "@/lib/clinical-shared/result";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: { token: string };
}

const MODULE_LABELS: Record<string, string> = {
  pediatrics: "Odontopediatría",
  endodontics: "Endodoncia",
  periodontics: "Periodoncia",
  implants: "Implantología",
  orthodontics: "Ortodoncia",
};

export default async function PublicSharePage(props: PageProps) {
  const res = await resolvePublicShareToken(props.params.token);

  if (isFailure(res)) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: 0, fontSize: 22, color: "var(--text-1)" }}>Link no disponible</h1>
          <p style={{ color: "var(--text-2)", marginTop: 8, fontSize: 14 }}>{res.error}</p>
        </div>
      </main>
    );
  }

  const v = res.data;

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <header
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingBottom: 12,
            borderBottom: "1px solid var(--border)",
            marginBottom: 16,
          }}
        >
          <small style={{ fontSize: 11, color: "var(--text-2)", letterSpacing: 0.5, textTransform: "uppercase" }}>
            {v.clinicName}
          </small>
          <h1 style={{ margin: 0, fontSize: 22, color: "var(--text-1)" }}>
            Resumen para {v.patientFirstName}
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>
            Módulo: {MODULE_LABELS[v.module] ?? v.module}
          </span>
        </header>

        <p
          style={{
            margin: 0,
            whiteSpace: "pre-line",
            fontSize: 14,
            color: "var(--text-1)",
            lineHeight: 1.6,
          }}
        >
          {v.summary || "Sin resumen disponible."}
        </p>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginTop: 18,
          }}
        >
          <Stat label="Sellantes" value={v.stats.sealants} />
          <Stat label="Aplicaciones de flúor" value={v.stats.fluorides} />
          <Stat label="Evaluaciones conductuales" value={v.stats.behaviorAssessments} />
          <Stat label="Consentimientos" value={v.stats.consents} />
        </section>

        <footer style={{ marginTop: 18, fontSize: 11, color: "var(--text-2)", textAlign: "center" }}>
          Compartido el {new Date(v.generatedAt).toLocaleDateString("es-MX")} ·
          MediFlow
        </footer>
      </div>
    </main>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <strong style={{ fontSize: 22, color: "var(--accent)" }}>{props.value}</strong>
      <span style={{ fontSize: 11, color: "var(--text-2)" }}>{props.label}</span>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "var(--surface-2)",
};

const cardStyle: React.CSSProperties = {
  width: "min(640px, 100%)",
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 24,
};
