/**
 * DINERO INTERNO: anticipos, traspasos a saldo a favor y reembolsos en el
 * corte de caja (ws1-t5, F2 · F3 · F5 de la auditoría del dinero, 3-oct-2026).
 *
 * Run: npm run test:dinero-cobro-caja
 *
 * Cada prueba es un caso con los números del reporte. Con el código de antes:
 *  · F3: el excedente de $700 que pasa a saldo a favor salía como «Reembolsos −$700».
 *  · F2: el anticipo de $500 cobrado el 28-sep no aparecía ese día y sumaba
 *        $500 de «ingresos» el 3-oct, cuando se aplicaba sin que entrara dinero.
 *  · F5: el corte no restaba un reembolso en efectivo (faltante fantasma).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anticipoCobradoCreditWhere,
  buildCloseSummary,
  computeSuggestedOpening,
  deriveWindow,
  refundPaymentWhere,
  revenuePaymentWhere,
  type CajaDb,
} from "../caja";
import { esReembolsoReal, esTraspasoASaldoAFavor } from "../dinero/reembolsos";

type Pago = { id: string; invoiceId: string; amount: number; method: string; refundMethod?: string | null; paidAt: Date };
type Credito = { id: string; amount: number; source: string; creditDate: Date };

const FACTURA = {
  items: [{ description: "Ortodoncia" }], discount: 0, total: 10_000, taxRate: 0, taxIncluded: true, doctorId: null,
  patient: { firstName: "Ana", lastName: "Prueba", visibleUserIds: [] }, appointment: null,
};

/**
 * Doble de la base: las lecturas filtran por la ventana de fechas (lo único
 * que cambia entre las pruebas) y por las reglas de `anticipoCobradoCreditWhere`.
 */
function base(pagos: Pago[], creditos: Credito[] = []): CajaDb {
  const enVentana = (d: Date, w: any) => (!w?.gte || d >= w.gte) && (!w?.lte || d <= w.lte);
  // `method` como Prisma: texto exacto o `{ in }` (el efectivo y sus alias, QA de
  // Rafael #2). Antes el doble solo entendía texto y con `{ in }` dejaba pasar
  // el reembolso como si fuera un cobro en efectivo.
  const metodoCumple = (m: string, f: any) =>
    typeof f === "string" ? m === f : Array.isArray(f?.in) ? f.in.includes(m) : true;
  return ({
    // Las condiciones de pago (facturas a plazos) se leen con SQL crudo: aquí no hay ninguna.
    $queryRaw: async () => [],
    payment: {
      findMany: (async (args: any) => {
        const w = args?.where ?? {};
        return pagos
          .filter((p) => enVentana(p.paidAt, w.paidAt))
          .filter((p) => (w.refundMethod ? p.method === "refund" && p.refundMethod === w.refundMethod : true))
          .filter((p) => metodoCumple(p.method, w.method))
          .map((p) => ({ ...p, invoice: FACTURA }));
      }) as any,
    },
    invoice: {
      aggregate: (async () => ({ _sum: { discount: 0 } })) as any,
      findMany: (async () => []) as any,
    },
    clinic: { findUnique: (async () => ({ cfdiTaxMode: "exempt", timezone: "America/Mexico_City" })) as any },
    user: { findMany: (async () => []) as any },
    cashRegister: { findFirst: (async () => null) as any, findMany: (async () => []) as any },
    patientCredit: {
      findMany: (async (args: any) => {
        const w = args?.where ?? {};
        return creditos
          .filter((c) => enVentana(c.creditDate, w.creditDate))
          .filter((c) => (w.source?.in ? w.source.in.includes(c.source) : true))
          .filter((c) => c.amount > 0)
          .map((c) => ({ ...c, patient: FACTURA.patient }));
      }) as any,
    },
  }) as unknown as CajaDb;
}

const dia = (iso: string) => ({ from: new Date(`${iso}T06:00:00Z`), to: new Date(`${iso}T23:59:59Z`) });

