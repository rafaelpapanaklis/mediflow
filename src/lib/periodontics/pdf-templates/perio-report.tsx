// Periodontics — PDF "Informe periodontal del paciente". SPEC §9.1.
// Lenguaje accesible, no técnico. 4-6 páginas.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PerioMetrics } from "../periodontogram-math";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 18, fontWeight: "bold", marginBottom: 8, color: "#0F172A" },
  h2: { fontSize: 14, fontWeight: "bold", marginTop: 16, marginBottom: 6, color: "#334155" },
  meta: { fontSize: 9, color: "#64748B", marginBottom: 4 },
  sectionBox: {
    padding: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: 4,
    marginBottom: 12,
  },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: "#64748B", width: 180 },
  metricValue: { color: "#0F172A", fontWeight: "bold" },
  bullet: { marginLeft: 12, marginBottom: 3 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#CBD5E1", marginVertical: 8 },
});

export type PerioReportProps = {
  patient: { name: string; age: number };
  doctor: { name: string; licenseNumber: string };
  clinicName: string;
  classification?: {
    stage: string;
    grade?: string | null;
    extension?: string | null;
  } | null;
  metrics: PerioMetrics;
  recommendations: string[];
  planPhase?: string;
  nextAppointmentAt?: string;
  generatedAt?: string;
};

/**
 * Traduce la clasificación 2017 a frase plain Spanish para pacientes.
 * Stage IV/Grade C es el caso más severo; la traducción es deliberadamente
 * tranquilizadora ("rápida progresión" en lugar de "agresiva").
 */
export function translateClassificationToPlainSpanish(c: {
  stage: string;
  grade?: string | null;
  extension?: string | null;
}): string {
  const stageMap: Record<string, string> = {
    SALUD: "Tus encías están sanas",
    GINGIVITIS: "Inflamación de encías (gingivitis)",
    STAGE_I: "Periodontitis inicial (Estadio I)",
    STAGE_II: "Periodontitis moderada (Estadio II)",
    STAGE_III: "Periodontitis avanzada (Estadio III)",
    STAGE_IV: "Periodontitis avanzada con pérdida significativa (Estadio IV)",
  };
  const gradeMap: Record<string, string> = {
    GRADE_A: "progresión lenta",
    GRADE_B: "progresión moderada",
    GRADE_C: "progresión rápida",
  };
  const extMap: Record<string, string> = {
    LOCALIZADA: "localizada",
    GENERALIZADA: "generalizada",
    PATRON_MOLAR_INCISIVO: "con patrón molar/incisivo",
  };
  const parts = [stageMap[c.stage] ?? c.stage];
  if (c.grade) parts.push(`con ${gradeMap[c.grade] ?? c.grade}`);
  if (c.extension) parts.push(extMap[c.extension] ?? c.extension);
  return parts.join(", ");
}

export function PerioReportPDF(props: PerioReportProps) {
  const today = props.generatedAt ?? new Date().toLocaleDateString("es-MX");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Informe periodontal</Text>
        <Text style={styles.meta}>
          Paciente: {props.patient.name} · Edad: {props.patient.age} años · Fecha: {today}
        </Text>
        <Text style={styles.meta}>
          Dr./Dra. {props.doctor.name} · Cédula {props.doctor.licenseNumber}
        </Text>
        <Text style={styles.meta}>{props.clinicName}</Text>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>Tu diagnóstico</Text>
          <Text>
            {props.classification
              ? translateClassificationToPlainSpanish(props.classification)
              : "Tu evaluación periodontal aún no ha sido clasificada."}
          </Text>
        </View>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>Métricas clínicas de hoy</Text>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sangrado al sondaje (BoP):</Text>
            <Text style={styles.metricValue}>{props.metrics.bopPct}%</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Índice de placa O'Leary:</Text>
            <Text style={styles.metricValue}>{props.metrics.plaquePct}%</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sitios sanos (1-3 mm):</Text>
            <Text style={styles.metricValue}>{props.metrics.sites1to3}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sitios moderados (4-5 mm):</Text>
            <Text style={styles.metricValue}>{props.metrics.sites4to5}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sitios profundos (≥6 mm):</Text>
            <Text style={styles.metricValue}>{props.metrics.sites6plus}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Dientes con bolsa ≥5 mm:</Text>
            <Text style={styles.metricValue}>{props.metrics.teethWithPockets5plus}</Text>
          </View>
        </View>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>Tu plan de tratamiento</Text>
          <Text>
            {props.planPhase
              ? `Estás en la ${labelPhase(props.planPhase)}. ${describePhase(props.planPhase)}`
              : "Tu plan de tratamiento se definirá en la siguiente cita."}
          </Text>
          {props.nextAppointmentAt ? (
            <Text style={{ marginTop: 6 }}>
              Tu próxima cita: <Text style={{ fontWeight: "bold" }}>{props.nextAppointmentAt}</Text>
            </Text>
          ) : null}
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Recomendaciones de higiene</Text>
        <Text style={styles.meta}>Personalizadas según tus hallazgos de hoy.</Text>
        <View style={styles.divider} />
        {props.recommendations.length > 0 ? (
          props.recommendations.map((r, i) => (
            <Text key={i} style={styles.bullet}>
              • {r}
            </Text>
          ))
        ) : (
          <Text>
            Mantén tu higiene diaria: cepillado 3 veces al día con técnica de Bass modificada,
            uso de hilo dental o cepillos interproximales en cada limpieza, y enjuague
            antimicrobiano según indicación.
          </Text>
        )}
      </Page>
    </Document>
  );
}

function labelPhase(phase: string): string {
  const map: Record<string, string> = {
    PHASE_1: "Fase 1 — Control de la inflamación",
    PHASE_2: "Fase 2 — Tratamiento periodontal",
    PHASE_3: "Fase 3 — Reevaluación y cirugía si es necesaria",
    PHASE_4: "Fase 4 — Mantenimiento periodontal",
  };
  return map[phase] ?? phase;
}

function describePhase(phase: string): string {
  const map: Record<string, string> = {
    PHASE_1: "Vamos a controlar la inflamación con higiene profesional y mejor técnica diaria.",
    PHASE_2: "Vamos a hacer raspado y alisado radicular para eliminar el sarro bajo la encía.",
    PHASE_3: "Vamos a revisar tu progreso y, si quedan zonas profundas, planeamos cirugía mínima.",
    PHASE_4: "Vienes cada 3-6 meses para mantener tus encías sanas a largo plazo.",
  };
  return map[phase] ?? "";
}
