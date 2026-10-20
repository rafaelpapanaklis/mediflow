import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { ClinicLetterhead, type ClinicLetterheadClinic } from "./clinic-letterhead";
import type { DocumentoDelPlan, RenglonPdf } from "@/lib/treatments/plan-pdf";

/**
 * PlanTratamientoDocument — el plan de tratamiento del paciente, CON precios (ws1-t12).
 *
 * Mismo lenguaje que el presupuesto (`quote-document.tsx`): tabla de conceptos
 * agrupada por fase, totales a la derecha, leyenda y firma. La cabecera es la
 * común (`ClinicLetterhead`: logo, nombre y datos de la clínica o sede) y el pie
 * de firmas imita el de los consentimientos (línea, rol, nombre y fecha por llenar).
 *
 * El contenido llega YA armado (`armarDocumentoDelPlan`): aquí no hay aritmética
 * ni se lee `description`, así que las notas del plan no tienen por dónde entrar.
 * Todos los textos llegan traducidos (`textos`), del es.json / en.json de la clínica.
 */

export interface TextosPlanPdf {
  titulo: string;
  paciente: string;
  fecha: string;
  doctor: string;
  /** «Céd. prof. {cedula}», ya con el número. "" si el doctor no la tiene. */
  cedula: string;
  plan: string;
  estado: string;
  inicio: string;
  procedimientos: string;
  concepto: string;
  zona: string;
  cantidad: string;
  precio: string;
  importe: string;
  subtotalFase: string;
  subtotal: string;
  descuento: string;
  ajuste: string;
  total: string;
  pagado: string;
  saldo: string;
  notaPagos: string;
  leyenda: string;
  firmaPaciente: string;
  firmaDoctor: string;
  fechaPorLlenar: string;
  pie: string;
  /** Recibe número de página y total: «Página 1 de 2». */
  pagina: (n: number, total: number) => string;
}

export interface PlanTratamientoDocumentProps extends ClinicLetterheadClinic {
  textos: TextosPlanPdf;
  pacienteNombre: string;
  /** Folio del paciente (patientNumber), o null. */
  pacienteFolio: string | null;
  doctorNombre: string;
  planNombre: string;
  estadoPlan: string;
  /** Ya formateadas en la zona de la clínica. */
  fechaEmision: string;
  fechaInicio: string | null;
  documento: DocumentoDelPlan;
  /** Formato de dinero de la app (`formatCurrency`). */
  dinero: (n: number) => string;
}

