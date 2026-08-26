import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { formatCents, monthLabel } from "@/lib/realty/rent-charges";
import { REALTY_AGING_UI } from "@/lib/realty/rent-charges";
import type { RealtyCurrency } from "@/lib/realty/types";
import {
  activeCurrencies,
  formatPctOrDash,
  yieldBlockedText,
  type MoneyByCurrency,
  type OwnerActivityReport,
} from "@/lib/realty/owner-report";
import type {
  OperationsReport,
  PortfolioReport,
  TaxSummary,
} from "@/lib/realty/reports";

/* ═══════════════════════════════════════════════════════════════════════
   LOS CUATRO REPORTES EN PDF.

   🔴 ESTE ARCHIVO NO ES UN COMPONENTE DE PANTALLA. Sus etiquetas
   (Document, Page, Text, View) son de @react-pdf/renderer y NO son HTML:
   solo lo puede importar una ruta de servidor que llame a renderToBuffer.
   Si alguna vez un componente con "use client" lo importa, el build se cae
   — y ese es el comportamiento correcto. Mismo criterio que
   components/realty/portal/recibo-pdf.tsx.

   ── POR QUÉ AQUÍ Y NO DENTRO DE CADA RUTA ─────────────────────────────
   Porque los cuatro reportes comparten membrete, tipografía y el aviso de
   moneda. Repartidos en cuatro rutas, en seis meses habría cuatro estilos
   distintos y el propietario recibiría hojas que no parecen del mismo
   sistema.

   ── LA REGLA QUE MANDA, TAMBIÉN AQUÍ ──────────────────────────────────
   Ninguna celda de dinero acepta un `number` suelto: o recibe centavos CON
   su moneda, o recibe un MoneyByCurrency y entonces imprime un renglón por
   moneda. Un PDF que sumara pesos con dólares sería el único documento del
   sistema que un tercero archiva y usa para decidir.

   Fuentes Helvetica/Helvetica-Bold integradas: registrar una externa es
   una petición de red que puede fallar justo cuando alguien descarga su
   reporte.
   ═══════════════════════════════════════════════════════════════════════ */

const PINE = "#2F6B4D";
const PINE_DARK = "#27543E";
const INK = "#14201A";
const MUTED = "#6B776F";
const LINE = "#DCD8CD";
const SAND = "#F5F1E8";
const MIST = "#EDF3EF";
const AMBER = "#8A5A12";
const AMBER_BG = "#FBF3E3";

const s = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 54,
    paddingHorizontal: 34,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
    lineHeight: 1.45,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: PINE,
    paddingBottom: 10,
    marginBottom: 16,
  },
  brandBox: { flexDirection: "row", alignItems: "center", maxWidth: "60%" },
  logo: { width: 30, height: 30, objectFit: "contain", marginRight: 8 },
  brand: { fontSize: 13, fontFamily: "Helvetica-Bold", color: PINE_DARK },
  brandSub: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  headRight: { textAlign: "right", maxWidth: "45%" },
  kicker: { fontSize: 7.5, color: PINE, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 2 },
  sub: { fontSize: 8.5, color: MUTED, marginTop: 2 },

  section: { marginTop: 15 },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  sectionNote: { fontSize: 7.5, color: MUTED, marginTop: 5, lineHeight: 1.4 },

  advice: {
    backgroundColor: MIST,
    borderLeftWidth: 3,
    borderLeftColor: PINE,
    borderRadius: 3,
    padding: 12,
    marginTop: 4,
  },
  adviceWarn: { backgroundColor: AMBER_BG, borderLeftColor: AMBER },
  adviceHead: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK },
  adviceBody: { fontSize: 9.5, marginTop: 5, lineHeight: 1.55 },
  adviceAction: { fontSize: 9, marginTop: 4, color: PINE_DARK },

  kpis: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  kpi: {
    width: "20%",
    paddingVertical: 7,
    paddingRight: 8,
  },
  kpiWide: { width: "33.33%" },
  kpiLabel: { fontSize: 7, color: MUTED, letterSpacing: 0.4, textTransform: "uppercase" },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  kpiHint: { fontSize: 7, color: MUTED, marginTop: 1 },

  headline: { flexDirection: "row", marginTop: 4 },
  headlineCell: {
    flex: 1,
    backgroundColor: SAND,
    borderRadius: 4,
    padding: 11,
    marginRight: 8,
  },
  headlineLast: { marginRight: 0 },
  headlineLabel: { fontSize: 7, color: MUTED, letterSpacing: 0.6, textTransform: "uppercase" },
  headlineValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 3 },
  headlineExtra: { fontSize: 7.5, color: MUTED, marginTop: 3 },

  thead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PINE,
    paddingBottom: 3,
  },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: PINE_DARK, paddingRight: 6 },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 4,
  },
  trFoot: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: PINE, paddingTop: 5 },
  td: { fontSize: 8, paddingRight: 6 },
  tdStrong: { fontFamily: "Helvetica-Bold" },
  num: { textAlign: "right" },

  quote: { fontSize: 8, color: "#3B463F", fontStyle: "italic" },
  empty: {
    fontSize: 8.5,
    color: MUTED,
    backgroundColor: SAND,
    padding: 9,
    borderRadius: 3,
  },
  warn: {
    fontSize: 8,
    color: AMBER,
    backgroundColor: AMBER_BG,
    padding: 9,
    borderRadius: 3,
    marginTop: 8,
    lineHeight: 1.45,
  },
  info: {
    fontSize: 8,
    color: PINE_DARK,
    backgroundColor: MIST,
    padding: 9,
    borderRadius: 3,
    marginTop: 8,
    lineHeight: 1.45,
  },
  foot: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: MUTED,
  },
});

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas
// ═══════════════════════════════════════════════════════════════════════

