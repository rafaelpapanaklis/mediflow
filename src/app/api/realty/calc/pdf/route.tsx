// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/calc/pdf — el resultado en una hoja que se puede mandar.
//
// El servidor RECALCULA a partir de las respuestas del formulario: el PDF
// nunca dibuja números que le hayan mandado. Si el navegador pudiera dictar
// las cifras, el asesor podría entregar un documento con membrete de la
// inmobiliaria y el impuesto que se le antojara.
//
// La leyenda de "esto es un estimado" se imprime en TODAS las páginas, con
// `fixed`, para que no se pierda al recortar o fotografiar solo la primera.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { resolveCreditoParams, resolveEscrituracionParams, resolveIsrParams } from "@/lib/realty/calc/catalog";
import { calcularEscrituracion } from "@/lib/realty/calc/escrituracion";
import { calcularIsrVenta } from "@/lib/realty/calc/isr";
import { precalificar, type TipoCredito } from "@/lib/realty/calc/infonavit";
import { fmtMXN, fmtPct, parseMoneyInput, parseNumberInput } from "@/lib/realty/calc/money";
import { getCalcParamRows } from "@/lib/realty/calc/params";
import { requireCalcApi } from "../_guard";

// @react-pdf/renderer no corre en edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PINE = "#2F6B4D";

const s = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 62,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#14201A",
    lineHeight: 1.5,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: PINE,
    paddingBottom: 10,
    marginBottom: 16,
  },
  marca: { fontSize: 9, color: PINE, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  titulo: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 4 },
  sub: { fontSize: 9.5, color: "#4c5a52", marginTop: 3 },
  seccion: { marginTop: 16 },
  seccionTitulo: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#4c5a52",
    letterSpacing: 1,
    marginBottom: 5,
  },
  fila: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: "#DCD8CD",
    paddingVertical: 4.5,
  },
  filaLabel: { flex: 1, paddingRight: 14 },
  filaValor: { fontFamily: "Helvetica-Bold", textAlign: "right" },
  destacado: {
    marginTop: 14,
    backgroundColor: "#EDF3EF",
    borderWidth: 0.5,
    borderColor: PINE,
    borderRadius: 4,
    padding: 11,
  },
  destacadoLabel: { fontSize: 8.5, color: "#4c5a52", letterSpacing: 0.8 },
  destacadoValor: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 3, color: "#14201A" },
  nota: { fontSize: 8.5, color: "#4c5a52", marginTop: 7 },
  pie: {
    position: "absolute",
    bottom: 26,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: "#DCD8CD",
    paddingTop: 7,
    fontSize: 7.5,
    color: "#6b7770",
  },
});

interface Fila {
  label: string;
  valor: string;
}
interface Seccion {
  titulo: string;
  filas: Fila[];
}
interface Hoja {
  titulo: string;
  sub: string;
  destacado?: { label: string; valor: string };
  secciones: Seccion[];
  notas: string[];
  leyenda: string;
}

function Documento({ hoja }: { hoja: Hoja }) {
  return (
    <Document title={hoja.titulo} author="DaleControl">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.marca}>DALECONTROL · INMUEBLES</Text>
          <Text style={s.titulo}>{hoja.titulo}</Text>
          <Text style={s.sub}>{hoja.sub}</Text>
        </View>

        {hoja.destacado && (
          <View style={s.destacado}>
            <Text style={s.destacadoLabel}>{hoja.destacado.label.toUpperCase()}</Text>
            <Text style={s.destacadoValor}>{hoja.destacado.valor}</Text>
          </View>
        )}

        {hoja.secciones.map((sec, i) => (
          <View key={i} style={s.seccion}>
            <Text style={s.seccionTitulo}>{sec.titulo.toUpperCase()}</Text>
            {sec.filas.map((f, j) => (
              <View key={j} style={s.fila}>
                <Text style={s.filaLabel}>{f.label}</Text>
                <Text style={s.filaValor}>{f.valor}</Text>
              </View>
            ))}
          </View>
        ))}

        {hoja.notas.length > 0 && (
          <View style={s.seccion}>
            <Text style={s.seccionTitulo}>A TOMAR EN CUENTA</Text>
            {hoja.notas.map((n, i) => (
              <Text key={i} style={s.nota}>
                • {n}
              </Text>
            ))}
          </View>
        )}

        <Text style={s.pie} fixed>
          {hoja.leyenda}
        </Text>
      </Page>
    </Document>
  );
}