const ACENTO = "#7c3aed";
const TINTA = "#14101f";
const GRIS = "#6b6b78";

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 64, fontFamily: "Helvetica", fontSize: 10, color: TINTA, lineHeight: 1.5 },
  docTitle: { fontSize: 13, color: ACENTO, fontFamily: "Helvetica-Bold", textAlign: "right", textTransform: "uppercase" },
  metaRight: { fontSize: 8, color: GRIS, textAlign: "right", marginTop: 4 },
  metaValue: { fontSize: 10, color: TINTA, fontFamily: "Helvetica-Bold", textAlign: "right" },
  block: { backgroundColor: "#f4f2f8", padding: 10, paddingHorizontal: 12, borderRadius: 6, marginBottom: 10 },
  twoCol: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  label: { fontSize: 8, color: GRIS, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Helvetica-Bold" },
  value: { fontSize: 11, color: TINTA, fontFamily: "Helvetica-Bold", marginTop: 2 },
  sub: { fontSize: 9, color: GRIS, marginTop: 1 },
  sectionTitle: {
    fontSize: 10, color: ACENTO, fontFamily: "Helvetica-Bold",
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 6,
  },
  faseRow: { paddingTop: 8, paddingBottom: 2 },
  tHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: ACENTO, paddingBottom: 4, marginBottom: 2 },
  th: { fontSize: 8, color: GRIS, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  tRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e5ed", paddingVertical: 4 },
  td: { fontSize: 9.5, color: TINTA },
  tdBold: { fontSize: 9.5, color: TINTA, fontFamily: "Helvetica-Bold" },
  tdMutedSmall: { fontSize: 8, color: GRIS, marginTop: 1 },
  cConcept: { width: "44%", paddingRight: 6 },
  cZona: { width: "17%", paddingRight: 4 },
  cQty: { width: "9%", textAlign: "center" },
  cUnit: { width: "15%", textAlign: "right" },
  cTotal: { width: "15%", textAlign: "right" },
  faseSubtotal: { fontSize: 8.5, color: GRIS, textAlign: "right", marginTop: 3 },
  // La leyenda va a la izquierda de los totales (el hueco que dejan), no debajo: así un plan
  // corto cabe en una hoja con las firmas.
  bottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 18, marginTop: 12 },
  totalsBox: { alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end", gap: 16, paddingVertical: 1.5 },
  totalsLabel: { fontSize: 10, color: GRIS, textAlign: "right", width: 140 },
  totalsValue: { fontSize: 10, color: TINTA, fontFamily: "Helvetica-Bold", textAlign: "right", width: 90 },
  grandLabel: { fontSize: 12, color: ACENTO, fontFamily: "Helvetica-Bold", textAlign: "right", width: 140 },
  grandValue: { fontSize: 12, color: ACENTO, fontFamily: "Helvetica-Bold", textAlign: "right", width: 90 },
  pagosNota: { fontSize: 8, color: GRIS, textAlign: "right", marginTop: 3, maxWidth: 260 },
  legend: { fontSize: 8, color: GRIS, flex: 1, maxWidth: 220 },
  // Firmas: como las de los consentimientos (consent-document.tsx): sitio de
  // sobra encima de la línea para un bolígrafo, rol, nombre y fecha por llenar.
  sigRow: { flexDirection: "row", gap: 28, marginTop: 18 },
  sigBox: { flex: 1 },
  sigSpace: { height: 34 },
  sigLine: { borderTopWidth: 0.8, borderTopColor: TINTA, paddingTop: 6 },
  sigRole: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, lineHeight: 1.2 },
  sigName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  sigDate: { fontSize: 8.5, color: GRIS, marginTop: 2, lineHeight: 1.3 },
  footer: {
    position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#9b9aa8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 8, lineHeight: 1.3,
  },
  // `lineHeight: ""` NO es decorativo (ver consent-document / patient-document):
  // sin él @react-pdf 4.x pinta el «Página N de M» fuera del papel.
  pageNum: { fontSize: 7.5, color: "#9b9aa8", textAlign: "center", marginTop: 2, lineHeight: "" },
});

/** Negativos con guion ASCII: Helvetica de @react-pdf no pinta U+2212. */
const conSigno = (n: number, dinero: (n: number) => string) => (n < 0 ? `-${dinero(-n)}` : dinero(n));

function Encabezado({ t }: { t: TextosPlanPdf }) {
  return (
    <View style={styles.tHead}>
      <Text style={[styles.th, styles.cConcept]}>{t.concepto}</Text>
      <Text style={[styles.th, styles.cZona]}>{t.zona}</Text>
      <Text style={[styles.th, styles.cQty]}>{t.cantidad}</Text>
      <Text style={[styles.th, styles.cUnit]}>{t.precio}</Text>
      <Text style={[styles.th, styles.cTotal]}>{t.importe}</Text>
    </View>
  );
}

function Renglon({ r, dinero }: { r: RenglonPdf; dinero: (n: number) => string }) {
  return (
    <View style={styles.tRow} wrap={false}>
      <View style={styles.cConcept}>
        <Text style={styles.tdBold}>{r.nombre}</Text>
        {r.motivo ? <Text style={styles.tdMutedSmall}>{r.motivo}</Text> : null}
      </View>
      <Text style={[styles.td, styles.cZona]}>{r.zona || "—"}</Text>
      <Text style={[styles.td, styles.cQty]}>{r.cantidad}</Text>
      <Text style={[styles.td, styles.cUnit]}>{dinero(r.precioUnitario)}</Text>
      <Text style={[styles.tdBold, styles.cTotal]}>{dinero(r.importe)}</Text>
    </View>
  );
}

