import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * PediatricsExportDocument — PDF estructurado del módulo Pediatría
 * para imprimir/compartir el expediente. Secciones:
 *   1. Portada (datos clínica + paciente + médico + rango de fechas)
 *   2. Eruption timeline
 *   3. CAMBRA history
 *   4. Behavior Frankl timeline
 *   5. Sealants
 *   6. Fluoride applications
 *   7. Habits
 *   8. Consents
 *   9. Photos thumbnail (URL listada, sin embed binario en este MVP)
 */

export interface PedExportEruptionRow {
  toothFdi: number;
  observedAt: string;
  ageDecimal: string;
  withinExpectedRange: boolean;
  deviation: string;
}
export interface PedExportCambraRow {
  scoredAt: string;
  category: string;
  recallMonths: number;
}
export interface PedExportBehaviorRow {
  recordedAt: string;
  scale: string;
  value: number;
  notes: string | null;
}
export interface PedExportSealantRow {
  toothFdi: number;
  placedAt: string;
  material: string;
  retentionStatus: string;
  reappliedAt: string | null;
}
export interface PedExportFluorideRow {
  appliedAt: string;
  product: string;
  teethCount: number;
  lotNumber: string | null;
}
export interface PedExportHabitRow {
  habitType: string;
  frequency: string;
  startedAt: string;
  endedAt: string | null;
}
export interface PedExportConsentRow {
  procedureType: string;
  guardianSignedAt: string | null;
  expiresAt: string;
}
export interface PedExportPhotoRow {
  photoType: string;
  stage: string;
  capturedAt: string;
}