// ── F3 ────────────────────────────────────────────────────────────────────
test("F3 · cobro de $3,000 en efectivo con $700 de excedente a saldo a favor: ingresos $3,000 y reembolsos $0", async () => {
  const at = new Date("2026-10-03T17:00:00Z");
  const db = base([
    { id: "p1", invoiceId: "f1", amount: 2_300, method: "cash", paidAt: at },
    { id: "p2", invoiceId: "f1", amount: 700, method: "cash", paidAt: at },
    { id: "p3", invoiceId: "f1", amount: 700, method: "refund", refundMethod: "saldo_a_favor", paidAt: at },
  ]);
  const { from, to } = dia("2026-10-03");
  const w = await deriveWindow("c1", from, to, { db });
  assert.equal(w.cashIncome, 3_000, "el efectivo que entró al cajón");
  assert.equal(w.totalIncome, 3_000);
  assert.equal(w.refunds, 0, "antes: «Reembolsos −$700» sin que saliera dinero");
  assert.equal(w.toCredit, 700, "se muestra aparte: pasó a saldo a favor");
  assert.equal(w.cashRefunds, 0, "el traspaso no baja el efectivo esperado");
});

test("F3 · Finanzas: refundPaymentWhere ya no cuenta el traspaso, y sí los reembolsos viejos (NULL) y los reales", () => {
  const w: any = refundPaymentWhere("c1", { gte: new Date(0) });
  assert.equal(w.method, "refund");
  assert.deepEqual(w.OR, [{ refundMethod: null }, { refundMethod: { not: "saldo_a_favor" } }]);
  assert.equal(w.invoice.clinicId, "c1");
  assert.equal(esTraspasoASaldoAFavor({ method: "refund", refundMethod: "saldo_a_favor" }), true);
  assert.equal(esReembolsoReal({ method: "refund", refundMethod: "saldo_a_favor" }), false);
  assert.equal(esReembolsoReal({ method: "refund", refundMethod: null }), true);
  assert.equal(esReembolsoReal({ method: "refund", refundMethod: "transfer" }), true);
});

// ── F2 ────────────────────────────────────────────────────────────────────
test("F2 · anticipo de $500 por Mercado Pago el 28-sep, aplicado el 3-oct: ingreso el 28-sep, $0 el 3-oct", async () => {
  const db = base(
    [{ id: "a1", invoiceId: "f1", amount: 500, method: "anticipo", paidAt: new Date("2026-10-03T16:00:00Z") }],
    [
      { id: "c1", amount: 500, source: "anticipo_mercadopago", creditDate: new Date("2026-09-28T19:00:00Z") },
      { id: "c2", amount: -500, source: "aplicado_a_factura", creditDate: new Date("2026-10-03T16:00:00Z") },
    ],
  );
  const sep = await deriveWindow("c1", dia("2026-09-28").from, dia("2026-09-28").to, { db });
  assert.equal(sep.totalIncome, 500, "antes: $0 — el dinero entró por MP y nadie lo veía");
  assert.equal(sep.cashIncome, 0, "no es efectivo: no va al cajón");
  assert.ok(sep.list.some((r) => r.paymentId === "credito:c1" && r.amount === 500), "y sale su fila en el corte");

  const oct = await deriveWindow("c1", dia("2026-10-03").from, dia("2026-10-03").to, { db });
  assert.equal(oct.totalIncome, 0, "antes: $500 de ingresos sin que entrara dinero");
  assert.equal(oct.appliedCredit, 500, "se ve aparte: saldo a favor aplicado");
});

