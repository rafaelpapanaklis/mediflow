// Página pública /share/p/[token] — vista del paciente sin autenticación.
//
// Despacha por módulo:
//   - periodontics → PerioShareView (perio-específico, sprint perio)
//   - implants     → ImplantShareTimeline (timeline visual de fases)
//   - pediatrics y resto → vista genérica con stats vía resolvePublicShareToken
//                          (sprint pediatrics, modela stats pediátricos)

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolvePublicShareToken } from "@/app/actions/clinical-shared/share-links";
import { isFailure } from "@/lib/clinical-shared/result";
import ImplantShareTimeline from "./ImplantShareTimeline";
import { PerioShareView } from "./PerioShareView";

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
  // Peek module sin auth para despachar a vista perio-específica.
  // findUnique es indexado por token (@unique) — barato.
  const peek = await prisma.patientShareLink.findUnique({
    where: { token: props.params.token },
    select: { module: true },
  });

  if (peek?.module === "periodontics") {
    return <PerioShareSection token={props.params.token} />;
  }

  // Vista genérica (default) — utiliza resolvePublicShareToken.
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

  // Para implants, renderizamos timeline visual de fases (no stats genéricos).
  if (v.module === "implants") {
    return <ImplantSharePage token={props.params.token} clinicName={v.clinicName} patientFirstName={v.patientFirstName} />;
  }

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

// ── Sub-render perio ─────────────────────────────────────────────────

async function PerioShareSection({ token }: { token: string }) {
  const link = await prisma.patientShareLink.findUnique({
    where: { token },
    select: {
      id: true,
      module: true,
      patientId: true,
      clinicId: true,
      expiresAt: true,
      revokedAt: true,
      viewCount: true,
    },
  });

  if (!link || link.module !== "periodontics") notFound();
  if (link.revokedAt) return <PerioExpiredOrRevoked reason="revoked" />;
  if (link.expiresAt < new Date()) return <PerioExpiredOrRevoked reason="expired" />;

  const [patient, latestRecord, plan, lastSrp, classification] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: link.patientId, clinicId: link.clinicId, deletedAt: null },
      select: {
        firstName: true,
        clinic: { select: { name: true, logoUrl: true } },
      },
    }),
    prisma.periodontalRecord.findFirst({
      where: { patientId: link.patientId, clinicId: link.clinicId, deletedAt: null },
      orderBy: { recordedAt: "desc" },
      select: {
        bopPercentage: true,
        plaqueIndexOleary: true,
        sites4to5mm: true,
        sites6PlusMm: true,
        teethWithPockets5Plus: true,
        recordedAt: true,
      },
    }),
    prisma.periodontalTreatmentPlan.findFirst({
      where: { patientId: link.patientId, clinicId: link.clinicId, deletedAt: null },
      select: { currentPhase: true, nextEvaluationAt: true },
    }),
    prisma.sRPSession.findFirst({
      where: { patientId: link.patientId, clinicId: link.clinicId, deletedAt: null },
      orderBy: { performedAt: "desc" },
      select: { performedAt: true, technique: true },
    }),
    prisma.periodontalClassification.findFirst({
      where: { patientId: link.patientId, clinicId: link.clinicId },
      orderBy: { classifiedAt: "desc" },
      select: { stage: true, grade: true, extension: true, classifiedAt: true },
    }),
  ]);

  if (!patient) notFound();

  // Incrementa view count en background — no bloqueamos render si falla.
  prisma.patientShareLink
    .update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 }, lastViewed: new Date() },
    })
    .catch((e) => console.error("[perio share] view-count update failed:", e));

  return (
    <PerioShareView
      patientFirstName={patient.firstName}
      clinicName={patient.clinic.name}
      clinicLogoUrl={patient.clinic.logoUrl}
      latestRecord={
        latestRecord
          ? {
              bopPercentage: latestRecord.bopPercentage,
              plaquePercentage: latestRecord.plaqueIndexOleary,
              sitesAtRisk:
                (latestRecord.sites4to5mm ?? 0) + (latestRecord.sites6PlusMm ?? 0),
              teethAtRisk: latestRecord.teethWithPockets5Plus ?? 0,
              recordedAt: latestRecord.recordedAt.toISOString(),
            }
          : null
      }
      classification={
        classification
          ? {
              stage: classification.stage,
              grade: classification.grade,
              extension: classification.extension,
              classifiedAt: classification.classifiedAt.toISOString(),
            }
          : null
      }
      plan={
        plan
          ? {
              currentPhase: plan.currentPhase,
              nextEvaluationAt: plan.nextEvaluationAt?.toISOString() ?? null,
            }
          : null
      }
      lastSrpAt={lastSrp?.performedAt.toISOString() ?? null}
      expiresAt={link.expiresAt.toISOString()}
    />
  );
}

