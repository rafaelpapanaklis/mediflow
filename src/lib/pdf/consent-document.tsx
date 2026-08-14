import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from "@react-pdf/renderer";
import { formatConsentDate, formatConsentDateTime } from "@/lib/consent/dates";

/**
 * ConsentDocument — PDF de la carta de consentimiento informado.
 *
 * Sirve para DOS cosas y por eso se imprime igual esté firmada o no:
 *   · como copia del documento firmado que se entrega al paciente y se conserva
 *     en el expediente (NOM-004-SSA3-2012 numeral 5.11);
 *   · como hoja para imprimir y firmar en papel cuando el paciente no firma en
 *     tableta — de ahí que las líneas de firma salgan en blanco con el nombre
 *     debajo si todavía no hay imagen.
 *
 * El pie de evidencia (hash del texto, IP y navegador desde donde se firmó) es
 * lo que sostiene la firma electrónica: sin él, el PDF es una imagen bonita sin
 * nada que demuestre qué se firmó ni desde dónde.
 *
 * TODAS las fechas se imprimen en la zona horaria de la CLÍNICA (`timeZone`),
 * que llega como prop obligatoria. Este componente se renderiza en el servidor,
 * donde la zona local es UTC: sin ella el PDF fechaba las firmas seis horas
 * adelante y contradecía a la pantalla que el paciente acababa de ver.
 *
 * Mismo lenguaje visual que QuoteDocument y PrescriptionDocument.
 */

export interface ConsentSignatureBlock {
  /** Rótulo de la línea ("Paciente", "Testigo", "Estomatólogo"). */
  role: string;
  /** Nombre impreso bajo la línea. */
  name: string;
  /** Imagen de la firma (data URL). null = línea en blanco para firmar a mano. */
  dataUrl: string | null;
  /** Fecha-hora de ESA firma (ISO). */
  signedAt: string | null;
}

export interface ConsentDocumentProps {
  clinicName: string;
  clinicAddress: string | null;
  clinicCity: string | null;
  clinicPhone: string | null;
  clinicEmail: string | null;
  logoDataUrl: string | null;

  procedure: string;
  /** Lugar de la firma (ciudad de la clínica). */
  place: string | null;
  /** Fecha de emisión (ISO). */
  issuedAt: string;
  /**
   * Zona horaria de la clínica (`Clinic.timezone`). Obligatoria a propósito:
   * si fuera opcional, un caller nuevo que la olvide vuelve a imprimir en UTC
   * y nadie se entera hasta que un paciente reclama la hora de su firma.
   */
  timeZone: string;

  patientName: string;
  patientNumber: string | null;
  signerName: string | null;
  signerRelation: string | null;
  doctorName: string | null;
  doctorLicense: string | null;

  /** Texto íntegro de la carta, tal como se guardó y como lo leyó el paciente. */
  content: string;

  signatures: ConsentSignatureBlock[];

