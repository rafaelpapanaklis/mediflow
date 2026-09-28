/**
 * ARITMÉTICA DEL DINERO de Caja y Finanzas — hallazgos 12 y 18 (WS1-T6).
 *
 * Run: npm run test:caja-dinero
 *
 * La auditoría encontró CERO pruebas sobre los números con los que la clínica
 * cuadra el cajón y el dueño decide la nómina. Por eso nada de esto saltó antes.
 * Cada test de aquí abajo es el caso concreto de un hallazgo, con los importes
 * del reporte:
 *
 *  · 12   Finanzas nunca restaba los reembolsos → netRevenueSeries.
 *  · 18a  expectedCash nunca resta lo devuelto  → expectedCashOf.
 *  · 18b  el arqueo impreso se contradecía      → buildCloseSummary.
 *  · 18c  la apertura sugería efectivo anulado  → cashOnHandPaymentWhere.
 *  · 18d  "Descuentos" mezclaba dos poblaciones → invoiceDiscountPortion.
 *  · H21a «Vencido» contaba entera una factura a plazos → computeOverdueAmount.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCloseSummary,
  cashOnHandPaymentWhere,
  computeOverdueAmount,
  computeReceivables,
  whereFacturasVencidas,
  deriveWindow,
  expectedCashOf,
  invoiceDiscountPortion,
  money,
  netRevenueSeries,
  overdueInstallmentsOf,
  overdueOfInvoice,
  paymentDiscountPortion,
  type FacturaPorCobrarParaVencido,
} from "../caja";
import { bucketKeyOf } from "../analytics/query";
import { condicionesPorDefecto, type CondicionesPago } from "../quotes/condiciones-pago";

/** El MISMO bucketing que usa /api/finanzas: día natural de México, no UTC. */
const dayKey = (d: Date) => bucketKeyOf(d, "day");

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 12 — Finanzas nunca resta los reembolsos
// ─────────────────────────────────────────────────────────────────────────
test("12 · un cobro reembolsado por completo deja el periodo en $0, no en $10,000", () => {
  const cobros   = [{ amount: 10_000, paidAt: new Date("2026-01-05T18:00:00Z") }];
  const devueltos = [{ amount: 10_000, paidAt: new Date("2026-01-20T18:00:00Z") }];

  const neto = netRevenueSeries(cobros, devueltos, dayKey);

  // El número con el que se pagan comisiones y se decide la nómina.
  assert.equal(neto.ingresos, 0, "ingresos del mes");
  assert.equal(neto.reembolsos, 10_000, "lo devuelto se reporta aparte");
  // Y la serie diaria cuenta la misma historia que el KPI: sube el 5, baja el 20.
  assert.equal(neto.porBucket["2026-01-05"], 10_000);
  assert.equal(neto.porBucket["2026-01-20"], -10_000);
});

