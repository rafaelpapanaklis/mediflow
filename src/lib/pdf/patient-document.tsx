import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { ClinicLetterhead, type ClinicLetterheadClinic } from "./clinic-letterhead";
import { htmlABloques, type Bloque, type Tramo } from "@/lib/patient-documents/html-a-bloques";
import { valorORaya } from "@/lib/patient-documents/faltantes";

/**
 * PatientDocument — el PDF de un documento del paciente escrito desde una
 * plantilla de la clínica (hoy la nota de evolución; mañana, lo que comparta
 * la tabla `patient_documents`).
 *
 * Es una CARTA: membrete, fecha a la derecha, a quién y de quién, título,
 * cuerpo y pie de firma. La misma composición que la hoja de la pantalla
 * (`components/dashboard/documentos-paciente`), para que lo que el doctor firmó
 * y lo que el paciente recibe se reconozcan a simple vista.
 *
 * TRES REGLAS:
 *   · Se pinta SOLO lo que llega por props, que es la foto congelada con el
 *     documento. Aquí no se consulta nada ni se rellena nada con datos de hoy.
 *   · Un dato que falta sale como su ETIQUETA con la raya para llenarlo a mano
 *     (`valorORaya`). Nunca "N/A", nunca un valor inventado. El logo es la
 *     excepción que ya decidió Rafael en el membrete: sin logo no hay recuadro
 *     vacío, manda el nombre de la clínica.
 *   · El cuerpo es el HTML GUARDADO del documento —el texto tal y como se
 *     firmó—, no el de la plantilla de la que salió.
 */

export interface PatientDocumentProps extends ClinicLetterheadClinic {
  /** Renglón bajo el nombre de la clínica: "Nota de evolución". */
  kindLabel: string;
  title: string;
  /** Fecha larga ya formateada en la zona de la clínica. */
  date: string;

  patientName: string;
  patientNumber: string | null;
  patientCurp: string | null;
  /** Paciente extranjero: no hay CURP que llenar, así que el renglón no sale. */
  patientHasNoCurp: boolean;

  doctorName: string;
  doctorLicense: string | null;
  doctorSpecialtyLicense: string | null;
  doctorSpecialty: string | null;

  /** HTML saneado del documento, tal y como se guardó. */
  bodyHtml: string;

  signed: boolean;
  /** Fecha y hora de la firma, ya formateadas en la zona de la clínica. */
  signedAtLabel: string | null;
}

const ACCENT = "#7c3aed";
const TINTA = "#14101f";
const GRIS = "#6b6b78";

const styles = StyleSheet.create({
  // Márgenes de carta: 56 pt a los lados dejan 500 pt de renglón; el cuerpo se
  // estrecha además con `body.paddingRight` para acercarse a los ~75 caracteres.
  page: {
    paddingTop: 48, paddingHorizontal: 56, paddingBottom: 72,
    fontFamily: "Helvetica", fontSize: 10.5, color: TINTA, lineHeight: 1.5,
  },
  dateLabel: {
    fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8,
    textAlign: "right", lineHeight: 1.2,
  },
  dateValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 2, lineHeight: 1.25 },

  parties: { flexDirection: "row", gap: 24, marginBottom: 22 },
  party: { flex: 1 },
  label: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, lineHeight: 1.2 },
  value: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  detail: { fontSize: 9, color: GRIS, marginTop: 2, lineHeight: 1.3 },
  detailValue: { color: TINTA },

  title: { fontSize: 17, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 4 },
  draft: { fontSize: 8.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  rule: { borderBottomWidth: 0.7, borderBottomColor: "#e5e5ed", marginTop: 8, marginBottom: 14 },

  body: { paddingRight: 36 },
  p: { marginBottom: 8, textAlign: "left" },
  h1: { fontSize: 13.5, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 5, lineHeight: 1.25 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 4, lineHeight: 1.25 },
  h3: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 3 },
  item: { flexDirection: "row", marginBottom: 3 },
  itemMark: { width: 16 },
  itemText: { flex: 1 },

  signature: { marginTop: 36, width: 260 },
  signatureLine: { borderTopWidth: 0.8, borderTopColor: TINTA, paddingTop: 6 },
  signatureName: { fontSize: 11.5, fontFamily: "Helvetica-Bold", lineHeight: 1.25 },
  signatureMeta: { fontSize: 9, color: GRIS, marginTop: 2, lineHeight: 1.3 },

  footer: {
    position: "absolute", bottom: 28, left: 56, right: 56, fontSize: 8, color: "#9b9aa8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8, lineHeight: 1.3,
  },
  // `lineHeight: ""` NO es decorativo: @react-pdf 4.x vuelve a resolver los
  // estilos al pintar un `render` y multiplica otra vez el interlineado heredado;
  // el «Página N de M» acaba FUERA del papel. Mismo arreglo (y misma medida con
  // `_texto-del-pdf.ts`) que `clinical-note-document`.
  pageNum: { fontSize: 7.5, color: "#9b9aa8", textAlign: "center", marginTop: 2, lineHeight: "" },
});