  /** Evidencia de la firma electrónica. */
  contentHash: string | null;
  signedIp: string | null;
  signedUserAgent: string | null;
  signedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 70,
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
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "row", gap: 10, alignItems: "flex-start", maxWidth: 330 },
  logo: { width: 44, height: 44, objectFit: "contain" },
  brand: { fontSize: 16, color: "#7c3aed", fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 8.5, color: "#6b6b78", marginTop: 1 },
  docTitle: { fontSize: 12, color: "#7c3aed", fontFamily: "Helvetica-Bold", textAlign: "right", maxWidth: 170 },
  metaRight: { fontSize: 8, color: "#6b6b78", textAlign: "right", marginTop: 4 },
  metaValue: { fontSize: 10, color: "#14101f", fontFamily: "Helvetica-Bold", textAlign: "right" },

  block: { backgroundColor: "#f4f2f8", padding: 12, borderRadius: 6, marginBottom: 12 },
  twoCol: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  label: {
    fontSize: 8, color: "#6b6b78", textTransform: "uppercase",
    letterSpacing: 0.5, fontFamily: "Helvetica-Bold",
  },
  value: { fontSize: 11, color: "#14101f", fontFamily: "Helvetica-Bold", marginTop: 2 },
  sub: { fontSize: 9, color: "#6b6b78", marginTop: 1 },
  sectionTitle: {
    fontSize: 10, color: "#7c3aed", fontFamily: "Helvetica-Bold",
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 6,
  },

  // Cuerpo de la carta: se respeta el salto de línea del texto guardado.
  bodyLine: { fontSize: 9.5, color: "#14101f", lineHeight: 1.45 },
  bodyGap: { height: 5 },

  revoked: {
    borderWidth: 1, borderColor: "#dc2626", borderRadius: 6,
    padding: 8, marginBottom: 12,
  },
  revokedTitle: { fontSize: 10, color: "#dc2626", fontFamily: "Helvetica-Bold" },
  revokedText: { fontSize: 9, color: "#7f1d1d", marginTop: 2 },

  // Firmas: dos por renglón.
  sigRow: { flexDirection: "row", gap: 18, marginTop: 8 },
  sigBox: { flex: 1 },
  sigImg: { width: 150, height: 46, objectFit: "contain", marginBottom: 2 },
  sigImgEmpty: { height: 46 },
  sigLine: { borderTopWidth: 0.7, borderTopColor: "#14101f", paddingTop: 4 },
  sigRole: { fontSize: 8, color: "#6b6b78", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Helvetica-Bold" },
  sigName: { fontSize: 9.5, color: "#14101f", fontFamily: "Helvetica-Bold", marginTop: 1 },
  sigDate: { fontSize: 8, color: "#6b6b78", marginTop: 1 },

  evidence: {
    marginTop: 16, borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8,
  },
  evidenceLine: { fontSize: 7.5, color: "#6b6b78" },
  evidenceMono: { fontSize: 7, color: "#6b6b78" },

  footer: {
    position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#9b9aa8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8,
  },
  pageNum: { fontSize: 7.5, color: "#9b9aa8", textAlign: "center", marginTop: 2 },
});

/** Pares de firmas por renglón (dos columnas). */
function inPairs(blocks: ConsentSignatureBlock[]): ConsentSignatureBlock[][] {
  const rows: ConsentSignatureBlock[][] = [];
  for (let i = 0; i < blocks.length; i += 2) rows.push(blocks.slice(i, i + 2));
  return rows;
}

function SignatureCell({ block, timeZone }: { block: ConsentSignatureBlock; timeZone: string }) {
  return (
    <View style={styles.sigBox}>
      {block.dataUrl ? (
        <PdfImage style={styles.sigImg} src={block.dataUrl} />
      ) : (
        <View style={styles.sigImgEmpty} />
      )}
      <View style={styles.sigLine}>
        <Text style={styles.sigRole}>{block.role}</Text>
        <Text style={styles.sigName}>{block.name || "—"}</Text>
        <Text style={styles.sigDate}>
          {block.signedAt
            ? `Firmado el ${formatConsentDateTime(block.signedAt, timeZone)}`
            : "Fecha: ____ / ____ / ________"}
        </Text>
      </View>
    </View>
  );
}

