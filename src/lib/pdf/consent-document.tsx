import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from "@react-pdf/renderer";
import { ClinicLetterhead } from "./clinic-letterhead";
import { formatConsentDate, formatConsentDateTime } from "@/lib/consent/dates";
import { parseConsentText, splitConsentBody } from "@/lib/consent/render";
import {
  consentValue,
  consentValueOrBlank,
  doctorCredentialLines,
  patientIdentityLines,
} from "@/lib/consent/document-data";

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
 * DATOS DE IDENTIFICACIÓN: CURP e ID del paciente, cédula(s) y especialidad del
 * doctor y dirección de la clínica van SIEMPRE con su etiqueta. Si el dato no
 * está capturado sale la raya para llenarlo a mano — nunca se omite el renglón
 * (así nadie nota que falta) ni se imprime "undefined" o un "N/A". Las etiquetas
 * y la raya salen de `lib/consent/document-data`, las mismas que usa el texto.
 *
 * ES UNA CARTA, con la misma composición que `PatientDocument` (la nota de
 * evolución) y que la hoja del panel: membrete común (`ClinicLetterhead`), fecha
 * a la derecha, a quién y de quién con las etiquetas pequeñas y los valores
 * mandando, título, cuerpo a ancho de lectura y un pie de firmas que parece un
 * pie de firmas. Lo que esta carta tiene de más —dos firmas, testigos,
 * representante, revocación y evidencia— se queda.
 *
 * El TEXTO se imprime íntegro y en su orden: `parseConsentText` solo lo parte
 * para darle jerarquía (encabezados, párrafos, viñetas). Una carta sin secciones
 * numeradas —las del sistema viejo— sale entera como párrafos.
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
  /** Ancho/alto reales del logo. Sin esto el membrete lo asume cuadrado. */
  logoAspect?: number | null;

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
  /** ID del paciente = `Patient.patientNumber` (el folio), NUNCA el id interno. */
  patientNumber: string | null;
  /** `Patient.curp`. */
  patientCurp: string | null;
  signerName: string | null;
  signerRelation: string | null;
  doctorName: string | null;
  /** `User.cedulaProfesional`. */
  doctorLicense: string | null;
  /** `User.cedulaEspecialidad`. Solo se imprime si existe. */
  doctorSpecialtyLicense: string | null;
  /** `User.especialidad` (la de Equipo), no `User.specialty`. */
  doctorSpecialty: string | null;

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

const ACCENT = "#7c3aed";
const TINTA = "#14101f";
const GRIS = "#6b6b78";

const styles = StyleSheet.create({
  // Los mismos márgenes de carta que `PatientDocument`: 56 pt a los lados.
  page: {
    paddingTop: 48, paddingHorizontal: 56, paddingBottom: 72,
    fontFamily: "Helvetica", fontSize: 10, color: TINTA, lineHeight: 1.5,
  },
  dateLabel: {
    fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8,
    textAlign: "right", lineHeight: 1.2,
  },
  dateValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 2, lineHeight: 1.25 },

  parties: { flexDirection: "row", gap: 24, marginBottom: 18 },
  party: { flex: 1 },
  label: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, lineHeight: 1.2 },
  labelGap: { marginTop: 8 },
  value: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  detail: { fontSize: 9, color: GRIS, marginTop: 2, lineHeight: 1.3 },
  detailValue: { color: TINTA },

  kind: { fontSize: 8.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3, lineHeight: 1.2 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  rule: { borderBottomWidth: 0.7, borderBottomColor: "#e5e5ed", marginTop: 10, marginBottom: 14 },

  // Cuerpo: renglón a renglón, para que el salto de página caiga entre
  // renglones y no parta una frase por la mitad.
  body: { paddingRight: 28 },
  heading: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4, lineHeight: 1.25 },
  line: { fontSize: 10, lineHeight: 1.5 },
  blockGap: { height: 7 },
  item: { flexDirection: "row", marginBottom: 2, marginLeft: 6 },
  itemMark: { width: 12 },
  itemText: { flex: 1, fontSize: 10, lineHeight: 1.5 },

  revoked: {
    borderWidth: 1, borderColor: "#dc2626", borderRadius: 6,
    padding: 8, marginBottom: 14,
  },
  revokedTitle: { fontSize: 10, color: "#dc2626", fontFamily: "Helvetica-Bold" },
  revokedText: { fontSize: 9, color: "#7f1d1d", marginTop: 2 },

  // Firmas: dos por renglón, con sitio de sobra encima de la línea para un
  // bolígrafo de verdad.
  sigRow: { flexDirection: "row", gap: 28, marginTop: 14 },
  sigBox: { flex: 1 },
  sigImg: { width: 160, height: 54, objectFit: "contain", objectPositionX: 0, marginBottom: 2 },
  sigImgEmpty: { height: 56 },
  sigLine: { borderTopWidth: 0.8, borderTopColor: TINTA, paddingTop: 6 },
  sigRole: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, lineHeight: 1.2 },
  sigName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  sigDate: { fontSize: 8.5, color: GRIS, marginTop: 2, lineHeight: 1.3 },

  evidence: {
    marginTop: 22, borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8,
  },
  evidenceLine: { fontSize: 7.5, color: GRIS, lineHeight: 1.4 },
  evidenceMono: { fontSize: 7, color: GRIS, lineHeight: 1.4 },

  footer: {
    position: "absolute", bottom: 28, left: 56, right: 56, fontSize: 8, color: "#9b9aa8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8, lineHeight: 1.3,
  },
  // `lineHeight: ""` NO es decorativo: ver `patient-document.tsx`. Sin él
  // @react-pdf 4.x pinta el «Página N de M» FUERA del papel.
  pageNum: { fontSize: 7.5, color: "#9b9aa8", textAlign: "center", marginTop: 2, lineHeight: "" },
});

