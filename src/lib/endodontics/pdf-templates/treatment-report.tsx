// Endodontics — PDF "Informe al doctor referente". A4 vertical. Spec §11.1.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EndoTreatmentReportPdfData } from "@/app/actions/endodontics/reports";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0F172A" },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 6 },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 4, color: "#334155", textTransform: "uppercase" },
  meta: { fontSize: 9, color: "#64748B", marginBottom: 4 },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  box: { padding: 10, backgroundColor: "#F1F5F9", borderRadius: 4, marginBottom: 12 },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: "#475569", width: 200 },
  metricValue: { color: "#0F172A", fontWeight: 700 },
  table: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 4, marginBottom: 10 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#CBD5E1", padding: "4 6" },
  trHead: { backgroundColor: "#F1F5F9", fontWeight: 700 },
  signature: { marginTop: 28, paddingTop: 28, borderTopWidth: 1, borderTopColor: "#94A3B8" },
});

const PULPAL_LABEL: Record<string, string> = {
  PULPA_NORMAL: "Pulpa normal",
  PULPITIS_REVERSIBLE: "Pulpitis reversible",
  PULPITIS_IRREVERSIBLE_SINTOMATICA: "Pulpitis irreversible sintomática",
  PULPITIS_IRREVERSIBLE_ASINTOMATICA: "Pulpitis irreversible asintomática",
  NECROSIS_PULPAR: "Necrosis pulpar",
  PREVIAMENTE_TRATADO: "Previamente tratado",
  PREVIAMENTE_INICIADO: "Previamente iniciado",
};
const PERIAPICAL_LABEL: Record<string, string> = {
  TEJIDOS_PERIAPICALES_NORMALES: "Tejidos periapicales normales",
  PERIODONTITIS_APICAL_SINTOMATICA: "Periodontitis apical sintomática",
  PERIODONTITIS_APICAL_ASINTOMATICA: "Periodontitis apical asintomática",
  ABSCESO_APICAL_AGUDO: "Absceso apical agudo",
  ABSCESO_APICAL_CRONICO: "Absceso apical crónico",
  OSTEITIS_CONDENSANTE: "Osteitis condensante",
};
const TREATMENT_TYPE_LABEL: Record<string, string> = {
  TC_PRIMARIO: "Tratamiento de conductos primario",
  RETRATAMIENTO: "Retratamiento endodóntico",
  APICECTOMIA: "Apicectomía",
  PULPOTOMIA_EMERGENCIA: "Pulpotomía de emergencia",
  TERAPIA_REGENERATIVA: "Terapia regenerativa",
};

