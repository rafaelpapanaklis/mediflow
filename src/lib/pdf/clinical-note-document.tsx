import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * ClinicalNoteDocument — PDF de nota SOAP firmada para el expediente del
 * paciente. Header con clínica + paciente + doctor, cuerpo SOAP por
 * secciones, lista CIE-10 si existe, y footer con disclaimer NOM-024.
 *
 * Fuentes: Helvetica built-in (sin Font.register para evitar dependencias
 * externas).
 */

export interface ClinicalNoteDxRow {
  code: string;
  description: string;
}

export interface ClinicalNoteDocumentProps {
  clinicName: string;
  patientName: string;
  patientDob: string | null;     // ISO o null
  patientGender: string | null;
  doctorName: string | null;
  visitDate: string;             // ISO
  generatedAt: string;           // ISO
  status: "DRAFT" | "SIGNED";
  signedAt: string | null;       // ISO o null
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  diagnoses: ClinicalNoteDxRow[];
  procedures: string[];
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
  meta: {
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
  patientBlock: {
    backgroundColor: "#f4f2f8",
    padding: 12,
    borderRadius: 6,
    marginBottom: 18,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  patientCol: {
    flex: 1,
  },
  patientLabel: {
    fontSize: 8,
    color: "#6b6b78",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  patientValue: {
    fontSize: 11,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  patientSub: {
    fontSize: 9,
    color: "#6b6b78",
    marginTop: 2,
  },
  statusPillSigned: {
    fontSize: 9,
    color: "#15803d",
    backgroundColor: "#dcfce7",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    fontFamily: "Helvetica-Bold",
  },
  statusPillDraft: {
    fontSize: 9,
    color: "#a16207",
    backgroundColor: "#fef3c7",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 11,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4dc",
  },
  sectionBody: {
    fontSize: 10,
    color: "#14101f",
    marginBottom: 6,
  },
  sectionEmpty: {
    fontSize: 9,
    color: "#9b9aa8",
    fontStyle: "italic",
    marginBottom: 6,
  },
  dxRow: {
    flexDirection: "row",
    fontSize: 10,
    marginBottom: 3,
  },
  dxCode: {
    width: 60,
    fontFamily: "Helvetica-Bold",
    color: "#7c3aed",
  },
  dxLabel: {
    flex: 1,
    color: "#14101f",
  },
  procRow: {
    fontSize: 10,
    marginBottom: 3,
    color: "#14101f",
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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtAge(dob: string | null): string {
  if (!dob) return "—";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const years = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
  return `${years} años`;
}

export function ClinicalNoteDocument(props: ClinicalNoteDocumentProps) {
  const {
    clinicName, patientName, patientDob, patientGender,
    doctorName, visitDate, generatedAt, status, signedAt,
    subjective, objective, assessment, plan,
    diagnoses, procedures,
  } = props;

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>MediFlow</Text>
            <Text style={styles.brandSub}>Nota clínica · expediente electrónico</Text>
          </View>
          <View>
            <Text style={styles.meta}>Clínica</Text>
            <Text style={styles.metaValue}>{clinicName}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>Fecha de visita</Text>
            <Text style={styles.metaValue}>{fmtDateTime(visitDate)}</Text>
          </View>
        </View>

        <View style={styles.patientBlock}>
          <View style={styles.patientCol}>
            <Text style={styles.patientLabel}>Paciente</Text>
            <Text style={styles.patientValue}>{patientName}</Text>
            <Text style={styles.patientSub}>
              {fmtAge(patientDob)}{patientGender ? ` · ${patientGender}` : ""}
            </Text>
          </View>
          <View style={styles.patientCol}>
            <Text style={styles.patientLabel}>Médico tratante</Text>
            <Text style={styles.patientValue}>{doctorName ?? "—"}</Text>
          </View>
          <View style={[styles.patientCol, { alignItems: "flex-end" }]}>
            <Text style={styles.patientLabel}>Estado</Text>
            <View style={{ marginTop: 4 }}>
              <Text style={status === "SIGNED" ? styles.statusPillSigned : styles.statusPillDraft}>
                {status === "SIGNED" ? "FIRMADA" : "BORRADOR"}
              </Text>
            </View>
            {status === "SIGNED" && signedAt && (
              <Text style={[styles.patientSub, { marginTop: 4 }]}>{fmtDateTime(signedAt)}</Text>
            )}
          </View>
        </View>

        <SoapBlock label="Subjetivo (S)" body={subjective} />
        <SoapBlock label="Objetivo (O)" body={objective} />
        <SoapBlock label="Análisis (A)" body={assessment} />
        <SoapBlock label="Plan (P)" body={plan} />

        {diagnoses.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Diagnósticos CIE-10</Text>
            {diagnoses.map((d) => (
              <View key={d.code} style={styles.dxRow} wrap={false}>
                <Text style={styles.dxCode}>{d.code}</Text>
                <Text style={styles.dxLabel}>{d.description}</Text>
              </View>
            ))}
          </>
        )}

        {procedures.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Procedimientos</Text>
            {procedures.map((p, i) => (
              <Text key={i} style={styles.procRow} wrap={false}>· {p}</Text>
            ))}
          </>
        )}

        <Text style={styles.footer} fixed>
          MediFlow · Expediente clínico electrónico conforme a NOM-024-SSA3-2012 ·
          Generado el {fmtDateTime(generatedAt)}
        </Text>
      </Page>
    </Document>
  );
}

function SoapBlock({ label, body }: { label: string; body: string | null }) {
  const has = !!body && body.trim().length > 0;
  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>{label}</Text>
      {has ? (
        <Text style={styles.sectionBody}>{body}</Text>
      ) : (
        <Text style={styles.sectionEmpty}>Sin información registrada.</Text>
      )}
    </View>
  );
}
