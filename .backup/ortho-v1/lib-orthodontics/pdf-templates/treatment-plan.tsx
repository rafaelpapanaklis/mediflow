// Orthodontics — PDF "Plan de tratamiento al paciente". A4 vertical, 4 páginas. SPEC §9.1.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { TreatmentPlanPdfData } from "@/app/actions/orthodontics/exportTreatmentPlanPdf";
import { techniqueLabel } from "../consent-texts";
import { PHASE_LABELS } from "../kanban-helpers";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0F172A" },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 8 },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6, color: "#334155" },
  meta: { fontSize: 9, color: "#64748B", marginBottom: 4 },
  paragraph: { marginBottom: 6, lineHeight: 1.5 },
  box: { padding: 10, backgroundColor: "#F1F5F9", borderRadius: 4, marginBottom: 12 },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: "#475569", width: 200 },
  metricValue: { color: "#0F172A", fontWeight: 700 },
  bullet: { marginLeft: 12, marginBottom: 3 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#CBD5E1", marginVertical: 8 },
});

export function TreatmentPlanPdf({ data }: { data: TreatmentPlanPdfData }) {
  const today = data.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString("es-MX")
    : new Date().toLocaleDateString("es-MX");

  return (
    <Document>
      {/* Página 1 — datos + diagnóstico traducido */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Plan de tratamiento ortodóntico</Text>
        <Text style={styles.meta}>
          Paciente: {data.patient.firstName} {data.patient.lastName} · Fecha: {today}
        </Text>
        <Text style={styles.meta}>
          Dr./Dra. {data.doctor.firstName} {data.doctor.lastName} · Cédula{" "}
          {data.doctor.cedulaProfesional ?? "—"}
        </Text>
        <Text style={styles.meta}>{data.clinic.name}</Text>

        <View style={styles.box}>
          <Text style={styles.h2}>Tu diagnóstico</Text>
          <Text>
            Clase Angle derecha: {data.diagnosis.angleClassRight} · izquierda:{" "}
            {data.diagnosis.angleClassLeft}.
          </Text>
          <Text>
            Overbite: {data.diagnosis.overbiteMm} mm · Overjet:{" "}
            {data.diagnosis.overjetMm} mm.
          </Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.h2}>Resumen clínico</Text>
          <Text style={styles.paragraph}>{data.diagnosis.clinicalSummary}</Text>
        </View>
      </Page>

      {/* Página 2 — plan + fases */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Tu plan de tratamiento</Text>
        <View style={styles.box}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Técnica:</Text>
            <Text style={styles.metricValue}>{techniqueLabel(data.plan.technique as never)}</Text>
          </View>
          {data.plan.techniqueNotes ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Detalle de técnica:</Text>
              <Text style={styles.metricValue}>{data.plan.techniqueNotes}</Text>
            </View>
          ) : null}
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Duración estimada:</Text>
            <Text style={styles.metricValue}>{data.plan.estimatedDurationMonths} meses</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Anclaje:</Text>
            <Text style={styles.metricValue}>{data.plan.anchorageType.toLowerCase()}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Objetivos:</Text>
            <Text style={styles.metricValue}>
              {data.plan.treatmentObjectives.replaceAll("_", " ").toLowerCase()}
            </Text>
          </View>
          {data.plan.extractionsRequired ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Extracciones:</Text>
              <Text style={styles.metricValue}>
                FDI {data.plan.extractionsTeethFdi.join(", ") || "—"}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.h2}>Las 6 fases del tratamiento</Text>
        {data.phases.map((p) => (
          <View key={p.phaseKey} style={{ ...styles.bullet, flexDirection: "row" }}>
            <Text style={{ width: 18 }}>{p.orderIndex + 1}.</Text>
            <Text>
              {PHASE_LABELS[p.phaseKey as never] ?? p.phaseKey} ·{" "}
              {p.status === "COMPLETED"
                ? "completada"
                : p.status === "IN_PROGRESS"
                  ? "en curso"
                  : p.status === "DELAYED"
                    ? "atrasada"
                    : "pendiente"}
            </Text>
          </View>
        ))}
      </Page>

      {/* Página 3 — costos */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Costos</Text>
        <View style={styles.box}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Costo total del tratamiento:</Text>
            <Text style={styles.metricValue}>${data.plan.totalCostMxn} MXN</Text>
          </View>
          <Text style={styles.paragraph}>
            El acuerdo financiero detallado (enganche, mensualidades, día de pago,
            métodos aceptados, cláusulas de retraso y abandono) se firma en
            documento separado. Solicita una copia a recepción.
          </Text>
        </View>
      </Page>

      {/* Página 4 — riesgos + plan retención */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Lo que necesitas saber</Text>
        <View style={styles.box}>
          <Text style={styles.h2}>Plan de retención</Text>
          <Text style={styles.paragraph}>{data.plan.retentionPlanText}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.h2}>Qué esperar mes a mes</Text>
          <Text style={styles.bullet}>• Cita mensual de control (~30-45 min).</Text>
          <Text style={styles.bullet}>• Higiene exhaustiva: cepillado 3 veces al día + hilo dental.</Text>
          <Text style={styles.bullet}>• Si te ponen elásticos: úsalos al menos 22 horas al día.</Text>
          <Text style={styles.bullet}>
            • Avisa de inmediato si se rompe un bracket, sale un elástico, o tienes dolor anormal.
          </Text>
        </View>
        <View style={styles.divider} />
        <Text style={styles.meta}>
          Este documento es informativo. El consentimiento firmado contiene los términos legales completos.
        </Text>
      </Page>
    </Document>
  );
}