export function TreatmentReportPdf({ data }: { data: EndoTreatmentReportPdfData }) {
  const today = new Date(data.generatedAt).toLocaleDateString("es-MX");
  const fmt = (d: Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  const dx = data.diagnosis;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: "#0F172A",
            marginBottom: 12,
          }}
        >
          <View>
            <Text style={{ fontSize: 11, fontWeight: 700 }}>{data.clinic.name}</Text>
            <Text style={styles.meta}>Informe endodóntico al doctor referente</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 10 }}>
              Dr./Dra. {data.doctor.firstName} {data.doctor.lastName}
            </Text>
            <Text style={styles.meta}>Cédula: {data.doctor.cedulaProfesional ?? "—"}</Text>
            <Text style={styles.meta}>Generado: {today}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Datos del paciente</Text>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Nombre:</Text>
          <Text style={styles.metricValue}>
            {data.patient.firstName} {data.patient.lastName}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Expediente:</Text>
          <Text style={styles.metricValue}>{data.patient.patientNumber}</Text>
        </View>
        {data.patient.dob ? (
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Fecha de nacimiento:</Text>
            <Text style={styles.metricValue}>{fmt(data.patient.dob)}</Text>
          </View>
        ) : null}

        <Text style={styles.h2}>Diagnóstico AAE</Text>
        {dx ? (
          <View style={styles.box}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Pulpar:</Text>
              <Text style={styles.metricValue}>
                {PULPAL_LABEL[dx.pulpalDiagnosis] ?? dx.pulpalDiagnosis}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Periapical:</Text>
              <Text style={styles.metricValue}>
                {PERIAPICAL_LABEL[dx.periapicalDiagnosis] ?? dx.periapicalDiagnosis}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Diagnosticado:</Text>
              <Text style={styles.metricValue}>{fmt(dx.diagnosedAt)}</Text>
            </View>
            {dx.justification ? (
              <Text style={{ ...styles.paragraph, marginTop: 4 }}>{dx.justification}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.paragraph}>Sin diagnóstico documentado.</Text>
        )}

        <Text style={styles.h2}>Tratamiento realizado</Text>
        <View style={styles.box}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Tipo:</Text>
            <Text style={styles.metricValue}>
              {TREATMENT_TYPE_LABEL[data.treatment.type] ?? data.treatment.type}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Diente FDI:</Text>
            <Text style={styles.metricValue}>{data.treatment.toothFdi}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sesiones:</Text>
            <Text style={styles.metricValue}>
              {data.treatment.sessionsCount} ({data.treatment.isMultiSession ? "multi-sesión" : "una sesión"})
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Inicio:</Text>
            <Text style={styles.metricValue}>{fmt(data.treatment.startedAt)}</Text>
          </View>
          {data.treatment.completedAt ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Cierre:</Text>
              <Text style={styles.metricValue}>{fmt(data.treatment.completedAt)}</Text>
            </View>
          ) : null}
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sistema:</Text>
            <Text style={styles.metricValue}>
              {data.treatment.instrumentationSystem ?? "—"}
              {data.treatment.technique ? ` · ${data.treatment.technique}` : ""}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Obturación:</Text>
            <Text style={styles.metricValue}>
              {data.treatment.obturationTechnique ?? "—"}
              {data.treatment.sealer ? ` (sellador ${data.treatment.sealer})` : ""}
            </Text>
          </View>
        </View>

        <Text style={styles.h2}>Conductos tratados</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={{ width: 90 }}>Conducto</Text>
            <Text style={{ width: 70, textAlign: "right" }}>LT (mm)</Text>
            <Text style={{ width: 60, textAlign: "right" }}>Lima ISO</Text>
            <Text style={{ width: 60, textAlign: "right" }}>Conicidad</Text>
            <Text style={{ flex: 1 }}>Calidad obturación</Text>
          </View>
          {data.rootCanals.length > 0 ? (
            data.rootCanals.map((c, i) => (
              <View key={i} style={styles.tr}>
                <Text style={{ width: 90 }}>
                  {c.canonicalName.replaceAll("_", " ").toLowerCase()}
                </Text>
                <Text style={{ width: 70, textAlign: "right" }}>{c.workingLengthMm}</Text>
                <Text style={{ width: 60, textAlign: "right" }}>{c.masterApicalFileIso}</Text>
                <Text style={{ width: 60, textAlign: "right" }}>{c.masterApicalFileTaper}</Text>
                <Text style={{ flex: 1 }}>{c.obturationQuality?.toLowerCase() ?? "—"}</Text>
              </View>
            ))
          ) : (
            <View style={styles.tr}>
              <Text style={{ flex: 1, textAlign: "center", color: "#94A3B8" }}>
                Sin conductos registrados
              </Text>
            </View>
          )}
        </View>

        {data.treatment.requiresPost ? (
          <View style={styles.box}>
            <Text style={styles.h2}>Recomendación de restauración</Text>
            <Text>
              Tipo: {data.treatment.restorationPlan ?? "—"}
              {data.treatment.restorationUrgencyDays != null
                ? ` · Plazo recomendado: ${data.treatment.restorationUrgencyDays} días`
                : ""}
              .
            </Text>
          </View>
        ) : null}

        {data.followUps.length > 0 ? (
          <>
            <Text style={styles.h2}>Plan de seguimiento</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={{ width: 110 }}>Hito</Text>
                <Text style={{ width: 110 }}>Programado</Text>
                <Text style={{ width: 110 }}>Realizado</Text>
                <Text style={{ width: 60, textAlign: "right" }}>PAI</Text>
                <Text style={{ flex: 1 }}>Conclusión</Text>
              </View>
              {data.followUps.map((f, i) => (
                <View key={i} style={styles.tr}>
                  <Text style={{ width: 110 }}>{f.milestone.replaceAll("_", " ").toLowerCase()}</Text>
                  <Text style={{ width: 110 }}>{fmt(f.scheduledAt)}</Text>
                  <Text style={{ width: 110 }}>{f.performedAt ? fmt(f.performedAt) : "—"}</Text>
                  <Text style={{ width: 60, textAlign: "right" }}>{f.paiScore ?? "—"}</Text>
                  <Text style={{ flex: 1 }}>{f.conclusion?.replaceAll("_", " ").toLowerCase() ?? "—"}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.signature}>
          <Text style={{ fontSize: 9 }}>
            _________________________________________________
          </Text>
          <Text style={{ fontSize: 9 }}>
            Dr./Dra. {data.doctor.firstName} {data.doctor.lastName}
          </Text>
          <Text style={{ fontSize: 9 }}>
            Cédula profesional: {data.doctor.cedulaProfesional ?? "—"}
          </Text>
          <Text style={{ fontSize: 8, color: "#64748B", marginTop: 6 }}>
            Documento generado conforme a NOM-024-SSA3-2012 · Expediente {data.patient.patientNumber}.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
