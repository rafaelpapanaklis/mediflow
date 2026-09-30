/**
 * SALDO A FAVOR EN ORTODONCIA — el cobro con ADELANTO (ws1-t4).
 *
 * Run: npm run test:orto-saldo-a-favor
 *
 * «Si el paciente paga más que lo de hoy, el excedente se aplica a las
 * siguientes mensualidades pendientes del caso en orden de vencimiento y, si
 * sobra, queda como saldo a favor» (ticket de BEVADENT).
 *
 * Dos partes:
 *   · el reparto puro (`adelanto-core.ts`): orden, tope por factura y que ni
 *     un centavo se cree ni se pierda;
 *   · la transacción (`cobrarConAdelanto`) contra un doble de Prisma que
 *     aplica el where (clinicId incluido) y deshace TODO si algo lanza: cada
 *     factura recibe su Payment con el método real, lo pagado nunca pasa del
 *     total, y lo que sobra sale como «refund» + fila positiva en el libro.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ordenDeAdelanto, repartirCobro, vencimientoPorFactura, type FacturaDelCaso } from "../adelanto-core";
import { FUENTE_EXCEDENTE } from "@/lib/patient-credit-core";

// ═══════════════════════════════════════════════════════════════════════════
// Reparto puro
// ═══════════════════════════════════════════════════════════════════════════
const f = (invoiceId: string, falta: number, vencimiento: string | null = null): FacturaDelCaso => ({
  invoiceId, invoiceNumber: invoiceId.toUpperCase(), falta, vencimiento,
});

test("precio total: el plan a plazos se lleva todo lo que le falta y lo que sobra queda a favor", () => {
  const r = repartirCobro(2000, f("plan", 1500), []);
  assert.deepEqual(r.partes.map((p) => [p.invoiceId, p.monto, p.esLaCobrada]), [["plan", 1500, true]]);
  assert.equal(r.excedente, 500);
  assert.equal(r.aFavor, 500);
});

test("sin pagar de más: nada se mueve de factura ni queda a favor", () => {
  const r = repartirCobro(800, f("a", 800), [f("b", 800, "2026-09-01")]);
  assert.deepEqual(r.partes.map((p) => [p.invoiceId, p.monto]), [["a", 800]]);
  assert.equal(r.excedente, 0);
  assert.equal(r.aFavor, 0);
});

test("pago por control: lo de más va a las otras facturas por vencimiento (la más vieja primero), sin pasar de lo que deben", () => {
  const r = repartirCobro(2400, f("ctrl-a", 800), [
    f("ctrl-b", 800, "2026-09-15"),
    f("colocacion", 3000, "2026-08-01"),
    f("ctrl-c", 800, "2026-09-01"),
  ]);
  assert.deepEqual(r.partes.map((p) => [p.invoiceId, p.monto]), [["ctrl-a", 800], ["colocacion", 1600]]);
  assert.equal(r.aFavor, 0);

  const todo = repartirCobro(6000, f("ctrl-a", 800), [f("ctrl-b", 800, "2026-09-15"), f("colocacion", 3000, "2026-08-01"), f("ctrl-c", 800, "2026-09-01")]);
  assert.deepEqual(todo.partes.map((p) => [p.invoiceId, p.monto]), [["ctrl-a", 800], ["colocacion", 3000], ["ctrl-c", 800], ["ctrl-b", 800]]);
  assert.equal(todo.aFavor, 600);
});

test("orden: sin fecha al final, empate por id; ninguna factura se paga dos veces ni la cobrada se repite", () => {
  assert.deepEqual(ordenDeAdelanto([f("z", 1, null), f("b", 1, "2026-01-01"), f("a", 1, "2026-01-01"), f("c", 1, null)]).map((x) => x.invoiceId), ["a", "b", "c", "z"]);
  const r = repartirCobro(5000, f("a", 100), [f("a", 999, "2020-01-01"), f("b", 100, "2026-01-01"), f("b", 100, "2026-01-01")]);
  assert.deepEqual(r.partes.map((p) => [p.invoiceId, p.monto]), [["a", 100], ["b", 100]]);
  assert.equal(r.aFavor, 4800);
});

test("ni un centavo se crea ni se pierde: Σ partes + a favor = monto (centavos, 500 casos)", () => {
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 500; i++) {
    const monto = Math.round(azar() * 1_000_000) / 100;
    const cobrada = f("x", Math.round(azar() * 300_000) / 100);
    const otras = Array.from({ length: Math.floor(azar() * 5) }, (_, k) => f(`o${k}`, Math.round(azar() * 200_000) / 100, azar() > 0.3 ? `2026-0${1 + Math.floor(azar() * 9)}-1${k}` : null));
    const r = repartirCobro(monto, cobrada, otras);
    const suma = r.partes.reduce((s, p) => s + Math.round(p.monto * 100), 0) + Math.round(r.aFavor * 100);
    assert.equal(suma, Math.round(monto * 100));
    for (const p of r.partes) {
      const tope = p.esLaCobrada ? cobrada.falta : otras.find((o) => o.invoiceId === p.invoiceId)!.falta;
      assert.ok(p.monto <= tope + 1e-9, "nunca más de lo que la factura debe");
      assert.ok(p.monto > 0);
    }
    if (r.aFavor > 0) {
      assert.equal(r.partes.reduce((s, p) => s + Math.round(p.monto * 100), 0), Math.round(cobrada.falta * 100) + otras.reduce((s, o) => s + Math.round(o.falta * 100), 0), "solo queda a favor si TODO el caso quedó saldado");
    }
  }
});

test("vencimientoPorFactura: la cuota pendiente más vieja de cada factura; las del plan caen en la principal", () => {
  const m = vencimientoPorFactura(
    [
      { vencimiento: "2026-10-05" },
      { vencimiento: "2026-09-05" },
      { invoiceId: "ctrl", vencimiento: "2026-09-20" },
      { invoiceId: "ctrl", vencimiento: null },
    ],
    "plan",
  );
  assert.equal(m.get("plan"), "2026-09-05");
  assert.equal(m.get("ctrl"), "2026-09-20");
});

// ═══════════════════════════════════════════════════════════════════════════
// La transacción, contra un doble de Prisma
// ═══════════════════════════════════════════════════════════════════════════
type Row = Record<string, any>;
const db = { invoices: [] as Row[], payments: [] as Row[], credits: [] as Row[], seq: 0, bloqueos: [] as string[][] };
let fallarEn: string | null = null;

function cumple(row: Row, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      for (const [op, val] of Object.entries(v as any)) {
        if (op === "in") { if (!(val as any[]).includes(row[k])) return false; }
        else throw new Error(`el doble no sabe evaluar ${k}: ${op}`);
      }
      continue;
    }
    if ((row[k] ?? null) !== v) return false;
  }
  return true;
}
function proyectar(row: Row, select?: any): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

const dobleDb: any = {
  $transaction: async (fn: any) => {
    const deshacer: Array<() => void> = [];
    const insertar = (tabla: Row[], fila: Row) => { tabla.push(fila); deshacer.push(() => tabla.splice(tabla.indexOf(fila), 1)); };
    const tx = {
      $queryRaw: async (partes: TemplateStringsArray, ...vals: any[]) => {
        const sql = partes.join("?");
        if (!/FOR UPDATE/.test(sql) || !/invoices/.test(sql)) throw new Error(`el doble no conoce este SQL: ${sql}`);
        // Prisma.join(ids) llega como un objeto Sql con `values`.
        const ids = (vals[0]?.values ?? vals[0]) as string[];
        db.bloqueos.push([...ids]);
        assert.ok(vals.includes("c1"), "el candado también filtra por clinicId");
        return [];
      },
      invoice: {
        findMany: async ({ where, select }: any) => db.invoices.filter((r) => cumple(r, where)).map((r) => proyectar(r, select)),
        updateMany: async ({ where, data }: any) => {
          const filas = db.invoices.filter((r) => cumple(r, where));
          for (const fila of filas) {
            const antes = { ...fila };
            Object.assign(fila, data);
            deshacer.push(() => { Object.keys(fila).forEach((k) => delete fila[k]); Object.assign(fila, antes); });
          }
          return { count: filas.length };
        },
      },
      payment: {
        create: async ({ data, select }: any) => {
          if (fallarEn === "payment.create") throw new Error("fallo provocado");
          const fila = { id: `pay${++db.seq}`, ...data };
          insertar(db.payments, fila);
          return proyectar(fila, select);
        },
      },
      patientCredit: {
        create: async ({ data }: any) => {
          if (fallarEn === "patientCredit.create") throw new Error("fallo provocado");
          if (!(data.amount > 0)) throw new Error("patient_credits_signo_chk");
          const fila = { id: `cred${++db.seq}`, ...data };
          insertar(db.credits, fila);
          return fila;
        },
      },
    };
    try {
      return await fn(tx);
    } catch (e) {
      deshacer.reverse().forEach((d) => d());
      throw e;
    }
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: dobleDb } });
const servidor = () => import("../saldo-orto.server");

function factura(over: Row): Row {
  const fila = { id: `inv${++db.seq}`, clinicId: "c1", patientId: "p1", invoiceNumber: `F-${db.seq}`, total: 1000, paid: 0, balance: 1000, status: "PENDING", ...over };
  fila.balance = Math.round((fila.total - fila.paid) * 100) / 100;
  db.invoices.push(fila);
  return fila;
}
const AHORA = new Date("2026-09-30T17:00:00Z");
const base = (over: Row) => ({ clinicId: "c1", userId: "u1", patientId: "p1", method: "cash", paidAt: AHORA, reference: null, notes: null, ...over }) as any;

/** El dinero cuadra: lo que entró (Σ Payment no-refund) = lo abonado a las facturas + lo que quedó a favor. */
function assertCuadra(monto: number, pagadoAntes: Map<string, number>) {
  const entro = db.payments.filter((p) => p.method !== "refund").reduce((s, p) => s + Math.round(p.amount * 100), 0);
  assert.equal(entro, Math.round(monto * 100), "Caja: entra UNA vez todo lo cobrado, con su método");
  const abonado = db.invoices.reduce((s, i) => s + Math.round((i.paid - (pagadoAntes.get(i.id) ?? 0)) * 100), 0);
  const aFavor = db.credits.reduce((s, c) => s + Math.round(c.amount * 100), 0);
  const reembolsos = db.payments.filter((p) => p.method === "refund").reduce((s, p) => s + Math.round(p.amount * 100), 0);
  assert.equal(abonado + aFavor, Math.round(monto * 100), "lo abonado + lo que quedó a favor = lo cobrado");
  assert.equal(reembolsos, aFavor, "lo que sale de la factura es exactamente lo que entra al libro");
  for (const i of db.invoices) {
    assert.ok(i.paid <= i.total + 1e-9, `${i.invoiceNumber}: lo pagado nunca pasa del total`);
    assert.equal(i.balance, Math.max(0, Math.round((i.total - i.paid) * 100) / 100));
    const netoPagos = db.payments.filter((p) => p.invoiceId === i.id).reduce((s, p) => s + (p.method === "refund" ? -1 : 1) * Math.round(p.amount * 100), 0);
    assert.equal(netoPagos, Math.round((i.paid - (pagadoAntes.get(i.id) ?? 0)) * 100), `${i.invoiceNumber}: paid = Σ pagos − reembolsos`);
  }
}
const foto = () => new Map(db.invoices.map((i) => [i.id, i.paid]));