function PerioExpiredOrRevoked({ reason }: { reason: "expired" | "revoked" }) {
  const title = reason === "expired" ? "Enlace expirado" : "Enlace revocado";
  const desc =
    reason === "expired"
      ? "Este enlace ya no está vigente. Solicita uno nuevo a tu clínica."
      : "Este enlace fue revocado por la clínica. Comunícate con ellos para más información.";
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: 0, fontSize: 22, color: "var(--text-1)" }}>{title}</h1>
        <p style={{ color: "var(--text-2)", marginTop: 8, fontSize: 14 }}>{desc}</p>
      </div>
    </main>
  );
}

// ── Vista genérica (estilos compartidos) ─────────────────────────────

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

// ── Implants — timeline visual de fases ─────────────────────────────

async function ImplantSharePage({
  token,
  clinicName,
  patientFirstName,
}: {
  token: string;
  clinicName: string;
  patientFirstName: string;
}) {
  // Token ya fue validado por resolvePublicShareToken; recargamos el link
  // para obtener patientId/clinicId y consultar el implante asociado.
  const link = await prisma.patientShareLink.findUnique({
    where: { token },
    select: { patientId: true, clinicId: true },
  });
  if (!link) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Link no disponible</h1>
        </div>
      </main>
    );
  }

  const implant = await prisma.implant.findFirst({
    where: { patientId: link.patientId, clinicId: link.clinicId },
    orderBy: { placedAt: "desc" },
    select: {
      id: true,
      toothFdi: true,
      brand: true,
      brandCustomName: true,
      modelName: true,
      diameterMm: true,
      lengthMm: true,
      placedAt: true,
      currentStatus: true,
      protocol: true,
      surgicalRecord: { select: { performedAt: true } },
      healingPhase: {
        select: {
          startedAt: true,
          expectedDurationWeeks: true,
          completedAt: true,
        },
      },
      secondStage: { select: { performedAt: true } },
      prostheticPhase: { select: { prosthesisDeliveredAt: true } },
      followUps: {
        orderBy: { performedAt: "asc" },
        select: {
          milestone: true,
          performedAt: true,
          meetsAlbrektssonCriteria: true,
        },
      },
    },
  });

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted-fg)]">
          {clinicName}
        </p>
        <h1 className="text-2xl font-semibold">Hola, {patientFirstName}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-fg)]">
          Aquí puedes seguir las fases del tratamiento de tu implante.
        </p>
      </header>

      {implant ? (
        <ImplantShareTimeline
          implant={{
            toothFdi: implant.toothFdi,
            brand: implant.brandCustomName ?? implant.brand,
            modelName: implant.modelName,
            diameterMm: String(implant.diameterMm),
            lengthMm: String(implant.lengthMm),
            placedAt: implant.placedAt.toISOString(),
            currentStatus: implant.currentStatus,
            protocol: implant.protocol,
            surgicalAt: implant.surgicalRecord?.performedAt?.toISOString() ?? null,
            healingStartedAt:
              implant.healingPhase?.startedAt?.toISOString() ?? null,
            healingCompletedAt:
              implant.healingPhase?.completedAt?.toISOString() ?? null,
            healingExpectedWeeks:
              implant.healingPhase?.expectedDurationWeeks ?? null,
            secondStageAt: implant.secondStage?.performedAt?.toISOString() ?? null,
            prosthesisDeliveredAt:
              implant.prostheticPhase?.prosthesisDeliveredAt?.toISOString() ??
              null,
            followUps: implant.followUps.map((f) => ({
              milestone: f.milestone,
              performedAt: f.performedAt?.toISOString() ?? null,
              meetsAlbrektssonCriteria: f.meetsAlbrektssonCriteria,
            })),
          }}
        />
      ) : (
        <p className="text-sm text-[var(--color-muted-fg)]">
          Aún no hay información disponible para mostrar.
        </p>
      )}

      <footer className="mt-10 border-t border-[var(--border)] pt-4 text-center text-xs text-[var(--color-muted-fg)]">
        Información compartida por su clínica. Para cualquier duda,
        contáctenos.
      </footer>
    </main>
  );
}