test("12 · la suma de la serie diaria es SIEMPRE el KPI (misma población)", () => {
  const cobros = [
    { amount: 3_000, paidAt: new Date("2026-01-05T18:00:00Z") },
    { amount: 1_250.5, paidAt: new Date("2026-01-05T20:00:00Z") },
    { amount: 900, paidAt: new Date("2026-01-11T16:00:00Z") },
  ];
  const devueltos = [{ amount: 1_200, paidAt: new Date("2026-01-11T19:00:00Z") }];

  const neto = netRevenueSeries(cobros, devueltos, dayKey);
  // Se suma EXACTAMENTE lo que sale en el JSON: money() por punto de la serie
  // (finanzas/route.ts) y las claves de bucket de México, no las de UTC.
  const sumaSerie = Object.values(neto.porBucket).reduce((a, b) => a + money(b), 0);

  assert.equal(neto.ingresos, 3_950.5, "KPI de ingresos");
  assert.equal(money(sumaSerie), neto.ingresos, "la gráfica suma lo que dice la tarjeta");
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18a — el faltante fantasma del corte
// ─────────────────────────────────────────────────────────────────────────
test("18a · la fórmula ya sabe restar lo devuelto en efectivo (falta el dato, no la fórmula)", () => {
  const turno = { openingBalance: 0, cashIncome: 3_000, withdrawals: 0 };

  // ⚠️ Esto NO demuestra que el faltante fantasma esté cerrado en producción:
  // hoy `cashRefunds` vale 0 SIEMPRE porque el reembolso no guarda con qué
  // método salió el dinero (sql/payment-refund-method.sql). Sin ese dato, el
  // corte sigue reclamando los $3,000 que ya no están en el cajón:
  assert.equal(expectedCashOf(turno), 3_000, "comportamiento de HOY, sin el dato");

  // Lo que sí queda demostrado es que la fórmula —ahora una sola, compartida
  // por la pantalla y el cierre— resta bien en cuanto le llegue el dato.
  assert.equal(expectedCashOf({ ...turno, cashRefunds: 3_000 }), 0);
});

test("18a · la fórmula del esperado es UNA sola: apertura + efectivo − retiros − devuelto", () => {
  assert.equal(
    expectedCashOf({ openingBalance: 1_500, cashIncome: 4_320.75, withdrawals: 800, cashRefunds: 320.75 }),
    4_700,
  );
  // Sin reembolsos identificados el resultado es idéntico al de siempre.
  assert.equal(expectedCashOf({ openingBalance: 1_500, cashIncome: 4_320.75, withdrawals: 800 }), 5_020.75);
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18b — el arqueo impreso no puede contradecirse a sí mismo
// ─────────────────────────────────────────────────────────────────────────
/** Ventana derivada de un turno, con el mismo contrato que deriveWindow. */
function derivadoFalso(over: Partial<Awaited<ReturnType<typeof deriveWindow>>> = {}) {
  const base: Awaited<ReturnType<typeof deriveWindow>> = {
    cashIncome: 0, cardDebitIncome: 0, cardCreditIncome: 0, otherIncome: 0,
    totalIncome: 0, refunds: 0, cashRefunds: 0, discounts: 0, tax: 0, list: [],
  };
  return { ...base, ...over };
}

test("18b · el resumen del cierre se imprime con el pago que entró entre el render y el clic", () => {
  // La pantalla se pintó en el SSR con $5,000 de efectivo. Entre el render y el
  // clic entra un pago de $700 en efectivo: el servidor lo ve, la pantalla no.
  const pago700 = {
    paymentId: "p700", at: "2026-01-20T21:59:00.000Z", patientName: "Ana Ruiz",
    concept: "Limpieza", amount: 700, method: "cash", discount: 0, doctorName: "—",
  };
  const fresco = derivadoFalso({
    cashIncome: 5_700, totalIncome: 5_700, list: [pago700],
  });

  const s = buildCloseSummary({
    openedAt:       new Date("2026-01-20T15:00:00Z"),
    closedAt:       new Date("2026-01-20T22:00:00Z"),
    openingBalance: 0,
    withdrawals:    0,
    counted:        5_000,
    derived:        fresco,
  });

  // El papel cuadra CONSIGO MISMO: apertura + efectivo − retiros = esperado.
  assert.equal(s.expectedCash, 5_700, "esperado fresco, no el del render");
  assert.equal(s.cashIncome, 5_700, "el efectivo impreso es el mismo del esperado");
  assert.equal(s.openingBalance + s.cashIncome - s.withdrawals, s.expectedCash);
  assert.equal(s.variance, -700, "la diferencia sale del mismo cálculo");
  // Y el pago que la causa SÍ está en la tabla impresa.
  assert.equal(s.list.length, 1);
  assert.equal(s.list[0].paymentId, "p700");
});

test("18b · el resumen desglosa la tarjeta aparte de 'otros', como la pantalla", () => {
  // deriveWindow devuelve otherIncome CON tarjeta; el arqueo la lista aparte.
  const s = buildCloseSummary({
    openedAt: new Date("2026-01-20T15:00:00Z"),
    closedAt: new Date("2026-01-20T22:00:00Z"),
    openingBalance: 100, withdrawals: 50, counted: 1_050,
    derived: derivadoFalso({
      cashIncome: 1_000, cardDebitIncome: 400, cardCreditIncome: 250,
      otherIncome: 800, totalIncome: 1_800, refunds: 90,
    }),
  });

  assert.equal(s.otherIncome, 150, "800 − 400 débito − 250 crédito");
  assert.equal(s.expectedCash, 1_050);
  assert.equal(s.variance, 0);
  assert.equal(s.refunds, 90, "los reembolsos del turno se imprimen");
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18c — la apertura sugerida no prefija efectivo que no está
// ─────────────────────────────────────────────────────────────────────────
test("18c · el efectivo sugerido para abrir excluye las facturas CANCELADAS", () => {
  const from = new Date("2026-01-20T06:00:00Z");
  const to   = new Date("2026-01-20T18:00:00Z");
  const w: any = cashOnHandPaymentWhere("clinic-1", from, to);

  assert.equal(w.method, "cash", "solo efectivo: lo demás no está en el cajón");
  assert.equal(w.invoice.clinicId, "clinic-1", "aislado por tenant, siempre");
  assert.deepEqual(
    w.invoice.status,
    { notIn: ["CANCELLED"] },
    "una factura anulada no deja billetes en el cajón",
  );
  assert.equal(w.paidAt.gte, from);
  assert.equal(w.paidAt.lte, to);
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18d — "Descuentos" y "Ingresos" hablan de lo mismo
// ─────────────────────────────────────────────────────────────────────────
test("18d · el descuento no cobrado NO se imprime junto a los ingresos del turno", () => {
  // La factura del hallazgo: emitida en el turno con $20,000 de descuento. Hasta
  // que no se cobre, no aporta nada al corte — el turno solo habla del dinero
  // que entró. (Una factura sin cobrar no produce ninguna fila de Payment, así
  // que el corte ni siquiera la ve; el prorrateo es lo que impide que vuelva a
  // colarse por la puerta de "facturas creadas en la ventana".)
  const factura = { discount: 20_000, total: 2_000 };
  assert.equal(invoiceDiscountPortion(0, factura), 0);

  // Y cuando entra un abono, entra SU parte y no el descuento entero.
  assert.equal(invoiceDiscountPortion(200, factura), 2_000, "10 % cobrado → 10 % del descuento");
});

test("18d · cobrar, reembolsar y volver a cobrar NO duplica el descuento", () => {
  // Caso real de recepción: se cobra con el método equivocado, se reembolsa y se
  // vuelve a cobrar con el correcto. /refund devuelve el balance a la factura,
  // así que la suma de pagos SUPERA el total y el clamp por pago no lo impide:
  // sin el signo del reembolso, el corte imprimía $1,000 de descuento sobre una
  // factura cuyo descuento es $500.
  const factura = { discount: 500, total: 2_000 };
  const movimientos = [
    { method: "cash",   amount: 2_000 },
    { method: "refund", amount: 2_000 },
    { method: "debit",  amount: 2_000 },
  ];

  const total = movimientos.reduce(
    (sum, m) => sum + paymentDiscountPortion(m.method, m.amount, factura),
    0,
  );
  assert.equal(money(total), 500, "el descuento de la factura, una sola vez");

  // Y un reembolso parcial revierte su parte: cobrado $2,000, devuelto $1,000 →
  // el turno se queda con el descuento de los $1,000 que sí entraron.
  const parcial =
    paymentDiscountPortion("cash", 2_000, factura) +
    paymentDiscountPortion("refund", 1_000, factura);
  assert.equal(money(parcial), 250);
});

test("18d · el descuento viaja con el cobro y se prorratea en los abonos", () => {
  const factura = { discount: 20_000, total: 2_000 };

  // Cobrada completa en el turno: el descuento entero es de este turno.
  assert.equal(invoiceDiscountPortion(2_000, factura), 20_000);

  // Dos abonos: cada turno se lleva su parte y entre los dos suman el descuento.
  const abono1 = invoiceDiscountPortion(500, factura);
  const abono2 = invoiceDiscountPortion(1_500, factura);
  assert.equal(abono1, 5_000);
  assert.equal(abono2, 15_000);
  assert.equal(abono1 + abono2, factura.discount);

  // Sin descuento, sin total o con total 0 no hay nada que prorratear.
  assert.equal(invoiceDiscountPortion(1_000, { discount: 0, total: 2_000 }), 0);
  assert.equal(invoiceDiscountPortion(1_000, { discount: 500, total: 0 }), 0);
  assert.equal(invoiceDiscountPortion(1_000, null), 0);
  // Un sobrepago no reparte más descuento del que la factura tiene.
  assert.equal(invoiceDiscountPortion(9_999, factura), 20_000);
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO H21a (ws1-t2, ronda 4) — «Vencido» de Caja contaba ENTERA una
// factura a plazos (`Invoice.balance`) en cuanto su `dueDate` —un campo de
// texto libre que la recepcionista llena a mano y que guardar las
// condiciones NUNCA toca— caía en el pasado. Debe contar SOLO lo que sus
// cuotas vencidas de verdad suman (estadoDelPlan.importeVencido).
// ─────────────────────────────────────────────────────────────────────────
const HOY = "2026-02-10";

/** `n` mensualidades desde el 3 de enero de 2026 (vence 3-ene, 3-feb, 3-mar…). */
const plazosMensual = (numPagos: number, over: Partial<CondicionesPago> = {}): CondicionesPago => ({
  ...condicionesPorDefecto(), modo: "plazos", numPagos, primerPago: "2026-01-03", ...over,
});
/** 2 mensualidades de $2,000 (total $4,000): vence 3-ene, 3-feb. */
const plazosDosMil2 = (over: Partial<CondicionesPago> = {}) => plazosMensual(2, over);

test("H21a · factura a plazos con 2 cuotas vencidas y NADA pagado: vencido = las 2 cuotas completas", () => {
  // Las dos ya vencieron para el 10 de febrero (3-ene y 3-feb).
  const vencido = overdueInstallmentsOf({ total: 4_000, condiciones: plazosDosMil2(), cobros: [] }, HOY);
  assert.equal(vencido, 4_000, "ninguna cuota se pagó: las dos cuentan completas");
});

test("H21a · factura a plazos con una cuota vencida abonada parcial y la otra AÚN sin vencer: solo cuenta lo que falta de la vencida", () => {
  // hoy = 20 de enero: la del 3-ene ya venció, la del 3-feb todavía no.
  const condiciones = plazosDosMil2();
  const abono500 = [{ amount: 500 }]; // abona $500 de los $2,000 de la cuota vencida
  const vencido = overdueInstallmentsOf({ total: 4_000, condiciones, cobros: abono500 }, "2026-01-20");
  assert.equal(vencido, 1_500, "$2,000 de la cuota vencida menos los $500 ya abonados; la que no vence no entra");
});

test("H21a · computeOverdueAmount: factura normal vencida + a plazos con cuotas vencidas, SIN contar el balance completo de la de plazos", () => {
  const normalVencida: FacturaPorCobrarParaVencido = {
    id: "n1", balance: 5_000, dueDate: new Date("2026-01-01T00:00:00Z"), total: 5_000,
    condiciones: null, cobros: [],
  };
  // La de plazos: 4 mensualidades de $2,000 (Jan3, Feb3, Mar3, Abr3) — para el
  // 10 de febrero solo vencieron 2 ($4,000), y NADA se ha pagado. Su `balance`
  // real es de $8,000 (le quedan las 4 completas) y su `dueDate` es NULO — la
  // recepción nunca lo llenó. El criterio viejo, que miraba dueDate/balance,
  // habría dado 0 aquí (sin dueDate, "nunca vence") o $8,000 si alguien hubiera
  // puesto un dueDate viejo por error; ninguna de las dos es correcta.
  const aPlazos: FacturaPorCobrarParaVencido = {
    id: "p1", balance: 8_000, dueDate: null, total: 8_000,
    condiciones: plazosMensual(4), cobros: [],
  };
  const todayStart = new Date("2026-02-10T06:00:00Z");
  const total = computeOverdueAmount([normalVencida, aPlazos], todayStart, HOY);
  assert.equal(total, 5_000 + 4_000, "5,000 de la normal + SOLO las 2 mensualidades ya vencidas de la de plazos (nunca sus $8,000)");
});

test("H21a · una factura a plazos AL CORRIENTE no aporta nada, aunque su dueDate esté vencido", () => {
  // dueDate vencido a propósito: demuestra que en una factura a plazos esa
  // columna NUNCA decide — solo lo hacen sus cuotas.
  const alCorriente: FacturaPorCobrarParaVencido = {
    id: "p2", balance: 8_000, dueDate: new Date("2026-01-01T00:00:00Z"), total: 4_000,
    condiciones: plazosDosMil2(), cobros: [{ amount: 4_000 }], // las 2 cuotas, pagadas
  };
  const todayStart = new Date("2026-02-10T06:00:00Z");
  assert.equal(computeOverdueAmount([alCorriente], todayStart, HOY), 0);
});

test("H21a · SIN facturas a plazos, computeOverdueAmount da EXACTAMENTE lo de siempre (dueDate < hoy, balance completo)", () => {
  const facturas: FacturaPorCobrarParaVencido[] = [
    { id: "a", balance: 1_000, dueDate: new Date("2026-01-01T00:00:00Z"), total: 1_000, condiciones: null, cobros: [] }, // vencida
    { id: "b", balance: 2_500, dueDate: new Date("2026-03-01T00:00:00Z"), total: 2_500, condiciones: undefined, cobros: [] }, // futura: no cuenta
    { id: "c", balance: 700, dueDate: null, total: 700, condiciones: null, cobros: [] }, // sin dueDate: nunca vence
  ];
  const todayStart = new Date("2026-02-10T06:00:00Z");
  // Es la MISMA cuenta que hacía overdueInvoiceWhere + aggregate antes de H21a:
  // solo la (a) tiene dueDate < hoy. La clínica sin plan a plazos no ve cambiar
  // su «Vencido» ni un peso.
  assert.equal(computeOverdueAmount(facturas, todayStart, HOY), 1_000);
});

// ─────────────────────────────────────────────────────────────────────────
// FILA 87 de la revisión de lógica de uso (ws1-t5, ronda 6) — «Vencido» y
// «Por cobrar» daban cifras distintas en Caja → Caja, Caja → Facturas y
// Finanzas. Ahora las tres leen `computeReceivables`.
// ─────────────────────────────────────────────────────────────────────────

test("fila 87 · un cargo de control de ortodoncia sin dueDate vence al día siguiente de su fecha, como en Cobranza", () => {
  const todayStart = new Date("2026-02-10T06:00:00Z");
  const control = (vencimientoControl: string): FacturaPorCobrarParaVencido => ({
    id: "c1", balance: 800, dueDate: null, total: 800, condiciones: null, cobros: [], vencimientoControl,
  });
  assert.equal(overdueOfInvoice(control("2026-02-09"), todayStart, HOY), 800, "ayer: ya venció");
  assert.equal(overdueOfInvoice(control("2026-02-10"), todayStart, HOY), 0, "hoy: todavía no");
  assert.equal(overdueOfInvoice(control("2026-02-11"), todayStart, HOY), 0, "mañana: no");
});

test("fila 87 · una factura normal sin dueDate sigue sin vencer jamás: el cargo de control no cambia a las demás", () => {
  const todayStart = new Date("2026-02-10T06:00:00Z");
  const normal: FacturaPorCobrarParaVencido = { id: "n", balance: 700, dueDate: null, total: 700, condiciones: null, cobros: [] };
  assert.equal(overdueOfInvoice(normal, todayStart, HOY), 0);
  assert.equal(overdueOfInvoice({ ...normal, vencimientoControl: null }, todayStart, HOY), 0);
});

/** Una base de mentira con lo justo que lee `computeReceivables`. */
function baseDeSaldos(opts: {
  facturas: Array<{ id: string; clinicId: string; status: string; balance: number; total: number; dueDate: Date | null; patientId?: string; payments?: Array<{ amount: number; method: string }> }>;
  condiciones?: Array<Record<string, unknown>>;
  timezone?: string;
}) {
  const consultas: Array<{ where: any }> = [];
  const db = {
    invoice: {
      findMany: async ({ where, select, orderBy, take }: any) => {
        consultas.push({ where });
        // `AND`: el cursor de las tandas (`id > …`) y el filtro extra (aquí, por `patientId`).
        const y: any[] = where.AND ?? [];
        let filas = opts.facturas
          .filter((f) => f.clinicId === where.clinicId)
          .filter((f) => (where.status?.notIn ? !where.status.notIn.includes(f.status) : true))
          .filter((f) => (where.balance?.gt !== undefined ? f.balance > where.balance.gt : true))
          .filter((f) => (where.id?.in ? where.id.in.includes(f.id) : true))
          .filter((f) => y.every((c) => (c.id?.gt !== undefined ? f.id > c.id.gt : c.patientId !== undefined ? f.patientId === c.patientId : true)));
        if (orderBy?.id === "asc") filas = [...filas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (typeof take === "number") filas = filas.slice(0, take);
        return filas.map((f) => (select?.payments ? { id: f.id, payments: f.payments ?? [] } : { id: f.id, balance: f.balance, total: f.total, dueDate: f.dueDate }));
      },
      aggregate: async () => ({ _sum: {} }),
    },
    clinic: { findUnique: async () => ({ timezone: opts.timezone ?? "America/Mexico_City" }) },
    // leerCondicionesDeFacturas: primero sondea la tabla, luego lee las filas.
    $queryRaw: async (cadenas: TemplateStringsArray) => {
      const texto = cadenas.join("?");
      if (/to_regclass|information_schema/.test(texto)) return [{ existe: true, reg: "invoice_payment_terms" }];
      return opts.condiciones ?? [];
    },
  };
  return { db: db as any, consultas };
}

test("fila 87 · computeReceivables: por cobrar = TODO lo que falta; vencido = lo que ya pasó de fecha, por cuota en las de plazos", async () => {
  const { db, consultas } = baseDeSaldos({
    facturas: [
      // De un pago, vencida: cuenta entera en los dos.
      { id: "n1", clinicId: "cl-1", status: "PENDING", balance: 5_000, total: 5_000, dueDate: new Date("2026-01-01T06:00:00Z") },
      // De un pago, aún no vence: solo por cobrar.
      { id: "n2", clinicId: "cl-1", status: "PARTIAL", balance: 1_200, total: 2_000, dueDate: new Date("2026-03-01T06:00:00Z") },
      // Cargo de control de ortodoncia, sin dueDate, de ayer: vencido.
      { id: "c1", clinicId: "cl-1", status: "PENDING", balance: 800, total: 800, dueDate: null },
      // Borrador y cancelada: no existen para los saldos.
      { id: "b1", clinicId: "cl-1", status: "DRAFT", balance: 9_000, total: 9_000, dueDate: new Date("2026-01-01T06:00:00Z") },
      { id: "x1", clinicId: "cl-1", status: "CANCELLED", balance: 9_000, total: 9_000, dueDate: new Date("2026-01-01T06:00:00Z") },
      // De otra clínica: jamás.
      { id: "o1", clinicId: "cl-2", status: "PENDING", balance: 77_000, total: 77_000, dueDate: new Date("2026-01-01T06:00:00Z") },
    ],
  });
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map([["c1", "2026-02-09"]]));
  assert.equal(saldos.porCobrar, 5_000 + 1_200 + 800);
  assert.equal(saldos.vencido, 5_000 + 800);
  assert.deepEqual(saldos.vencidoPorFactura, { n1: 5_000, c1: 800 });
  assert.ok(consultas.every((c) => c.where.clinicId === "cl-1"), "toda lectura de facturas lleva el clinicId de quien pregunta");
});

test("fila 87 · computeReceivables: «hoy» es el día de la clínica, no el de UTC", async () => {
  // 10-feb 02:00 UTC = 9-feb 20:00 en México: una factura que vence el 9 NO está vencida todavía.
  const { db } = baseDeSaldos({
    facturas: [{ id: "n1", clinicId: "cl-1", status: "PENDING", balance: 300, total: 300, dueDate: new Date("2026-02-09T06:00:00Z") }],
  });
  const noche = await computeReceivables("cl-1", new Date("2026-02-10T02:00:00Z"), db, async () => new Map());
  assert.equal(noche.vencido, 0);
  const manana = await computeReceivables("cl-1", new Date("2026-02-10T07:00:00Z"), db, async () => new Map());
  assert.equal(manana.vencido, 300);
});

test("fila 87 · computeReceivables: sin clínica no consulta nada, y si falla la lectura de controles no tumba el saldo", async () => {
  const { db, consultas } = baseDeSaldos({
    facturas: [{ id: "n1", clinicId: "cl-1", status: "PENDING", balance: 300, total: 300, dueDate: new Date("2026-01-09T06:00:00Z") }],
  });
  assert.deepEqual(await computeReceivables("", new Date(), db), { porCobrar: 0, vencido: 0, vencidoPorFactura: {}, incompleto: false });
  assert.equal(consultas.length, 0);
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => { throw new Error("sin columna"); });
  assert.equal(saldos.vencido, 300);
});

// ─────────────────────────────────────────────────────────────────────────
// Topes silenciosos (ws1-t5): `computeReceivables` tenía `take: 5000` y
// cortaba sin avisar. Ahora lee en tandas por cursor de `id` y, solo si toca su
// techo, lo dice con `incompleto: true`.
// ─────────────────────────────────────────────────────────────────────────

/** `n` facturas de un pago, vencidas, de $100 cada una, con ids ordenables. */
function muchasFacturas(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${String(i).padStart(5, "0")}`, clinicId: "cl-1", status: "PENDING", balance: 100, total: 100,
    dueDate: new Date("2026-01-01T06:00:00Z"),
  }));
}

test("topes · computeReceivables lee TODAS las facturas en tandas: nada se queda fuera por un take", async () => {
  const { db, consultas } = baseDeSaldos({ facturas: muchasFacturas(7) });
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map(), { pagina: 3 });
  assert.equal(saldos.porCobrar, 700, "las 7, no las 3 de la primera tanda");
  assert.equal(saldos.vencido, 700);
  assert.equal(Object.keys(saldos.vencidoPorFactura).length, 7);
  assert.equal(saldos.incompleto, false);
  const tandas = consultas.filter((c) => c.where.status?.notIn);
  assert.equal(tandas.length, 3, "3 + 3 + 1");
  assert.ok(consultas.every((c) => c.where.clinicId === "cl-1"), "cada tanda lleva el clinicId");
});

test("topes · tanda exacta: si la última viene llena, se pide una más (vacía) y no se marca incompleto", async () => {
  const { db, consultas } = baseDeSaldos({ facturas: muchasFacturas(6) });
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map(), { pagina: 3 });
  assert.equal(saldos.porCobrar, 600);
  assert.equal(saldos.incompleto, false);
  assert.equal(consultas.filter((c) => c.where.status?.notIn).length, 3);
});

test("topes · pasado el techo de tandas, la cifra es un mínimo y lo DICE (incompleto: true)", async () => {
  const { db } = baseDeSaldos({ facturas: muchasFacturas(10) });
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map(), { pagina: 3, maxPaginas: 2 });
  assert.equal(saldos.porCobrar, 600, "solo 2 tandas de 3");
  assert.equal(saldos.incompleto, true);
});

test("fila 87 · computeReceivables con filtro extra (Sabina): estrecha, no ensancha, y sigue en la clínica", async () => {
  const { db, consultas } = baseDeSaldos({
    facturas: [
      { id: "a", clinicId: "cl-1", status: "PENDING", balance: 500, total: 500, dueDate: new Date("2026-01-01T06:00:00Z"), patientId: "p1" },
      { id: "b", clinicId: "cl-1", status: "PENDING", balance: 900, total: 900, dueDate: new Date("2026-01-01T06:00:00Z"), patientId: "p2" },
      { id: "c", clinicId: "cl-2", status: "PENDING", balance: 700, total: 700, dueDate: new Date("2026-01-01T06:00:00Z"), patientId: "p1" },
    ],
  });
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map(), {
    filtro: { patientId: "p1" }, timezone: "America/Mexico_City",
  });
  assert.equal(saldos.porCobrar, 500);
  assert.deepEqual(saldos.vencidoPorFactura, { a: 500 });
  assert.ok(consultas.every((c) => c.where.clinicId === "cl-1"));
});

test("fila 87 · la píldora «Vencida» de Facturas es la de computeReceivables: plan a plazos al corriente con dueDate pasada NO está vencido; con una cuota atrasada, SÍ", async () => {
  const todayStart = new Date("2026-02-10T06:00:00Z");
  // 4 mensualidades de $1,000 (3-ene, 3-feb, 3-mar, 3-abr), con una `dueDate` de enero.
  const condiciones = plazosMensual(4);
  const base = { id: "p", balance: 3_000, dueDate: new Date("2026-01-01T06:00:00Z"), total: 4_000, condiciones };
  // Enero pagado; febrero venció el 3 → atrasado el 10.
  const conAtraso = overdueOfInvoice({ ...base, cobros: [{ amount: 1_000, method: "cash" }] }, todayStart, HOY);
  assert.ok(conAtraso > 0 && conAtraso < 3_000, "solo la cuota, no el saldo entero");
  // Enero y febrero pagados: al corriente aunque `dueDate` ya pasó.
  const alCorriente = overdueOfInvoice({ ...base, balance: 2_000, cobros: [{ amount: 2_000, method: "cash" }] }, todayStart, HOY);
  assert.equal(alCorriente, 0);
});

test("filtro «Vencidas» de /api/invoices: sale del mapa de computeReceivables, con el clinicId, y sin vencidas no hay where", async () => {
  assert.equal(whereFacturasVencidas("cl-1", { vencidoPorFactura: {} }), null, "ninguna vencida: no se consulta");
  assert.equal(whereFacturasVencidas("", { vencidoPorFactura: { a: 5 } }), null, "sin clínica: jamás un where sin tenant");
  assert.deepEqual(whereFacturasVencidas("cl-1", { vencidoPorFactura: { a: 500, b: 0, c: 12.5 } }), { clinicId: "cl-1", id: { in: ["a", "c"] } });
  // Y es la MISMA población que el KPI: de punta a punta con la base de mentira.
  const { db } = baseDeSaldos({
    facturas: [
      { id: "n1", clinicId: "cl-1", status: "PENDING", balance: 5_000, total: 5_000, dueDate: new Date("2026-01-01T06:00:00Z") },
      { id: "n2", clinicId: "cl-1", status: "PENDING", balance: 1_200, total: 1_200, dueDate: new Date("2026-03-01T06:00:00Z") },
      { id: "c1", clinicId: "cl-1", status: "PENDING", balance: 800, total: 800, dueDate: null },
    ],
  });
  const saldos = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map([["c1", "2026-02-09"]]));
  assert.deepEqual(whereFacturasVencidas("cl-1", saldos), { clinicId: "cl-1", id: { in: ["c1", "n1"] } });
});
