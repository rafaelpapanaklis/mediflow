import type { ComponentProps } from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { ClinicLetterhead, type ClinicLetterheadClinic } from "./clinic-letterhead";
import { esRenglonGrande, textoParaHelvetica, textoParaPintar, type DocumentoDelPlan, type GrupoPdf, type RenglonPdf } from "@/lib/treatments/plan-pdf";

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
  /** Diferencia que cabe en el redondeo a pesos de los planes viejos (revisión P2). */
  redondeo: string;
  ajuste: string;
  total: string;
  leyenda: string;
  firmaPaciente: string;
  firmaDoctor: string;
  fechaPorLlenar: string;
  pie: string;
  /** Recibe número de página y total: «Página 1 de 2». */
  pagina: (n: number, total: number) => string;
  /** Rótulo de la tabla en las hojas siguientes: «Procedimientos (continúa)». */
  continua: string;
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

/** Alto del encabezado de tabla que se repite en las hojas 2 y siguientes (revisión P6). */
const BANDA_REPETIDA = 34;
/** Carta (612 pt) menos los 40 de margen a cada lado. */
const ANCHO_UTIL = 532;

const ACENTO = "#7c3aed";
const TINTA = "#14101f";
const GRIS = "#6b6b78";

const styles = StyleSheet.create({
  // paddingTop deja sitio, en TODAS las hojas, al encabezado de columnas que se repite desde
  // la 2 (`EncabezadoRepetido`); en la 1 la cabecera lo recupera con un margen negativo.
  page: { padding: 40, paddingTop: 40 + BANDA_REPETIDA, paddingBottom: 64, fontFamily: "Helvetica", fontSize: 10, color: TINTA, lineHeight: 1.5 },
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
  primeraHoja: { marginTop: -BANDA_REPETIDA },
  repetidoRotulo: { fontSize: 8, color: ACENTO, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5 },
});

/** Negativos con guion ASCII: Helvetica de @react-pdf no pinta U+2212. */
const conSigno = (n: number, dinero: (n: number) => string) => (n < 0 ? `-${dinero(-n)}` : dinero(n));

/** Sin guiones: «implantes» baja entero al renglón siguiente en vez de partirse «im-plantes» (P6). */
const sinGuiones = (palabra: string) => [palabra];

/** Texto con lo que Helvetica sabe pintar (P5; «—» si no queda nada, t8 N-P6) y sin partir palabras (P6). */
// El `style` de `Text` admite también el de SVG y no encaja; el de `View` es el mismo `Style | Style[]` de un texto.
function T({ style, children }: { style?: ComponentProps<typeof View>["style"]; children: string | number | null | undefined }) {
  const texto = typeof children === "number" ? String(children) : textoParaPintar(children ?? "");
  return <Text style={style} hyphenationCallback={sinGuiones}>{texto}</Text>;
}

function Encabezado({ t }: { t: TextosPlanPdf }) {
  return (
    <View style={styles.tHead}>
      <T style={[styles.th, styles.cConcept]}>{t.concepto}</T>
      <T style={[styles.th, styles.cZona]}>{t.zona}</T>
      <T style={[styles.th, styles.cQty]}>{t.cantidad}</T>
      <T style={[styles.th, styles.cUnit]}>{t.precio}</T>
      <T style={[styles.th, styles.cTotal]}>{t.importe}</T>
    </View>
  );
}

/** Ancho de cada columna (fracción del ancho útil): las mismas que `cConcept`…`cTotal`. */
const COLUMNAS = [
  { clave: "concepto", ancho: 0.44, align: "left" },
  { clave: "zona", ancho: 0.17, align: "left" },
  { clave: "cantidad", ancho: 0.09, align: "center" },
  { clave: "precio", ancho: 0.15, align: "right" },
  { clave: "importe", ancho: 0.15, align: "right" },
] as const;

/**
 * El encabezado de columnas en las hojas 2 y siguientes (P6). Son `Text` sueltos, `fixed` y
 * absolutos en la banda que el padding superior reserva en todas las hojas, cada uno con
 * `render` que en la hoja 1 no pinta nada (allí está el de siempre, bajo «Procedimientos»).
 * Medido: una `View` con `render` no maqueta lo que devuelve anidado (salía el rótulo y no la
 * fila); un `Text` con `render` sí, igual que «Página N de M». Como el último renglón viaja con
 * los totales y las firmas (bloque final), toda hoja desde la 2 lleva procedimientos debajo.
 */