export async function POST(req: NextRequest) {
  const guard = await requireCalcApi();
  if (!guard.ok) return guard.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const rows = await getCalcParamRows();
  const ahora = new Date();
  let hoja: Hoja | null = null;
  let archivo = "calculo";

  const tipo = String(body.tipo ?? "");

  if (tipo === "escrituracion") {
    const estado = String(body.estado ?? "CMX");
    const p = resolveEscrituracionParams(rows, estado, ahora);
    if (!p.ok || !p.params) {
      return NextResponse.json({ error: "Faltan parámetros para este estado." }, { status: 409 });
    }
    const r = calcularEscrituracion(
      {
        precioCents: parseMoneyInput(String(body.precio ?? "")) ?? 0,
        valorCatastralCents: parseMoneyInput(String(body.catastral ?? "")),
        avaluoCents: parseMoneyInput(String(body.avaluo ?? "")),
      },
      p.params,
    );
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    archivo = "gastos-de-escrituracion";
    hoja = {
      titulo: "Gastos de escrituración",
      sub: `${r.stateName} · valores vigentes de ${r.year}`,
      destacado: {
        label: "Gastos de escrituración",
        valor: `${fmtMXN(r.totalMinCents!)} a ${fmtMXN(r.totalMaxCents!)}`,
      },
      secciones: [
        {
          titulo: "Desglose",
          filas: r.conceptos!.map((c) => ({
            label: c.etiqueta,
            valor:
              c.minCents === c.maxCents
                ? fmtMXN(c.minCents)
                : `${fmtMXN(c.minCents)} — ${fmtMXN(c.maxCents)}`,
          })),
        },
        {
          titulo: "Resumen",
          filas: [
            { label: "Base gravable", valor: fmtMXN(r.baseGravableCents!) },
            {
              label: "Porcentaje sobre el precio",
              valor: `${fmtPct(r.totalPctMin!)} a ${fmtPct(r.totalPctMax!)}`,
            },
            {
              label: "Precio + gastos",
              valor: `${fmtMXN(r.costoRealMinCents!)} a ${fmtMXN(r.costoRealMaxCents!)}`,
            },
          ],
        },
      ],
      notas: [r.baseAdvertencia, ...p.avisos].filter(Boolean) as string[],
      leyenda: r.leyenda!,
    };
  } else if (tipo === "isr") {
    const estado = String(body.estado ?? "CMX");
    const p = resolveIsrParams(rows, estado, ahora);
    if (!p.ok || !p.params) {
      return NextResponse.json({ error: "Faltan parámetros del ISR." }, { status: 409 });
    }
    const r = calcularIsrVenta(
      {
        precioVentaCents: parseMoneyInput(String(body.precioVenta ?? "")) ?? 0,
        precioAdquisicionCents: parseMoneyInput(String(body.precioCompra ?? "")) ?? 0,
        anioAdquisicion: Math.round(parseNumberInput(String(body.anioCompra ?? "")) ?? 0),
        anioVenta: Math.round(
          parseNumberInput(String(body.anioVenta ?? "")) ?? ahora.getFullYear(),
        ),
        esCasaHabitacion: body.casaHabitacion === true,
        usoExencionReciente: body.usoExencion === true,
        mejorasCents: parseMoneyInput(String(body.mejoras ?? "")),
        anioMejoras: parseNumberInput(String(body.anioMejoras ?? "")),
        gastosAdquisicionCents: parseMoneyInput(String(body.gastosCompra ?? "")),
        gastosVentaCents: parseMoneyInput(String(body.gastosVenta ?? "")),
      },
      p.params,
    );
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    archivo = "isr-por-la-venta";
    const filas: Fila[] = r.renglones!.map((f) => ({
      label: `${f.esDeduccion ? "− " : ""}${f.etiqueta}`,
      valor: fmtMXN(f.montoCents),
    }));
    filas.push({ label: "Ganancia estimada", valor: fmtMXN(r.gananciaTotalCents!) });
    const resumen: Fila[] = [
      { label: "Tope de la exención", valor: fmtMXN(r.limiteExentoCents!) },
      { label: "Ganancia gravada", valor: fmtMXN(r.gananciaGravadaCents!) },
      { label: "ISR estimado", valor: fmtMXN(r.isrCents!) },
    ];
    if (r.cedularCents! > 0) {
      resumen.push({
        label: `Impuesto cedular (${r.cedularPct}%)`,
        valor: fmtMXN(r.cedularCents!),
      });
    }
    resumen.push(
      { label: "Total de impuestos", valor: fmtMXN(r.totalImpuestosCents!) },
      { label: "Le queda al vendedor", valor: fmtMXN(r.netoVendedorCents!) },
    );
    hoja = {
      titulo: "ISR por la venta",
      sub: `${p.params.stateName} · valores vigentes de ${r.year}`,
      destacado: {
        label: r.exento ? "Resultado" : "ISR estimado",
        valor: r.exento ? "EXENTO" : fmtMXN(r.isrCents!),
      },
      secciones: [
        { titulo: "Cómo se llega a la ganancia", filas },
        { titulo: "Impuestos", filas: resumen },
      ],
      notas: [
        r.exento
          ? "El precio de venta está por debajo del tope de la exención de casa habitación."
          : (r.motivoNoExento ??
            `Exento hasta ${fmtMXN(r.limiteExentoCents!)}; el excedente sí grava.`),
        ...(r.avisos ?? []),
        ...p.avisos,
      ].filter(Boolean),
      leyenda: r.leyenda!,
    };
  } else if (tipo === "precalificacion") {
    const p = resolveCreditoParams(rows, ahora);
    if (!p.ok || !p.params) {
      return NextResponse.json({ error: "Faltan parámetros de crédito." }, { status: 409 });
    }
    const r = precalificar(
      {
        tipo: String(body.credito ?? "INFONAVIT") as TipoCredito,
        salarioMensualCents: parseMoneyInput(String(body.salario ?? "")) ?? 0,
        ahorroCents: parseMoneyInput(String(body.ahorro ?? "")) ?? 0,
        deudasMensualesCents: parseMoneyInput(String(body.deudas ?? "")),
        edad: Math.round(parseNumberInput(String(body.edad ?? "")) ?? 0),
        puntosInfonavit: parseNumberInput(String(body.puntos ?? "")),
        unirCredito: body.unir === true,
        salarioSocioCents: parseMoneyInput(String(body.salarioSocio ?? "")),
        tasaAnualPropia: parseNumberInput(String(body.tasaPropia ?? "")),
      },
      p.params,
    );
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    archivo = "precalificacion";
    const filas: Fila[] = [];
    if (r.califica) {
      if ((r.creditoMaxCents ?? 0) > 0) {
        filas.push(
          {
            label: "Crédito estimado",
            valor: `${fmtMXN(r.creditoMinCents!)} a ${fmtMXN(r.creditoMaxCents!)}`,
          },
          {
            label: "Mensualidad aproximada",
            valor: `${fmtMXN(r.mensualidadMinCents!)} a ${fmtMXN(r.mensualidadMaxCents!)}`,
          },
          { label: "Plazo", valor: `${Math.floor(r.plazoMeses! / 12)} años` },
          {
            label: "Tasa anual considerada",
            valor: `${fmtPct(r.tasaMinPct!)} a ${fmtPct(r.tasaMaxPct!)}`,
          },
        );
      }
      filas.push({
        label: "Presupuesto de compra",
        valor: `${fmtMXN(r.presupuestoMinCents!)} a ${fmtMXN(r.presupuestoMaxCents!)}`,
      });
    }
    hoja = {
      titulo: "Precalificación de crédito",
      sub: `${r.tipoLabel} · valores vigentes de ${r.year}`,
      destacado: r.califica
        ? {
            label: "Le alcanza para una casa de",
            valor: `${fmtMXN(r.presupuestoMinCents!)} a ${fmtMXN(r.presupuestoMaxCents!)}`,
          }
        : { label: "Resultado", valor: "Todavía no califica" },
      secciones: filas.length > 0 ? [{ titulo: "El crédito", filas }] : [],
      notas: [r.motivoNoCalifica, ...(r.pasos ?? []), ...(r.avisos ?? []), ...p.avisos].filter(
        Boolean,
      ) as string[],
      leyenda: r.leyenda!,
    };
  }

  if (!hoja) return NextResponse.json({ error: "Tipo de cálculo desconocido." }, { status: 400 });

  try {
    const buffer = await renderToBuffer(<Documento hoja={hoja} />);
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${archivo}.pdf"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (e) {
    console.error("[realty-calc] el PDF no se pudo dibujar:", e);
    return NextResponse.json({ error: "No se pudo generar el PDF." }, { status: 500 });
  }
}