test("F2 · un saldo a favor MIGRADO de $1,000 aplicado no suma ingreso nunca", async () => {
  const db = base(
    [{ id: "a1", invoiceId: "f1", amount: 1_000, method: "anticipo", paidAt: new Date("2026-10-03T16:00:00Z") }],
    [{ id: "m1", amount: 1_000, source: "migrated", creditDate: new Date("2026-10-01T16:00:00Z") }],
  );
  for (const d of ["2026-10-01", "2026-10-03"]) {
    const w = await deriveWindow("c1", dia(d).from, dia(d).to, { db });
    assert.equal(w.totalIncome, 0, `ingresos del ${d}`);
  }
});

test("F2 · revenuePaymentWhere deja fuera «anticipo» y anticipoCobradoCreditWhere solo toma dinero que entró", () => {
  const r: any = revenuePaymentWhere("c1", { gte: new Date(0) });
  assert.deepEqual(r.method, { notIn: ["refund", "anticipo"] });
  const c: any = anticipoCobradoCreditWhere("c1", { gte: new Date(0) });
  assert.equal(c.clinicId, "c1");
  assert.deepEqual(c.source.in, ["anticipo_mercadopago", "cobro_automatico_mercadopago"]);
  assert.deepEqual(c.amount, { gt: 0 });
});

// ── F5 ────────────────────────────────────────────────────────────────────
const turno = (refundMethod: string | null) => base([
  { id: "p1", invoiceId: "f1", amount: 3_000, method: "cash", paidAt: new Date("2026-10-03T16:00:00Z") },
  { id: "r1", invoiceId: "f1", amount: 500, method: "refund", refundMethod, paidAt: new Date("2026-10-03T17:00:00Z") },
]);

async function corte(refundMethod: string | null) {
  const { from, to } = dia("2026-10-03");
  const derived = await deriveWindow("c1", from, to, { db: turno(refundMethod) });
  return { derived, s: buildCloseSummary({ openedAt: from, closedAt: to, openingBalance: 1_000, withdrawals: 0, counted: 3_500, derived }) };
}

test("F5 · apertura $1,000 + efectivo $3,000 − reembolso en EFECTIVO $500 = esperado $3,500 (antes $4,000: faltante fantasma)", async () => {
  const { s } = await corte("cash");
  assert.equal(s.expectedCash, 3_500);
  assert.equal(s.variance, 0);
  assert.equal(s.cashRefunds, 500);
  assert.equal(s.refunds, 500);
});

test("F5 · el mismo reembolso devuelto a la tarjeta no toca el cajón: esperado $4,000", async () => {
  const { s } = await corte("credit");
  assert.equal(s.expectedCash, 4_000);
  assert.equal(s.refunds, 500, "sigue siendo un reembolso");
});

test("F5 · un reembolso viejo sin método (NULL) no se resta y se avisa aparte", async () => {
  const { s, derived } = await corte(null);
  assert.equal(s.expectedCash, 4_000);
  assert.equal(derived.refundsUnknownMethod, 500);
});

test("F5 · la apertura sugerida resta lo reembolsado en efectivo hoy", async () => {
  const sug = await computeSuggestedOpening("c1", dia("2026-10-03").from, dia("2026-10-03").to, turno("cash"));
  assert.equal(sug, 2_500);
  const sinMetodo = await computeSuggestedOpening("c1", dia("2026-10-03").from, dia("2026-10-03").to, turno(null));
  assert.equal(sinMetodo, 3_000);
});

test("F5 · la apertura sugerida cuenta el efectivo escrito «CASH» y deja fuera la tarjeta", async () => {
  const at = new Date("2026-10-03T16:00:00Z");
  const db = base([
    { id: "p1", invoiceId: "f1", amount: 1_000, method: "cash", paidAt: at },
    { id: "p2", invoiceId: "f1", amount: 200, method: "CASH", paidAt: at },
    { id: "p3", invoiceId: "f1", amount: 800, method: "debit", paidAt: at },
    { id: "r1", invoiceId: "f1", amount: 300, method: "refund", refundMethod: "cash", paidAt: at },
  ]);
  const sug = await computeSuggestedOpening("c1", dia("2026-10-03").from, dia("2026-10-03").to, db);
  assert.equal(sug, 900, "$1,000 + $200 «CASH» − $300 devueltos en efectivo; los $800 de débito no están en el cajón");
});

