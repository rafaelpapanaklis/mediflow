import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from "@react-pdf/renderer";

/**
 * PrescriptionDocument — PDF de receta médica electrónica (NOM-024).
 * Membrete con datos de la clínica (logo si existe), médico con cédula
 * profesional, paciente, medicamentos CUMS, indicaciones, vigencia COFEPRIS,
 * QR de verificación pública y bloque de firma (electrónica FIEL si aplica).
 */

export interface PrescriptionPdfItemProps {
  descripcion: string;
  presentacion: string | null;
  dosage: string;
  duration: string | null;
  quantity: string | null;
  notes: string | null;
  cofeprisGroup: string | null;
}

export interface PrescriptionDocumentProps {
  clinicName: string;
  clinicAddress: string | null;
  clinicCity: string | null;
  clinicPhone: string | null;
  clinicEmail: string | null;
  clinicClues: string | null;
  logoDataUrl: string | null;
  doctorName: string;
  doctorEspecialidad: string | null;
  doctorCedula: string | null;
  doctorCedulaEspecialidad: string | null;
  patientName: string;
  patientAge: string | null;
  diagnosis: string | null;
  indications: string | null;
  items: PrescriptionPdfItemProps[];
  issuedAt: string;
  expiresAt: string | null;
  cofeprisGroup: string | null;
  cofeprisFolio: string | null;
  folio: string;
  verifyUrl: string;
  qrDataUrl: string | null;
  signedElectronically: boolean;
  signedAt: string | null;
  // NOM-004 / NOM-024 §7 — receta ANULADA (status VOIDED). Estampa watermark +
  // banner para que el PDF jamás se confunda con una receta vigente.
  voided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 64,
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
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    maxWidth: 330,
  },
  logo: {
    width: 44,
    height: 44,
    objectFit: "contain",
  },
  brand: {
    fontSize: 16,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
  },
  brandSub: {
    fontSize: 8.5,
    color: "#6b6b78",
    marginTop: 1,
  },
  rxTitle: {
    fontSize: 13,
    color: "#7c3aed",
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  metaRight: {
    fontSize: 8,
    color: "#6b6b78",
    textAlign: "right",
    marginTop: 4,
  },
  metaValue: {
    fontSize: 10,
    color: "#14101f",
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  folioMono: {
    fontSize: 7.5,
    color: "#6b6b78",
    textAlign: "right",
  },
  block: {
    backgroundColor: "#f4f2f8",
    padding: 12,
    borderRadius: 6,
    marginBottom: 12,
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
    marginTop: 6,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4dc",
  },
  medRow: {
    marginBottom: 8,
    paddingLeft: 2,
  },
  medName: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#14101f",
  },
  medPresentation: {
    fontSize: 9,
    color: "#6b6b78",
  },
  medPosology: {
    fontSize: 9.5,
    color: "#33304a",
    marginTop: 1,
  },
  medNotes: {
    fontSize: 8.5,
    color: "#6b6b78",
    marginTop: 1,
  },
  controlled: {
    fontSize: 8,
    color: "#b91c1c",
    fontFamily: "Helvetica-Bold",
    marginTop: 1,
  },
  body: {
    fontSize: 10,
    color: "#14101f",
    marginBottom: 8,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 26,
  },
  qrBox: {
    alignItems: "flex-start",
    maxWidth: 250,
  },
  qrImage: {
    width: 88,
    height: 88,
  },
  qrCaption: {
    fontSize: 7.5,
    color: "#6b6b78",
    marginTop: 4,
  },
  qrUrl: {
    fontSize: 6.5,
    color: "#9b9aa8",
  },
  signature: {
    borderTopWidth: 0.5,
    borderTopColor: "#14101f",
    paddingTop: 6,
    width: 210,
  },
  signedBadge: {
    fontSize: 8,
    color: "#047857",
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#9b9aa8",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5ed",
    paddingTop: 8,
  },
  watermark: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  watermarkText: {
    fontSize: 120,
    color: "#dc2626",
    fontFamily: "Helvetica-Bold",
    opacity: 0.16,
    transform: "rotate(-45deg)",
    letterSpacing: 6,
  },
  voidBanner: {
    backgroundColor: "#dc2626",
    borderRadius: 6,
    padding: 10,
    marginBottom: 14,
  },
  voidBannerTitle: {
    fontSize: 13,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
  },
  voidBannerReason: {
    fontSize: 8.5,
    color: "#ffffff",
    marginTop: 2,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}

export function PrescriptionDocument(props: PrescriptionDocumentProps) {
  const clinicLine2 = [props.clinicAddress, props.clinicCity].filter(Boolean).join(", ");
  const clinicLine3 = [
    props.clinicPhone ? `Tel: ${props.clinicPhone}` : null,
    props.clinicEmail,
  ].filter(Boolean).join(" · ");

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* NOM-004 / NOM-024 §7 — sello de ANULADA si la receta fue anulada */}
        {props.voided ? (
          <View style={styles.watermark} fixed>
            <Text style={styles.watermarkText}>ANULADA</Text>
          </View>
        ) : null}
        {props.voided ? (
          <View style={styles.voidBanner}>
            <Text style={styles.voidBannerTitle}>RECETA ANULADA — SIN VALIDEZ</Text>
            <Text style={styles.voidBannerReason}>
              Esta receta fue anulada{props.voidedAt ? ` el ${fmtDate(props.voidedAt)}` : ""} y no debe surtirse.{props.voidReason ? ` Motivo: ${props.voidReason}` : ""}
            </Text>
          </View>
        ) : null}
        {/* Membrete */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {props.logoDataUrl ? <PdfImage style={styles.logo} src={props.logoDataUrl} /> : null}
            <View>
              <Text style={styles.brand}>{props.clinicName}</Text>
              {clinicLine2 ? <Text style={styles.brandSub}>{clinicLine2}</Text> : null}
              {clinicLine3 ? <Text style={styles.brandSub}>{clinicLine3}</Text> : null}
              {props.clinicClues ? <Text style={styles.brandSub}>CLUES: {props.clinicClues}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.rxTitle}>RECETA MÉDICA</Text>
            <Text style={styles.metaRight}>Folio</Text>
            <Text style={styles.folioMono}>{props.folio}</Text>
            <Text style={styles.metaRight}>Fecha de emisión</Text>
            <Text style={styles.metaValue}>{fmtDate(props.issuedAt)}</Text>
          </View>
        </View>

        {/* Médico + paciente */}
        <View style={styles.block}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Médico tratante</Text>
              <Text style={styles.value}>{props.doctorName}</Text>
              {props.doctorEspecialidad ? <Text style={styles.sub}>{props.doctorEspecialidad}</Text> : null}
              {props.doctorCedula ? <Text style={styles.sub}>Cédula profesional: {props.doctorCedula}</Text> : null}
              {props.doctorCedulaEspecialidad ? (
                <Text style={styles.sub}>Cédula de especialidad: {props.doctorCedulaEspecialidad}</Text>
              ) : null}
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Paciente</Text>
              <Text style={styles.value}>{props.patientName}</Text>
              {props.patientAge ? <Text style={styles.sub}>Edad: {props.patientAge}</Text> : null}
            </View>
          </View>
        </View>

        {/* Diagnóstico (opcional) */}
        {props.diagnosis ? (
          <View>
            <Text style={styles.sectionTitle}>Diagnóstico</Text>
            <Text style={styles.body}>{props.diagnosis}</Text>
          </View>
        ) : null}

        {/* Medicamentos */}
        <Text style={styles.sectionTitle}>Medicamentos prescritos</Text>
        {props.items.length === 0 ? (
          <Text style={styles.body}>Sin medicamentos estructurados (receta en formato anterior).</Text>
        ) : (
          props.items.map((it, idx) => (
            <View key={idx} style={styles.medRow} wrap={false}>
              <Text style={styles.medName}>{idx + 1}. {it.descripcion}</Text>
              {it.presentacion ? <Text style={styles.medPresentation}>{it.presentacion}</Text> : null}
              <Text style={styles.medPosology}>
                Dosis: {it.dosage}
                {it.duration ? `  ·  Duración: ${it.duration}` : ""}
                {it.quantity ? `  ·  Cantidad: ${it.quantity}` : ""}
              </Text>
              {it.notes ? <Text style={styles.medNotes}>{it.notes}</Text> : null}
              {it.cofeprisGroup ? (
                <Text style={styles.controlled}>Sustancia controlada — Grupo COFEPRIS {it.cofeprisGroup}</Text>
              ) : null}
            </View>
          ))
        )}

        {/* Indicaciones generales */}
        {props.indications ? (
          <View>
            <Text style={styles.sectionTitle}>Indicaciones generales</Text>
            <Text style={styles.body}>{props.indications}</Text>
          </View>
        ) : null}

        {/* Vigencia */}
        <View style={[styles.block, { marginTop: 4 }]}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Vigencia</Text>
              <Text style={styles.sub}>Emitida el {fmtDate(props.issuedAt)}</Text>
              <Text style={styles.sub}>Válida hasta el {fmtDate(props.expiresAt)}</Text>
            </View>
            {props.cofeprisGroup || props.cofeprisFolio ? (
              <View style={styles.col}>
                <Text style={styles.label}>COFEPRIS</Text>
                {props.cofeprisGroup ? <Text style={styles.sub}>Clasificación: Grupo {props.cofeprisGroup}</Text> : null}
                {props.cofeprisFolio ? <Text style={styles.sub}>Folio: {props.cofeprisFolio}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* QR + firma */}
        <View style={styles.bottomRow} wrap={false}>
          <View style={styles.qrBox}>
            {props.qrDataUrl ? <PdfImage style={styles.qrImage} src={props.qrDataUrl} /> : null}
            <Text style={styles.qrCaption}>Escanea el código para verificar esta receta:</Text>
            <Text style={styles.qrUrl}>{props.verifyUrl}</Text>
          </View>
          <View style={styles.signature}>
            <Text style={styles.value}>{props.doctorName}</Text>
            <Text style={styles.sub}>
              {props.doctorCedula ? `Cédula profesional ${props.doctorCedula}` : "Médico tratante"}
            </Text>
            {props.signedElectronically ? (
              <Text style={styles.signedBadge}>
                Firmada electrónicamente (e.firma){props.signedAt ? ` el ${fmtDate(props.signedAt)}` : ""}
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Receta generada en DaleControl · Verificable en línea mediante el código QR
        </Text>
      </Page>
    </Document>
  );
}
