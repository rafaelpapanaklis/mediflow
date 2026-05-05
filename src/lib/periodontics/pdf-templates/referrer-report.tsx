// Periodontics — PDF "Reporte legal al médico tratante". SPEC §9.2.
// Lenguaje técnico. Usado para diabéticos / embarazadas / cardiópatas /
// oncológicos. NOM-024-SSA3-2012 + LFPDPPP (consentimiento explícito).

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PerioMetrics } from "../periodontogram-math";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#0F172A",
  },
  clinicBlock: { fontSize: 9, color: "#0F172A" },
  doctorBlock: { fontSize: 9, color: "#0F172A", textAlign: "right" },
  h1: { fontSize: 16, fontWeight: "bold", marginBottom: 6, color: "#0F172A" },
  h2: {
    fontSize: 11,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
    color: "#0F172A",
    textTransform: "uppercase",
  },
  meta: { fontSize: 9, color: "#475569", marginBottom: 3 },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  metric: { flexDirection: "row", marginBottom: 2 },
  metricLabel: { color: "#475569", width: 220 },
  metricValue: { color: "#0F172A" },
  bullet: { marginLeft: 12, marginBottom: 2 },
  signature: { marginTop: 30, paddingTop: 30, borderTopWidth: 1, borderTopColor: "#94A3B8" },
});

export type ReferrerReportProps = {
  patient: {
    name: string;
    age: number;
    systemicCondition?: string | null;
  };
  doctor: { name: string; licenseNumber: string; specialty?: string };
  clinic: { name: string; phone?: string; address?: string };
  classification?: {
    stage: string;
    grade?: string | null;
    extension?: string | null;
  } | null;
  metrics: PerioMetrics;
  planSummary?: string;
  prognosis?: string;
  coordinationNotes?: string;
  generatedAt?: string;
};

export function ReferrerReportPDF(props: ReferrerReportProps) {
  const today = props.generatedAt ?? new Date().toLocaleDateString("es-MX");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.clinicBlock}>
            <Text>{props.clinic.name}</Text>
            {props.clinic.phone ? <Text>{props.clinic.phone}</Text> : null}
            {props.clinic.address ? <Text>{props.clinic.address}</Text> : null}
          </View>
          <View style={styles.doctorBlock}>
            <Text>Dr./Dra. {props.doctor.name}</Text>
            <Text>Cédula profesional: {props.doctor.licenseNumber}</Text>
            <Text>{props.doctor.specialty ?? "Periodoncia"}</Text>
          </View>
        </View>

        <Text style={styles.h1}>Reporte periodontal — médico tratante</Text>
        <Text style={styles.meta}>Generado el {today}</Text>

        <Text style={styles.h2}>Datos del paciente</Text>
        <Text style={styles.paragraph}>
          {props.patient.name}, {props.patient.age} años.
          {props.patient.systemicCondition
            ? ` Condición sistémica relevante: ${props.patient.systemicCondition}.`
            : ""}
        </Text>

        <Text style={styles.h2}>Diagnóstico periodontal (clasificación 2017 AAP/EFP)</Text>
        <Text style={styles.paragraph}>
          {props.classification
            ? formatClassification(props.classification)
            : "El paciente aún no cuenta con clasificación 2017 documentada."}
        </Text>

        <Text style={styles.h2}>Hallazgos relevantes</Text>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Sangrado al sondaje (BoP):</Text>
          <Text style={styles.metricValue}>{props.metrics.bopPct}%</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Índice de placa O'Leary:</Text>
          <Text style={styles.metricValue}>{props.metrics.plaquePct}%</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Sitios con PD 1-3 mm:</Text>
          <Text style={styles.metricValue}>{props.metrics.sites1to3}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Sitios con PD 4-5 mm:</Text>
          <Text style={styles.metricValue}>{props.metrics.sites4to5}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Sitios con PD ≥6 mm:</Text>
          <Text style={styles.metricValue}>{props.metrics.sites6plus}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Dientes con bolsa ≥5 mm:</Text>
          <Text style={styles.metricValue}>{props.metrics.teethWithPockets5plus}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>PD promedio:</Text>
          <Text style={styles.metricValue}>{props.metrics.avgPd} mm</Text>
        </View>

        <Text style={styles.h2}>Plan periodontal y pronóstico</Text>
        <Text style={styles.paragraph}>
          {props.planSummary ?? "Plan en cuatro fases: control de la infección, terapia mecánica, reevaluación y mantenimiento."}
        </Text>
        {props.prognosis ? <Text style={styles.paragraph}>{props.prognosis}</Text> : null}

        <Text style={styles.h2}>Recomendaciones de coordinación interdisciplinaria</Text>
        <Text style={styles.paragraph}>
          {props.coordinationNotes ??
            "Se sugiere coordinación con la especialidad de tratamiento sistémico para optimizar el control de factores de riesgo modificables (tabaquismo, control glucémico) que impactan la respuesta al tratamiento periodontal."}
        </Text>

        <View style={styles.signature}>
          <Text style={{ fontSize: 9 }}>
            _________________________________________________
          </Text>
          <Text style={{ fontSize: 9 }}>
            Dr./Dra. {props.doctor.name} — Cédula {props.doctor.licenseNumber}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function formatClassification(c: {
  stage: string;
  grade?: string | null;
  extension?: string | null;
}): string {
  const stage = c.stage.replace("_", " ");
  const grade = c.grade ? c.grade.replace("GRADE_", "Grado ") : null;
  const ext = c.extension
    ? c.extension === "PATRON_MOLAR_INCISIVO"
      ? "patrón molar/incisivo"
      : c.extension.toLowerCase()
    : null;
  const parts = [stage];
  if (grade) parts.push(grade);
  if (ext) parts.push(ext);
  return parts.join(" · ");
}