export function PlanTratamientoDocument(props: PlanTratamientoDocumentProps) {
  const t = props.textos;
  const d = props.documento;
  const dinero = props.dinero;
  const conFases = d.grupos.some((g) => g.fase);

  return (
    <Document title={`${t.titulo} · ${props.pacienteNombre}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <ClinicLetterhead
          {...props}
          accent={ACENTO}
          right={
            <View>
              <Text style={styles.docTitle}>{t.titulo}</Text>
              <Text style={styles.metaRight}>{t.fecha}</Text>
              <Text style={styles.metaValue}>{props.fechaEmision}</Text>
            </View>
          }
        />

        {/* Paciente, doctor y plan */}
        <View style={styles.block}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>{t.paciente}</Text>
              <Text style={styles.value}>{props.pacienteNombre}</Text>
              {props.pacienteFolio ? <Text style={styles.sub}>{props.pacienteFolio}</Text> : null}
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>{t.doctor}</Text>
              <Text style={styles.value}>{props.doctorNombre || "—"}</Text>
              {t.cedula ? <Text style={styles.sub}>{t.cedula}</Text> : null}
            </View>
          </View>
          <View style={[styles.twoCol, { marginTop: 8 }]}>
            <View style={styles.col}>
              <Text style={styles.label}>{t.plan}</Text>
              <Text style={styles.value}>{props.planNombre}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>{t.estado}</Text>
              <Text style={styles.value}>{props.estadoPlan}</Text>
              {props.fechaInicio ? <Text style={styles.sub}>{t.inicio}: {props.fechaInicio}</Text> : null}
            </View>
          </View>
        </View>

        {/* Procedimientos */}
        <Text style={styles.sectionTitle}>{t.procedimientos}</Text>
        {/* Un solo encabezado de columnas; cada fase es un rótulo dentro de la tabla. */}
        <Encabezado t={t} />
        {d.grupos.map((g, gi) => (
          <View key={gi}>
            {conFases ? (
              <View style={styles.faseRow} wrap={false} minPresenceAhead={40}>
                <Text style={styles.label}>{g.fase || "—"}</Text>
              </View>
            ) : null}
            {g.renglones.map((r, i) => (
              <Renglon key={i} r={r} dinero={dinero} />
            ))}
            {conFases && d.grupos.length > 1 ? (
              <Text style={styles.faseSubtotal}>
                {t.subtotalFase}: {dinero(g.subtotal)}
              </Text>
            ) : null}
          </View>
        ))}

        {/* Leyenda + totales */}
        <View style={styles.bottomRow} wrap={false}>
          <Text style={styles.legend}>{t.leyenda}</Text>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{t.subtotal}</Text>
              <Text style={styles.totalsValue}>{dinero(d.subtotal)}</Text>
            </View>
            {d.ajuste !== 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{d.ajuste < 0 ? t.descuento : t.ajuste}</Text>
                <Text style={styles.totalsValue}>{conSigno(d.ajuste, dinero)}</Text>
              </View>
            ) : null}
            <View style={[styles.totalsRow, { marginTop: 3 }]}>
              <Text style={styles.grandLabel}>{t.total}</Text>
              <Text style={styles.grandValue}>{dinero(d.total)}</Text>
            </View>
            {d.pagos ? (
              <>
                <View style={[styles.totalsRow, { marginTop: 6 }]}>
                  <Text style={styles.totalsLabel}>{t.pagado}</Text>
                  <Text style={styles.totalsValue}>{dinero(d.pagos.pagado)}</Text>
                </View>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>{t.saldo}</Text>
                  <Text style={styles.totalsValue}>{dinero(d.pagos.saldo)}</Text>
                </View>
                <Text style={styles.pagosNota}>{t.notaPagos}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Firmas */}
        <View style={styles.sigRow} wrap={false}>
          <View style={styles.sigBox}>
            <View style={styles.sigSpace} />
            <View style={styles.sigLine}>
              <Text style={styles.sigRole}>{t.firmaPaciente}</Text>
              <Text style={styles.sigName}>{props.pacienteNombre}</Text>
              <Text style={styles.sigDate}>{t.fechaPorLlenar}</Text>
            </View>
          </View>
          <View style={styles.sigBox}>
            <View style={styles.sigSpace} />
            <View style={styles.sigLine}>
              <Text style={styles.sigRole}>{t.firmaDoctor}</Text>
              <Text style={styles.sigName}>{props.doctorNombre || " "}</Text>
              {t.cedula ? <Text style={styles.sigDate}>{t.cedula}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{t.pie}</Text>
          <Text style={styles.pageNum} render={({ pageNumber, totalPages }) => t.pagina(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}
