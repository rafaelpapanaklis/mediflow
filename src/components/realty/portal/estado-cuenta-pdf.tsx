import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/* ═══════════════════════════════════════════════════════════════════════
   ESTADO DE CUENTA DEL PROPIETARIO — PDF del mes.

   Cuatro números y de dónde salen:

     Cobrado      lo que pagaron los inquilinos en el mes
     − Administración   la comisión pactada en la ficha de cada inmueble
     − Gastos      predial, agua, reparaciones… (tabla RealtyExpense)
     = Depositado  lo que le toca al propietario

   🔴 Si no hay comisión pactada, la retención es CERO y el documento lo
   dice con todas sus letras. Inventar un porcentaje "de mercado" sería
   cobrarle al propietario algo que nadie acordó.

   🔴 Los costos de mantenimiento se listan aparte como INFORMACIÓN y no se
   restan: cuando la inmobiliaria paga esa reparación la captura como
   gasto, y restarla dos veces le cobraría dos veces la misma plomería.
   ═══════════════════════════════════════════════════════════════════════ */

const PINE = "#2F6B4D";
const PINE_DARK = "#27543E";
const INK = "#14201A";
const MUTED = "#77837B";

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 58, fontFamily: "Helvetica", fontSize: 9.5, color: INK },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: PINE,
    paddingBottom: 12,
    marginBottom: 18,
  },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 16 },
  kicker: { fontSize: 9, color: MUTED, marginTop: 3 },
  right: { textAlign: "right" },
  strong: { fontFamily: "Helvetica-Bold", fontSize: 11, textTransform: "capitalize" },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    color: MUTED,
    marginTop: 18,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#EDE8DC",
  },
  sumK: { fontSize: 10 },
  sumHelp: { fontSize: 8, color: MUTED, marginTop: 1 },
  sumV: { fontSize: 10.5, fontFamily: "Helvetica-Bold" },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: PINE_DARK,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  totalLbl: { fontSize: 8, letterSpacing: 1, color: "#DCEAE1" },
  totalSub: { fontSize: 8.5, color: "#EAF3EE", marginTop: 3 },
  totalVal: { fontFamily: "Helvetica-Bold", fontSize: 20, color: "#FFFFFF" },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#BFD9CA",
    paddingBottom: 4,
    marginBottom: 2,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#F2EFE6",
  },
  trAlt: { backgroundColor: "#FAF8F2" },
  thText: { fontFamily: "Helvetica-Bold", fontSize: 8, color: MUTED, textTransform: "uppercase" },
  cell: { fontSize: 9 },
  cellNum: { fontSize: 9, textAlign: "right" },
  note: { fontSize: 8, color: MUTED, marginTop: 8, lineHeight: 1.4 },
  empty: { fontSize: 9, color: MUTED, paddingVertical: 8 },
  legal: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: MUTED,
    borderTopWidth: 1,
    borderTopColor: "#E0EDE5",
    paddingTop: 9,
  },
});

export interface EstadoCuentaFila {
  inmueble: string;
  cobrado: string;
  retenido: string;
  gastos: string;
  depositado: string;
}

export interface EstadoCuentaGasto {
  fecha: string;
  inmueble: string;
  tipo: string;
  nota: string;
  monto: string;
}

export interface EstadoCuentaMantenimiento {
  fecha: string;
  inmueble: string;
  descripcion: string;
  estado: string;
  costo: string;
}

export interface EstadoCuentaPdfProps {
  inmobiliaria: string;
  propietario: string;
  mesLabel: string;
  generadoEn: string;
  cobrado: string;
  retenido: string;
  gastos: string;
  depositado: string;
  sinComisionPactada: boolean;
  filas: EstadoCuentaFila[];
  detalleGastos: EstadoCuentaGasto[];
  mantenimientos: EstadoCuentaMantenimiento[];
}

