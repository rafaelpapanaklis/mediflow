// Orthodontics — PDF "Acuerdo financiero" firmable. A4 vertical. SPEC §9.2.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { FinancialAgreementPdfData } from "@/app/actions/orthodontics/exportFinancialAgreementPdf";
import { techniqueLabel } from "../consent-texts";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0F172A" },
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 4, textTransform: "uppercase" },
  meta: { fontSize: 9, color: "#475569", marginBottom: 4 },
  paragraph: { marginBottom: 6, lineHeight: 1.5 },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: "#475569", width: 200 },
  metricValue: { color: "#0F172A", fontWeight: 700 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    padding: "4 6",
    fontSize: 9,
    fontWeight: 700,
  },
  tableRow: {
    flexDirection: "row",
    padding: "3 6",
    fontSize: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: "#CBD5E1",
  },
  signature: { marginTop: 28, paddingTop: 28, borderTopWidth: 1, borderTopColor: "#94A3B8" },
});

export function FinancialAgreementPdf({ data }: { data: FinancialAgreementPdfData }) {
  const today = new Date(data.generatedAt).toLocaleDateString("es-MX");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Acuerdo financiero — tratamiento ortodóntico</Text>
        <Text style={styles.meta}>
          Generado el {today} · {data.clinic.name}
        </Text>

        <Text style={styles.h2}>Datos del paciente</Text>
        <Text style={styles.paragraph}>
          {data.patient.firstName} {data.patient.lastName}
        </Text>

        <Text style={styles.h2}>Tratamiento autorizado</Text>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Técnica:</Text>
          <Text style={styles.metricValue}>
            {techniqueLabel(data.technique as never)}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Duración estimada:</Text>
          <Text style={styles.metricValue}>{data.estimatedDurationMonths} meses</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Costo total:</Text>
          <Text style={styles.metricValue}>$ {data.totalAmount} M.N.</Text>
        </View>

        <Text style={styles.h2}>Estructura de pago</Text>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Enganche:</Text>
          <Text style={styles.metricValue}>$ {data.initialDownPayment} M.N.</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Mensualidades:</Text>
          <Text style={styles.metricValue}>
            {data.installmentCount} × $ {data.installmentAmount} M.N.
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Día de pago:</Text>
          <Text style={styles.metricValue}>día {data.paymentDayOfMonth} de cada mes</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Inicio:</Text>
          <Text style={styles.metricValue}>
            {new Date(data.startDate).toLocaleDateString("es-MX")}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Fin:</Text>
          <Text style={styles.metricValue}>
            {new Date(data.endDate).toLocaleDateString("es-MX")}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Método preferente:</Text>
          <Text style={styles.metricValue}>{data.preferredPaymentMethod.replaceAll("_", " ").toLowerCase()}</Text>
        </View>

        <Text style={styles.h2}>Calendario de mensualidades</Text>
        <View style={styles.tableHeader}>
          <Text style={{ width: 30 }}>#</Text>
          <Text style={{ width: 110 }}>Vence</Text>
          <Text style={{ width: 80, textAlign: "right" }}>Monto</Text>
          <Text style={{ flex: 1 }}>Status</Text>
        </View>
        {data.installments.map((i) => (
          <View key={i.installmentNumber} style={styles.tableRow}>
            <Text style={{ width: 30 }}>{i.installmentNumber}</Text>
            <Text style={{ width: 110 }}>
              {new Date(i.dueDate).toLocaleDateString("es-MX")}
            </Text>
            <Text style={{ width: 80, textAlign: "right" }}>$ {i.amount}</Text>
            <Text style={{ flex: 1 }}>{i.status.toLowerCase()}</Text>
          </View>
        ))}
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Cláusulas financieras</Text>
        <Text style={styles.paragraph}>
          1. La Clínica acepta hasta 30 días naturales de tolerancia sin penalización.
        </Text>
        <Text style={styles.paragraph}>
          2. Retraso mayor a 30 días autoriza a la Clínica a suspender citas de
          control hasta regularización. La suspensión NO modifica vencimientos
          subsecuentes.
        </Text>
        <Text style={styles.paragraph}>
          3. Tres o más mensualidades vencidas no regularizadas activan las
          cláusulas de abandono.
        </Text>
        <Text style={styles.paragraph}>
          4. Cualquier modificación al calendario requiere acuerdo escrito separado.
        </Text>
        <Text style={styles.paragraph}>
          5. Si el paciente abandona unilateralmente, no procede reembolso del
          enganche ni de mensualidades pagadas. Las mensualidades vencidas hasta
          el abandono son exigibles.
        </Text>
        <Text style={styles.paragraph}>
          6. La Clínica expedirá CFDI por cada pago.
        </Text>
        <Text style={styles.paragraph}>
          7. El tratamiento de datos se rige por LFPDPPP y el aviso de privacidad de la Clínica.
        </Text>

        <View style={styles.signature}>
          <Text style={{ fontSize: 9 }}>
            _________________________________________________
          </Text>
          <Text style={{ fontSize: 9 }}>
            {data.patient.firstName} {data.patient.lastName}
          </Text>
          <Text style={{ fontSize: 9 }}>(Paciente o responsable financiero)</Text>
        </View>

        <View style={styles.signature}>
          <Text style={{ fontSize: 9 }}>
            _________________________________________________
          </Text>
          <Text style={{ fontSize: 9 }}>Por {data.clinic.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
