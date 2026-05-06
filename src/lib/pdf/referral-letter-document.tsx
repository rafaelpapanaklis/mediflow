import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * ReferralLetterDocument — PDF de hoja de referencia/interconsulta.
 * Header con clínica + fecha + status, bloque del paciente, bloque del
 * doctor receptor (si hay contacto), motivo, summary del módulo origen
 * y firma del médico autor.
 */

export interface ReferralLetterDocumentProps {
  clinicName: string;
  doctorAuthorName: string;
  doctorAuthorCedula: string | null;
  module: string;
  generatedAt: string;
  patientName: string;
  patientDob: string | null;
  patientGender: string | null;
  contactName: string | null;
  contactSpecialty: string | null;
  contactClinicName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  reason: string;
  summary: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#14101f",
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#7c3aed",
    paddingBottom: 12,
    marginBottom: 18,
  },
  brand: {
    fontSize: 18,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  brandSub: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 2,
  },
  metaRight: {
    fontSize: 9,
    color: "#6b6b78",
    textAlign: "right",
  },
  metaValue: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  block: {
    backgroundColor: "#f4f2f8",
    padding: 12,
    borderRadius: 6,
    marginBottom: 14,
  },
  twoCol: {
    flexDirection: "row",
    gap: 18,
  },
  col: {
    flex: 1,
  },
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
  sub: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 1,
  },
  sectionTitle: {
    fontSize: 11,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4dc",
  },
  body: {
    fontSize: 10,
    color: "#14101f",
    marginBottom: 8,
  },
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
    paddingTop: 8,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function fmtAge(dob: string | null): string {
  if (!dob) return "—";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const years = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
  const months = Math.max(
    0,
    Math.floor((ms - years * 365.25 * 24 * 3600 * 1000) / (30.44 * 24 * 3600 * 1000)),
  );
  if (years < 5) return `${years} a ${months} m`;
  return `${years} años`;
}

const MODULE_LABELS: Record<string, string> = {
  pediatrics: "Odontopediatría",
  endodontics: "Endodoncia",
  periodontics: "Periodoncia",
  implants: "Implantología",
  orthodontics: "Ortodoncia",
};

export function ReferralLetterDocument(props: ReferralLetterDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>{props.clinicName}</Text>
            <Text style={styles.brandSub}>Hoja de referencia · interconsulta</Text>
          </View>
          <View>
            <Text style={styles.metaRight}>Módulo origen</Text>
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
              <Text style={styles.sub}>
                {fmtAge(props.patientDob)}
                {props.patientGender ? ` · ${props.patientGender}` : ""}
              </Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Doctor referente</Text>
              <Text style={styles.value}>{props.doctorAuthorName}</Text>
              {props.doctorAuthorCedula ? (
                <Text style={styles.sub}>Cédula prof: {props.doctorAuthorCedula}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Dirigida a</Text>
          <Text style={styles.value}>
            {props.contactName ?? "Doctor receptor (sin asignar)"}
          </Text>
          {props.contactSpecialty ? (
            <Text style={styles.sub}>{props.contactSpecialty}</Text>
          ) : null}
          {props.contactClinicName ? (
            <Text style={styles.sub}>{props.contactClinicName}</Text>
          ) : null}
          {props.contactPhone ? (
            <Text style={styles.sub}>Tel: {props.contactPhone}</Text>
          ) : null}
          {props.contactEmail ? (
            <Text style={styles.sub}>Email: {props.contactEmail}</Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Motivo de la referencia</Text>
        <Text style={styles.body}>{props.reason}</Text>

        <Text style={styles.sectionTitle}>Resumen clínico</Text>
        <Text style={styles.body}>{props.summary}</Text>

        <View style={styles.signature}>
          <Text style={styles.value}>{props.doctorAuthorName}</Text>
          <Text style={styles.sub}>
            {props.doctorAuthorCedula ? `Cédula ${props.doctorAuthorCedula}` : "Médico tratante"}
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          Generada en MediFlow el {fmtDate(props.generatedAt)} · Documento informativo
        </Text>
      </Page>
    </Document>
  );
}