export function EstadoCuentaPdf(props: EstadoCuentaPdfProps) {
  return (
    <Document
      title={`Estado de cuenta ${props.mesLabel}`}
      author={props.inmobiliaria}
      subject="Estado de cuenta del propietario"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{props.inmobiliaria}</Text>
            <Text style={styles.kicker}>Estado de cuenta</Text>
            <Text style={styles.kicker}>{props.propietario}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.kicker}>Mes</Text>
            <Text style={styles.strong}>{props.mesLabel}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Resumen del mes</Text>

        <View style={styles.sumRow}>
          <View>
            <Text style={styles.sumK}>Cobrado</Text>
            <Text style={styles.sumHelp}>Lo que pagaron sus inquilinos este mes.</Text>
          </View>
          <Text style={styles.sumV}>{props.cobrado}</Text>
        </View>
        <View style={styles.sumRow}>
          <View>
            <Text style={styles.sumK}>Administración</Text>
            <Text style={styles.sumHelp}>
              {props.sinComisionPactada
                ? "Sin comisión pactada en sus inmuebles: no se retuvo nada."
                : "Comisión pactada por administrar sus inmuebles."}
            </Text>
          </View>
          <Text style={styles.sumV}>− {props.retenido}</Text>
        </View>
        <View style={styles.sumRow}>
          <View>
            <Text style={styles.sumK}>Gastos</Text>
            <Text style={styles.sumHelp}>Predial, agua, reparaciones y demás del mes.</Text>
          </View>
          <Text style={styles.sumV}>− {props.gastos}</Text>
        </View>

        <View style={styles.total}>
          <View>
            <Text style={styles.totalLbl}>SE LE DEPOSITÓ</Text>
            <Text style={styles.totalSub}>Cobrado menos administración y gastos.</Text>
          </View>
          <Text style={styles.totalVal}>{props.depositado}</Text>
        </View>

        <Text style={styles.sectionTitle}>Por inmueble</Text>
        <View style={styles.th}>
          <Text style={[styles.thText, { flex: 3 }]}>Inmueble</Text>
          <Text style={[styles.thText, { flex: 1.2, textAlign: "right" }]}>Cobrado</Text>
          <Text style={[styles.thText, { flex: 1.2, textAlign: "right" }]}>Admón.</Text>
          <Text style={[styles.thText, { flex: 1.2, textAlign: "right" }]}>Gastos</Text>
          <Text style={[styles.thText, { flex: 1.3, textAlign: "right" }]}>Depositado</Text>
        </View>
        {props.filas.length === 0 ? (
          <Text style={styles.empty}>No hubo movimientos este mes.</Text>
        ) : (
          props.filas.map((f, i) => (
            <View key={`${f.inmueble}-${i}`} style={i % 2 ? [styles.tr, styles.trAlt] : styles.tr}>
              <Text style={[styles.cell, { flex: 3 }]}>{f.inmueble}</Text>
              <Text style={[styles.cellNum, { flex: 1.2 }]}>{f.cobrado}</Text>
              <Text style={[styles.cellNum, { flex: 1.2 }]}>{f.retenido}</Text>
              <Text style={[styles.cellNum, { flex: 1.2 }]}>{f.gastos}</Text>
              <Text style={[styles.cellNum, { flex: 1.3, fontFamily: "Helvetica-Bold" }]}>
                {f.depositado}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Detalle de gastos</Text>
        {props.detalleGastos.length === 0 ? (
          <Text style={styles.empty}>No hubo gastos este mes.</Text>
        ) : (
          <>
            <View style={styles.th}>
              <Text style={[styles.thText, { flex: 1.1 }]}>Fecha</Text>
              <Text style={[styles.thText, { flex: 2.4 }]}>Inmueble</Text>
              <Text style={[styles.thText, { flex: 1.4 }]}>Tipo</Text>
              <Text style={[styles.thText, { flex: 2.4 }]}>Nota</Text>
              <Text style={[styles.thText, { flex: 1.2, textAlign: "right" }]}>Monto</Text>
            </View>
            {props.detalleGastos.map((g, i) => (
              <View key={`gasto-${i}`} style={i % 2 ? [styles.tr, styles.trAlt] : styles.tr}>
                <Text style={[styles.cell, { flex: 1.1 }]}>{g.fecha}</Text>
                <Text style={[styles.cell, { flex: 2.4 }]}>{g.inmueble}</Text>
                <Text style={[styles.cell, { flex: 1.4 }]}>{g.tipo}</Text>
                <Text style={[styles.cell, { flex: 2.4 }]}>{g.nota}</Text>
                <Text style={[styles.cellNum, { flex: 1.2 }]}>{g.monto}</Text>
              </View>
            ))}
          </>
        )}

        {props.mantenimientos.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Mantenimientos del mes</Text>
            <View style={styles.th}>
              <Text style={[styles.thText, { flex: 1.1 }]}>Fecha</Text>
              <Text style={[styles.thText, { flex: 2.2 }]}>Inmueble</Text>
              <Text style={[styles.thText, { flex: 3.4 }]}>Qué pasó</Text>
              <Text style={[styles.thText, { flex: 1.3 }]}>Estado</Text>
              <Text style={[styles.thText, { flex: 1.2, textAlign: "right" }]}>Costo</Text>
            </View>
            {props.mantenimientos.map((m, i) => (
              <View key={`mant-${i}`} style={i % 2 ? [styles.tr, styles.trAlt] : styles.tr}>
                <Text style={[styles.cell, { flex: 1.1 }]}>{m.fecha}</Text>
                <Text style={[styles.cell, { flex: 2.2 }]}>{m.inmueble}</Text>
                <Text style={[styles.cell, { flex: 3.4 }]}>{m.descripcion}</Text>
                <Text style={[styles.cell, { flex: 1.3 }]}>{m.estado}</Text>
                <Text style={[styles.cellNum, { flex: 1.2 }]}>{m.costo}</Text>
              </View>
            ))}
            <Text style={styles.note}>
              Los costos de mantenimiento se muestran como información. Si la inmobiliaria ya los
              capturó como gasto, están incluidos arriba y no se restan dos veces.
            </Text>
          </>
        ) : null}

        <Text style={styles.legal} fixed>
          Estado de cuenta informativo. NO es un comprobante fiscal (CFDI). Generado el{" "}
          {props.generadoEn}.
        </Text>
      </Page>
    </Document>
  );
}