/** Pares de firmas por renglón (dos columnas). */
function inPairs(blocks: ConsentSignatureBlock[]): ConsentSignatureBlock[][] {
  const rows: ConsentSignatureBlock[][] = [];
  for (let i = 0; i < blocks.length; i += 2) rows.push(blocks.slice(i, i + 2));
  return rows;
}

function SignatureCell({
  block, timeZone, forPaper,
}: { block: ConsentSignatureBlock; timeZone: string; forPaper: boolean }) {
  return (
    <View style={styles.sigBox}>
      {block.dataUrl ? (
        <PdfImage style={styles.sigImg} src={block.dataUrl} />
      ) : (
        <View style={styles.sigImgEmpty} />
      )}
      <View style={styles.sigLine}>
        <Text style={styles.sigRole}>{block.role}</Text>
        <Text style={styles.sigName}>{block.name || " "}</Text>
        <Text style={styles.sigDate}>
          {block.signedAt
            ? `Firmado el ${formatConsentDateTime(block.signedAt, timeZone)}`
            // La fecha por llenar es de la hoja que va a pasar por un bolígrafo.
            // En una carta ya firmada en digital, a quien falta le falta FIRMAR.
            : forPaper
              ? "Fecha: ____ / ____ / ________"
              : "Firma pendiente"}
        </Text>
      </View>
    </View>
  );
}

function Detalle({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Text style={styles.detail}>
      {etiqueta}: <Text style={styles.detailValue}>{valor}</Text>
    </Text>
  );
}

/** Un tramo del texto de la carta: párrafos renglón a renglón y viñetas. */
function Cuerpo({ text }: { text: string }) {
  const blocks = splitConsentBody(text);
  return (
    <>
      {blocks.map((block, bi) => (
        <View key={bi}>
          {block.kind === "bullets"
            ? block.lines.map((l, li) => (
                <View key={li} style={styles.item} wrap={false}>
                  <Text style={styles.itemMark}>•</Text>
                  <Text style={styles.itemText}>{l}</Text>
                </View>
              ))
            : block.lines.map((l, li) => <Text key={li} style={styles.line}>{l}</Text>)}
          {bi < blocks.length - 1 ? <View style={styles.blockGap} /> : null}
        </View>
      ))}
    </>
  );
}

