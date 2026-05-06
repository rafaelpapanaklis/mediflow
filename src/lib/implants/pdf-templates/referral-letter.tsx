// Implants — Hoja de referencia entre especialistas (envío a cirujano oral,
// prostodoncista, periodoncista, endodoncista). A4 vertical formal.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface ImplantReferralLetterPdfData {
  patient: {
    firstName: string;
    lastName: string;
    age?: number | null;
    sex?: string | null;
  };
  fromDoctor: {
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
  };
  fromClinic: { name: string; phone: string | null; address: string | null };
  to: {
    clinicName: string | null;
    doctorName: string | null;
    specialty: string;
  };
  /** Asunto / título del envío. */
  subject: string;
  /** Motivo / razón. */
  reason: string;
  /** Resumen clínico. */
  summary: string;
  /** Plan sugerido (opcional). */
  treatmentPlan: string | null;
  /** Fecha de emisión. */
  issuedAt: Date;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0f172a",
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#1e3a8a",
    paddingBottom: 12,
    marginBottom: 18,
  },
  brand: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
  },
  brandSub: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  meta: {
    fontSize: 8,
    color: "#64748b",
  },
  recipientBox: {
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    padding: 10,
    marginBottom: 14,
    backgroundColor: "#f8fafc",
  },
  recipientLabel: {
    fontSize: 8,
    color: "#64748b",
    marginBottom: 2,
  },
  recipientValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 2,
  },
  paragraph: {
    fontSize: 10,
    marginBottom: 4,
    textAlign: "justify",
  },
  signatureBlock: {
    marginTop: 30,
    width: 240,
  },
  signatureLine: {
    borderTopWidth: 0.5,
    borderTopColor: "#0f172a",
    paddingTop: 4,
  },
  signatureName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  signatureSub: {
    fontSize: 8,
    color: "#64748b",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    paddingTop: 6,
    textAlign: "center",
  },
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function ImplantReferralLetterDocument(props: {
  data: ImplantReferralLetterPdfData;
}) {
  const d = props.data;
  const recipient =
    [d.to.doctorName, d.to.clinicName].filter(Boolean).join(" — ") ||
    "Profesional de la salud";

  return (
    <Document
      title={`Hoja de referencia — ${d.patient.firstName} ${d.patient.lastName}`}
      author={d.fromClinic.name}
      subject={d.subject}
    >
      <Page size="A4" style={styles.page}>
        {/* header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{d.fromClinic.name}</Text>
            {d.fromClinic.phone ? (
              <Text style={styles.brandSub}>Tel {d.fromClinic.phone}</Text>
            ) : null}
            {d.fromClinic.address ? (
              <Text style={styles.brandSub}>{d.fromClinic.address}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>Hoja de referencia</Text>
            <Text style={styles.meta}>{fmtDate(d.issuedAt)}</Text>
          </View>
        </View>

        {/* destinatario */}
        <View style={styles.recipientBox}>
          <Text style={styles.recipientLabel}>Para</Text>
          <Text style={styles.recipientValue}>{recipient}</Text>
          <Text style={styles.meta}>Especialidad: {d.to.specialty}</Text>
        </View>

        {/* asunto */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Asunto</Text>
          <Text style={styles.paragraph}>{d.subject}</Text>
        </View>

        {/* paciente */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Paciente</Text>
          <Text style={styles.paragraph}>
            {d.patient.firstName} {d.patient.lastName}
            {d.patient.age != null ? ` · ${d.patient.age} años` : ""}
            {d.patient.sex ? ` · ${d.patient.sex}` : ""}
          </Text>
        </View>

        {/* motivo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Motivo del envío</Text>
          <Text style={styles.paragraph}>{d.reason}</Text>
        </View>

        {/* resumen clínico */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resumen clínico</Text>
          <Text style={styles.paragraph}>{d.summary}</Text>
        </View>

        {/* plan */}
        {d.treatmentPlan ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Plan de tratamiento sugerido</Text>
            <Text style={styles.paragraph}>{d.treatmentPlan}</Text>
          </View>
        ) : null}

        {/* firma */}
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine}>
            <Text style={styles.signatureName}>
              Dr. {d.fromDoctor.firstName} {d.fromDoctor.lastName}
            </Text>
            <Text style={styles.signatureSub}>
              {d.fromDoctor.cedulaProfesional
                ? `Céd. Prof. ${d.fromDoctor.cedulaProfesional}`
                : "Cédula profesional pendiente de registro"}
            </Text>
          </View>
        </View>

        <Text fixed style={styles.footer}>
          Documento de referencia clínica. Confidencial.
        </Text>
      </Page>
    </Document>
  );
}