beforeEach(() => {
  db.invoices = []; db.payments = []; db.credits = []; db.seq = 0; db.bloqueos = [];
  fallarEn = null;
});

test("precio total al final del plan: $2,000 sobre $1,500 pendientes → plan PAGADO y $500 a favor (refund + fila excedente)", async () => {
  const { cobrarConAdelanto } = await servidor();
  const plan = factura({ total: 12000, paid: 10500, status: "PARTIAL" });
  const antes = foto();
  const r = await cobrarConAdelanto(base({ invoiceId: plan.id, otras: [], amount: 2000 }), dobleDb);
  assert.equal(r.ok, true);
  assert.deepEqual([plan.paid, plan.balance, plan.status], [12000, 0, "PAID"]);
  assert.ok(plan.paidAt instanceof Date);
  // Dos cobros con el método real: la parte del plan y el excedente (así el
  // CFDI por pago del plan nunca incluye dinero que no es suyo).
  const cobros = db.payments.filter((p) => p.method === "cash").map((p) => p.amount).sort((x, y) => x - y);
  assert.deepEqual(cobros, [500, 1500], "entra al cajón todo lo que el paciente entregó, en dos renglones");
  const excedente = db.payments.find((p) => p.method === "cash" && p.amount === 500)!;
  assert.match(excedente.notes, /saldo a favor/);
  const reembolso = db.payments.find((p) => p.method === "refund")!;
  assert.equal(reembolso.amount, 500);
  assert.match(reembolso.notes, /no sale dinero de caja/);
  const credito = db.credits[0];
  assert.deepEqual(
    [credito.amount, credito.source, credito.invoiceId, credito.paymentId, credito.createdById, credito.clinicId, credito.patientId],
    [500, FUENTE_EXCEDENTE, plan.id, excedente.id, "u1", "c1", "p1"],
    "la fila del libro apunta al Payment del excedente (el que /api/payments/[id]/cfdi no deja timbrar)",
  );
  assertCuadra(2000, antes);
});

