// Ortodoncia — PDF «Convenio de pago» (ws1-t4, 29-sep-2026). Carta vertical.
//
// Antes: el botón «Imprimir convenio» del cobro del caso abría una ventana
// about:blank con HTML plano (sin logo, sin clínica, sin doctor, fechas sin
// año) y esta plantilla —la del acuerdo financiero del sistema viejo— leía
// OrthoPaymentPlan e imprimía cláusulas inventadas (30 días de tolerancia,
// 5% de recargo…). Ahora es UN documento, el mismo para descargar y para
// imprimir: membrete común de ortodoncia, datos del caso, resumen económico
// y calendario leídos de la factura del tratamiento (lo mismo que enseña la
// pantalla), las condiciones que la clínica configuró y las firmas.
// Los datos los arma `armarConvenio` (lib/orthodontics/pdf/convenio.ts).

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  ACENTO_ORTO,
  GRIS_ORTO,
  MembreteOrto,
  PieOrto,
  TINTA_ORTO,
  estilosPaginaOrto,
} from "../pdf/membrete-orto";
import type { ConvenioPdfData, Renglon } from "../pdf/convenio";

const s = StyleSheet.create({
  titulo: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 2 },
  intro: { fontSize: 9.5, color: GRIS_ORTO, marginBottom: 12, lineHeight: 1.4 },
  h2: {
    fontSize: 8.5, fontFamily: "Helvetica-Bold", color: ACENTO_ORTO, textTransform: "uppercase",
    letterSpacing: 0.8, marginTop: 12, marginBottom: 5, lineHeight: 1.2,
  },
  dosCol: { flexDirection: "row", gap: 24 },
  col: { flex: 1 },
  renglon: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#eeeef3" },
  rEtiqueta: { width: "46%", fontSize: 9, color: GRIS_ORTO },
  rValor: { flex: 1, fontSize: 9.5, color: TINTA_ORTO },
  rValorDestacado: { flex: 1, fontSize: 10.5, fontFamily: "Helvetica-Bold", color: TINTA_ORTO },
  respNombre: { fontSize: 11, fontFamily: "Helvetica-Bold", lineHeight: 1.25 },
  respRel: { fontSize: 9, color: GRIS_ORTO, marginBottom: 3 },
  tabla: { borderWidth: 0.5, borderColor: "#dcdce4", borderRadius: 3 },
  thFila: { flexDirection: "row", backgroundColor: "#f4f2f8", paddingVertical: 4, paddingHorizontal: 6 },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: GRIS_ORTO, textTransform: "uppercase", letterSpacing: 0.5 },
  tdFila: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, borderTopWidth: 0.5, borderTopColor: "#eeeef3" },
  td: { fontSize: 9, color: TINTA_ORTO },
  cConcepto: { width: "38%" },
  cVence: { width: "18%" },
  cImporte: { width: "16%", textAlign: "right" },
  cEstado: { width: "28%", paddingLeft: 10 },
  vacio: { fontSize: 9, color: GRIS_ORTO, fontStyle: "italic" },
  clausula: { flexDirection: "row", marginBottom: 3 },
  clausulaNum: { width: 16, fontSize: 9.5 },
  clausulaTexto: { flex: 1, fontSize: 9.5, lineHeight: 1.45 },
  lugar: { fontSize: 9.5, marginTop: 16 },
  firmas: { flexDirection: "row", gap: 36, marginTop: 44 },
  firma: { flex: 1, borderTopWidth: 0.8, borderTopColor: TINTA_ORTO, paddingTop: 5 },
  firmaRol: { fontSize: 7.5, color: GRIS_ORTO, textTransform: "uppercase", letterSpacing: 0.8 },
  firmaNombre: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 2 },
  firmaDetalle: { fontSize: 8.5, color: GRIS_ORTO, marginTop: 1 },
});

const TONO: Record<string, string> = { pagada: "#15803d", vencida: "#b91c1c", porVencer: TINTA_ORTO };

