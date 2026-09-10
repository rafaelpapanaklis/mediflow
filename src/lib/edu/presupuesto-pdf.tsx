/**
 * DaleControl INSTITUCIONAL — Ola C·2 · EL PDF DEL PRESUPUESTO.
 *
 * SERVIDOR (`renderToBuffer` de @react-pdf/renderer): EL MISMO MOTOR que
 * la receta (`receta-pdf.tsx`) y el consentimiento, y por la misma razón
 * por la que aquéllos lo eligieron — no se añade una segunda forma de
 * generar papel en un producto que ya tiene una. Este archivo NO consulta
 * la base: recibe los datos ya resueltos por `getEduQuotePdfData`
 * (presupuestos.ts), que es quien aplica el permiso y el alcance.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE ESTE DOCUMENTO TIENE QUE DECIR, y es el contrato:
 *
 *   1. QUÉ SE PROPONE Y CUÁNTO CUESTA, partida por partida, con los
 *      dientes escritos. Es el papel que el paciente se lleva a su casa y
 *      con el que compara.
 *   2. HASTA CUÁNDO VALE. Un presupuesto sin vigencia es una promesa
 *      abierta: cuando el paciente vuelva en un año con el papel en la
 *      mano, la escuela tiene que poder decir por qué el precio cambió.
 *   3. QUE NO ES UNA FACTURA NI UN COBRO. Se dice con esas palabras al
 *      pie: un documento con importes y sello de la escuela se confunde
 *      con un recibo con una facilidad que no conviene subestimar.
 *   4. SI YA ESTÁ ACEPTADO, CUÁNDO Y POR QUIÉN. Y si está vencido,
 *      rechazado o cancelado, lo DICE ARRIBA, en una franja, antes que
 *      los importes — igual que la receta anulada. Un presupuesto
 *      cancelado que se imprime sin decirlo es un precio que alguien va a
 *      exigir.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createElement } from "react";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EduQuotePdfData } from "@/lib/edu/presupuestos";

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: "#1a1d21",
  },

  // Encabezado: el instituto a la izquierda, el sello del documento a la
  // derecha. Sin logo, por lo mismo que la receta: un fetch remoto en el
  // camino del PDF es un timeout esperando a pasar.
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  instName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  instMeta: { fontSize: 8, color: "#5a6270", marginTop: 2 },
  docTag: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 8, color: "#5a6270", textAlign: "right", marginTop: 2 },

  // La franja de estado. Roja para lo que ya no vale (vencido, rechazado,
  // cancelado) y verde para el aceptado. Va ARRIBA: quien recibe el papel
  // tiene que leerla antes que los importes.
  bandMala: {
    borderWidth: 1.4,
    borderColor: "#b3261e",
    backgroundColor: "#fdeceb",
    padding: 8,
    marginBottom: 12,
  },
  bandMalaTitle: { color: "#b3261e", fontFamily: "Helvetica-Bold", fontSize: 11 },
  bandMalaText: { color: "#7a1c16", fontSize: 8.5, marginTop: 2 },
  bandOk: {
    borderWidth: 1.4,
    borderColor: "#166534",
    backgroundColor: "#eefaf1",
    padding: 8,
    marginBottom: 12,
  },
  bandOkTitle: { color: "#166534", fontFamily: "Helvetica-Bold", fontSize: 11 },
  bandOkText: { color: "#14532d", fontSize: 8.5, marginTop: 2 },

  rule: { borderBottomWidth: 1, borderBottomColor: "#d7dbe0", marginVertical: 10 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  k: { fontSize: 7.5, color: "#5a6270", textTransform: "uppercase", letterSpacing: 0.4 },
  v: { fontSize: 10, marginTop: 1 },

  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 8,
    color: "#5a6270",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },

  // La tabla de partidas. Anchos fijos y no `flex` en las columnas de
  // dinero: los importes se leen alineados o no se leen.
  thead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#8a919c",
    paddingBottom: 3,
    marginBottom: 4,
  },
  trow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e6e9ee",
  },
  cConcepto: { flex: 1, paddingRight: 8 },
  cCant: { width: 34, textAlign: "right" },
  cPrecio: { width: 66, textAlign: "right" },
  cDesc: { width: 62, textAlign: "right" },
  cTotal: { width: 72, textAlign: "right" },
  th: { fontSize: 7.5, color: "#5a6270", textTransform: "uppercase", letterSpacing: 0.4 },
  td: { fontSize: 9 },
  tdSub: { fontSize: 7.5, color: "#5a6270", marginTop: 1 },

  fase: {
    fontSize: 8,
    color: "#344e8c",
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    marginBottom: 2,
  },

  totales: { marginTop: 10, alignItems: "flex-end" },
  totalFila: { flexDirection: "row", width: 240, justifyContent: "space-between", paddingVertical: 2 },
  totalFuerte: {
    flexDirection: "row",
    width: 240,
    justifyContent: "space-between",
    paddingTop: 5,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: "#8a919c",
  },
  totalLabel: { fontSize: 9.5 },
  totalValor: { fontSize: 9.5 },
  totalLabelFuerte: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  totalValorFuerte: { fontSize: 11, fontFamily: "Helvetica-Bold" },

  notas: { fontSize: 9, lineHeight: 1.4, marginTop: 4 },

  firma: { marginTop: 30, borderTopWidth: 1, borderTopColor: "#8a919c", paddingTop: 5, width: 240 },
  firmaRole: { fontSize: 7.5, color: "#5a6270", textTransform: "uppercase", letterSpacing: 0.4 },
  firmaMeta: { fontSize: 8.5, color: "#3d4450", marginTop: 1 },

  foot: {
    position: "absolute",
    bottom: 20,
    left: 44,
    right: 44,
    fontSize: 7,
    color: "#8a919c",
    textAlign: "center",
  },
});

function money(cents: number): string {
  const signo = cents < 0 ? "−" : "";
  const abs = Math.abs(Math.round(cents));
  const entero = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${signo}$${entero.toLocaleString("es-MX")}.${dec}`;
}

export function EduPresupuestoDocument({ data }: { data: EduQuotePdfData }) {
  // Las partidas se agrupan por FASE si alguna la trae. El orden dentro de
  // cada fase es el `sortOrder` que puso el servidor: el orden de las
  // partidas ES contenido (las etapas de un tratamiento van en orden).
  const hayFases = data.items.some((i) => i.phase !== null);
  const fases = hayFases
    ? [...new Set(data.items.map((i) => i.phase))].sort(
        (a, b) => (a ?? 999) - (b ?? 999),
      )
    : [null];

  return (
    <Document
      title={`Presupuesto ${data.folio} · ${data.patientName}`}
      author={data.institutionName}
      creator="DaleControl Institucional"
    >
      <Page size="LETTER" style={s.page}>
        <View style={s.head}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.instName}>{data.institutionName}</Text>
            <Text style={s.instMeta}>
              {[data.institutionCity, data.institutionPhone, data.institutionEmail]
                .filter(Boolean)
                .join(" · ") || "Clínica de enseñanza"}
            </Text>
          </View>
          <View>
            <Text style={s.docTag}>PRESUPUESTO</Text>
            <Text style={s.docMeta}>Folio {data.folio}</Text>
            <Text style={s.docMeta}>Emitido el {data.createdAtLabel}</Text>
          </View>
        </View>

        {/* 🔴 EL ESTADO, ANTES QUE LOS IMPORTES. Un presupuesto vencido,
            rechazado o cancelado que se imprime sin decirlo es un precio
            que alguien va a exigir con el papel en la mano. */}
        {data.avisoMalo && (
          <View style={s.bandMala}>
            <Text style={s.bandMalaTitle}>{data.avisoMalo.titulo}</Text>
            <Text style={s.bandMalaText}>{data.avisoMalo.detalle}</Text>
          </View>
        )}
        {data.aceptado && (
          <View style={s.bandOk}>
            <Text style={s.bandOkTitle}>ACEPTADO</Text>
            <Text style={s.bandOkText}>{data.aceptado}</Text>
          </View>
        )}

        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.k}>Paciente</Text>
            <Text style={s.v}>{data.patientName}</Text>
          </View>
          <View style={{ width: 90 }}>
            <Text style={s.k}>Folio</Text>
            <Text style={s.v}>{data.patientFolio}</Text>
          </View>
          <View style={{ width: 120 }}>
            <Text style={s.k}>Vigencia</Text>
            <Text style={s.v}>{data.validUntilLabel ?? "Sin vencimiento"}</Text>
          </View>
        </View>

        <View style={s.rule} />

        <View>
          <Text style={s.sectionTitle}>{data.title}</Text>

          <View style={s.thead}>
            <Text style={[s.cConcepto, s.th]}>Concepto</Text>
            <Text style={[s.cCant, s.th]}>Cant.</Text>
            <Text style={[s.cPrecio, s.th]}>Precio</Text>
            <Text style={[s.cDesc, s.th]}>Desc.</Text>
            <Text style={[s.cTotal, s.th]}>Importe</Text>
          </View>

          {fases.map((f) => (
            <View key={String(f)}>
              {hayFases && (
                <Text style={s.fase}>{f === null ? "Sin fase" : `Fase ${f}`}</Text>
              )}
              {data.items
                .filter((i) => (hayFases ? i.phase === f : true))
                .map((i, n) => (
                  <View key={`${String(f)}-${n}`} style={s.trow} wrap={false}>
                    <View style={s.cConcepto}>
                      <Text style={s.td}>{i.name}</Text>
                      {(i.toothFdi || i.notes) && (
                        <Text style={s.tdSub}>
                          {[i.toothFdi ? `Dientes ${i.toothFdi}` : null, i.notes]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      )}
                    </View>
                    <Text style={[s.cCant, s.td]}>{i.quantity}</Text>
                    <Text style={[s.cPrecio, s.td]}>{money(i.unitPriceCents)}</Text>
                    <Text style={[s.cDesc, s.td]}>
                      {i.discountCents > 0 ? `−${money(i.discountCents)}` : "—"}
                    </Text>
                    <Text style={[s.cTotal, s.td]}>{money(i.lineTotalCents)}</Text>
                  </View>
                ))}
            </View>
          ))}
        </View>

        <View style={s.totales}>
          <View style={s.totalFila}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text style={s.totalValor}>{money(data.subtotalCents)}</Text>
          </View>
          {data.discountCents > 0 && (
            <View style={s.totalFila}>
              <Text style={s.totalLabel}>
                Descuento{data.discountPctLabel ? ` (${data.discountPctLabel})` : ""}
              </Text>
              <Text style={s.totalValor}>−{money(data.discountCents)}</Text>
            </View>
          )}
          <View style={s.totalFuerte}>
            <Text style={s.totalLabelFuerte}>Total</Text>
            <Text style={s.totalValorFuerte}>{money(data.totalCents)}</Text>
          </View>
        </View>

        {data.notes && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notas</Text>
            <Text style={s.notas}>{data.notes}</Text>
          </View>
        )}

        <View style={s.firma} wrap={false}>
          <Text style={s.firmaRole}>Lo preparó</Text>
          <Text style={s.v}>{data.createdByName}</Text>
          <Text style={s.firmaMeta}>{data.institutionName}</Text>
        </View>

        {/* 🔴 QUE NO ES UN COBRO, con esas palabras. Un papel con importes
            y el nombre de la escuela se confunde con un recibo, y el
            paciente que lo guarda como comprobante de pago descubre el
            malentendido en el peor momento. */}
        <Text style={s.foot} fixed>
          Este documento es un PRESUPUESTO: no es una factura, no es un recibo y no acredita ningún
          pago. Los importes pueden cambiar después de la vigencia indicada · DaleControl
          Institucional · documento {data.quoteId}
        </Text>
      </Page>
    </Document>
  );
}

/** El buffer listo para la respuesta HTTP. */
export async function buildEduPresupuestoPdf(
  data: EduQuotePdfData,
): Promise<{ buffer: Buffer; fileName: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(createElement(EduPresupuestoDocument, { data }) as any);
  return { buffer, fileName: data.fileName };
}