test("pago por control: el excedente paga las otras facturas del caso por vencimiento, con el método real", async () => {
  const { cobrarConAdelanto } = await servidor();
  const a = factura({ total: 800 });
  const colocacion = factura({ total: 3000, paid: 1000, status: "PARTIAL" });
  const b = factura({ total: 800 });
  const antes = foto();
  const r = await cobrarConAdelanto(
    base({
      invoiceId: a.id,
      method: "transfer",
      otras: [
        { invoiceId: b.id, invoiceNumber: b.invoiceNumber, falta: 800, vencimiento: "2026-09-15" },
        { invoiceId: colocacion.id, invoiceNumber: colocacion.invoiceNumber, falta: 2000, vencimiento: "2026-08-01" },
      ],
      amount: 3000,
    }),
    dobleDb,
  );
  assert.equal(r.ok, true);
  assert.deepEqual([a.status, colocacion.status, b.status], ["PAID", "PAID", "PARTIAL"]);
  assert.equal(b.paid, 200, "la última (por fecha) recibe lo que alcanzó");
  assert.equal(db.credits.length, 0, "no sobró nada");
  assert.ok(db.payments.every((p) => p.method === "transfer"));
  assert.match(db.payments.find((p) => p.invoiceId === colocacion.id)!.notes, new RegExp(`Adelanto.*${a.invoiceNumber}`));
  assert.deepEqual(db.bloqueos[0], [a.id, b.id, colocacion.id].sort(), "se bloquean todas, en orden de id");
  assertCuadra(3000, antes);
});

