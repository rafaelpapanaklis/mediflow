// Orthodontics — Ola 1 (ws1-t6), A13: carta de avance al doctor que refirió
// al paciente. Una página, A4. Mismo estilo (StyleSheet, tipografía) que
// treatment-plan.tsx — no reinventa el look de los PDFs de ortodoncia.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { ReferralProgressLetterPdfData } from "@/app/actions/orthodontics/exportReferralProgressLetterPdf";
import { techniqueLabel } from "../consent-texts";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10.5, fontFamily: "Helvetica", color: "#0F172A" },
  header: { marginBottom: 24 },
  clinicName: { fontSize: 13, fontWeight: 700 },
  clinicMeta: { fontSize: 9, color: "#64748B", marginTop: 2 },
  date: { fontSize: 9, color: "#64748B", marginTop: 12 },
  salutation: { marginTop: 18, marginBottom: 10, fontSize: 11 },
  paragraph: { marginBottom: 10, lineHeight: 1.6 },
  box: { padding: 12, backgroundColor: "#F1F5F9", borderRadius: 4, marginVertical: 12 },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: "#475569", width: 160 },
  metricValue: { color: "#0F172A", fontWeight: 700 },
  signature: { marginTop: 36 },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: "#94A3B8", width: 220, marginBottom: 4 },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, fontSize: 8, color: "#94A3B8" },
});

export function ReferralProgressLetterPdf({ data }: { data: ReferralProgressLetterPdfData }) {
  const today = new Date(data.generatedAt).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const doctorName = data.treatingDoctor
    ? `Dr./Dra. ${data.treatingDoctor.firstName} ${data.treatingDoctor.lastName}`
    : "El equipo tratante";
  const patientName = `${data.patient.firstName} ${data.patient.lastName}`.trim();
  const isInicio = data.stage === "inicio";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.clinicName}>{data.clinic.name}</Text>
          <Text style={styles.clinicMeta}>
            {[data.clinic.phone, data.clinic.email].filter(Boolean).join(" · ") || "—"}
          </Text>
          <Text style={styles.date}>{today}</Text>
        </View>

        <Text style={styles.salutation}>
          Estimado/a {data.referredByDoctor.fullName}
          {data.referredByDoctor.clinicName ? ` (${data.referredByDoctor.clinicName})` : ""}:
        </Text>

        {isInicio ? (
          <Text style={styles.paragraph}>
            Le escribimos para informarle que su paciente, {patientName}, a quien nos refirió, ha iniciado
            tratamiento de ortodoncia en nuestra clínica. Agradecemos la confianza al referirlo/a con
            nosotros y le compartimos un breve resumen del caso:
          </Text>
        ) : (
          <Text style={styles.paragraph}>
            Le escribimos para informarle que su paciente, {patientName}, a quien nos refirió, ha concluido
            su tratamiento de ortodoncia en nuestra clínica. Agradecemos nuevamente la confianza al
            referirlo/a con nosotros y le compartimos un breve resumen del resultado:
          </Text>
        )}

        <View style={styles.box}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Clasificación Angle:</Text>
            <Text style={styles.metricValue}>
              der. {data.diagnosis.angleClassRight.replaceAll("_", " ").toLowerCase()} · izq.{" "}
              {data.diagnosis.angleClassLeft.replaceAll("_", " ").toLowerCase()}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Técnica utilizada:</Text>
            <Text style={styles.metricValue}>{techniqueLabel(data.plan.technique as never)}</Text>
          </View>
          {isInicio ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Duración estimada:</Text>
              <Text style={styles.metricValue}>{data.plan.estimatedDurationMonths} meses</Text>
            </View>
          ) : (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Plan de retención:</Text>
              <Text style={styles.metricValue}>{data.plan.retentionPlanText}</Text>
            </View>
          )}
        </View>

        <Text style={styles.paragraph}>
          {isInicio
            ? "Le mantendremos informado/a sobre la evolución del caso. Quedamos a sus órdenes para cualquier información adicional."
            : "Quedamos a sus órdenes para cualquier información adicional sobre el caso, y para seguir refiriéndole pacientes con la misma confianza."}
        </Text>

        <View style={styles.signature}>
          <View style={styles.signatureLine} />
          <Text>{doctorName}</Text>
          {data.treatingDoctor?.cedulaProfesional ? (
            <Text style={{ fontSize: 9, color: "#64748B" }}>
              Cédula profesional {data.treatingDoctor.cedulaProfesional}
            </Text>
          ) : null}
          <Text style={{ fontSize: 9, color: "#64748B" }}>{data.clinic.name}</Text>
        </View>

        <Text style={styles.footer}>
          Documento generado por DaleControl. No sustituye el expediente clínico completo del paciente.
        </Text>
      </Page>
    </Document>
  );
}
