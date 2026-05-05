// Endodontics — PDF "Informe legal NOM-024". A4 vertical extenso. Spec §11.2.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EndoLegalReportPdfData } from "@/app/actions/endodontics/reports";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#0F172A" },
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 4, color: "#334155", textTransform: "uppercase" },
  meta: { fontSize: 8, color: "#64748B", marginBottom: 4 },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  box: { padding: 8, backgroundColor: "#F1F5F9", borderRadius: 4, marginBottom: 10 },
  metric: { flexDirection: "row", marginBottom: 2 },
  metricLabel: { color: "#475569", width: 200, fontSize: 9 },
  metricValue: { color: "#0F172A", fontWeight: 700, fontSize: 9 },
  table: { borderWidth: 0.5, borderColor: "#CBD5E1", borderRadius: 3, marginBottom: 10 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#CBD5E1", padding: "3 5" },
  trHead: { backgroundColor: "#F1F5F9", fontWeight: 700, fontSize: 8 },
  certification: {
    marginTop: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: "#0F172A",
    borderRadius: 4,
    fontSize: 9,
    lineHeight: 1.4,
  },
  signature: { marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: "#94A3B8" },
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
const TEST_LABEL: Record<string, string> = {
  FRIO: "Frío",
  CALOR: "Calor",
  EPT: "EPT",
  PERCUSION_VERTICAL: "Percusión vertical",
  PERCUSION_HORIZONTAL: "Percusión horizontal",
  PALPACION_APICAL: "Palpación apical",
  MORDIDA_TOOTHSLOOTH: "Mordida (Tooth Slooth)",
};

export function LegalReportPdf({ data }: { data: EndoLegalReportPdfData }) {
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
            <Text style={styles.meta}>Informe legal endodóntico — NOM-024-SSA3-2012</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 10 }}>
              Dr./Dra. {data.doctor.firstName} {data.doctor.lastName}
            </Text>
            <Text style={styles.meta}>Cédula: {data.doctor.cedulaProfesional ?? "—"}</Text>
            <Text style={styles.meta}>Generado: {today}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Identificación del paciente</Text>
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

        <Text style={styles.h2}>Pruebas de vitalidad documentadas</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={{ width: 90 }}>Prueba</Text>
            <Text style={{ width: 50 }}>FDI</Text>
            <Text style={{ width: 110 }}>Resultado</Text>
            <Text style={{ width: 60, textAlign: "right" }}>Intensidad</Text>
            <Text style={{ flex: 1 }}>Realizada</Text>
          </View>
          {data.vitalityTests.length > 0 ? (
            data.vitalityTests.map((v, i) => (
              <View key={i} style={styles.tr}>
                <Text style={{ width: 90 }}>{TEST_LABEL[v.testType] ?? v.testType}</Text>
                <Text style={{ width: 50 }}>{v.toothFdi}</Text>
                <Text style={{ width: 110 }}>{v.result.toLowerCase()}</Text>
                <Text style={{ width: 60, textAlign: "right" }}>
                  {v.intensity != null ? `${v.intensity}/10` : "—"}
                </Text>
                <Text style={{ flex: 1 }}>{fmt(v.performedAt)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.tr}>
              <Text style={{ flex: 1, textAlign: "center", color: "#94A3B8" }}>
                Sin pruebas de vitalidad documentadas
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.h2}>Tratamiento + protocolo</Text>
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
            <Text style={styles.metricLabel}>Sistema instrumentación:</Text>
            <Text style={styles.metricValue}>
              {data.treatment.instrumentationSystem ?? "—"}
              {data.treatment.technique ? ` · ${data.treatment.technique}` : ""}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Técnica obturación:</Text>
            <Text style={styles.metricValue}>
              {data.treatment.obturationTechnique ?? "—"}
              {data.treatment.sealer ? ` (sellador ${data.treatment.sealer})` : ""}
            </Text>
          </View>
        </View>

        <Text style={styles.h2}>Conductos + obturación</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={{ width: 90 }}>Conducto</Text>
            <Text style={{ width: 70, textAlign: "right" }}>LT (mm)</Text>
            <Text style={{ width: 60, textAlign: "right" }}>Lima ISO</Text>
            <Text style={{ width: 60, textAlign: "right" }}>Conicidad</Text>
            <Text style={{ flex: 1 }}>Calidad</Text>
          </View>
          {data.rootCanals.map((c, i) => (
            <View key={i} style={styles.tr}>
              <Text style={{ width: 90 }}>
                {c.canonicalName.replaceAll("_", " ").toLowerCase()}
              </Text>
              <Text style={{ width: 70, textAlign: "right" }}>{c.workingLengthMm}</Text>
              <Text style={{ width: 60, textAlign: "right" }}>{c.masterApicalFileIso}</Text>
              <Text style={{ width: 60, textAlign: "right" }}>{c.masterApicalFileTaper}</Text>
              <Text style={{ flex: 1 }}>{c.obturationQuality?.toLowerCase() ?? "—"}</Text>
            </View>
          ))}
        </View>

        {data.intracanalMedications.length > 0 ? (
          <>
            <Text style={styles.h2}>Medicación intraconducto</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={{ width: 90 }}>Conducto</Text>
                <Text style={{ width: 130 }}>Medicación</Text>
                <Text style={{ width: 100 }}>Colocada</Text>
                <Text style={{ flex: 1 }}>Retirada</Text>
              </View>
              {data.intracanalMedications.map((m, i) => (
                <View key={i} style={styles.tr}>
                  <Text style={{ width: 90 }}>{m.canalName ?? "—"}</Text>
                  <Text style={{ width: 130 }}>{m.medication}</Text>
                  <Text style={{ width: 100 }}>{fmt(m.placedAt)}</Text>
                  <Text style={{ flex: 1 }}>
                    {m.removedAt ? fmt(m.removedAt) : "Sigue colocada"}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {data.retreatmentReason ? (
          <View style={styles.box}>
            <Text style={styles.h2}>Motivo de retratamiento</Text>
            <Text>{data.retreatmentReason}</Text>
          </View>
        ) : null}
        {data.apicalSurgeryNotes ? (
          <View style={styles.box}>
            <Text style={styles.h2}>Notas de apicectomía</Text>
            <Text>{data.apicalSurgeryNotes}</Text>
          </View>
        ) : null}

        {data.followUps.length > 0 ? (
          <>
            <Text style={styles.h2}>Controles programados / realizados</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={{ width: 90 }}>Hito</Text>
                <Text style={{ width: 100 }}>Programado</Text>
                <Text style={{ width: 100 }}>Realizado</Text>
                <Text style={{ width: 50, textAlign: "right" }}>PAI</Text>
                <Text style={{ flex: 1 }}>Conclusión</Text>
              </View>
              {data.followUps.map((f, i) => (
                <View key={i} style={styles.tr}>
                  <Text style={{ width: 90 }}>
                    {f.milestone.replaceAll("_", " ").toLowerCase()}
                  </Text>
                  <Text style={{ width: 100 }}>{fmt(f.scheduledAt)}</Text>
                  <Text style={{ width: 100 }}>{f.performedAt ? fmt(f.performedAt) : "—"}</Text>
                  <Text style={{ width: 50, textAlign: "right" }}>{f.paiScore ?? "—"}</Text>
                  <Text style={{ flex: 1 }}>
                    {f.conclusion?.replaceAll("_", " ").toLowerCase() ?? "—"}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.certification}>
          <Text style={{ fontWeight: 700, marginBottom: 4 }}>
            Certificación NOM-024-SSA3-2012
          </Text>
          <Text>
            Documento generado por MediFlow conforme a la Norma Oficial Mexicana
            NOM-024-SSA3-2012 que establece los objetivos funcionales y
            funcionalidades que deberán observar los productos de Sistemas de
            Expediente Clínico Electrónico para garantizar la interoperabilidad,
            procesamiento, interpretación, confidencialidad, seguridad y uso de
            estándares y catálogos de la información del paciente.
          </Text>
          <Text style={{ marginTop: 4 }}>
            Expediente clínico número {data.patient.patientNumber}. Conservación
            mínima 5 años conforme normativa aplicable.
          </Text>
        </View>

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
        </View>
      </Page>
    </Document>
  );
}
