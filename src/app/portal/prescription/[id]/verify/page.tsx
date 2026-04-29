export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

interface PageProps {
  params: { id: string };
}

/**
 * /portal/prescription/[id]/verify — verificación pública por farmacia.
 * NO requiere auth: cualquier persona con el QR/URL puede ver la receta.
 *
 * Multi-tenant: la receta tiene clinicId pero al ser una verificación
 * pública del documento, no hay scope adicional que aplicar — el QR
 * único (16-byte hex unique) actúa como token de bearer.
 */
export default async function VerifyPrescriptionPage({ params }: PageProps) {
  const rx = await prisma.prescription.findUnique({
    where: { id: params.id },
    include: {
      patient: { select: { firstName: true, lastName: true, dob: true, gender: true, curp: true } },
      doctor:  {
        select: {
          firstName: true,
          lastName: true,
          cedulaProfesional: true,
          cedulaEspecialidad: true,
          especialidad: true,
        },
      },
      clinic:  { select: { name: true, clues: true, address: true, phone: true } },
      items:   { include: { cums: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (!rx) notFound();

  const now = new Date();
  const expired = rx.expiresAt ? rx.expiresAt < now : false;
  const issuedDate = rx.issuedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  const expiresDate = rx.expiresAt ? rx.expiresAt.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const patientFullName = `${rx.patient.firstName} ${rx.patient.lastName}`;
  const doctorFullName = `Dr/a. ${rx.doctor.firstName} ${rx.doctor.lastName}`;

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "clamp(20px, 4vw, 48px)",
        fontFamily: "var(--font-sora, 'Sora', system-ui, sans-serif)",
        color: "#0f172a",
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          marginBottom: 20,
          background: expired ? "#fee2e2" : "#dcfce7",
          color: expired ? "#991b1b" : "#166534",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {expired ? "⚠ Receta vencida — no debe ser surtida" : "✓ Receta válida y vigente"}
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Receta médica electrónica</h1>
      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 28 }}>
        Folio: <code style={{ fontFamily: "monospace" }}>{rx.qrCode}</code>
      </p>

      <Section title="Médico tratante">
        <p><b>{doctorFullName}</b></p>
        {rx.doctor.especialidad && <p>Especialidad: {rx.doctor.especialidad}</p>}
        {rx.doctor.cedulaProfesional && (
          <p>Cédula profesional: <code style={{ fontFamily: "monospace" }}>{rx.doctor.cedulaProfesional}</code></p>
        )}
        {rx.doctor.cedulaEspecialidad && (
          <p>Cédula de especialidad: <code style={{ fontFamily: "monospace" }}>{rx.doctor.cedulaEspecialidad}</code></p>
        )}
      </Section>

      <Section title="Establecimiento">
        <p><b>{rx.clinic.name}</b></p>
        {rx.clinic.clues && <p>CLUES: <code style={{ fontFamily: "monospace" }}>{rx.clinic.clues}</code></p>}
        {rx.clinic.address && <p>{rx.clinic.address}</p>}
        {rx.clinic.phone && <p>Tel: {rx.clinic.phone}</p>}
      </Section>

      <Section title="Paciente">
        <p><b>{patientFullName}</b></p>
        {rx.patient.curp && <p>CURP: <code style={{ fontFamily: "monospace" }}>{rx.patient.curp}</code></p>}
        {rx.patient.dob && (
          <p>Fecha de nacimiento: {new Date(rx.patient.dob).toLocaleDateString("es-MX")}</p>
        )}
        <p>Sexo: {rx.patient.gender === "M" ? "Masculino" : rx.patient.gender === "F" ? "Femenino" : "Otro"}</p>
      </Section>

      <Section title="Medicamentos prescritos">
        {rx.items.length === 0 ? (
          <p style={{ color: "#64748b" }}>Sin items registrados (receta legacy).</p>
        ) : (
          <ol style={{ paddingLeft: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            {rx.items.map((it) => (
              <li key={it.id}>
                <p><b>{it.cums.descripcion}</b></p>
                <p style={{ fontSize: 13 }}>{it.cums.presentacion}</p>
                <p style={{ fontSize: 13, color: "#475569" }}>
                  <b>Dosis:</b> {it.dosage}
                  {it.duration && <> · <b>Duración:</b> {it.duration}</>}
                  {it.quantity && <> · <b>Cantidad:</b> {it.quantity}</>}
                </p>
                {it.notes && <p style={{ fontSize: 12, color: "#64748b" }}>{it.notes}</p>}
                {it.cums.cofeprisGroup && (
                  <p style={{ fontSize: 11, color: "#b91c1c", fontWeight: 700 }}>
                    Sustancia controlada — Grupo COFEPRIS {it.cums.cofeprisGroup}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        {rx.indications && (
          <div style={{ marginTop: 14, padding: 12, background: "#f8fafc", borderRadius: 8 }}>
            <b>Indicaciones generales:</b>
            <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{rx.indications}</p>
          </div>
        )}
      </Section>

      <Section title="Vigencia">
        <p>Emitida el {issuedDate}.</p>
        <p>Válida hasta el {expiresDate}.</p>
        {rx.cofeprisGroup && <p>Clasificación COFEPRIS: <b>Grupo {rx.cofeprisGroup}</b></p>}
        {rx.cofeprisFolio && <p>Folio COFEPRIS: <code style={{ fontFamily: "monospace" }}>{rx.cofeprisFolio}</code></p>}
      </Section>

      <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 32, textAlign: "center" }}>
        Documento verificable en {rx.verifyUrl}
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22, borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {title}
      </h2>
      <div style={{ fontSize: 14 }}>{children}</div>
    </section>
  );
}