export function ConsentDocument(props: ConsentDocumentProps) {
  // Dirección con etiqueta y, si falta, con raya: en el membrete un hueco
  // silencioso es justo lo que hacía que nadie supiera que faltaba. Va en UN
  // renglón con la ciudad (por eso `clinicCity` no se le pasa al membrete).
  const clinicAddress = consentValue(props.clinicAddress);
  const addressLine =
    "Dirección: " +
    (clinicAddress
      ? [clinicAddress, consentValue(props.clinicCity)].filter(Boolean).join(", ")
      : consentValueOrBlank(null));

  const doc = parseConsentText(props.content ?? "");
  const forPaper = !props.signedAt;

  return (
    <Document title={props.procedure} author={props.clinicName}>
      <Page size="LETTER" style={styles.page} wrap>
        <ClinicLetterhead
          clinicName={props.clinicName}
          clinicAddress={addressLine}
          clinicPhone={props.clinicPhone}
          clinicEmail={props.clinicEmail}
          clinicLogoDataUrl={props.logoDataUrl}
          clinicLogoAspect={props.logoAspect ?? null}
          accent={ACCENT}
          right={
            <View>
              <Text style={styles.dateLabel}>Fecha</Text>
              <Text style={styles.dateValue}>{formatConsentDate(props.issuedAt, props.timeZone)}</Text>
            </View>
          }
        />

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

        {/* A quién y de quién */}
        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Paciente</Text>
            <Text style={styles.value}>{consentValueOrBlank(props.patientName)}</Text>
            {patientIdentityLines(props).map((l) => (
              <Detalle key={l.label} etiqueta={l.label} valor={l.value} />
            ))}
            {props.signerName ? (
              <View>
                <Text style={[styles.label, styles.labelGap]}>Representante legal</Text>
                <Text style={styles.value}>{props.signerName}</Text>
                <Detalle etiqueta="Parentesco o relación" valor={consentValueOrBlank(props.signerRelation)} />
              </View>
            ) : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Estomatólogo responsable</Text>
            <Text style={styles.value}>{consentValueOrBlank(props.doctorName)}</Text>
            {doctorCredentialLines(props).map((l) => (
              <Detalle key={l.label} etiqueta={l.label} valor={l.value} />
            ))}
            <Text style={[styles.label, styles.labelGap]}>Lugar y fecha</Text>
            <Text style={styles.detail}>
              <Text style={styles.detailValue}>
                {consentValueOrBlank(props.place) + ", a " + formatConsentDate(props.issuedAt, props.timeZone)}
              </Text>
            </Text>
          </View>
        </View>

        {/* El título del propio texto va de sello: así la carta sale ÍNTEGRA. */}
        <Text style={styles.kind}>{doc.title || "Carta de consentimiento informado"}</Text>
        <Text style={styles.title}>{consentValueOrBlank(props.procedure)}</Text>
        <View style={styles.rule} />

        {/* Cuerpo de la carta */}
        <View style={styles.body}>
          {doc.preamble ? <Cuerpo text={doc.preamble} /> : null}
          {doc.sections.map((section, i) => (
            <View key={i}>
              {/* Un encabezado no se queda solo al pie de la hoja. */}
              <Text style={styles.heading} minPresenceAhead={40}>
                {section.number == null ? section.title : `${section.number}. ${section.title}`}
              </Text>
              <Cuerpo text={section.body} />
            </View>
          ))}
        </View>

        {/* Firmas */}
        {inPairs(props.signatures).map((row, i) => (
          <View key={i} style={[styles.sigRow, i === 0 ? { marginTop: 30 } : {}]} wrap={false}>
            {row.map((b, j) => (
              <SignatureCell key={j} block={b} timeZone={props.timeZone} forPaper={forPaper} />
            ))}
            {/* Relleno para que una firma suelta no ocupe el ancho completo. */}
            {row.length === 1 ? <View style={styles.sigBox} /> : null}
          </View>
        ))}

        {/* Evidencia. Una carta SIN firmar es la que se imprime para firmar a
            mano: no puede decir "firmado electrónicamente" ni "IP" de nada.
            Lleva solo la huella del texto, que es lo que permite comprobar
            después que el papel firmado es este documento y no otro. */}
        <View style={styles.evidence} wrap={false}>
          {props.signedAt ? (
            <Text style={styles.evidenceLine}>
              Documento firmado electrónicamente. Evidencia conforme a arts. 89 y 89 bis del Código de
              Comercio y 210-A del CFPC.
            </Text>
          ) : (
            <Text style={styles.evidenceLine}>
              Documento emitido para su firma autógrafa. La huella identifica el texto exacto de esta
              carta.
            </Text>
          )}
          {props.contentHash ? (
            <Text style={styles.evidenceMono}>
              Huella del documento (SHA-256): {props.contentHash}
            </Text>
          ) : null}
          {props.signedAt ? (
            <Text style={styles.evidenceMono}>
              Firma del paciente: {formatConsentDateTime(props.signedAt, props.timeZone)}
              {props.signedIp ? ` · IP ${props.signedIp}` : ""}
            </Text>
          ) : null}
          {props.signedAt && props.signedUserAgent ? (
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
            style={styles.pageNum}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
