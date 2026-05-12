// Orthodontics — PDF "Reporte de progreso T0 vs T2". A4 horizontal. SPEC §9.3.

import {
  Document,
  Image as PdfImage,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { PHOTO_VIEW_ORDER, VIEW_LABELS } from "../photo-set-helpers";

export interface ProgressReportPdfData {
  patientName: string;
  doctorName: string;
  clinicName: string;
  durationMonthsActual: number;
  techniqueLabel: string;
  retentionPlanText: string;
  beforeLabel: string; // ej. "T0 · 12 mar 2024"
  afterLabel: string;  // ej. "T2 · 03 nov 2024"
  pairs: Array<{
    view: (typeof PHOTO_VIEW_ORDER)[number];
    beforeUrl: string | null;
    afterUrl: string | null;
  }>;
  hasPhotoUseConsent: boolean;
}

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, fontFamily: "Helvetica", color: "#0F172A" },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 9, color: "#475569", marginBottom: 8 },
  watermark: {
    position: "absolute",
    top: 12,
    right: 24,
    fontSize: 9,
    color: "#EF4444",
    fontWeight: 700,
  },
  twoCols: { flexDirection: "row", gap: 8 },
  col: { flex: 1 },
  rowGrid: { flexDirection: "row", gap: 4, marginBottom: 4 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: "#0B0D11",
    borderRadius: 3,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cellLabel: { fontSize: 7, color: "#64748B" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#CBD5E1", marginVertical: 8 },
});

export function ProgressReportPdf({ data }: { data: ProgressReportPdfData }) {
  // Grid 4×2 de las 8 vistas, lado a lado.
  const rows: Array<typeof PHOTO_VIEW_ORDER[number][]> = [
    PHOTO_VIEW_ORDER.slice(0, 4) as never,
    PHOTO_VIEW_ORDER.slice(4, 8) as never,
  ];

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {!data.hasPhotoUseConsent ? (
          <Text style={styles.watermark}>Uso clínico — confidencial</Text>
        ) : null}

        <Text style={styles.h1}>Reporte de progreso ortodóntico</Text>
        <Text style={styles.meta}>
          {data.patientName} · Dr./Dra. {data.doctorName} · {data.clinicName}
        </Text>
        <Text style={styles.meta}>
          Técnica: {data.techniqueLabel} · Duración real: {data.durationMonthsActual} meses
        </Text>

        <View style={styles.twoCols}>
          <View style={styles.col}>
            <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
              {data.beforeLabel}
            </Text>
            {rows.map((row, ri) => (
              <View key={`b-${ri}`} style={styles.rowGrid}>
                {row.map((view) => {
                  const pair = data.pairs.find((p) => p.view === view);
                  return (
                    <View key={view} style={styles.cell}>
                      {pair?.beforeUrl ? (
                        // eslint-disable-next-line jsx-a11y/alt-text
                        <Img src={pair.beforeUrl} />
                      ) : (
                        <Text style={styles.cellLabel}>{VIEW_LABELS[view]}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.col}>
            <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
              {data.afterLabel}
            </Text>
            {rows.map((row, ri) => (
              <View key={`a-${ri}`} style={styles.rowGrid}>
                {row.map((view) => {
                  const pair = data.pairs.find((p) => p.view === view);
                  return (
                    <View key={view} style={styles.cell}>
                      {pair?.afterUrl ? (
                        // eslint-disable-next-line jsx-a11y/alt-text
                        <Img src={pair.afterUrl} />
                      ) : (
                        <Text style={styles.cellLabel}>{VIEW_LABELS[view]}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </Page>

      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h1}>Carta de salida</Text>
        <Text style={styles.meta}>
          El tratamiento ortodóntico activo de {data.patientName} ha concluido
          después de {data.durationMonthsActual} meses con técnica{" "}
          {data.techniqueLabel}.
        </Text>
        <View style={styles.divider} />
        <Text style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
          Plan de retención
        </Text>
        <Text style={{ lineHeight: 1.5 }}>{data.retentionPlanText}</Text>
        <View style={styles.divider} />
        <Text style={styles.meta}>
          La retención es de por vida. El abandono o uso incorrecto de los
          retenedores es la principal causa de recidiva. La responsabilidad de
          su uso es exclusivamente del paciente.
        </Text>
      </Page>
    </Document>
  );
}

// Wrapper local — react-pdf necesita una URL absoluta o data URI para Image.
// Dejamos el componente <PdfImage> como cell child directo donde se usa.
function Img({ src }: { src: string }) {
  return (
    <PdfImage src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  );
}