// ── F3: los tres traspasos llevan su marca ────────────────────────────────
test("F3 · excedente de ortodoncia, cita cancelada «a favor» y anticipo devuelto al cancelar se escriben como traspaso, no como reembolso", async () => {
  const { readFileSync } = await import("node:fs");
  const leer = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  const casos: Array<[string, RegExp]> = [
    ["src/lib/orthodontics/saldo-a-favor/saldo-orto.server.ts", /method: "refund",\s*\/\/[^\n]*\n\s*refundMethod: REEMBOLSO_A_SALDO_A_FAVOR,\s*notes: `Excedente del cobro/],
    ["src/lib/anticipos/cita-cancelada.server.ts", /method: "refund", paidAt: ahora,\s*\/\/[^\n]*\n\s*refundMethod: REEMBOLSO_A_SALDO_A_FAVOR,\s*notes: `Pasa al saldo a favor/],
    ["src/lib/patient-credit-aplicar.ts", /method: "refund",\s*\/\/[^\n]*\n\s*refundMethod: REEMBOLSO_A_SALDO_A_FAVOR,\s*notes: "Anticipo devuelto al saldo a favor/],
  ];
  for (const [ruta, re] of casos) assert.match(leer(ruta), re, ruta);
  // Y el reembolso REAL de «Ya lo devolví» lleva el método que se eligió, no el traspaso.
  assert.match(leer("src/lib/anticipos/cita-cancelada.server.ts"), /method: "refund", refundMethod: args\.refundMethod, paidAt: ahora,\s*notes: `Devuelto al paciente/);
});

// ── F7: caja abierta de más, cierre automático y cobros fuera de corte ─────
import { cierreAutomaticoDe, cobrosFueraDeCorte, diasAbierta, medianocheAnterior } from "../dinero/caja-core";

test("F7 · días abierta: 23 h = 0 (sin aviso en Hoy); 25 h = 1; 85 días = 85", () => {
  const now = new Date("2026-10-03T18:00:00Z");
  assert.equal(diasAbierta(new Date(now.getTime() - 23 * 3_600_000), now), 0);
  assert.equal(diasAbierta(new Date(now.getTime() - 25 * 3_600_000), now), 1);
  assert.equal(diasAbierta(new Date(now.getTime() - 85 * 86_400_000), now), 85);
});

test("F7 · medianoche de la clínica en su zona: CDMX (UTC−6) y Tijuana (UTC−7 en octubre)", () => {
  const now = new Date("2026-10-03T07:30:00Z"); // 01:30 en CDMX, 00:30 en Tijuana
  assert.equal(medianocheAnterior(now, "America/Mexico_City").toISOString(), "2026-10-03T06:00:00.000Z");
  assert.equal(medianocheAnterior(now, "America/Tijuana").toISOString(), "2026-10-03T07:00:00.000Z");
  assert.equal(medianocheAnterior(now, "America/Cancun").toISOString(), "2026-10-03T05:00:00.000Z");
});

test("F7 · cierre automático: la caja abierta ayer a las 9:00 se cierra a las 00:00; la abierta hoy a las 00:30, no", () => {
  const now = new Date("2026-10-03T06:20:00Z"); // 00:20 CDMX
  const ayer = cierreAutomaticoDe(new Date("2026-10-02T15:00:00Z"), now, "America/Mexico_City");
  assert.equal(ayer.cerrar, true);
  assert.equal(ayer.closedAt.toISOString(), "2026-10-03T06:00:00.000Z");
  const hoy = cierreAutomaticoDe(new Date("2026-10-03T06:30:00Z"), new Date("2026-10-03T07:00:00Z"), "America/Mexico_City");
  assert.equal(hoy.cerrar, false);
});

test("F7 · cobros fuera de corte: sin caja abierta, con fecha anterior a la apertura, y NO los que están dentro de un turno o ya asignados", () => {
  const now = new Date("2026-10-03T20:00:00Z");
  const cajas = [
    { id: "r1", openedAt: new Date("2026-10-01T15:00:00Z"), closedAt: new Date("2026-10-01T23:00:00Z") },
    { id: "r2", openedAt: new Date("2026-10-03T15:00:00Z"), closedAt: null },
  ];
  const cobros = [
    { id: "dentroR1", paidAt: new Date("2026-10-01T18:00:00Z") },
    { id: "sinCaja", paidAt: new Date("2026-10-02T18:00:00Z") },       // 2-oct: no hubo caja
    { id: "antesDeAbrir", paidAt: new Date("2026-10-03T14:00:00Z") },  // hoy, antes de abrir
    { id: "dentroR2", paidAt: new Date("2026-10-03T19:00:00Z") },
    { id: "asignado", paidAt: new Date("2026-10-02T19:00:00Z") },
    { id: "antesDeUsarCaja", paidAt: new Date("2026-09-20T18:00:00Z") },
  ];
  const fuera = cobrosFueraDeCorte(cobros, cajas, new Set(["asignado"]), now, new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(fuera.map((c) => c.id), ["sinCaja", "antesDeAbrir"]);
  assert.deepEqual(cobrosFueraDeCorte(cobros, [], new Set(), now, null), [], "clínica que nunca abrió caja: nada");
});

test("F7 · un cobro asignado a la caja entra en su turno aunque su fecha quede fuera: el esperado lo suma", async () => {
  const db = base([
    { id: "p1", invoiceId: "f1", amount: 1_000, method: "cash", paidAt: new Date("2026-10-03T16:00:00Z") },
    { id: "fuera", invoiceId: "f1", amount: 2_000, method: "cash", paidAt: new Date("2026-10-02T18:00:00Z") },
  ]);
  // El doble devuelve por OR: la ventana de hoy + los ids asignados.
  (db.payment as any).findMany = async (args: any) => {
    const ids: string[] = args.where.OR?.[1]?.id?.in ?? [];
    const w = args.where.OR?.[0]?.paidAt ?? args.where.paidAt;
    return [
      { id: "p1", amount: 1_000, method: "cash", paidAt: new Date("2026-10-03T16:00:00Z"), invoice: FACTURA },
      { id: "fuera", amount: 2_000, method: "cash", paidAt: new Date("2026-10-02T18:00:00Z"), invoice: FACTURA },
    ].filter((p) => ids.includes(p.id) || (p.paidAt >= w.gte && p.paidAt <= w.lte));
  };
  const { from, to } = dia("2026-10-03");
  const sin = await deriveWindow("c1", from, to, { db });
  assert.equal(sin.cashIncome, 1_000);
  const con = await deriveWindow("c1", from, to, { db, asignados: new Set(["fuera"]) });
  assert.equal(con.cashIncome, 3_000);
});

test("F7 · el cierre de caja solo cierra una caja que SIGUE abierta (dos cierres a la vez → el segundo 409)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../app/api/caja/close/route.ts", import.meta.url), "utf8");
  assert.match(src, /cashRegister\.updateMany\(\{\s*where: \{ id: reg\.id, clinicId, status: "OPEN" \}/);
  assert.match(src, /if \(cerrada\.count === 0\)[\s\S]{0,200}status: 409/);
  assert.doesNotMatch(src, /cashRegister\.update\(\{/, "ya no hay un update solo por id");
  const auto = readFileSync(new URL("../dinero/cierre-automatico.server.ts", import.meta.url), "utf8");
  assert.match(auto, /updateMany\(\{\s*where: \{ id: reg\.id, clinicId, status: "OPEN" \}/);
  assert.match(auto, /countedClosingBalance: null/, "sin conteo");
  assert.match(auto, /snapshotVariance:\s*null/, "sin diferencia inventada");
});

// ── Punto 7 (retirado): sin tope de descuento ──────────────────────────
// Decisión de Rafael (4-oct-2026): quien puede editar la factura pone el descuento
// que sea. Ni la regla ni su ajuste por clínica existen ya.
import { existsSync, readFileSync as leerArchivo } from "node:fs";
import { join as unirRuta } from "node:path";
test("descuento sin tope · no queda ni la regla ni su ajuste por clínica", () => {
  const join = unirRuta;
  const readFileSync = leerArchivo;
  const raiz = join(__dirname, "../../..");
  assert.equal(existsSync(join(raiz, "src/lib/dinero/descuento-autorizacion.ts")), false);
  assert.equal(existsSync(join(raiz, "src/lib/dinero/descuento.server.ts")), false);
  for (const ruta of ["src/app/api/invoices/route.ts", "src/app/api/invoices/[id]/route.ts", "src/app/api/invoices/[id]/edit-price/route.ts",
    "src/app/api/caja/ajustes/route.ts", "src/lib/dinero/ajustes.server.ts", "src/components/dashboard/billing/caja-fuera-de-corte.tsx"]) {
    const src = readFileSync(join(raiz, ruta), "utf8");
    assert.doesNotMatch(src, /denegarDescuentoSobreTope|descuentoMaxPct|DESCUENTO_REQUIERE_DUENO|limiteTitulo/, ruta);
  }
});

// ── Tablas nuevas sin SQL: una pregunta, cero consultas a la tabla ──────
import { _olvidarTablas, leerAjustesDinero, cobrosAsignados } from "../dinero/ajustes.server";

test("sin sql/ws1-t5-dinero-caja.sql: 20 lecturas → 1 to_regclass y 0 consultas a las tablas; valores de fábrica", async () => {
  _olvidarTablas();
  const consultas: string[] = [];
  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray) => { consultas.push(strings.join("?")); return strings.join("?").includes("to_regclass") ? [{ existe: false }] : []; },
    $executeRaw: async () => 0,
  };
  for (let i = 0; i < 10; i++) {
    const a = await leerAjustesDinero("c1", db);
    assert.deepEqual(a, { cajaCierreAutomatico: false, disponible: false });
    assert.equal((await cobrosAsignados("c1", {}, db)).size, 0);
  }
  assert.equal(consultas.filter((q) => q.includes("to_regclass")).length, 2, "una por tabla");
  assert.equal(consultas.filter((q) => !q.includes("to_regclass")).length, 0);
  _olvidarTablas();
});

// ── F10: el abono del presupuesto es anticipo, no descuento ─────────────
import { armarAceptacion, conceptosParaFactura, planearCargo } from "../quotes/aceptacion";
import { invoiceFieldsFromQuote } from "../quotes/invoice-from-quote-core";
import { presupuestosPorCargar } from "../quotes/por-cargar";

const PRESUPUESTO = {
  discountAmount: 0,
  items: [
    { id: "resina", name: "Resina", toothFdi: "16", quantity: 1, unitPrice: 1500, discount: 0, lineTotal: 1500 },
    { id: "orto", name: "Ortodoncia", toothFdi: null, quantity: 1, unitPrice: 8500, discount: 0, lineTotal: 8500 },
  ],
};

test("F10 (decisión de Rafael, 4-oct-2026) · el abono de $3,000 es un PAGO a la factura de su concepto, creada a precio completo; nada se descuenta después", () => {
  const r = armarAceptacion(PRESUPUESTO, ["resina", "orto"]);
  const abono = planearCargo(r, [], { abono: 3000, abonoA: "orto" });
  assert.ok(abono.ok);
  assert.equal(abono.plan!.lineas.length, 0, "ningún renglón «Abono al presupuesto»");
  assert.equal(abono.plan!.abono?.quoteItemId, "orto");
  assert.equal(abono.plan!.abono?.linea?.monto, 8500, "la factura de la ortodoncia nace a precio completo");
  // Luego la resina: entera, sin descuento ni «anticipo aplicado».
  const vivos = [{ quoteItemId: "orto", invoiceId: "B", monto: 8500 }];
  const resina = planearCargo(r, vivos, { itemIds: ["resina"] });
  assert.ok(resina.ok);
  const f = invoiceFieldsFromQuote(conceptosParaFactura(resina.plan!));
  assert.equal(f.total, 1500);
  assert.equal(f.discount, 0);
  assert.equal(f.items.reduce((s, it: any) => s + (it.anticipoAplicado ?? 0), 0), 0);
  assert.equal(resina.plan!.quedaPorCargar, 0);
});

test("F10 · «Cobrar hoy» sabe qué presupuestos aceptados tienen algo sin cargar", () => {
  const r = presupuestosPorCargar([
    { id: "q1", folio: "P-0001", status: "ACCEPTED", cobro: { porCargar: 7000, cargados: ["resina"], renglones: [
      { quoteItemId: "resina", aceptado: true, nombre: "Resina" }, { quoteItemId: "orto", aceptado: true, nombre: "Ortodoncia" },
      { quoteItemId: "x", aceptado: false, nombre: "Blanqueamiento" },
    ] } },
    { id: "q2", folio: "P-0002", status: "ACCEPTED", cobro: { porCargar: 0, cargados: [], renglones: [] } },
    { id: "q3", folio: "P-0003", status: "PRESENTED", cobro: { porCargar: 500 } },
  ]);
  assert.deepEqual(r, [{ id: "q1", folio: "P-0001", porCargar: 7000, conceptos: ["Ortodoncia"] }]);
  assert.deepEqual(presupuestosPorCargar({ error: "x" }), []);
});

// ── F16: zona de la clínica ─────────────────────────────────────────────
import { bucketKeyOf, eachBucket } from "../analytics/query";

test("F16 · un cobro a las 23:30 de Tijuana es del 2-oct en Tijuana (en UTC−6 fijo caía el 3-oct); sin zona, lo de siempre", () => {
  const d = new Date("2026-10-03T06:30:00Z");
  assert.equal(bucketKeyOf(d, "day"), "2026-10-03", "sin zona = México, como siempre");
  assert.equal(bucketKeyOf(d, "day", "America/Mexico_City"), "2026-10-03");
  assert.equal(bucketKeyOf(d, "day", "America/Tijuana"), "2026-10-02");
  assert.equal(bucketKeyOf(new Date("2026-10-01T05:30:00Z"), "month", "America/Cancun"), "2026-10", "00:30 en Cancún ya es octubre");
  assert.equal(bucketKeyOf(new Date("2026-10-01T05:30:00Z"), "month"), "2026-09", "en UTC−6 fijo seguía siendo septiembre");
  assert.equal(bucketKeyOf(d, "day", "Zona/Inventada"), "2026-10-03", "zona inválida cae a México");
  assert.deepEqual(eachBucket(new Date("2026-10-01T07:00:00Z"), new Date("2026-10-03T06:00:00Z"), "day", "America/Tijuana"), ["2026-10-01", "2026-10-02"]);
});

test("F15 · la semilla de la demo solo usa métodos del selector (antes «debit_card»/«credit_card» no entraban como tarjeta)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../app/api/admin/seed-demo-rafael/route.ts", import.meta.url), "utf8");
  const { METODOS_PAGO } = await import("../quotes/condiciones-pago");
  const usados = Array.from(src.matchAll(/method: pick\(\[([^\]]+)\]\)/g)).flatMap((m) => m[1].split(",").map((x) => x.trim().replace(/"/g, "")));
  assert.ok(usados.length > 0);
  for (const m of usados) assert.ok((METODOS_PAGO as readonly string[]).includes(m), `método fuera del selector: ${m}`);
});
