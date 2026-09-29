// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). PDF del análisis
// cefalométrico: tabla medida/valor/norma/desviación/interpretación +
// la radiografía con el trazado (puntos y planos activos) dibujado
// encima. Mismo estilo que el resto de PDF del panel: `ClinicLetterhead`
// arriba, Helvetica, acento de color, pie fijo con paginación.

import {
  Circle,
  Document,
  Image as PdfImage,
  Line,
  Page,
  Svg,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { ClinicLetterhead } from "../../../pdf/clinic-letterhead";
import { MembreteOrto, PieOrto } from "../../pdf/membrete-orto";
import type { CephReportPdfData, CephReportRow } from "./ceph-report-pdf-types";
import { fechaDMA } from "../../pdf/formato";

export type { CephReportPdfData, CephReportRow };

const ACCENT = "#0e7490";
const DOCUMENTO = "Análisis cefalométrico";

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 64, fontSize: 9.5, fontFamily: "Helvetica", color: "#14101f" },
  title: { fontSize: 16, fontWeight: 700, fontFamily: "Helvetica-Bold", color: "#14101f", marginBottom: 2 },
  subtitle: { fontSize: 9.5, color: "#6b6b78", marginBottom: 14 },
  section: { marginTop: 16 },
  h2: { fontSize: 11.5, fontWeight: 700, fontFamily: "Helvetica-Bold", color: ACCENT, marginBottom: 6 },
  imageBox: { position: "relative", alignSelf: "center", marginBottom: 6 },
  noImage: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d4d4dc",
    borderRadius: 6,
    padding: 24,
    alignItems: "center",
  },
  noImageText: { fontSize: 9, color: "#9b9aa8" },
  calibNote: { fontSize: 8, color: "#9b9aa8", marginTop: 4, textAlign: "center" },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f2f8",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#d4d4dc",
    marginTop: 6,
  },
  th: { fontSize: 8, fontWeight: 700, fontFamily: "Helvetica-Bold", color: "#6b6b78", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5ed",
  },
  td: { fontSize: 9, color: "#14101f" },
  cellMeasure: { width: "24%" },
  cellValue: { width: "14%", textAlign: "right", fontFamily: "Helvetica-Bold" },
  cellNorm: { width: "16%", textAlign: "right", color: "#6b6b78" },
  cellDev: { width: "12%", textAlign: "right", color: "#6b6b78" },
  cellInterp: { width: "34%", paddingLeft: 10 },
  tagNormal: { color: "#15803d" },
  tagAumentado: { color: "#b45309" },
  tagDisminuido: { color: "#b45309" },
  tagSinNorma: { color: "#9b9aa8" },
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
    paddingTop: 8,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

const MAX_IMAGE_W = 380;
const MAX_IMAGE_H = 360;

function TracedImage({ data }: { data: CephReportPdfData }) {
  if (!data.image) {
    return (
      <View style={styles.noImage}>
        <Text style={styles.noImageText}>Sin radiografía lateral adjunta a este trazado.</Text>
      </View>
    );
  }
  const { url, widthPx, heightPx } = data.image;
  const aspect = widthPx > 0 && heightPx > 0 ? widthPx / heightPx : 1;
  let w = MAX_IMAGE_W;
  let h = w / aspect;
  if (h > MAX_IMAGE_H) {
    h = MAX_IMAGE_H;
    w = h * aspect;
  }
  // Grosor de línea/radio de punto en el espacio de coordenadas NATIVO de
  // la imagen (no en pt de PDF): el viewBox del Svg reescala todo junto,
  // así que un trazo fino a 3000px de imagen sigue viéndose fino a 380pt.
  const strokeW = Math.max(1, widthPx / 400);
  const dotR = Math.max(2, widthPx / 250);

  return (
    <View style={styles.imageBox}>
      <PdfImage src={url} style={{ width: w, height: h, objectFit: "contain" }} />
      <Svg
        style={{ position: "absolute", top: 0, left: 0 }}
        width={w}
        height={h}
        viewBox={`0 0 ${widthPx} ${heightPx}`}
      >
        {data.planes.map((p) => (
          <Line key={p.id} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke="#22c55e" strokeWidth={strokeW} />
        ))}
        {data.points.map((pt) => (
          <Circle key={pt.id} cx={pt.x} cy={pt.y} r={dotR} fill="#ef4444" />
        ))}
      </Svg>
    </View>
  );
}