export function ConsentDocument(props: ConsentDocumentProps) {
  const clinicLine2 = [props.clinicAddress, props.clinicCity].filter(Boolean).join(", ");
  const clinicLine3 = [
    props.clinicPhone ? `Tel: ${props.clinicPhone}` : null,
    props.clinicEmail,
  ].filter(Boolean).join(" · ");

  // El contenido se guardó como texto plano con saltos de línea. Se pinta línea
  // a línea (y no como un solo Text) para que el salto de página caiga entre
  // renglones y no parta una frase por la mitad.
  const lines = (props.content ?? "").split("\n");

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Membrete */}
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {props.logoDataUrl ? <PdfImage style={styles.logo} src={props.logoDataUrl} /> : null}
            <View>
              <Text style={styles.brand}>{props.clinicName}</Text>
              {clinicLine2 ? <Text style={styles.brandSub}>{clinicLine2}</Text> : null}
              {clinicLine3 ? <Text style={styles.brandSub}>{clinicLine3}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.docTitle}>CARTA DE CONSENTIMIENTO INFORMADO</Text>
            <Text style={styles.metaRight}>Fecha</Text>
            <Text style={styles.metaValue}>{formatConsentDate(props.issuedAt, props.timeZone)}</Text>
          </View>
        </View>

        {props.revokedAt ? (
          <View style={styles.revoked}>
            <Text style={styles.revokedTitle}>
              CONSENTIMIENTO REVOCADO EL {formatConsentDateTime(props.revokedAt, props.timeZone)}
            </Text>
            <Text style={styles.revokedText}>
              Motivo: {props.revokedReason || "No se registró motivo."}
            </Text>
          </View>
        ) : null}

        {/* Identificación — paciente, representante y estomatólogo */}
        <View style={styles.block}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Paciente</Text>
              <Text style={styles.value}>{props.patientName}</Text>
              {props.patientNumber ? (
                <Text style={styles.sub}>Expediente: {props.patientNumber}</Text>
              ) : null}
              {props.signerName ? (
                <View>
                  <Text style={[styles.label, { marginTop: 6 }]}>Representante legal</Text>
                  <Text style={styles.value}>{props.signerName}</Text>
                  <Text style={styles.sub}>
                    Parentesco o relación: {props.signerRelation || "—"}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Estomatólogo responsable</Text>
              <Text style={styles.value}>{props.doctorName || "—"}</Text>
              {props.doctorLicense ? (
                <Text style={styles.sub}>Cédula profesional: {props.doctorLicense}</Text>
              ) : null}
              <Text style={[styles.label, { marginTop: 6 }]}>Lugar y fecha</Text>
              <Text style={styles.sub}>
                {(props.place || "—") + ", a " + formatConsentDate(props.issuedAt, props.timeZone)}
              </Text>
              <Text style={[styles.label, { marginTop: 6 }]}>Acto autorizado</Text>
              <Text style={styles.sub}>{props.procedure}</Text>
            </View>
          </View>
        </View>

        {/* Cuerpo de la carta */}
        {lines.map((line, i) =>
          line.trim() === "" ? (
            <View key={i} style={styles.bodyGap} />
          ) : (
            <Text key={i} style={styles.bodyLine}>{line}</Text>
          ),
        )}

        {/* Firmas */}
        <Text style={styles.sectionTitle}>Firmas</Text>
        {inPairs(props.signatures).map((row, i) => (
          <View key={i} style={styles.sigRow} wrap={false}>
            {row.map((b, j) => <SignatureCell key={j} block={b} timeZone={props.timeZone} />)}
            {/* Relleno para que una firma suelta no ocupe el ancho completo. */}
            {row.length === 1 ? <View style={styles.sigBox} /> : null}
          </View>
        ))}

        {/* Evidencia de la firma electrónica */}
        <View style={styles.evidence} wrap={false}>
          <Text style={styles.evidenceLine}>
            Documento firmado electrónicamente. Evidencia conforme a arts. 89 y 89 bis del Código de
            Comercio y 210-A del CFPC.
          </Text>
          {props.contentHash ? (
            <Text style={styles.evidenceMono}>
              Huella del documento (SHA-256): {props.contentHash}
            </Text>
          ) : null}
          <Text style={styles.evidenceMono}>
            Firma del paciente:{" "}
            {props.signedAt ? formatConsentDateTime(props.signedAt, props.timeZone) : "pendiente"}
            {props.signedIp ? ` · IP ${props.signedIp}` : ""}
          </Text>
          {props.signedUserAgent ? (
            <Text style={styles.evidenceMono}>
              Dispositivo: {props.signedUserAgent.slice(0, 160)}
            </Text>
          ) : null}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            Elaborado conforme al contenido de la NOM-004-SSA3-2012 y la NOM-013-SSA2-2015 ·{" "}
            {props.clinicName}
          </Text>
          <Text
            fixed
            style={styles.pageNum}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