test("lo pendiente se RELEE bajo candado: si otra factura ya se pagó mientras tanto, no se le abona de más", async () => {
  const { cobrarConAdelanto } = await servidor();
  const a = factura({ total: 800 });
  const b = factura({ total: 800, paid: 800, status: "PAID" }); // en pantalla debía 800; ya no
  const antes = foto();
  const r = await cobrarConAdelanto(base({ invoiceId: a.id, otras: [{ invoiceId: b.id, invoiceNumber: b.invoiceNumber, falta: 800, vencimiento: "2026-09-01" }], amount: 1000 }), dobleDb);
  assert.equal(r.ok, true);
  assert.equal(b.paid, 800);
  assert.equal(db.credits[0].amount, 200, "lo que ya no cabía queda a favor");
  assertCuadra(1000, antes);
});

test("aislamiento: una factura de OTRO paciente u OTRA clínica en la lista no recibe nada", async () => {
  const { cobrarConAdelanto } = await servidor();
  const a = factura({ total: 500 });
  const ajena = factura({ total: 800, patientId: "p2" });
  const otraClinica = factura({ total: 800, clinicId: "c2" });
  const antes = foto();
  const otras = [ajena, otraClinica].map((x) => ({ invoiceId: x.id, invoiceNumber: x.invoiceNumber, falta: 800, vencimiento: "2026-01-01" }));
  const r = await cobrarConAdelanto(base({ invoiceId: a.id, otras, amount: 900 }), dobleDb);
  assert.equal(r.ok, true);
  assert.equal(ajena.paid, 0);
  assert.equal(otraClinica.paid, 0);
  assert.equal(db.credits[0].amount, 400);
  assert.ok(db.payments.every((p) => p.invoiceId === a.id));
  assertCuadra(900, antes);
});

test("puertas: cancelada, borrador, ya pagada, de otro paciente o monto inválido → error y NADA escrito", async () => {
  const { cobrarConAdelanto } = await servidor();
  const cancelada = factura({ status: "CANCELLED" });
  const borrador = factura({ status: "DRAFT" });
  const pagada = factura({ paid: 1000, status: "PAID" });
  const ajena = factura({ patientId: "p2" });
  for (const [id, re] of [[cancelada.id, /cancelada/], [borrador.id, /Confirma/], [pagada.id, /saldo pendiente/], [ajena.id, /no es de este caso/], ["no-existe", /Not found/]] as const) {
    const r = await cobrarConAdelanto(base({ invoiceId: id, otras: [], amount: 1500 }), dobleDb);
    assert.equal(r.ok, false);
    assert.match((r as any).error, re);
  }
  const r0 = await cobrarConAdelanto(base({ invoiceId: ajena.id, otras: [], amount: 0 }), dobleDb);
  assert.equal(r0.ok, false);
  assert.equal(db.payments.length, 0);
  assert.equal(db.credits.length, 0);
});

