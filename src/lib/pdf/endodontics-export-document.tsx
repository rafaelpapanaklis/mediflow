// Endodontics — PDF "Export completo del módulo" para un paciente.
// Mismo patrón que PediatricsExportDocument: el caller (action server)
// arma el DTO, este componente lo renderiza vía @react-pdf/renderer.
//
// Secciones (Spec):
//   1. Portada (clínica + paciente + médico + rango fechas + diente activo)
//   2. Línea de tiempo del diente activo
//   3. Historial de diagnósticos AAE (pulpar + periapical)
//   4. Pruebas de vitalidad
//   5. Mapa canalicular por TC (lima maestra + calidad obturación)
//   6. Cada sesión con materiales (sistema, técnica, obturación, cemento)
//   7. Controles 6m / 12m / 24m con PAI score
//   8. Fotos clínicas (lista de URLs sin embed para mantener PDF liviano)
//   9. RX comparativo (referencias a PatientFile)

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

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
  OSTEITIS_CONDENSANTE: "Osteítis condensante",
};

const FOLLOWUP_MILESTONE_LABEL: Record<string, string> = {
  CONTROL_6M: "Control 6 meses",
  CONTROL_12M: "Control 12 meses",
  CONTROL_24M: "Control 24 meses",
  CONTROL_EXTRA: "Control extra",
};

const FOLLOWUP_CONCLUSION_LABEL: Record<string, string> = {
  EXITO: "Éxito",
  EN_CURACION: "En cicatrización",
  FRACASO: "Fracaso",
  INCIERTO: "Incierto",
};

const OBTURATION_QUALITY_LABEL: Record<string, string> = {
  HOMOGENEA: "Homogénea",
  ADECUADA: "Adecuada",
  CON_HUECOS: "Con huecos",
  SOBREOBTURADA: "Sobreobturada",
  SUBOBTURADA: "Subobturada",
};

export function describePAI(pai: number | null): string {
  if (pai === null || pai === undefined) return "—";
  const map: Record<number, string> = {
    1: "PAI 1 — Estructuras periapicales normales",
    2: "PAI 2 — Pequeños cambios óseos",
    3: "PAI 3 — Cambios óseos con pérdida mineral",
    4: "PAI 4 — Periodontitis apical bien definida",
    5: "PAI 5 — Periodontitis apical severa con expansión",
  };
  return map[pai] ?? `PAI ${pai}`;
}

export interface EndoExportDiagnosis {
  toothFdi: number;
  pulpalDiagnosis: string;
  periapicalDiagnosis: string;
  justification: string | null;
  diagnosedAt: string;
}

export interface EndoExportVitality {
  toothFdi: number;
  testType: string;
  result: string;
  evaluatedAt: string;
  notes: string | null;
}

export interface EndoExportRootCanal {
  canonicalName: string;
  workingLengthMm: string;
  masterApicalFileIso: number;
  masterApicalFileTaper: string;
  obturationQuality: string | null;
}

export interface EndoExportFollowUp {
  milestone: string;
  scheduledAt: string;
  performedAt: string | null;
  paiScore: number | null;
  conclusion: string | null;
}

export interface EndoExportTreatment {
  toothFdi: number;
  treatmentType: string;
  startedAt: string;
  completedAt: string | null;
  instrumentationSystem: string | null;
  technique: string | null;
  obturationTechnique: string | null;
  sealer: string | null;
  notes: string | null;
  rootCanals: EndoExportRootCanal[];
  followUps: EndoExportFollowUp[];
}

export interface EndoExportPhoto {
  photoType: string;
  stage: string;
  capturedAt: string;
  toothFdi: number | null;
}

export interface EndoExportRadiograph {
  fileName: string;
  category: string;
  takenAt: string | null;
  /** Origen: conductometry / control / intraoperative / generic. */
  source: "conductometry" | "control" | "intraoperative" | "generic";
  /** Hito legible (ej. "Control 12 meses"). */
  milestone: string | null;
}

export interface EndoExportData {
  clinicName: string;
  doctorName: string;
  generatedAt: string;
  patientName: string;
  patientNumber: string;
  patientDob: string | null;
  fromDate: string | null;
  toDate: string | null;
  /** Diente focal del export. null = todas las piezas tratadas. */
  toothFdi: number | null;
  diagnoses: EndoExportDiagnosis[];
  vitalityTests: EndoExportVitality[];
  treatments: EndoExportTreatment[];
  photos: EndoExportPhoto[];
  radiographs: EndoExportRadiograph[];
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0F172A" },
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  h2: {
    fontSize: 12,
    fontWeight: 700,
    marginTop: 12,
    marginBottom: 4,
    color: "#334155",
    textTransform: "uppercase",
  },
  meta: { fontSize: 9, color: "#475569", marginBottom: 4 },
  tx: {
    border: 1,
    borderColor: "#CBD5E1",
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  txTitle: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  table: { borderWidth: 0.5, borderColor: "#CBD5E1", borderRadius: 4, marginTop: 4 },
  tHead: { flexDirection: "row", backgroundColor: "#F1F5F9", padding: "4 6" },
  tRow: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: "#CBD5E1",
    padding: "4 6",
  },
  cell: { fontSize: 9 },
  label: { fontSize: 9, color: "#64748B", textTransform: "uppercase" },
  block: { marginBottom: 8 },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function EndodonticsExportDocument(data: EndoExportData) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{data.clinicName}</Text>
        <Text style={styles.meta}>Resumen endodóntico · paciente {data.patientName}</Text>
        <Text style={styles.meta}>
          Expediente {data.patientNumber}
          {data.patientDob ? ` · Nac. ${fmtDate(data.patientDob)}` : ""}
          {data.toothFdi ? ` · Pieza ${data.toothFdi}` : " · Todas las piezas"}
        </Text>
        <Text style={styles.meta}>
          Doctor: {data.doctorName} · Generado el {fmtDate(data.generatedAt)}
        </Text>