function Renglones({ filas }: { filas: Renglon[] }) {
  return (
    <View>
      {filas.map((r) => (
        <View key={r.etiqueta} style={s.renglon} wrap={false}>
          <Text style={s.rEtiqueta}>{r.etiqueta}</Text>
          <Text style={r.destacado ? s.rValorDestacado : s.rValor}>{r.valor}</Text>
        </View>
      ))}
    </View>
  );
}

export function FinancialAgreementPdf({ data }: { data: ConvenioPdfData }) {
  const m = data.membrete;
  const r = data.responsable;
  return (
    <Document title={`${data.documento} · ${m.paciente.nombre}`} author={m.clinicName}>
      <Page size="LETTER" style={estilosPaginaOrto.carta} wrap>
        <MembreteOrto datos={m} documento={data.documento} folio={data.folio} />

        <Text style={s.titulo}>Convenio de pago del tratamiento de ortodoncia</Text>
        <Text style={s.intro}>
          Acuerdo entre {m.clinicName} y {r.esElPaciente ? "el paciente" : "el responsable del pago"} sobre el costo y la
          forma de pago del tratamiento de {m.paciente.nombre}
          {data.pacienteEsMenor ? " (menor de edad)" : ""}.
        </Text>

        <View style={s.dosCol}>
          <View style={s.col}>
            <Text style={s.h2}>Responsable del pago</Text>
            <Text style={s.respNombre}>{r.nombre}</Text>
            <Text style={s.respRel}>{r.esElPaciente ? "El propio paciente" : r.relacion || "Responsable"}</Text>
            {data.responsableRenglones.length > 0 ? <Renglones filas={data.responsableRenglones} /> : null}
          </View>
          <View style={s.col}>
            <Text style={s.h2}>Tratamiento</Text>
            <Renglones filas={data.tratamiento} />
          </View>
        </View>

        <Text style={s.h2}>Resumen económico</Text>
        <Renglones filas={data.resumen} />

        <Text style={s.h2} minPresenceAhead={60}>{data.tituloCalendario}</Text>
        {data.calendario.length === 0 ? (
          <Text style={s.vacio}>{data.calendarioVacio}</Text>
        ) : (
          <View style={s.tabla}>
            <View style={s.thFila} fixed>
              <Text style={[s.th, s.cConcepto]}>Concepto</Text>
              <Text style={[s.th, s.cVence]}>Vence</Text>
              <Text style={[s.th, s.cImporte]}>Importe</Text>
              <Text style={[s.th, s.cEstado]}>Estado</Text>
            </View>
            {data.calendario.map((f, i) => (
              <View key={i} style={s.tdFila} wrap={false}>
                <Text style={[s.td, s.cConcepto]}>{f.concepto}</Text>
                <Text style={[s.td, s.cVence]}>{f.vence}</Text>
                <Text style={[s.td, s.cImporte]}>{f.importe}</Text>
                <Text style={[s.td, s.cEstado, { color: TONO[f.tono] ?? TINTA_ORTO }]}>{f.estado}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.h2} minPresenceAhead={50}>Condiciones</Text>
        {[...data.clausulas, ...data.politica].map((c, i) => (
          <View key={i} style={s.clausula} wrap={false}>
            <Text style={s.clausulaNum}>{i + 1}.</Text>
            <Text style={s.clausulaTexto}>{c}</Text>
          </View>
        ))}

        <View wrap={false}>
          <Text style={s.lugar}>{data.lugarYFecha}</Text>
          <View style={s.firmas}>
            {data.firmas.map((f) => (
              <View key={f.rol} style={s.firma}>
                <Text style={s.firmaRol}>{f.rol}</Text>
                <Text style={s.firmaNombre}>{f.nombre}</Text>
                {f.detalle ? <Text style={s.firmaDetalle}>{f.detalle}</Text> : null}
              </View>
            ))}
          </View>
        </View>

        <PieOrto datos={m} documento={data.documento} />
      </Page>
    </Document>
  );
}