test("todo o nada: si falla la fila del libro, no queda ni un Payment ni un peso abonado", async () => {
  const { cobrarConAdelanto } = await servidor();
  const a = factura({ total: 800 });
  const b = factura({ total: 800 });
  fallarEn = "patientCredit.create";
  await assert.rejects(
    cobrarConAdelanto(base({ invoiceId: a.id, otras: [{ invoiceId: b.id, invoiceNumber: b.invoiceNumber, falta: 800, vencimiento: null }], amount: 2000 }), dobleDb),
    /fallo provocado/,
  );
  assert.equal(db.payments.length, 0);
  assert.deepEqual([a.paid, b.paid, a.status, b.status], [0, 0, "PENDING", "PENDING"]);
});

test("efectivo sin caja abierta: el aviso viaja en la nota de cada pago, como en el cobro de siempre", async () => {
  const { cobrarConAdelanto } = await servidor();
  const a = factura({ total: 800 });
  await cobrarConAdelanto(base({ invoiceId: a.id, otras: [], amount: 900, notes: "pagó el papá", avisoDeCaja: "Efectivo cobrado sin caja abierta" }), dobleDb);
  for (const cobro of db.payments.filter((p) => p.method === "cash")) {
    assert.match(cobro.notes, /pagó el papá/);
    assert.match(cobro.notes, /⚠️ Efectivo cobrado sin caja abierta/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Las puertas que no se ven en el doble (leídas del código)
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { join } from "node:path";
const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("CFDI por pago: el Payment del excedente no se timbra (se factura cuando el saldo se use)", () => {
  const r = leer("app/api/payments/[id]/cfdi/route.ts");
  assert.match(r, /if \(await pasoAlSaldoAFavor\(ctx!\.clinicId, payment\.id\)\)/);
  assert.match(r, /where: \{ clinicId, paymentId, source: FUENTE_EXCEDENTE \}/);
});

test("la ruta: billing.charge para escribir, visibilidad por paciente, sin Mercado Pago ni «anticipo» tecleado, y fuera de ortodoncia no hay adelanto", () => {
  const r = leer("app/api/invoices/[id]/saldo-orto/route.ts");
  assert.match(r, /contexto\(req, params\.id, "billing\.charge"\)/);
  assert.match(r, /contexto\(req, params\.id, "billing\.view"\)/);
  assert.match(r, /assertPatientVisible\(inv\.patientId/);
  assert.match(r, /method === METODO_MERCADO_PAGO/);
  assert.match(r, /method === METODO_ANTICIPO/);
  assert.match(r, /if \(!caso\) \{\s*\/\/ Fuera de ortodoncia no hay adelanto[^\n]*\n\s*return NextResponse\.json\(\{ error: "El monto excede el saldo pendiente" \}, \{ status: 400 \}\);/);
  assert.match(r, /paidVisto/, "«Usar saldo a favor» exige lo pagado que veía la pantalla");
});

test("la pantalla: solo en ortodoncia se deja pagar de más (los dos caminos de cobro, iguales)", () => {
  for (const f of ["components/dashboard/factura-un-popup/use-cobro.ts", "components/dashboard/billing/payment-modal.tsx"]) {
    const t = leer(f);
    assert.match(t, /const adelanto = isOverpay && orto\.esOrto;/, f);
    assert.match(t, /const isInvalid = !amountNum \|\| amountNum <= 0 \|\| \(isOverpay && !adelanto\);/, f);
  }
  const c = leer("components/dashboard/plan-de-pagos/saldo-orto-cobro.tsx");
  assert.match(c, /^"use client";/);
  assert.doesNotMatch(c, /@\/lib\/prisma|patient-credit"|\.server"/, "un componente de cliente no importa nada que llegue a Prisma");
  assert.match(c, /if \(!info\?\.caso\) return null;/, "fuera de ortodoncia no pinta nada");
});