function EncabezadoRepetido({ t }: { t: TextosPlanPdf }) {
  const desdeLa2 = (texto: string) => ({ pageNumber }: { pageNumber: number }) =>
    pageNumber > 1 ? textoParaHelvetica(texto) : "";
  let izquierda = 40;
  return (
    <>
      <Text fixed style={[styles.repetidoRotulo, { position: "absolute", top: 40, left: 40, width: ANCHO_UTIL }]} render={desdeLa2(t.continua)} />
      {COLUMNAS.map((c) => {
        const ancho = Math.round(ANCHO_UTIL * c.ancho);
        const left = izquierda;
        izquierda += ancho;
        return (
          <Text
            key={c.clave}
            fixed
            style={[styles.th, { position: "absolute", top: 56, left, width: ancho, textAlign: c.align, paddingRight: c.align === "left" ? 6 : 0 }]}
            render={desdeLa2(t[c.clave])}
          />
        );
      })}
    </>
  );
}

const precio = (n: number | null, dinero: (n: number) => string) => (n == null ? "—" : dinero(n));

function Renglon({ r, dinero }: { r: RenglonPdf; dinero: (n: number) => string }) {
  // Un renglón normal no se parte entre hojas; uno gigante sí (t8, N-P7): si no, no cabría en
  // ninguna y @react-pdf lo dejaría salirse por abajo.
  return (
    <View style={styles.tRow} wrap={esRenglonGrande(r)}>
      <View style={styles.cConcept}>
        <T style={styles.tdBold}>{r.nombre}</T>
        {r.motivo ? <T style={styles.tdMutedSmall}>{r.motivo}</T> : null}
      </View>
      <T style={[styles.td, styles.cZona]}>{r.zona || "—"}</T>
      <T style={[styles.td, styles.cQty]}>{r.cantidad}</T>
      <T style={[styles.td, styles.cUnit]}>{precio(r.precioUnitario, dinero)}</T>
      <T style={[styles.tdBold, styles.cTotal]}>{precio(r.importe, dinero)}</T>
    </View>
  );
}

function RotuloDeFase({ g }: { g: GrupoPdf }) {
  return (
    <View style={styles.faseRow} wrap={false} minPresenceAhead={40}>
      <T style={styles.label}>{g.fase || "—"}</T>
    </View>
  );
}

function SubtotalDeFase({ g, t, dinero }: { g: GrupoPdf; t: TextosPlanPdf; dinero: (n: number) => string }) {
  if (g.subtotal == null) return null;
  return <T style={styles.faseSubtotal}>{`${t.subtotalFase}: ${dinero(g.subtotal)}`}</T>;
}