const INTERP_LABEL: Record<CephReportRow["interpretation"], string> = {
  normal: "Normal",
  aumentado: "Aumentado",
  disminuido: "Disminuido",
  "sin-norma": "Sin norma citada",
  "sin-medida": "Sin marcar",
};

const INTERP_STYLE: Record<CephReportRow["interpretation"], (typeof styles)["tagNormal"]> = {
  normal: styles.tagNormal,
  aumentado: styles.tagAumentado,
  disminuido: styles.tagDisminuido,
  "sin-norma": styles.tagSinNorma,
  "sin-medida": styles.tagSinNorma,
};

export function CephReportPdf({ data }: { data: CephReportPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {data.membrete ? (
          <>
            <MembreteOrto datos={data.membrete} documento={DOCUMENTO} />
            <Text style={styles.title}>Análisis de {data.analysisLabel}</Text>
            <Text style={styles.subtitle}>
              Trazado {data.kindLabel.toLowerCase()} del {fechaDMA(data.tracingDateIso, data.membrete.zonaHoraria)} ·{" "}
              {data.normSetLabel}
            </Text>
          </>
        ) : (
          <>
            <ClinicLetterhead
              {...data}
              accent={ACCENT}
              subtitle="Análisis cefalométrico"
              right={
                <View>
                  <Text style={{ fontSize: 8, color: "#6b6b78" }}>Trazado</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{data.kindLabel}</Text>
                  <Text style={{ fontSize: 8, color: "#6b6b78", marginTop: 6 }}>Fecha</Text>
                  <Text style={{ fontSize: 10 }}>{fmtDate(data.tracingDateIso)}</Text>
                </View>
              }
            />

            <Text style={styles.title}>Análisis de {data.analysisLabel}</Text>
            <Text style={styles.subtitle}>
              {data.patientName}
              {data.patientDobIso ? ` · nac. ${fmtDate(data.patientDobIso)}` : ""} · {data.normSetLabel} · Dr./Dra.{" "}
              {data.doctorName}
              {data.doctorCedula ? ` · cédula ${data.doctorCedula}` : ""}
            </Text>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.h2}>Trazado</Text>
          <TracedImage data={data} />
          {!data.calibrationPxPerMm ? (
            <Text style={styles.calibNote}>
              Trazado sin calibrar a milímetros — las medidas lineales (mm) de esta tabla no están disponibles.
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Medidas</Text>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.th, styles.cellMeasure]}>Medida</Text>
            <Text style={[styles.th, styles.cellValue]}>Valor</Text>
            <Text style={[styles.th, styles.cellNorm]}>Norma</Text>
            <Text style={[styles.th, styles.cellDev]}>Desv.</Text>
            <Text style={[styles.th, styles.cellInterp]}>Interpretación</Text>
          </View>
          {data.rows.map((r) => (
            <View key={r.key} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, styles.cellMeasure]}>{r.label}</Text>
              <Text style={[styles.td, styles.cellValue]}>{r.valueLabel}</Text>
              <Text style={[styles.td, styles.cellNorm]}>{r.normLabel ?? "—"}</Text>
              <Text style={[styles.td, styles.cellDev]}>{r.deviationLabel ?? "—"}</Text>
              <View style={styles.cellInterp}>
                <Text style={INTERP_STYLE[r.interpretation]}>{INTERP_LABEL[r.interpretation]}</Text>
                {r.interpretationText ? (
                  <Text style={{ fontSize: 8, color: "#6b6b78", marginTop: 1 }}>{r.interpretationText}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {data.membrete ? (
          <PieOrto datos={data.membrete} documento={DOCUMENTO} />
        ) : (
          <Text style={styles.footer} fixed>
            {data.clinicName} · generado en DaleControl el {fmtDate(data.generatedAtIso)} · uso clínico
          </Text>
        )}
      </Page>
    </Document>
  );
}