        <Text style={styles.h2}>Resumen ejecutivo</Text>
        <Text>
          {data.treatments.length} tratamiento(s) · {data.diagnoses.length} diagnóstico(s) AAE ·{" "}
          {data.vitalityTests.length} prueba(s) de vitalidad · {" "}
          {data.treatments.flatMap((t) => t.followUps).length} control(es) programado(s) · {" "}
          {data.radiographs.length} RX referenciada(s).
        </Text>

        {data.toothFdi !== null ? <ToothTimeline data={data} /> : null}

        <DiagnosesSection rows={data.diagnoses} />
        <VitalitySection rows={data.vitalityTests} />
      </Page>

      <Page size="A4" style={styles.page}>
        {data.treatments.map((t, i) => (
          <TreatmentBlock key={i} t={t} />
        ))}

        <FollowUpSummary rows={data.treatments.flatMap((t) => t.followUps.map((f) => ({ ...f, toothFdi: t.toothFdi })))} />
        <PhotosSection rows={data.photos} />
        <RadiographsSection rows={data.radiographs} />
      </Page>
    </Document>
  );
}

function ToothTimeline({ data }: { data: EndoExportData }) {
  const events: Array<{ at: string; label: string }> = [];
  for (const dx of data.diagnoses) {
    events.push({
      at: dx.diagnosedAt,
      label: `Dx ${PULPAL_LABEL[dx.pulpalDiagnosis] ?? dx.pulpalDiagnosis}`,
    });
  }
  for (const t of data.treatments) {
    events.push({ at: t.startedAt, label: `Inicio TC ${t.treatmentType}` });
    if (t.completedAt) events.push({ at: t.completedAt, label: "Cierre TC" });
    for (const f of t.followUps) {
      if (f.performedAt) {
        events.push({
          at: f.performedAt,
          label: `${FOLLOWUP_MILESTONE_LABEL[f.milestone] ?? f.milestone} · ${describePAI(f.paiScore)}`,
        });
      }
    }
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (events.length === 0) return null;
  return (
    <View>
      <Text style={styles.h2}>Línea de tiempo del diente</Text>
      {events.map((e, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            paddingVertical: 3,
            borderBottomWidth: 0.5,
            borderBottomColor: "#E2E8F0",
          }}
        >
          <Text style={{ width: 110, fontSize: 9, color: "#475569" }}>{fmtDate(e.at)}</Text>
          <Text style={{ flex: 1, fontSize: 10 }}>{e.label}</Text>
        </View>
      ))}
    </View>
  );
}