export function PlanTratamientoDocument(props: PlanTratamientoDocumentProps) {
  const t = props.textos;
  const d = props.documento;
  const dinero = props.dinero;
  const conFases = d.grupos.some((g) => g.fase);
  const subtotalesDeFase = conFases && d.grupos.length > 1;
  const nombre = textoParaPintar(props.pacienteNombre) || "—";
  const doctor = textoParaPintar(props.doctorNombre);

  // El ÚLTIMO renglón viaja con los totales y las firmas en un bloque que no se parte (P6):
  // las firmas nunca quedan solas en una hoja, y la hoja siguiente nunca empieza sin procedimientos.
  const ultimoGrupo = d.grupos[d.grupos.length - 1];
  const ultimoRenglon = ultimoGrupo.renglones[ultimoGrupo.renglones.length - 1];
  // Salvo que sea gigante (t8, N-P7): entonces el bloque no cabría en una hoja y sacaría el total
  // y las firmas por abajo. Va con los demás (partible) y el bloque final son totales + firmas.
  const ultimoViaja = !esRenglonGrande(ultimoRenglon);
  const rotuloViajaAlFinal = ultimoViaja && conFases && ultimoGrupo.renglones.length === 1;

  // Membrete: solo lo que Helvetica sabe pintar.
  const membrete = {
    clinicName: textoParaPintar(props.clinicName) || "—",
    clinicAddress: textoParaHelvetica(props.clinicAddress) || null,
    clinicCity: textoParaHelvetica(props.clinicCity) || null,
    clinicState: textoParaHelvetica(props.clinicState) || null,
    clinicPhone: textoParaHelvetica(props.clinicPhone) || null,
    clinicEmail: textoParaHelvetica(props.clinicEmail) || null,
    clinicTaxId: textoParaHelvetica(props.clinicTaxId) || null,
    clinicLogoDataUrl: props.clinicLogoDataUrl ?? null,
    clinicLogoAspect: props.clinicLogoAspect ?? null,
  };

  return (
    <Document title={`${t.titulo} · ${nombre}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <EncabezadoRepetido t={t} />
        <View style={styles.primeraHoja}>
          <ClinicLetterhead
            {...membrete}
            accent={ACENTO}
            right={
              <View>
                <T style={styles.docTitle}>{t.titulo}</T>
                <T style={styles.metaRight}>{t.fecha}</T>
                <T style={styles.metaValue}>{props.fechaEmision}</T>
              </View>
            }
          />
        </View>

        {/* Paciente, doctor y plan */}
        <View style={styles.block} wrap={false}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <T style={styles.label}>{t.paciente}</T>
              <T style={styles.value}>{nombre}</T>
              {props.pacienteFolio ? <T style={styles.sub}>{props.pacienteFolio}</T> : null}
            </View>
            <View style={styles.col}>
              <T style={styles.label}>{t.doctor}</T>
              <T style={styles.value}>{doctor || "—"}</T>
              {t.cedula ? <T style={styles.sub}>{t.cedula}</T> : null}
            </View>
          </View>
          <View style={[styles.twoCol, { marginTop: 8 }]}>
            <View style={styles.col}>
              <T style={styles.label}>{t.plan}</T>
              <T style={styles.value}>{props.planNombre || "—"}</T>
            </View>
            <View style={styles.col}>
              <T style={styles.label}>{t.estado}</T>
              <T style={styles.value}>{props.estadoPlan}</T>
              {props.fechaInicio ? <T style={styles.sub}>{`${t.inicio}: ${props.fechaInicio}`}</T> : null}
            </View>
          </View>
        </View>

        {/* Procedimientos: un solo encabezado de columnas; cada fase es un rótulo dentro de la tabla. */}
        <View minPresenceAhead={60}>
          <T style={styles.sectionTitle}>{t.procedimientos}</T>
          <Encabezado t={t} />
        </View>
        {d.grupos.map((g, gi) => {
          const esUltimo = gi === d.grupos.length - 1;
          const renglones = esUltimo && ultimoViaja ? g.renglones.slice(0, -1) : g.renglones;
          return (
            <View key={gi}>
              {conFases && !(esUltimo && rotuloViajaAlFinal) ? <RotuloDeFase g={g} /> : null}
              {renglones.map((r, i) => (
                <Renglon key={i} r={r} dinero={dinero} />
              ))}
              {subtotalesDeFase && !(esUltimo && ultimoViaja) ? <SubtotalDeFase g={g} t={t} dinero={dinero} /> : null}
            </View>
          );
        })}

        {/* Bloque final, que no se parte: último renglón + totales + firmas. */}
        <View wrap={false}>
          {rotuloViajaAlFinal ? <RotuloDeFase g={ultimoGrupo} /> : null}
          {ultimoViaja ? <Renglon r={ultimoRenglon} dinero={dinero} /> : null}
          {ultimoViaja && subtotalesDeFase ? <SubtotalDeFase g={ultimoGrupo} t={t} dinero={dinero} /> : null}

          <View style={styles.bottomRow}>
            <T style={styles.legend}>{t.leyenda}</T>
            <View style={styles.totalsBox}>
              {d.subtotal != null ? (
                <View style={styles.totalsRow}>
                  <T style={styles.totalsLabel}>{t.subtotal}</T>
                  <T style={styles.totalsValue}>{dinero(d.subtotal)}</T>
                </View>
              ) : null}
              {d.ajuste ? (
                <View style={styles.totalsRow}>
                  <T style={styles.totalsLabel}>
                    {d.ajuste.tipo === "redondeo" ? t.redondeo : d.ajuste.tipo === "descuento" ? t.descuento : t.ajuste}
                  </T>
                  <T style={styles.totalsValue}>{conSigno(d.ajuste.monto, dinero)}</T>
                </View>
              ) : null}
              <View style={[styles.totalsRow, { marginTop: 3 }]}>
                <T style={styles.grandLabel}>{t.total}</T>
                <T style={styles.grandValue}>{dinero(d.total)}</T>
              </View>
            </View>
          </View>

          {/* Firmas */}
          <View style={styles.sigRow}>
            <View style={styles.sigBox}>
              <View style={styles.sigSpace} />
              <View style={styles.sigLine}>
                <T style={styles.sigRole}>{t.firmaPaciente}</T>
                <T style={styles.sigName}>{nombre}</T>
                <T style={styles.sigDate}>{t.fechaPorLlenar}</T>
              </View>
            </View>
            <View style={styles.sigBox}>
              <View style={styles.sigSpace} />
              <View style={styles.sigLine}>
                <T style={styles.sigRole}>{t.firmaDoctor}</T>
                <T style={styles.sigName}>{doctor || " "}</T>
                {t.cedula ? <T style={styles.sigDate}>{t.cedula}</T> : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <T>{t.pie}</T>
          <Text style={styles.pageNum} render={({ pageNumber, totalPages }) => t.pagina(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}