export interface PdfBrand {
  name: string;
  /** data: URI ya reducido. null = solo el nombre. */
  logoSrc: string | null;
  licenseLine: string | null;
  phone: string | null;
  email: string | null;
}

function Head({
  brand,
  kicker,
  title,
  sub,
}: {
  brand: PdfBrand;
  kicker: string;
  title: string;
  sub: string;
}) {
  return (
    <View style={s.header} fixed>
      <View style={s.brandBox}>
        {brand.logoSrc ? <Image src={brand.logoSrc} style={s.logo} /> : null}
        <View>
          <Text style={s.brand}>{brand.name}</Text>
          {brand.licenseLine ? <Text style={s.brandSub}>{brand.licenseLine}</Text> : null}
          {brand.phone || brand.email ? (
            <Text style={s.brandSub}>
              {[brand.phone, brand.email].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={s.headRight}>
        <Text style={s.kicker}>{kicker.toUpperCase()}</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </View>
  );
}

function Foot({ brand, leyenda }: { brand: PdfBrand; leyenda: string }) {
  return (
    <View style={s.foot} fixed>
      <Text style={{ maxWidth: "78%" }}>{leyenda}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
      {note ? <Text style={s.sectionNote}>{note}</Text> : null}
    </View>
  );
}

interface Col {
  label: string;
  /** Peso relativo del ancho. */
  w: number;
  num?: boolean;
}

/**
 * Tabla con encabezado que se repite al cambiar de página. `wrap={false}`
 * en cada renglón: una fila partida a la mitad entre dos hojas es
 * exactamente lo que hace que un reporte se vea hecho a mano.
 */
function Table({
  cols,
  rows,
  footer,
  empty,
}: {
  cols: Col[];
  rows: Array<Array<string | number>>;
  footer?: Array<string | number> | null;
  empty?: string;
}) {
  if (rows.length === 0) {
    return <Text style={s.empty}>{empty ?? "Sin movimientos en el periodo."}</Text>;
  }
  return (
    <View>
      <View style={s.thead} fixed>
        {cols.map((c, i) => (
          <Text key={i} style={[s.th, { flex: c.w }, c.num ? s.num : {}]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {cols.map((c, j) => (
            <Text
              key={j}
              style={[s.td, { flex: c.w }, c.num ? s.num : {}, j === 0 ? s.tdStrong : {}]}
            >
              {String(r[j] ?? "")}
            </Text>
          ))}
        </View>
      ))}
      {footer ? (
        <View style={[s.tr, s.trFoot]} wrap={false}>
          {cols.map((c, j) => (
            <Text
              key={j}
              style={[s.td, s.tdStrong, { flex: c.w }, c.num ? s.num : {}]}
            >
              {String(footer[j] ?? "")}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Dinero de varias monedas en UNA celda de texto: "$12,000.00 · US$3,500.00".
 * Nunca los suma. Cuando no hubo movimiento imprime el cero de la moneda
 * que se le indique, para que la columna no quede en blanco.
 */
export function moneyText(m: MoneyByCurrency, zero: RealtyCurrency = "MXN"): string {
  const act = activeCurrencies(m);
  if (act.length === 0) return formatCents(0, zero);
  return act.map((c) => formatCents(m[c], c)).join(" · ");
}

function siNo(v: boolean): string {
  return v ? "Sí" : "No";
}

function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function minutos(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.round(n / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** El aviso de mezcla de monedas, solo cuando de verdad hay dos. */
function MixedNote({ monies }: { monies: MoneyByCurrency[] }) {
  const mixed = monies.some((m) => activeCurrencies(m).length > 1);
  if (!mixed) return null;
  return (
    <Text style={s.warn}>
      Hay movimientos en pesos y en dólares. No se suman: cada moneda va por
      separado, porque un total que las mezclara no sería ninguna de las dos. Este
      sistema no guarda tipo de cambio y por eso no convierte.
    </Text>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// A · Reporte de actividad al propietario
// ═══════════════════════════════════════════════════════════════════════

/**
 * Es lo único del sistema que ve un cliente del cliente. Empieza por la
 * lectura en texto claro y no por una tabla: el propietario no quiere doce
 * columnas, quiere que alguien le diga qué está pasando con su casa.
 */
export function OwnerReportPdf({
  report,
  brand,
}: {
  report: OwnerActivityReport;
  brand: PdfBrand;
}) {
  const rec = report.recommendation;
  const alerta = rec.tone === "PRECIO" || rec.tone === "SIN_ANUNCIO";

  return (
    <Document title={`Reporte — ${report.propertyTitle}`} author={brand.name}>
      <Page size="LETTER" style={s.page}>
        <Head
          brand={brand}
          kicker="Reporte de actividad"
          title={report.propertyTitle}
          sub={`Del ${report.from} al ${report.to}`}
        />

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 8.5, color: MUTED, maxWidth: "62%" }}>
            {report.address ?? ""}
            {report.ownerName ? `${report.address ? " · " : ""}${report.ownerName}` : ""}
          </Text>
          <Text style={{ fontSize: 8.5, color: MUTED }}>
            Precio de lista: {formatCents(report.askingPriceCents, report.currency)}
          </Text>
        </View>

        {/* La lectura. Va PRIMERO. */}
        <View style={[s.advice, alerta ? s.adviceWarn : {}]}>
          <Text style={s.adviceHead}>{rec.headline}</Text>
          <Text style={s.adviceBody}>{rec.body}</Text>
          {rec.actions.map((a, i) => (
            <Text key={i} style={s.adviceAction}>
              • {a}
            </Text>
          ))}
        </View>

        <Section
          title="Dónde está anunciado y qué trajo cada lado"
          note="Este reporte NO dice cuántas veces se vio el anuncio: ningún portal nos devuelve ese contador y la web no lleva uno. Lo que sí sabemos —y es lo que aquí se cuenta— es cuánta gente escribió desde cada lado."
        >
          <Table
            cols={[
              { label: "Portal", w: 3 },
              { label: "¿Publicado?", w: 1.4 },
              { label: "Última sync.", w: 1.6 },
              { label: "Escribieron", w: 1.4, num: true },
              { label: "Visitaron", w: 1.3, num: true },
              { label: "Ofertaron", w: 1.3, num: true },
            ]}
            rows={report.portals.map((p) => [
              p.label,
              siNo(p.published),
              fecha(p.lastPushedAt),
              p.leads,
              p.visits,
              p.offers,
            ])}
            empty="El inmueble no aparece publicado en ningún portal ni en la web de la inmobiliaria."
          />
        </Section>

        <Section title="El interés">
          <View style={s.kpis}>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Preguntaron</Text>
              <Text style={s.kpiValue}>{report.leads}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Llamadas</Text>
              <Text style={s.kpiValue}>{report.calls}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Mensajes</Text>
              <Text style={s.kpiValue}>{report.messages}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>1ª respuesta</Text>
              <Text style={s.kpiValue}>{minutos(report.response.medianMinutes)}</Text>
              <Text style={s.kpiHint}>mediana</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Sin contestar</Text>
              <Text style={s.kpiValue}>{report.response.unanswered}</Text>
            </View>
          </View>
        </Section>

        <Section title="Visitas y qué opinaron">
          <View style={s.kpis}>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Ocurrieron</Text>
              <Text style={s.kpiValue}>{report.visitsHappened}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Agendadas</Text>
              <Text style={s.kpiValue}>{report.visitsScheduled}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Canceladas</Text>
              <Text style={s.kpiValue}>{report.visitsCancelled}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>No asistió</Text>
              <Text style={s.kpiValue}>{report.visitsNoShow}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Hablaron del precio</Text>
              <Text style={s.kpiValue}>{report.priceObjections}</Text>
            </View>
          </View>

          <View style={{ marginTop: 8 }}>
            <Table
              cols={[
                { label: "Cuándo", w: 1.3 },
                { label: "Quién", w: 2 },
                { label: "Asesor", w: 2 },
                { label: "Qué dijeron al salir", w: 5 },
              ]}
              rows={report.visits.map((v) => [
                fecha(v.scheduledAt),
                v.visitorName ?? "—",
                v.agentName ?? "—",
                v.feedback
                  ? `${v.feedback}${v.priceObjection ? "  [habló del precio]" : ""}`
                  : "Sin comentario registrado",
              ])}
              empty="No hubo visitas agendadas en el periodo."
            />
          </View>

          {report.visits.length > 0 && report.feedbackCount === 0 ? (
            <Text style={s.info}>
              Ninguna de esas visitas dejó comentario registrado. Pedirle al asesor que
              anote qué dijeron al salir es lo que convierte este reporte en algo con
              lo que se puede decidir.
            </Text>
          ) : null}
        </Section>

        <Section
          title="Ofertas"
          note="Una etapa OFERTA del CRM no guarda importe —no hay tabla de ofertas—, así que puede aparecer una oferta sin monto. Las que sí lo traen son operaciones ya registradas."
        >
          <Table
            cols={[
              { label: "Quién", w: 3 },
              { label: "Cuándo", w: 1.5 },
              { label: "Estado", w: 2 },
              { label: "Monto", w: 2, num: true },
            ]}
            rows={[...report.offers, ...(report.closedDeal ? [report.closedDeal] : [])].map(
              (o) => [
                o.who,
                fecha(o.when),
                o.status,
                o.amountCents !== null && o.currency
                  ? formatCents(o.amountCents, o.currency)
                  : "No registrado",
              ],
            )}
            empty="No se recibió ninguna oferta en el periodo."
          />
        </Section>

        {report.zone ? (
          <Section
            title="Lo que se está cerrando en la zona"
            note="Sale de operaciones CERRADAS de esta misma inmobiliaria: mismo tipo de inmueble, misma ciudad y misma moneda, en los últimos 12 meses. No es un índice de mercado, y por eso no se emite con menos de tres operaciones comparables."
          >
            <View style={s.headline}>
              <View style={s.headlineCell}>
                <Text style={s.headlineLabel}>Operaciones comparables</Text>
                <Text style={s.headlineValue}>{report.zone.closedCount}</Text>
              </View>
              <View style={s.headlineCell}>
                <Text style={s.headlineLabel}>Mediana de cierre</Text>
                <Text style={s.headlineValue}>
                  {formatCents(report.zone.medianClosedCents, report.zone.currency)}
                </Text>
              </View>
              <View style={[s.headlineCell, s.headlineLast]}>
                <Text style={s.headlineLabel}>Este inmueble</Text>
                <Text style={s.headlineValue}>
                  {report.zone.deltaPct === null
                    ? "—"
                    : `${report.zone.deltaPct > 0 ? "+" : ""}${formatPctOrDash(report.zone.deltaPct)}`}
                </Text>
                <Text style={s.headlineExtra}>respecto de esa mediana</Text>
              </View>
            </View>
          </Section>
        ) : null}

        <Foot
          brand={brand}
          leyenda={`Reporte generado el ${fecha(report.generatedAt)} por ${brand.name}. Los datos salen del expediente de este inmueble.`}
        />
      </Page>
    </Document>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// B y D · Cartera del propietario y rentabilidad por inmueble
// ═══════════════════════════════════════════════════════════════════════

export function PortfolioPdf({
  report,
  brand,
  variant,
}: {
  report: PortfolioReport;
  brand: PdfBrand;
  variant: "cartera" | "rentabilidad";
}) {
  const esCartera = variant === "cartera";
  const title = esCartera ? "Cartera del propietario" : "Rentabilidad por inmueble";

  const cols: Col[] = [
    { label: "Inmueble", w: 3.4 },
    ...(esCartera
      ? ([
          { label: "Valor", w: 1.8, num: true },
          { label: "Renta", w: 1.6, num: true },
        ] as Col[])
      : []),
    { label: "Ingresos", w: 1.9, num: true },
    { label: "Gastos", w: 1.9, num: true },
    { label: "Neto", w: 1.9, num: true },
    { label: "Meses vacía", w: 1.1, num: true },
    { label: "Rendimiento", w: 1.3, num: true },
  ];

  const rows = report.rows.map((r) => [
    r.title,
    ...(esCartera
      ? [
          formatCents(r.valueCents, r.currency),
          formatCents(r.monthlyRentCents, r.monthlyRentCurrency),
        ]
      : []),
    moneyText(r.income, r.currency),
    moneyText(r.expenses, r.currency),
    moneyText(r.net, r.currency),
    r.monthsVacant,
    r.yield.netPct === null ? "—" : formatPctOrDash(r.yield.netPct),
  ]);

  const footer = [
    "TOTAL",
    ...(esCartera ? [moneyText(report.totalValue), moneyText(report.totalMonthlyRent)] : []),
    moneyText(report.totalIncome),
    moneyText(report.totalExpenses),
    moneyText(report.totalNet),
    "",
    "",
  ];

  const mantenimiento: MoneyByCurrency = { MXN: 0, USD: 0 };
  for (const r of report.rows) {
    mantenimiento.MXN += r.maintenanceCost.MXN;
    mantenimiento.USD += r.maintenanceCost.USD;
  }
  const sinRendimiento = report.rows.filter((r) => r.yield.netPct === null && r.yield.blocked);

  return (
    <Document title={title} author={brand.name}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Head
          brand={brand}
          kicker={esCartera ? "Patrimonio" : "Rentabilidad"}
          title={report.ownerName ? `${title} — ${report.ownerName}` : title}
          sub={`Del ${report.from} al ${report.to} · ${report.months} meses`}
        />

        {esCartera ? (
          <View style={s.headline}>
            <View style={s.headlineCell}>
              <Text style={s.headlineLabel}>Tu patrimonio vale hoy</Text>
              <Text style={s.headlineValue}>{moneyText(report.totalValue)}</Text>
              <Text style={s.headlineExtra}>
                Es el precio de LISTA capturado en cada ficha, no un avalúo.
              </Text>
            </View>
            <View style={s.headlineCell}>
              <Text style={s.headlineLabel}>Te renta al mes</Text>
              <Text style={s.headlineValue}>{moneyText(report.totalMonthlyRent)}</Text>
              <Text style={s.headlineExtra}>
                Del contrato vigente; si no hay, del precio de renta publicado.
              </Text>
            </View>
            <View style={[s.headlineCell, s.headlineLast]}>
              <Text style={s.headlineLabel}>Tu rendimiento anual</Text>
              <Text style={s.headlineValue}>
                {report.yieldByCurrency.length === 0
                  ? "—"
                  : report.yieldByCurrency
                      .map(
                        (y) =>
                          `${formatPctOrDash(y.netPct)}${
                            report.yieldByCurrency.length > 1 ? ` ${y.currency}` : ""
                          }`,
                      )
                      .join(" · ")}
              </Text>
              <Text style={s.headlineExtra}>
                (ingresos − gastos) ÷ valor, anualizado.
              </Text>
            </View>
          </View>
        ) : null}

        <MixedNote monies={[report.totalValue, report.totalIncome, report.totalExpenses]} />

        <Section
          title="Inmueble por inmueble"
          note="El rendimiento solo se emite cuando el valor, los ingresos y los gastos de ese inmueble están en la MISMA moneda. Cuando no, va un guion y abajo se dice por qué."
        >
          <Table
            cols={cols}
            rows={rows}
            footer={footer}
            empty="No hay inmuebles en el alcance de este reporte."
          />
        </Section>

        {report.best && report.worst ? (
          <Text style={s.info}>
            El que más te deja: {report.best.title} ({formatPctOrDash(report.best.yield.netPct)}).
            El que menos: {report.worst.title} ({formatPctOrDash(report.worst.yield.netPct)}).
          </Text>
        ) : report.rows.length > 1 ? (
          <Text style={s.info}>
            No se comparan entre sí: hay inmuebles en monedas distintas y ordenar un 8 %
            en dólares junto a un 6 % en pesos daría un ranking que no significa nada.
          </Text>
        ) : null}

        {sinRendimiento.length > 0 ? (
          <Section title="Por qué a algunos no se les pudo calcular el rendimiento">
            <Table
              cols={[
                { label: "Inmueble", w: 3 },
                { label: "Motivo", w: 7 },
              ]}
              rows={sinRendimiento.map((r) => [
                r.title,
                yieldBlockedText(r.yield.blocked) ?? "",
              ])}
            />
          </Section>
        ) : null}

        {mantenimiento.MXN !== 0 || mantenimiento.USD !== 0 ? (
          <Text style={s.warn}>
            Mantenimiento del periodo: {moneyText(mantenimiento)}. Va aparte y NO se resta
            del neto: cuando la inmobiliaria paga una reparación la captura como gasto, y
            restarla otra vez le cobraría dos veces la misma plomería.
          </Text>
        ) : null}

        {report.orphanPayments > 0 ? (
          <Text style={s.warn}>
            Hay {report.orphanPayments} pago(s) que no cuelgan de ningún inmueble. NO
            están en estos totales: no se puede saber de quién son ni en qué moneda.
          </Text>
        ) : null}

        <Foot
          brand={brand}
          leyenda={`Generado el ${fecha(report.generatedAt)} por ${brand.name}. El valor es el precio de lista: este sistema no hace avalúos.`}
        />
      </Page>
    </Document>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// C · Resumen anual del arrendador
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 NI UNA MENCIÓN DE CFDI. Este vertical no factura, no timbra y no
 * emite complementos de pago. La palabra "retenido" significa la COMISIÓN
 * DE ADMINISTRACIÓN de la inmobiliaria — y el PDF lo dice con esas
 * palabras, arriba, no en una nota al pie que nadie lee.
 */
export function TaxPdf({ report, brand }: { report: TaxSummary; brand: PdfBrand }) {
  return (
    <Document title={`Resumen anual ${report.year}`} author={brand.name}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Head
          brand={brand}
          kicker="Para tu contador"
          title={`Resumen anual del arrendador — ${report.year}`}
          sub={
            report.ownerName
              ? `${report.ownerName}${report.ownerRfc ? ` · RFC ${report.ownerRfc}` : ""} · ${report.from} al ${report.to}`
              : `${report.from} al ${report.to}`
          }
        />

        <Text style={s.warn}>
          Llévale esto a tu contador. NO es una declaración y no la sustituye. Este
          sistema no factura: lo que aparece en la columna Recibo son RECIBOS internos,
          no comprobantes fiscales. Y &quot;retenido&quot; es la comisión de administración que
          se quedó la inmobiliaria — nadie te retuvo ISR.
        </Text>

        <View style={s.headline}>
          <View style={s.headlineCell}>
            <Text style={s.headlineLabel}>Ingresos del año</Text>
            <Text style={s.headlineValue}>{moneyText(report.totalIncome)}</Text>
          </View>
          <View style={s.headlineCell}>
            <Text style={s.headlineLabel}>Gastos del año</Text>
            <Text style={s.headlineValue}>{moneyText(report.totalExpenses)}</Text>
            <Text style={s.headlineExtra}>
              Probablemente deducibles: {moneyText(report.totalLikelyDeductible)}
            </Text>
          </View>
          <View style={s.headlineCell}>
            <Text style={s.headlineLabel}>Retenido por administración</Text>
            <Text style={s.headlineValue}>{moneyText(report.totalRetained)}</Text>
          </View>
          <View style={[s.headlineCell, s.headlineLast]}>
            <Text style={s.headlineLabel}>Neto</Text>
            <Text style={s.headlineValue}>{moneyText(report.totalNet)}</Text>
          </View>
        </View>

        <MixedNote
          monies={[report.totalIncome, report.totalExpenses, report.totalRetained]}
        />

        <Section
          title="Por inmueble"
          note="La columna de gastos probablemente deducibles agrupa predial, agua, mantenimiento y reparaciones. Es una AYUDA por categoría, no un dictamen fiscal: quién decide qué se deduce es tu contador, con los comprobantes en la mano."
        >
          <Table
            cols={[
              { label: "Inmueble", w: 3.6 },
              { label: "Ingresos", w: 2, num: true },
              { label: "Gastos", w: 2, num: true },
              { label: "Deducibles probables", w: 2, num: true },
              { label: "Retenido", w: 2, num: true },
              { label: "Comisión", w: 1, num: true },
              { label: "Neto", w: 2, num: true },
            ]}
            rows={report.properties.map((p) => [
              p.title,
              moneyText(p.income, p.currency),
              moneyText(p.expenses, p.currency),
              moneyText(p.likelyDeductible, p.currency),
              moneyText(p.retained, p.currency),
              p.commissionPct === null ? "—" : `${p.commissionPct} %`,
              moneyText(p.net, p.currency),
            ])}
            footer={[
              "TOTAL",
              moneyText(report.totalIncome),
              moneyText(report.totalExpenses),
              moneyText(report.totalLikelyDeductible),
              moneyText(report.totalRetained),
              "",
              moneyText(report.totalNet),
            ]}
            empty="No hubo ingresos ni gastos registrados en el año."
          />
        </Section>

        {report.withoutCommissionPct > 0 ? (
          <Text style={s.info}>
            {report.withoutCommissionPct} inmueble(s) no tienen comisión pactada en su
            ficha. Su retención va en CERO porque nadie firmó un porcentaje, no porque se
            haya olvidado.
          </Text>
        ) : null}

        <Section title="Pagos recibidos, con su fecha" note={undefined}>
          <Table
            cols={[
              { label: "Fecha", w: 1.3 },
              { label: "Inmueble", w: 3.4 },
              { label: "Periodo", w: 1.5 },
              { label: "Forma", w: 1.4 },
              { label: "Referencia", w: 1.8 },
              { label: "Recibo", w: 1.6 },
              { label: "Monto", w: 1.8, num: true },
            ]}
            rows={report.payments.map((p) => [
              fecha(p.paidAt),
              p.propertyTitle,
              p.periodMonth ? monthLabel(p.periodMonth) : "—",
              p.method,
              p.reference ?? "—",
              p.receiptFolio || "Sin recibo",
              formatCents(p.cents, p.currency),
            ])}
            empty="No se registró ningún pago de renta en el año."
          />
        </Section>

        {report.orphanPayments > 0 ? (
          <Text style={s.warn}>
            Hay {report.orphanPayments} pago(s) que no cuelgan de ningún inmueble y NO
            están en estos totales.
          </Text>
        ) : null}

        <Foot
          brand={brand}
          leyenda={`Generado el ${fecha(report.generatedAt)} por ${brand.name}. No es una declaración ni un comprobante fiscal.`}
        />
      </Page>
    </Document>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// E · Reportes de la operación
// ═══════════════════════════════════════════════════════════════════════

export function OperationsPdf({
  report,
  brand,
}: {
  report: OperationsReport;
  brand: PdfBrand;
}) {
  const d = report.delinquency;
  const c = report.commissions;

  return (
    <Document title="Reportes de la operación" author={brand.name}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Head
          brand={brand}
          kicker="Operación"
          title="Reportes de la operación"
          sub={`Del ${report.from} al ${report.to}`}
        />

        {report.funnel ? (
          <Section
            title="Embudo de conversión"
            note="La etapa del prospecto es mutable y no guarda histórico: se cuenta ACUMULADO (quien está en OFERTA ya pasó por CONTACTADO). Es la foto de hoy, no la historia. Una visita cuenta como ocurrida si ya pasó su hora y no se canceló ni faltó."
          >
            <Table
              cols={[
                { label: "Etapa", w: 3 },
                { label: "Cuántos", w: 1.4, num: true },
                { label: "% del anterior", w: 1.6, num: true },
              ]}
              rows={report.funnel.steps.map((x) => [
                x.label,
                x.count,
                x.fromPreviousPct === null ? "—" : `${x.fromPreviousPct} %`,
              ])}
              empty="No entraron prospectos en el periodo."
            />
            <View style={s.kpis}>
              <View style={[s.kpi, s.kpiWide]}>
                <Text style={s.kpiLabel}>Visitas que ocurrieron</Text>
                <Text style={s.kpiValue}>{report.funnel.visitsHappened}</Text>
                <Text style={s.kpiHint}>{report.funnel.visitsScheduled} agendadas</Text>
              </View>
              <View style={[s.kpi, s.kpiWide]}>
                <Text style={s.kpiLabel}>Operaciones cerradas</Text>
                <Text style={s.kpiValue}>{report.funnel.closedDeals}</Text>
              </View>
              <View style={[s.kpi, s.kpiWide]}>
                <Text style={s.kpiLabel}>Prospectos perdidos</Text>
                <Text style={s.kpiValue}>{report.funnel.lost}</Text>
                <Text style={s.kpiHint}>
                  {report.funnel.lostReasons
                    .slice(0, 3)
                    .map((r) => `${r.label}: ${r.count}`)
                    .join(" · ")}
                </Text>
              </View>
            </View>
          </Section>
        ) : null}

        {report.portals.length > 0 ? (
          <Section
            title="Qué portal trae los que CIERRAN"
            note="Se ordena por los que CIERRAN, no por los que más prospectos traen: ese es el punto entero de esta tabla. Se cuentan PERSONAS por la etapa CIERRE del prospecto, no pesos — una operación no guarda de qué prospecto vino, y repartir el importe sería adivinarlo."
          >
            <Table
              cols={[
                { label: "Portal", w: 2.8 },
                { label: "Prospectos", w: 1.3, num: true },
                { label: "Contestados", w: 1.3, num: true },
                { label: "Visitaron", w: 1.2, num: true },
                { label: "Ofertaron", w: 1.2, num: true },
                { label: "Cerraron", w: 1.2, num: true },
                { label: "Tasa de cierre", w: 1.4, num: true },
                { label: "1ª respuesta", w: 1.4, num: true },
              ]}
              rows={report.portals.map((p) => [
                p.label,
                p.leads,
                p.answered,
                p.visits,
                p.offers,
                p.closed,
                `${p.closeRatePct} %`,
                minutos(p.medianResponseMinutes),
              ])}
            />
          </Section>
        ) : null}

        {report.agents.length > 0 ? (
          <Section
            title="Tiempo de primera respuesta por asesor"
            note="La mediana aguanta mejor que el promedio el prospecto que se contestó tres días después. Se mide desde que entra el prospecto hasta la primera respuesta registrada."
          >
            <Table
              cols={[
                { label: "Asesor", w: 3 },
                { label: "Prospectos", w: 1.3, num: true },
                { label: "Promedio", w: 1.3, num: true },
                { label: "Mediana", w: 1.3, num: true },
                { label: "Sin contestar", w: 1.4, num: true },
                { label: "Conversión", w: 1.3, num: true },
              ]}
              rows={report.agents.map((a) => [
                `${a.name}${a.active ? "" : " (baja)"}`,
                a.leads,
                minutos(a.avgResponseMinutes),
                minutos(a.medianResponseMinutes),
                a.unanswered,
                `${a.conversionPct} %`,
              ])}
            />
          </Section>
        ) : null}

        {d ? (
          <Section
            title={`Morosidad al ${d.today}`}
            note="Moroso no es el estado VENCIDO: un cargo con abono parcial y vencido se guarda como PARCIAL. El criterio es saldo mayor a cero y días de retraso mayores a cero, el mismo del tablero de cobranza."
          >
            <View style={s.kpis}>
              <View style={s.kpi}>
                <Text style={s.kpiLabel}>Vencido</Text>
                <Text style={s.kpiValue}>{moneyText(d.overdue)}</Text>
                <Text style={s.kpiHint}>{d.overdueCount} cargos</Text>
              </View>
              {d.buckets.map((b) => (
                <View key={b.key} style={s.kpi}>
                  <Text style={s.kpiLabel}>{REALTY_AGING_UI[b.key].short}</Text>
                  <Text style={s.kpiValue}>{b.count}</Text>
                  <Text style={s.kpiHint}>{moneyText(b.balance)}</Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: 8 }}>
              <Table
                cols={[
                  { label: "Inmueble", w: 3 },
                  { label: "Inquilino", w: 2.4 },
                  { label: "Periodo", w: 1.6 },
                  { label: "Vence", w: 1.3 },
                  { label: "Días", w: 1, num: true },
                  { label: "Antigüedad", w: 1.6 },
                  { label: "Saldo", w: 1.7, num: true },
                ]}
                rows={d.rows
                  .slice(0, 40)
                  .map((r) => [
                    r.propertyTitle,
                    r.tenantName,
                    monthLabel(r.periodMonth),
                    fecha(r.dueAt),
                    r.daysLate,
                    REALTY_AGING_UI[r.aging].short,
                    formatCents(r.balanceCents, r.currency),
                  ])}
                empty="No hay un solo peso vencido."
              />
              {d.rows.length > 40 ? (
                <Text style={s.sectionNote}>
                  Se imprimen los 40 más atrasados de {d.rows.length}. La lista completa
                  está en la hoja de cálculo.
                </Text>
              ) : null}
            </View>
          </Section>
        ) : null}

        {d && d.projection.length > 0 ? (
          <Section
            title="Proyección de cobranza — próximos 3 meses"
            note="Sale de los cargos que YA existen (el contrato los genera al activarse), no de multiplicar la renta por tres: a un contrato que se acaba en dos meses no se le inventa el tercero."
          >
            <Table
              cols={[
                { label: "Periodo", w: 3 },
                { label: "Cargos", w: 1.4, num: true },
                { label: "Esperado", w: 2, num: true },
              ]}
              rows={d.projection.map((p) => [
                monthLabel(p.periodMonth),
                p.charges,
                moneyText(p.expected),
              ])}
            />
          </Section>
        ) : null}

        {c ? (
          <Section
            title="Comisiones devengadas y pagadas"
            note="Devengado se ancla a la fecha de CIERRE de la operación; lo pagado, a la fecha de pago. Son dos preguntas distintas: cuánto se ganó y cuánto salió de caja."
          >
            <View style={s.kpis}>
              <View style={s.kpi}>
                <Text style={s.kpiLabel}>Operaciones</Text>
                <Text style={s.kpiValue}>{c.closedDeals}</Text>
              </View>
              <View style={s.kpi}>
                <Text style={s.kpiLabel}>Volumen cerrado</Text>
                <Text style={s.kpiValue}>{moneyText(c.closedVolume)}</Text>
              </View>
              <View style={s.kpi}>
                <Text style={s.kpiLabel}>Comisión de la casa</Text>
                <Text style={s.kpiValue}>{moneyText(c.houseCommission)}</Text>
              </View>
              <View style={s.kpi}>
                <Text style={s.kpiLabel}>Salió de caja</Text>
                <Text style={s.kpiValue}>{moneyText(c.paidInPeriod)}</Text>
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <Table
                cols={[
                  { label: "Beneficiario", w: 3 },
                  { label: "Operaciones", w: 1.4, num: true },
                  { label: "Devengado", w: 1.6, num: true },
                  { label: "Pagado", w: 1.6, num: true },
                  { label: "Pendiente", w: 1.6, num: true },
                  { label: "En proceso", w: 1.6, num: true },
                ]}
                rows={c.receipt.lines.map((l) => [
                  l.beneficiary,
                  l.operations,
                  l.earned.toFixed(2),
                  l.paid.toFixed(2),
                  l.pending.toFixed(2),
                  l.inProgress.toFixed(2),
                ])}
                footer={[
                  "TOTAL",
                  c.receipt.operations,
                  c.receipt.totalEarned.toFixed(2),
                  c.receipt.totalPaid.toFixed(2),
                  c.receipt.totalPending.toFixed(2),
                  c.receipt.totalInProgress.toFixed(2),
                ]}
                empty="No hubo comisiones devengadas en el periodo."
              />
            </View>
            {c.mixedCurrency ? (
              <Text style={s.warn}>
                Hay operaciones en pesos y en dólares. La tabla de beneficiarios NO las
                separa: sus columnas suman las dos monedas. Los cuatro recuadros de
                arriba sí las separan, y son los buenos.
              </Text>
            ) : null}
          </Section>
        ) : null}

        <Foot
          brand={brand}
          leyenda={`Generado el ${fecha(report.generatedAt)} por ${brand.name}.`}
        />
      </Page>
    </Document>
  );
}
