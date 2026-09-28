// H66: «carta de alta» — lo que se entrega al paciente al terminar el
// tratamiento activo: qué se hizo, cuánto duró y qué sigue (retención y
// revisiones). Texto factual, sin prometer resultados.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { ClinicLetterhead, type ClinicLetterheadClinic } from "@/lib/pdf/clinic-letterhead";

export interface DischargeLetterProps extends ClinicLetterheadClinic {
  patientName: string;
  doctorName: string;
  doctorCedula: string | null;
  techniqueLabel: string;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number | null;
  retentionPlanText: string | null;
  /** Revisiones de retención ya programadas: `{ meses, fecha }`. */
  revisiones: Array<{ meses: number; fecha: string | null }>;
  generatedAt: string;
}

const ACCENT = "#7c3aed";
const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 64, fontFamily: "Helvetica", fontSize: 10.5, color: "#14101f", lineHeight: 1.5 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 10 },
  p: { marginBottom: 8 },
  h: { fontSize: 11, color: ACCENT, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  li: { marginBottom: 2 },
  signature: { marginTop: 40, borderTopWidth: 0.5, borderTopColor: "#14101f", paddingTop: 6, width: 240 },
  small: { fontSize: 9, color: "#6b6b78" },
});

export function fechaLarga(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

export function DischargeLetterPdf(props: DischargeLetterProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <ClinicLetterhead {...props} accent={ACCENT} subtitle="Carta de alta de ortodoncia" right={<Text style={styles.small}>{fechaLarga(props.generatedAt)}</Text>} />
        <Text style={styles.title}>Carta de alta del tratamiento de ortodoncia</Text>
        <Text style={styles.p}>
          Por medio de la presente se hace constar que {props.patientName} concluyó la fase activa de su tratamiento de
          ortodoncia ({props.techniqueLabel}) en {props.clinicName}.
        </Text>
        <Text style={styles.h}>Resumen del tratamiento</Text>
        <Text style={styles.li}>• Inicio: {fechaLarga(props.startDate)}</Text>
        <Text style={styles.li}>• Retiro de la aparatología: {fechaLarga(props.endDate)}</Text>
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
                • A los {r.meses} meses: {fechaLarga(r.fecha)}
              </Text>
            ))}
          </>
        ) : null}
        <Text style={[styles.p, { marginTop: 12 }]}>
          Si un retenedor se rompe, se pierde o deja de ajustar, avisa a la clínica cuanto antes; no esperes a tu
          siguiente revisión.
        </Text>
        <View style={styles.signature}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{props.doctorName}</Text>
          {props.doctorCedula ? <Text style={styles.small}>Cédula profesional: {props.doctorCedula}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
