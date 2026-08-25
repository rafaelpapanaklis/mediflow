import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/* ═══════════════════════════════════════════════════════════════════════
   RECIBO DE PAGO DE RENTA — PDF.

   🔴 ES UN RECIBO, NO UNA FACTURA. Este vertical no timbra CFDI, no tiene
   complemento de pago y ninguna pantalla suya puede decir "factura". La
   leyenda del pie no es adorno legal: es lo que impide que un inquilino
   crea que ya tiene su deducible y descubra en abril que no.

   Fuentes Helvetica/Helvetica-Bold integradas en @react-pdf (sin
   Font.register): una fuente externa es una petición de red que puede
   fallar justo cuando alguien intenta bajar su comprobante.
   ═══════════════════════════════════════════════════════════════════════ */

const PINE = "#2F6B4D";
const INK = "#14201A";
const MUTED = "#77837B";

const styles = StyleSheet.create({
  page: {
    padding: 44,
    paddingBottom: 60,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: PINE,
    paddingBottom: 12,
    marginBottom: 22,
  },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 16, color: INK },
  kicker: { fontSize: 9, color: MUTED, marginTop: 3 },
  right: { textAlign: "right" },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    color: MUTED,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  cols: { flexDirection: "row", gap: 26, marginBottom: 20 },
  col: { flex: 1 },
  strong: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  line: { fontSize: 9.5, color: "#46524B", marginTop: 2 },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: PINE,
    color: "#FFFFFF",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 8,
    marginTop: 6,
  },
  totalLbl: { fontSize: 8, letterSpacing: 1, color: "#DCEAE1" },
  totalSub: { fontSize: 9.5, color: "#EAF3EE", marginTop: 3 },
  totalVal: { fontFamily: "Helvetica-Bold", fontSize: 22, color: "#FFFFFF" },
  meta: { marginTop: 22, borderTopWidth: 1, borderTopColor: "#E0EDE5", paddingTop: 12 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  metaK: { fontSize: 9.5, color: MUTED },
  metaV: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  legal: {
    position: "absolute",
    bottom: 30,
    left: 44,
    right: 44,
    textAlign: "center",
    fontSize: 8,
    color: MUTED,
    borderTopWidth: 1,
    borderTopColor: "#E0EDE5",
    paddingTop: 9,
  },
});

export interface ReciboPdfProps {
  folio: string;
  fecha: string;
  monto: string;
  metodo: string;
  referencia: string | null;
  concepto: string;
  inmuebleTitulo: string;
  inmuebleDireccion: string | null;
  inquilino: string;
  inmobiliaria: string;
  inmobiliariaContacto: string | null;
  generadoEn: string;
}

export function ReciboPdf(props: ReciboPdfProps) {
  return (
    <Document
      title={`Recibo ${props.folio}`}
      author={props.inmobiliaria}
      subject="Recibo de pago de renta"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{props.inmobiliaria}</Text>
            <Text style={styles.kicker}>Recibo de pago</Text>
            <Text style={styles.kicker}>Folio: {props.folio}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.kicker}>Fecha de pago</Text>
            <Text style={styles.strong}>{props.fecha}</Text>
          </View>
        </View>

        <View style={styles.cols}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Recibimos de</Text>
            <Text style={styles.strong}>{props.inquilino}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Inmueble</Text>
            <Text style={styles.strong}>{props.inmuebleTitulo}</Text>
            {props.inmuebleDireccion ? (
              <Text style={styles.line}>{props.inmuebleDireccion}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Concepto</Text>
        <View style={styles.total}>
          <View>
            <Text style={styles.totalLbl}>TOTAL PAGADO</Text>
            <Text style={styles.totalSub}>{props.concepto}</Text>
          </View>
          <Text style={styles.totalVal}>{props.monto}</Text>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Text style={styles.metaK}>Forma de pago</Text>
            <Text style={styles.metaV}>{props.metodo}</Text>
          </View>
          {props.referencia ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaK}>Referencia</Text>
              <Text style={styles.metaV}>{props.referencia}</Text>
            </View>
          ) : null}
          {props.inmobiliariaContacto ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaK}>Contacto</Text>
              <Text style={styles.metaV}>{props.inmobiliariaContacto}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.legal} fixed>
          Este documento es un recibo de pago. NO es un comprobante fiscal (CFDI) y no sirve para
          deducir impuestos. Generado el {props.generadoEn}.
        </Text>
      </Page>
    </Document>
  );
}
