// Orthodontics — PDF "Antes / Durante / Después" multi-página, formato
// libro de progreso. Pensado para mostrar al paciente o como entrega
// final del tratamiento. Distinto del progress-report.tsx existente
// (ese es 1 página landscape T0 vs T2 lado a lado).
//
// ws1-t4 (29-sep-2026): membrete y pie comunes de ortodoncia en vez de la
// portada oscura sin logo; las fotos llegan ya bajadas como data URL (antes
// se le pasaba la ruta cruda del bucket privado y salían casillas negras).

import {
  Document,
  Image as PdfImage,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { PHOTO_VIEW_ORDER, VIEW_LABELS } from "../photo-set-helpers";
import type {
  ComparisonPdfPhotoSet,
  ComparisonPdfData,
} from "./comparison-pdf-types";
import { MembreteOrto, PieOrto, estilosPaginaOrto } from "../pdf/membrete-orto";

export type { ComparisonPdfPhotoSet, ComparisonPdfData };

const DOCUMENTO = "Antes y después";

const styles = StyleSheet.create({
  watermark: {
    position: "absolute",
    top: 12,
    right: 40,
    fontSize: 9,
    color: "#EF4444",
    fontWeight: 700,
  },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 6, color: "#14101f" },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 6, color: "#7c3aed" },
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
});

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
  const m = data.membrete;
  const marca = !data.hasPhotoUseConsent ? <Text style={styles.watermark} fixed>Uso clínico — confidencial</Text> : null;
  const pie = <PieOrto datos={m} documento={DOCUMENTO} />;
  return (
    <Document title={`${DOCUMENTO} · ${m.paciente.nombre}`} author={m.clinicName}>
      {/* Página 1 — membrete, datos del caso y diagnóstico inicial. ws1-t4:
          antes era una portada oscura sin logo ni dirección, y los datos del
          paciente y del doctor iban en renglones grises sueltos. */}
      <Page size="LETTER" style={estilosPaginaOrto.carta}>
        {marca}
        <MembreteOrto datos={m} documento={DOCUMENTO} />
        <Text style={styles.h1}>Mi tratamiento ortodóntico</Text>
        <Text style={styles.meta}>
          {data.techniqueLabel} · duración estimada {data.estimatedDurationMonths} meses · real{" "}
          {data.durationMonthsActual} meses
        </Text>

        <View style={styles.divider} />

        <Text style={styles.h2}>Diagnóstico ortodóntico inicial</Text>
        <Text style={styles.body}>{data.diagnosisSummary || "—"}</Text>
        {pie}
      </Page>

      {/* Fotografías iniciales (T0) */}
      {data.initialSet ? (
        <Page size="LETTER" style={estilosPaginaOrto.carta}>
          {marca}
          <Text style={styles.h1}>Antes</Text>
          <Text style={styles.setCaption}>{data.initialSet.label}</Text>
          <PhotoGrid set={data.initialSet} />
          {pie}
        </Page>
      ) : null}

      {/* Controles intermedios */}
      {data.midSets.map((set, i) => (
        <Page key={`mid-${i}`} size="LETTER" style={estilosPaginaOrto.carta}>
          {marca}
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
          {pie}
        </Page>
      ))}

      {/* Fase final */}
      {data.finalSet ? (
        <Page size="LETTER" style={estilosPaginaOrto.carta}>
          {marca}
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
          {pie}
        </Page>
      ) : null}

      {/* Retención */}
      <Page size="LETTER" style={estilosPaginaOrto.carta}>
        <Text style={styles.h1}>Plan de retención</Text>
        <Text style={styles.body}>{data.retentionPlanText || "—"}</Text>
        {pie}
      </Page>
    </Document>
  );
}
