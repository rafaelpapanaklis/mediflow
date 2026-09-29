import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { MovimientoVista } from "./consultar-tipos";
import { ETIQUETA_CATEGORIA, fechaHoraLegible } from "./csv";

/**
 * «Movimientos Completo» en PDF: una tabla sencilla —fecha y hora, quién, tipo,
 * qué cambió— con el encabezado repetido en cada hoja. Sin logo ni membrete: es
 * un listado de trabajo, no un documento clínico; el membrete de la clínica
 * está en el expediente.
 */
const est = StyleSheet.create({
  pagina: { paddingTop: 36, paddingBottom: 42, paddingHorizontal: 36, fontSize: 9, fontFamily: "Helvetica", color: "#1c1b29" },
  titulo: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  sub: { fontSize: 9, color: "#555468", marginBottom: 2 },
  nota: { fontSize: 8, color: "#8a4b00", marginTop: 4 },
  cabeza: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#1c1b29", paddingBottom: 3, marginTop: 12 },
  fila: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d8d6e4", paddingVertical: 3 },
  cFecha: { width: "20%", paddingRight: 6 },
  cQuien: { width: "20%", paddingRight: 6 },
  cTipo: { width: "17%", paddingRight: 6 },
  cQue: { width: "43%" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase", color: "#555468" },
  pie: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 8, color: "#8a889c", flexDirection: "row", justifyContent: "space-between" },
});

export interface MovimientosPdfProps {
  paciente: string;
  numero: string | null;
  items: MovimientoVista[];
  total: number;
  recortado: boolean;
  zona: string;
  generado: string;
  filtros: string;
}

export function MovimientosDocument(p: MovimientosPdfProps) {
  return (
    <Document title={`Movimientos de ${p.paciente}`}>
      <Page size="A4" style={est.pagina} wrap>
        <Text style={est.titulo}>Movimientos del paciente</Text>
        <Text style={est.sub}>
          {p.paciente}
          {p.numero ? ` · Expediente ${p.numero}` : ""}
        </Text>
        <Text style={est.sub}>
          {p.filtros} · {p.total} {p.total === 1 ? "movimiento" : "movimientos"} · Generado el {p.generado}
        </Text>
        {p.recortado && (
          <Text style={est.nota}>
            La lista se cortó en los {p.items.length} más recientes; acota las fechas para ver el resto.
          </Text>
        )}
        <View style={est.cabeza} fixed>
          <Text style={[est.th, est.cFecha]}>Fecha y hora</Text>
          <Text style={[est.th, est.cQuien]}>Quién</Text>
          <Text style={[est.th, est.cTipo]}>Tipo</Text>
          <Text style={[est.th, est.cQue]}>Qué cambió</Text>
        </View>
        {p.items.map((m) => (
          <View key={m.id} style={est.fila} wrap={false}>
            <Text style={est.cFecha}>{fechaHoraLegible(m.fecha, p.zona)}</Text>
            <Text style={est.cQuien}>{m.actor}</Text>
            <Text style={est.cTipo}>{ETIQUETA_CATEGORIA[m.categoria] ?? m.categoria}</Text>
            <Text style={est.cQue}>{m.texto}</Text>
          </View>
        ))}
        {p.items.length === 0 && <Text style={{ marginTop: 12 }}>No hay movimientos con ese filtro.</Text>}
        <View style={est.pie} fixed>
          <Text>DaleControl · Movimientos del paciente</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
