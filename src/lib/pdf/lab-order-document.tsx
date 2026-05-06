import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * LabOrderDocument — PDF imprimible de orden de laboratorio. La sección
 * "Especificaciones" itera el JSON `spec` (clave: valor) — esto permite
 * que cada módulo guarde sus propios campos sin que el PDF lo conozca.
 */

export interface LabOrderDocumentProps {
  clinicName: string;
  doctorAuthorName: string;
  doctorAuthorCedula: string | null;
  partnerName: string | null;
  partnerContact: string | null;
  partnerAddress: string | null;
  generatedAt: string;
  patientName: string;
  patientDob: string | null;
  module: string;
  orderType: string;
  toothFdi: number | null;
  shadeGuide: string | null;
  dueDate: string | null;
  spec: Array<{ label: string; value: string }>;
  notes: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#14101f" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: "#0f766e",
    paddingBottom: 10,
    marginBottom: 14,
  },
  brand: { fontSize: 18, color: "#0f766e", fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 9, color: "#6b6b78", marginTop: 2 },
  metaRight: { fontSize: 9, color: "#6b6b78", textAlign: "right" },
  metaValue: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  block: { backgroundColor: "#f0fdfa", padding: 10, borderRadius: 6, marginBottom: 12 },
  twoCol: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  label: {
    fontSize: 8,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  value: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  sub: { fontSize: 9, color: "#6b6b78", marginTop: 1 },
  sectionTitle: {
    fontSize: 11,
    color: "#0f766e",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4dc",
  },
  specRow: { flexDirection: "row", marginBottom: 3, fontSize: 10 },
  specLabel: { width: 140, color: "#6b6b78", fontFamily: "Helvetica-Bold" },
  specValue: { flex: 1, color: "#14101f" },
  signature: {
    marginTop: 28,
    borderTopWidth: 0.5,
    borderTopColor: "#14101f",
    paddingTop: 6,
    width: 220,
  },
  footer: {
    position: "absolute",
    bottom: 30,
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

const MODULE_LABELS: Record<string, string> = {
  pediatrics: "Odontopediatría",
  endodontics: "Endodoncia",
  periodontics: "Periodoncia",
  implants: "Implantología",
  orthodontics: "Ortodoncia",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

export function LabOrderDocument(props: LabOrderDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>{props.clinicName}</Text>
            <Text style={styles.brandSub}>Orden de laboratorio</Text>
          </View>
          <View>
            <Text style={styles.metaRight}>Módulo</Text>
            <Text style={styles.metaValue}>
              {MODULE_LABELS[props.module] ?? props.module}
            </Text>
            <Text style={[styles.metaRight, { marginTop: 6 }]}>Fecha</Text>
            <Text style={styles.metaValue}>{fmtDate(props.generatedAt)}</Text>
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Paciente</Text>
              <Text style={styles.value}>{props.patientName}</Text>
              {props.patientDob ? (
                <Text style={styles.sub}>Nac.: {fmtDate(props.patientDob)}</Text>
              ) : null}
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Médico solicitante</Text>
              <Text style={styles.value}>{props.doctorAuthorName}</Text>
              {props.doctorAuthorCedula ? (
                <Text style={styles.sub}>Cédula prof: {props.doctorAuthorCedula}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Laboratorio</Text>
          <Text style={styles.value}>{props.partnerName ?? "Sin asignar"}</Text>
          {props.partnerContact ? (
            <Text style={styles.sub}>{props.partnerContact}</Text>
          ) : null}
          {props.partnerAddress ? (
            <Text style={styles.sub}>{props.partnerAddress}</Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Trabajo solicitado</Text>
        <View style={styles.specRow}>
          <Text style={styles.specLabel}>Tipo</Text>
          <Text style={styles.specValue}>{props.orderType}</Text>
        </View>
        {props.toothFdi != null ? (
          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Diente FDI</Text>
            <Text style={styles.specValue}>{props.toothFdi}</Text>
          </View>
        ) : null}
        {props.shadeGuide ? (
          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Color/guía</Text>
            <Text style={styles.specValue}>{props.shadeGuide}</Text>
          </View>
        ) : null}
        {props.dueDate ? (
          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Fecha entrega</Text>
            <Text style={styles.specValue}>{fmtDate(props.dueDate)}</Text>
          </View>
        ) : null}
        {props.spec.map((s, i) => (
          <View key={i} style={styles.specRow}>
            <Text style={styles.specLabel}>{s.label}</Text>
            <Text style={styles.specValue}>{s.value}</Text>
          </View>
        ))}

        {props.notes ? (
          <>
            <Text style={styles.sectionTitle}>Notas adicionales</Text>
            <Text style={{ fontSize: 10 }}>{props.notes}</Text>
          </>
        ) : null}

        <View style={styles.signature}>
          <Text style={styles.value}>{props.doctorAuthorName}</Text>
          <Text style={styles.sub}>
            {props.doctorAuthorCedula ? `Cédula ${props.doctorAuthorCedula}` : "Médico solicitante"}
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          Generada en MediFlow el {fmtDate(props.generatedAt)}
        </Text>
      </Page>
    </Document>
  );
}
