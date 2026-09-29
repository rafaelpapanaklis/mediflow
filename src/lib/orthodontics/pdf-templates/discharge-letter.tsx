// H66: «carta de alta» — lo que se entrega al paciente al terminar el
// tratamiento activo: qué se hizo, cuánto duró y qué sigue (retención y
// revisiones). Texto factual, sin prometer resultados.
//
// ws1-t4 (29-sep-2026): membrete y pie comunes de ortodoncia (`MembreteOrto`,
// `PieOrto`) — paciente y doctor con cédula en la banda, fechas dd/mm/aaaa en
// la zona de la clínica y «Página N de M».
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import {
  ACENTO_ORTO,
  GRIS_ORTO,
  MembreteOrto,
  PieOrto,
  TINTA_ORTO,
  estilosPaginaOrto,
  type DatosDelMembreteOrto,
} from "../pdf/membrete-orto";
import { fechaDMA } from "../pdf/formato";

const DOCUMENTO = "Carta de alta";

export interface DischargeLetterProps {
  membrete: DatosDelMembreteOrto;
  techniqueLabel: string;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number | null;
  retentionPlanText: string | null;
  /** Revisiones de retención ya programadas: `{ meses, fecha }`. */
  revisiones: Array<{ meses: number; fecha: string | null }>;
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 2, marginBottom: 10 },
  // fontSize junto al lineHeight: sin él @react-pdf calcula el renglón sobre 18 pt (27 pt de interlínea).
  p: { fontSize: 10.5, marginBottom: 8, lineHeight: 1.5 },
  h: { fontSize: 11, color: ACENTO_ORTO, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  li: { marginBottom: 2 },
  signature: { marginTop: 48, borderTopWidth: 0.8, borderTopColor: TINTA_ORTO, paddingTop: 6, width: 240 },
  small: { fontSize: 9, color: GRIS_ORTO },
});

export function DischargeLetterPdf(props: DischargeLetterProps) {
  const m = props.membrete;
  const f = (iso: string | null) => fechaDMA(iso, m.zonaHoraria);
  return (
    <Document title={`${DOCUMENTO} · ${m.paciente.nombre}`} author={m.clinicName}>
      <Page size="LETTER" style={estilosPaginaOrto.carta} wrap>
        <MembreteOrto datos={m} documento={DOCUMENTO} />
        <Text style={styles.title}>Carta de alta del tratamiento de ortodoncia</Text>
        <Text style={styles.p}>
          Por medio de la presente se hace constar que {m.paciente.nombre} concluyó la fase activa de su tratamiento de
          ortodoncia ({props.techniqueLabel}) en {m.clinicName}.
        </Text>
        <Text style={styles.h}>Resumen del tratamiento</Text>
        <Text style={styles.li}>• Inicio: {f(props.startDate)}</Text>
        <Text style={styles.li}>• Retiro de la aparatología: {f(props.endDate)}</Text>
        <Text style={styles.li}>
          • Duración: {props.durationMonths !== null ? `${props.durationMonths} meses` : "—"}
        </Text>
        <Text style={styles.h}>Retención</Text>
        <Text style={styles.p}>
          {props.retentionPlanText?.trim() ||
            "Usa tus retenedores como te indicó tu doctor: la retención es lo que mantiene los dientes en su lugar."}
        </Text>
        {props.revisiones.length > 0 ? (
          <>
            <Text style={styles.h}>Revisiones de retención</Text>
            {props.revisiones.map((r) => (
              <Text key={r.meses} style={styles.li}>
                • A los {r.meses} meses: {f(r.fecha)}
              </Text>
            ))}
          </>
        ) : null}
        <Text style={[styles.p, { marginTop: 12 }]}>
          Si un retenedor se rompe, se pierde o deja de ajustar, avisa a la clínica cuanto antes; no esperes a tu
          siguiente revisión.
        </Text>
        <View style={styles.signature} wrap={false}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{m.doctor?.nombre || m.clinicName}</Text>
          {m.doctor?.cedula ? <Text style={styles.small}>Cédula profesional: {m.doctor.cedula}</Text> : null}
          <Text style={styles.small}>{[m.lugar, f(m.emitidoEl)].filter(Boolean).join(", a ")}</Text>
        </View>
        <PieOrto datos={m} documento={DOCUMENTO} />
      </Page>
    </Document>
  );
}