export interface PediatricsExportDocumentProps {
  clinicName: string;
  doctorName: string;
  generatedAt: string;
  patientName: string;
  patientDob: string | null;
  patientGender: string | null;
  fromDate: string | null;
  toDate: string | null;
  eruption: PedExportEruptionRow[];
  cambra: PedExportCambraRow[];
  behavior: PedExportBehaviorRow[];
  sealants: PedExportSealantRow[];
  fluorides: PedExportFluorideRow[];
  habits: PedExportHabitRow[];
  consents: PedExportConsentRow[];
  photos: PedExportPhotoRow[];
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 9, color: "#14101f" },
  cover: { marginBottom: 22, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: "#7c3aed" },
  brand: { fontSize: 22, color: "#7c3aed", fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 11, color: "#6b6b78", marginTop: 4 },
  coverMeta: { marginTop: 10, flexDirection: "row", justifyContent: "space-between" },
  metaLabel: {
    fontSize: 8,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  metaValue: { fontSize: 11, color: "#14101f", fontFamily: "Helvetica-Bold", marginTop: 2 },
  sectionTitle: {
    fontSize: 12,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4dc",
  },
  th: {
    fontSize: 8,
    color: "#6b6b78",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.3,
    borderBottomColor: "#e5e5ed",
  },
  cell: { fontSize: 9, color: "#14101f" },
  empty: { fontSize: 9, color: "#9b9aa8", fontStyle: "italic", marginTop: 4 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#9b9aa8",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5ed",
    paddingTop: 6,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function PediatricsExportDocument(props: PediatricsExportDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.cover}>
          <Text style={styles.brand}>{props.clinicName}</Text>
          <Text style={styles.brandSub}>Expediente pediátrico — exportación</Text>
          <View style={styles.coverMeta}>
            <View>
              <Text style={styles.metaLabel}>Paciente</Text>
              <Text style={styles.metaValue}>{props.patientName}</Text>
              <Text style={[styles.cell, { color: "#6b6b78" }]}>
                Nac.: {fmtDate(props.patientDob)}
                {props.patientGender ? ` · ${props.patientGender}` : ""}
              </Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Médico tratante</Text>
              <Text style={styles.metaValue}>{props.doctorName}</Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Rango</Text>
              <Text style={styles.metaValue}>
                {fmtDate(props.fromDate)} — {fmtDate(props.toDate)}
              </Text>
            </View>
          </View>
        </View>

        <Section title="Línea de tiempo de erupción">
          {props.eruption.length === 0 ? (
            <Text style={styles.empty}>Sin registros.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 60 }]}>FDI</Text>
                <Text style={[styles.th, { width: 110 }]}>Observado</Text>
                <Text style={[styles.th, { width: 70 }]}>Edad</Text>
                <Text style={[styles.th, { width: 60 }]}>En rango</Text>
                <Text style={[styles.th, { flex: 1 }]}>Desviación</Text>
              </View>
              {props.eruption.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 60 }]}>{r.toothFdi}</Text>
                  <Text style={[styles.cell, { width: 110 }]}>{fmtDate(r.observedAt)}</Text>
                  <Text style={[styles.cell, { width: 70 }]}>{r.ageDecimal} años</Text>
                  <Text style={[styles.cell, { width: 60 }]}>{r.withinExpectedRange ? "Sí" : "No"}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{r.deviation || "—"}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Historial CAMBRA (riesgo cariogénico)">
          {props.cambra.length === 0 ? (
            <Text style={styles.empty}>Sin evaluaciones.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 110 }]}>Fecha</Text>
                <Text style={[styles.th, { width: 100 }]}>Categoría</Text>
                <Text style={[styles.th, { flex: 1 }]}>Recall (meses)</Text>
              </View>
              {props.cambra.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 110 }]}>{fmtDate(r.scoredAt)}</Text>
                  <Text style={[styles.cell, { width: 100 }]}>{r.category}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{r.recallMonths}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Línea de tiempo conductual (Frankl/Venham)">
          {props.behavior.length === 0 ? (
            <Text style={styles.empty}>Sin evaluaciones.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 110 }]}>Fecha</Text>
                <Text style={[styles.th, { width: 80 }]}>Escala</Text>
                <Text style={[styles.th, { width: 50 }]}>Valor</Text>
                <Text style={[styles.th, { flex: 1 }]}>Notas</Text>
              </View>
              {props.behavior.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 110 }]}>{fmtDate(r.recordedAt)}</Text>
                  <Text style={[styles.cell, { width: 80 }]}>{r.scale}</Text>
                  <Text style={[styles.cell, { width: 50 }]}>{r.value}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{r.notes ?? "—"}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Sellantes">
          {props.sealants.length === 0 ? (
            <Text style={styles.empty}>Sin sellantes registrados.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 50 }]}>FDI</Text>
                <Text style={[styles.th, { width: 110 }]}>Aplicado</Text>
                <Text style={[styles.th, { width: 110 }]}>Material</Text>
                <Text style={[styles.th, { width: 90 }]}>Retención</Text>
                <Text style={[styles.th, { flex: 1 }]}>Re-aplicado</Text>
              </View>
              {props.sealants.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 50 }]}>{r.toothFdi}</Text>
                  <Text style={[styles.cell, { width: 110 }]}>{fmtDate(r.placedAt)}</Text>
                  <Text style={[styles.cell, { width: 110 }]}>{r.material}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{r.retentionStatus}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{fmtDate(r.reappliedAt)}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Aplicaciones de flúor">
          {props.fluorides.length === 0 ? (
            <Text style={styles.empty}>Sin aplicaciones registradas.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 110 }]}>Fecha</Text>
                <Text style={[styles.th, { width: 130 }]}>Producto</Text>
                <Text style={[styles.th, { width: 70 }]}>Dientes</Text>
                <Text style={[styles.th, { flex: 1 }]}>Lote</Text>
              </View>
              {props.fluorides.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 110 }]}>{fmtDate(r.appliedAt)}</Text>
                  <Text style={[styles.cell, { width: 130 }]}>{r.product}</Text>
                  <Text style={[styles.cell, { width: 70 }]}>{r.teethCount}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{r.lotNumber ?? "—"}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Hábitos orales">
          {props.habits.length === 0 ? (
            <Text style={styles.empty}>Sin hábitos registrados.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 130 }]}>Hábito</Text>
                <Text style={[styles.th, { width: 90 }]}>Frecuencia</Text>
                <Text style={[styles.th, { width: 110 }]}>Inicio</Text>
                <Text style={[styles.th, { flex: 1 }]}>Fin</Text>
              </View>
              {props.habits.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 130 }]}>{r.habitType}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{r.frequency}</Text>
                  <Text style={[styles.cell, { width: 110 }]}>{fmtDate(r.startedAt)}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{fmtDate(r.endedAt)}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Consentimientos">
          {props.consents.length === 0 ? (
            <Text style={styles.empty}>Sin consentimientos.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 200 }]}>Procedimiento</Text>
                <Text style={[styles.th, { width: 120 }]}>Firmado por tutor</Text>
                <Text style={[styles.th, { flex: 1 }]}>Vence</Text>
              </View>
              {props.consents.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 200 }]}>{r.procedureType}</Text>
                  <Text style={[styles.cell, { width: 120 }]}>{fmtDate(r.guardianSignedAt)}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{fmtDate(r.expiresAt)}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Section title="Fotos clínicas">
          {props.photos.length === 0 ? (
            <Text style={styles.empty}>Sin fotos.</Text>
          ) : (
            <>
              <View style={[styles.row, { borderBottomColor: "#7c3aed" }]}>
                <Text style={[styles.th, { width: 160 }]}>Tipo</Text>
                <Text style={[styles.th, { width: 80 }]}>Etapa</Text>
                <Text style={[styles.th, { flex: 1 }]}>Capturada</Text>
              </View>
              {props.photos.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, { width: 160 }]}>{r.photoType}</Text>
                  <Text style={[styles.cell, { width: 80 }]}>{r.stage}</Text>
                  <Text style={[styles.cell, { flex: 1 }]}>{fmtDate(r.capturedAt)}</Text>
                </View>
              ))}
            </>
          )}
        </Section>

        <Text style={styles.footer} fixed>
          Generado en MediFlow el {fmtDate(props.generatedAt)}
        </Text>
      </Page>
    </Document>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.children}
    </View>
  );
}
