// Orthodontics — PDF "Antes / Durante / Después" multi-página, formato
// libro de progreso. Pensado para mostrar al paciente o como entrega
// final del tratamiento. Distinto del progress-report.tsx existente
// (ese es 1 página landscape T0 vs T2 lado a lado).

import {
  Document,
  Image as PdfImage,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { PHOTO_VIEW_ORDER, VIEW_LABELS } from "../photo-set-helpers";

export interface ComparisonPdfPhotoSet {
  /** Etiqueta visible (eg. "T0 · Inicio · 12 mar 2024", "Mes 6", "T2 · Final"). */
  label: string;
  capturedAtIso: string;
  monthInTreatment: number | null;
  pairs: Array<{
    view: (typeof PHOTO_VIEW_ORDER)[number];
    url: string | null;
  }>;
}

export interface ComparisonPdfData {
  patientName: string;
  patientDobIso: string | null;
  doctorName: string;
  doctorCedula: string | null;
  clinicName: string;
  techniqueLabel: string;
  durationMonthsActual: number;
  estimatedDurationMonths: number;
  diagnosisSummary: string;
  retentionPlanText: string;
  initialSet: ComparisonPdfPhotoSet | null;
  midSets: ComparisonPdfPhotoSet[];
  finalSet: ComparisonPdfPhotoSet | null;
  generatedAtIso: string;
  hasPhotoUseConsent: boolean;
}

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0F172A",
  },
  cover: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 60,
    backgroundColor: "#0F172A",
    color: "white",
    borderRadius: 12,
  },
  coverTitle: { fontSize: 32, color: "white", fontWeight: 700, marginBottom: 12 },
  coverSub: { fontSize: 14, color: "#cbd5e1", textAlign: "center", marginBottom: 8 },
  coverSmall: { fontSize: 10, color: "#94a3b8", marginTop: 24 },
  watermark: {
    position: "absolute",
    top: 12,
    right: 24,
    fontSize: 9,
    color: "#EF4444",
    fontWeight: 700,
  },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 6, color: "#0F172A" },
  h2: { fontSize: 14, fontWeight: 700, marginBottom: 6, color: "#1e40af" },
  meta: { fontSize: 10, color: "#475569", marginBottom: 4 },
  body: { fontSize: 10, color: "#0F172A", marginBottom: 6, lineHeight: 1.5 },
  section: { marginVertical: 12 },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#CBD5E1",
    marginVertical: 8,
  },
  grid4x2: { gap: 4 },
  gridRow: { flexDirection: "row", gap: 4, marginBottom: 4 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: "#0B0D11",
    borderRadius: 3,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cellLabel: { fontSize: 7, color: "#64748B", marginTop: 2, textAlign: "center" },
  twoCol: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  setCaption: { fontSize: 11, fontWeight: 700, marginBottom: 4, color: "#0F172A" },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 28,
    right: 28,
    fontSize: 8,
    color: "#94a3b8",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#CBD5E1",
    paddingTop: 6,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function PhotoGrid({ set }: { set: ComparisonPdfPhotoSet }) {
  const rows: Array<typeof PHOTO_VIEW_ORDER[number][]> = [
    PHOTO_VIEW_ORDER.slice(0, 4) as never,
    PHOTO_VIEW_ORDER.slice(4, 8) as never,
  ];
  const find = (view: (typeof PHOTO_VIEW_ORDER)[number]) =>
    set.pairs.find((p) => p.view === view)?.url ?? null;
  return (
    <View style={styles.grid4x2}>
      {rows.map((row, i) => (
        <View key={i} style={styles.gridRow}>
          {row.map((view) => {
            const url = find(view);
            return (
              <View key={view} style={styles.cell}>
                {url ? (
                  <PdfImage
                    src={url}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <Text style={styles.cellLabel}>{VIEW_LABELS[view]}</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function ComparisonPdf({ data }: { data: ComparisonPdfData }) {
  return (
    <Document>
      {/* Página 1 — portada */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.cover}>
          <Text style={styles.coverTitle}>Mi tratamiento ortodóntico</Text>
          <Text style={styles.coverSub}>{data.patientName}</Text>
          <Text style={styles.coverSub}>
            {data.clinicName} · Dr./Dra. {data.doctorName}
          </Text>
          <Text style={styles.coverSmall}>
            {data.techniqueLabel} · {data.durationMonthsActual} meses · generado{" "}
            {fmtDate(data.generatedAtIso)}
          </Text>
        </View>
      </Page>

      {/* Página 2 — datos del paciente + diagnóstico inicial */}
      <Page size="LETTER" style={styles.page}>
        {!data.hasPhotoUseConsent ? (
          <Text style={styles.watermark}>Uso clínico — confidencial</Text>
        ) : null}
        <Text style={styles.h1}>Datos del paciente</Text>
        <Text style={styles.meta}>Nombre: {data.patientName}</Text>
        {data.patientDobIso ? (
          <Text style={styles.meta}>
            Fecha de nacimiento: {fmtDate(data.patientDobIso)}
          </Text>
        ) : null}
        <Text style={styles.meta}>
          Doctor tratante: {data.doctorName}
          {data.doctorCedula ? ` · cédula ${data.doctorCedula}` : ""}
        </Text>
        <Text style={styles.meta}>Clínica: {data.clinicName}</Text>

        <View style={styles.divider} />

        <Text style={styles.h1}>Diagnóstico ortodóntico inicial</Text>
        <Text style={styles.body}>{data.diagnosisSummary}</Text>

        <View style={styles.divider} />

        <Text style={styles.h1}>Plan inicial</Text>
        <Text style={styles.meta}>Técnica: {data.techniqueLabel}</Text>
        <Text style={styles.meta}>
          Duración estimada: {data.estimatedDurationMonths} meses · real:{" "}
          {data.durationMonthsActual} meses
        </Text>

        <Text style={styles.footer} fixed>
          Generado en MediFlow el {fmtDate(data.generatedAtIso)}
        </Text>
      </Page>

      {/* Página 3 — fotografías iniciales (T0) */}
      {data.initialSet ? (
        <Page size="LETTER" style={styles.page}>
          {!data.hasPhotoUseConsent ? (
            <Text style={styles.watermark}>Uso clínico — confidencial</Text>
          ) : null}
          <Text style={styles.h1}>Antes</Text>
          <Text style={styles.setCaption}>{data.initialSet.label}</Text>
          <PhotoGrid set={data.initialSet} />
          <Text style={styles.footer} fixed>
            Generado en MediFlow el {fmtDate(data.generatedAtIso)}
          </Text>
        </Page>
      ) : null}

      {/* Páginas N — controles intermedios cada ~3m */}
      {data.midSets.map((set, i) => (
        <Page key={`mid-${i}`} size="LETTER" style={styles.page}>
          {!data.hasPhotoUseConsent ? (
            <Text style={styles.watermark}>Uso clínico — confidencial</Text>
          ) : null}
          <Text style={styles.h1}>Durante el tratamiento</Text>
          <Text style={styles.setCaption}>{set.label}</Text>
          {data.initialSet ? (
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.h2}>Inicio</Text>
                <PhotoGrid set={data.initialSet} />
              </View>
              <View style={styles.col}>
                <Text style={styles.h2}>{set.label}</Text>
                <PhotoGrid set={set} />
              </View>
            </View>
          ) : (
            <PhotoGrid set={set} />
          )}
          <Text style={styles.footer} fixed>
            Generado en MediFlow el {fmtDate(data.generatedAtIso)}
          </Text>
        </Page>
      ))}

      {/* Página final — fase final */}
      {data.finalSet ? (
        <Page size="LETTER" style={styles.page}>
          {!data.hasPhotoUseConsent ? (
            <Text style={styles.watermark}>Uso clínico — confidencial</Text>
          ) : null}
          <Text style={styles.h1}>Después</Text>
          <Text style={styles.setCaption}>{data.finalSet.label}</Text>
          {data.initialSet ? (
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.h2}>Inicio</Text>
                <PhotoGrid set={data.initialSet} />
              </View>
              <View style={styles.col}>
                <Text style={styles.h2}>Final</Text>
                <PhotoGrid set={data.finalSet} />
              </View>
            </View>
          ) : (
            <PhotoGrid set={data.finalSet} />
          )}
          <Text style={styles.footer} fixed>
            Generado en MediFlow el {fmtDate(data.generatedAtIso)}
          </Text>
        </Page>
      ) : null}

      {/* Página retención */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Plan de retención</Text>
        <Text style={styles.body}>{data.retentionPlanText}</Text>
        <Text style={styles.footer} fixed>
          Generado en MediFlow el {fmtDate(data.generatedAtIso)}
        </Text>
      </Page>
    </Document>
  );
}