function fuente(t: Tramo): string {
  if (t.negrita && t.cursiva) return "Helvetica-BoldOblique";
  if (t.negrita) return "Helvetica-Bold";
  if (t.cursiva) return "Helvetica-Oblique";
  return "Helvetica";
}

function Tramos({ tramos, negrita }: { tramos: Tramo[]; negrita?: boolean }) {
  return (
    <>
      {tramos.map((t, i) => (
        <Text
          key={i}
          style={{
            fontFamily: fuente(negrita ? { ...t, negrita: true } : t),
            textDecoration: t.subrayado ? "underline" : "none",
          }}
        >
          {t.texto}
        </Text>
      ))}
    </>
  );
}

function BloquePdf({ bloque }: { bloque: Bloque }) {
  if (bloque.tipo === "item") {
    return (
      <View style={[styles.item, { marginLeft: 6 + bloque.nivel * 16 }]} wrap={false}>
        <Text style={styles.itemMark}>{bloque.marca}</Text>
        <Text style={styles.itemText}>
          <Tramos tramos={bloque.tramos} />
        </Text>
      </View>
    );
  }
  if (bloque.tipo === "parrafo") {
    return (
      <Text style={styles.p}>
        <Tramos tramos={bloque.tramos} />
      </Text>
    );
  }
  return (
    // Un título no se queda solo al pie de la hoja.
    <Text style={styles[bloque.tipo]} minPresenceAhead={40}>
      <Tramos tramos={bloque.tramos} negrita />
    </Text>
  );
}

function Detalle({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Text style={styles.detail}>
      {etiqueta}: <Text style={styles.detailValue}>{valor}</Text>
    </Text>
  );
}

export function PatientDocument(props: PatientDocumentProps) {
  const bloques = htmlABloques(props.bodyHtml);
  const especialidadCedula = (props.doctorSpecialtyLicense ?? "").trim();

  return (
    <Document title={props.title} author={props.clinicName}>
      <Page size="LETTER" style={styles.page}>
        <ClinicLetterhead
          {...props}
          accent={ACCENT}
          subtitle={props.kindLabel}
          right={
            <View>
              <Text style={styles.dateLabel}>Fecha</Text>
              <Text style={styles.dateValue}>{valorORaya(props.date)}</Text>
            </View>
          }
        />

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Paciente</Text>
            <Text style={styles.value}>{valorORaya(props.patientName)}</Text>
            <Detalle etiqueta="Expediente" valor={valorORaya(props.patientNumber)} />
            {props.patientHasNoCurp ? null : (
              <Detalle etiqueta="CURP" valor={valorORaya(props.patientCurp)} />
            )}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Doctor</Text>
            <Text style={styles.value}>{valorORaya(props.doctorName)}</Text>
            <Detalle etiqueta="Cédula profesional" valor={valorORaya(props.doctorLicense)} />
            {/* La de especialidad solo la tiene quien cursó una: sin ella no hay renglón. */}
            {especialidadCedula ? <Detalle etiqueta="Cédula de especialidad" valor={especialidadCedula} /> : null}
            <Detalle etiqueta="Especialidad" valor={valorORaya(props.doctorSpecialty)} />
          </View>
        </View>

        {props.signed ? null : <Text style={styles.draft}>Borrador — sin firmar</Text>}
        <Text style={styles.title}>{props.title}</Text>
        <View style={styles.rule} />

        <View style={styles.body}>
          {bloques.map((b, i) => (
            <BloquePdf key={i} bloque={b} />
          ))}
        </View>

        <View style={styles.signature} wrap={false}>
          <View style={styles.signatureLine}>
            <Text style={styles.signatureName}>{valorORaya(props.doctorName)}</Text>
            <Text style={styles.signatureMeta}>Cédula profesional: {valorORaya(props.doctorLicense)}</Text>
            <Text style={styles.signatureMeta}>
              {props.signed
                ? `Firmada electrónicamente${props.signedAtLabel ? ` el ${props.signedAtLabel}` : ""}`
                : "Borrador: todavía no está firmada"}
            </Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{props.clinicName} · {props.kindLabel}</Text>
          <Text
            style={styles.pageNum}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