function DiagnosesSection({ rows }: { rows: EndoExportDiagnosis[] }) {
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={styles.h2}>Historial de diagnósticos AAE</Text>
      <View style={styles.table}>
        <View style={styles.tHead}>
          <Text style={[styles.cell, { width: 80 }]}>Fecha</Text>
          <Text style={[styles.cell, { width: 40 }]}>FDI</Text>
          <Text style={[styles.cell, { flex: 1 }]}>Pulpar</Text>
          <Text style={[styles.cell, { flex: 1 }]}>Periapical</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={styles.tRow}>
            <Text style={[styles.cell, { width: 80 }]}>{fmtDate(r.diagnosedAt)}</Text>
            <Text style={[styles.cell, { width: 40 }]}>{r.toothFdi}</Text>
            <Text style={[styles.cell, { flex: 1 }]}>
              {PULPAL_LABEL[r.pulpalDiagnosis] ?? r.pulpalDiagnosis}
            </Text>
            <Text style={[styles.cell, { flex: 1 }]}>
              {PERIAPICAL_LABEL[r.periapicalDiagnosis] ?? r.periapicalDiagnosis}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function VitalitySection({ rows }: { rows: EndoExportVitality[] }) {
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={styles.h2}>Pruebas de vitalidad</Text>
      <View style={styles.table}>
        <View style={styles.tHead}>
          <Text style={[styles.cell, { width: 80 }]}>Fecha</Text>
          <Text style={[styles.cell, { width: 40 }]}>FDI</Text>
          <Text style={[styles.cell, { width: 80 }]}>Tipo</Text>
          <Text style={[styles.cell, { flex: 1 }]}>Resultado</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={styles.tRow}>
            <Text style={[styles.cell, { width: 80 }]}>{fmtDate(r.evaluatedAt)}</Text>
            <Text style={[styles.cell, { width: 40 }]}>{r.toothFdi}</Text>
            <Text style={[styles.cell, { width: 80 }]}>{r.testType}</Text>
            <Text style={[styles.cell, { flex: 1 }]}>
              {r.result}
              {r.notes ? ` · ${r.notes}` : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TreatmentBlock({ t }: { t: EndoExportTreatment }) {
  return (
    <View style={styles.tx}>
      <Text style={styles.txTitle}>
        TC {t.treatmentType} · FDI {t.toothFdi} · {fmtDate(t.startedAt)} → {fmtDate(t.completedAt)}
      </Text>
      <View style={styles.block}>
        <Text style={styles.label}>Materiales / técnica</Text>
        <Text>
          Sistema: {t.instrumentationSystem ?? "—"} · Técnica: {t.technique ?? "—"} · Obturación:{" "}
          {t.obturationTechnique ?? "—"} · Cemento: {t.sealer ?? "—"}
        </Text>
      </View>
      {t.rootCanals.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.label}>Mapa canalicular</Text>
          <View style={styles.table}>
            <View style={styles.tHead}>
              <Text style={[styles.cell, { flex: 1 }]}>Conducto</Text>
              <Text style={[styles.cell, { width: 70 }]}>Long. trabajo</Text>
              <Text style={[styles.cell, { width: 90 }]}>Lima maestra</Text>
              <Text style={[styles.cell, { width: 100 }]}>Calidad</Text>
            </View>
            {t.rootCanals.map((rc, i) => (
              <View key={i} style={styles.tRow}>
                <Text style={[styles.cell, { flex: 1 }]}>{rc.canonicalName}</Text>
                <Text style={[styles.cell, { width: 70 }]}>{rc.workingLengthMm} mm</Text>
                <Text style={[styles.cell, { width: 90 }]}>
                  {rc.masterApicalFileIso}/{rc.masterApicalFileTaper}
                </Text>
                <Text style={[styles.cell, { width: 100 }]}>
                  {rc.obturationQuality
                    ? OBTURATION_QUALITY_LABEL[rc.obturationQuality] ?? rc.obturationQuality
                    : "—"}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {t.notes ? (
        <View style={styles.block}>
          <Text style={styles.label}>Notas</Text>
          <Text>{t.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

function FollowUpSummary({
  rows,
}: {
  rows: Array<EndoExportFollowUp & { toothFdi: number }>;
}) {
  const performed = rows.filter((r) => r.performedAt);
  if (performed.length === 0) return null;
  return (
    <View>
      <Text style={styles.h2}>Controles 6m / 12m / 24m con PAI</Text>
      <View style={styles.table}>
        <View style={styles.tHead}>
          <Text style={[styles.cell, { width: 80 }]}>Fecha</Text>
          <Text style={[styles.cell, { width: 40 }]}>FDI</Text>
          <Text style={[styles.cell, { width: 100 }]}>Hito</Text>
          <Text style={[styles.cell, { width: 50 }]}>PAI</Text>
          <Text style={[styles.cell, { flex: 1 }]}>Conclusión</Text>
        </View>
        {performed.map((r, i) => (
          <View key={i} style={styles.tRow}>
            <Text style={[styles.cell, { width: 80 }]}>{fmtDate(r.performedAt)}</Text>
            <Text style={[styles.cell, { width: 40 }]}>{r.toothFdi}</Text>
            <Text style={[styles.cell, { width: 100 }]}>
              {FOLLOWUP_MILESTONE_LABEL[r.milestone] ?? r.milestone}
            </Text>
            <Text style={[styles.cell, { width: 50 }]}>{r.paiScore ?? "—"}</Text>
            <Text style={[styles.cell, { flex: 1 }]}>
              {r.conclusion ? FOLLOWUP_CONCLUSION_LABEL[r.conclusion] ?? r.conclusion : "—"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PhotosSection({ rows }: { rows: EndoExportPhoto[] }) {
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={styles.h2}>Fotos clínicas registradas ({rows.length})</Text>
      {rows.slice(0, 30).map((p, i) => (
        <Text key={i} style={{ fontSize: 9, marginBottom: 2 }}>
          {fmtDate(p.capturedAt)} · {p.photoType} · stage {p.stage}
          {p.toothFdi ? ` · FDI ${p.toothFdi}` : ""}
        </Text>
      ))}
    </View>
  );
}

function RadiographsSection({ rows }: { rows: EndoExportRadiograph[] }) {
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={styles.h2}>Radiografías referenciadas</Text>
      {rows.map((r, i) => (
        <Text key={i} style={{ fontSize: 9, marginBottom: 2 }}>
          {fmtDate(r.takenAt)} · {r.fileName} · {r.category}
          {r.milestone ? ` · ${r.milestone}` : ""}
        </Text>
      ))}
    </View>
  );
}
