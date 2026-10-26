/**
 * «POR COBRAR» DE LA NOTA DEL PLAN = LO HECHO MENOS LO PAGADO (decisión de Rafael, 26-oct-2026). Puro.
 *
 * Run: npm run test:plan-por-cobrar
 *
 * Un plan de $18,000 recién aceptado NO es deuda; lo hecho sí, y vence a los 30 días de hecho; lo
 * pagado de más es saldo a favor; «Cerrar plan» deja la nota en lo hecho. Las facturas que no son de
 * plan, como siempre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { corteDeVencido, deudaDeNotaDelPlan, DIAS_PARA_VENCER, importesPorLinea, type FilaParaDeuda, type NotaParaDeuda } from "@/lib/treatments/por-cobrar";
import { ajustarNotaAlCerrar, motivoDeCierre, origenDelSaldoAFavor } from "@/lib/treatments/cerrar-plan";
import { cuentaDelPlan } from "@/lib/treatments/cobro";
import { computeReceivables } from "@/lib/caja";
import type { NotaDePlanLeida } from "@/lib/treatments/por-cobrar-db";

const HOY = new Date("2026-10-26T06:00:00Z"); // 00:00 del 26-oct en Ciudad de México
const CORTE = corteDeVencido(HOY);
const dia = (n: number) => new Date(HOY.getTime() - n * 86_400_000 + 10 * 3_600_000); // hace n días, 10:00 en México

const fila = (id: string, estado: FilaParaDeuda["estado"], hechoEn: Date | null = null, extra: Partial<FilaParaDeuda> = {}): FilaParaDeuda => ({ id, estado, hechoEn, ...extra });
const filas = (...f: FilaParaDeuda[]) => new Map(f.map((x) => [x.id, x] as const));
const linea = (planItemId: string | null, precio: number, name = `Proc ${planItemId ?? "extra"}`) => ({
  name, quantity: 1, unitPrice: precio, discount: 0, ...(planItemId ? { planItemId } : {}),
});
const nota = (items: unknown[], extra: Partial<NotaParaDeuda> = {}): NotaParaDeuda => {
  const total = (items as any[]).reduce((s: number, it: any) => s + it.quantity * it.unitPrice - (it.discount ?? 0), 0) as number;
  return { id: "n1", total, paid: 0, createdAt: dia(60), items, discount: 0, taxRate: 0, taxIncluded: true, ...extra };
};

// Un plan de 18,000: resina 3,000 · endodoncia 7,000 · corona 8,000.
const PLAN = [linea("r", 3000, "Resina"), linea("e", 7000, "Endodoncia"), linea("c", 8000, "Corona")];

test("plan de $18,000 recién aceptado: no debe nada; los 18,000 son «por hacer»", () => {
  const d = deudaDeNotaDelPlan(nota(PLAN, { createdAt: dia(0) }), filas(fila("r", "pendiente"), fila("e", "pendiente"), fila("c", "en_curso")), CORTE);
  assert.equal(d.aceptado, 18000);
  assert.equal(d.hecho, 0);
  assert.equal(d.debe, 0);
  assert.equal(d.porHacer, 18000);
  assert.equal(d.porHacerSinPagar, 18000);
  assert.equal(d.vencido, 0);
});

test("se hizo la resina: debe 3,000; lo demás sigue por hacer", () => {
  const d = deudaDeNotaDelPlan(nota(PLAN), filas(fila("r", "hecho", dia(2)), fila("e", "pendiente"), fila("c", "pendiente")), CORTE);
  assert.equal(d.hecho, 3000);
  assert.equal(d.debe, 3000);
  assert.equal(d.porHacerSinPagar, 15000);
  assert.equal(d.vencido, 0, "hecha hace 2 días: todavía no vence");
});

test("lo pagado se resta de lo hecho; si pasa de lo hecho es saldo a favor (y nada se debe)", () => {
  const f = filas(fila("r", "hecho", dia(2)), fila("e", "pendiente"), fila("c", "pendiente"));
  const parcial = deudaDeNotaDelPlan(nota(PLAN, { paid: 1000 }), f, CORTE);
  assert.equal(parcial.debe, 2000);
  assert.equal(parcial.saldoAFavor, 0);
  assert.equal(parcial.porHacerSinPagar, 15000);
  const adelanto = deudaDeNotaDelPlan(nota(PLAN, { paid: 5000 }), f, CORTE);
  assert.equal(adelanto.debe, 0);
  assert.equal(adelanto.saldoAFavor, 2000);
  assert.equal(adelanto.porHacerSinPagar, 13000, "saldo de la nota (13,000) − debe (0)");
});

test(`vencido: lo hecho y no pagado a los ${DIAS_PARA_VENCER} días de hecho; lo pagado cubre primero lo más viejo`, () => {
  assert.equal(DIAS_PARA_VENCER, 30);
  const f = filas(fila("r", "hecho", dia(45)), fila("e", "hecho", dia(31)), fila("c", "hecho", dia(29)));
  // Pagó 4,000: cubre la resina (3,000) y 1,000 de la endodoncia → vencen 6,000 de la endodoncia.
  const d = deudaDeNotaDelPlan(nota(PLAN, { paid: 4000 }), f, CORTE);
  assert.equal(d.debe, 14000);
  assert.equal(d.vencido, 6000, "la corona se hizo hace 29 días: aún no vence");
  // El día 30 todavía no; el 31, sí.
  const hecho = new Date("2026-09-26T16:00:00Z"); // 26-sep, 10:00 en México
  const una = filas(fila("r", "hecho", hecho));
  const n = nota([linea("r", 3000)]);
  assert.equal(deudaDeNotaDelPlan(n, una, corteDeVencido(new Date("2026-10-26T06:00:00Z"))).vencido, 0, "día 30");
  assert.equal(deudaDeNotaDelPlan(n, una, corteDeVencido(new Date("2026-10-27T06:00:00Z"))).vencido, 3000, "día 31");
});

test("un cargo extra que recepción agregó a la nota (sin fila) se debe desde el día de la nota, como hoy", () => {
  const items = [...PLAN, linea(null, 500, "Radiografía")];
  const d = deudaDeNotaDelPlan(nota(items, { createdAt: dia(3) }), filas(fila("r", "pendiente"), fila("e", "pendiente"), fila("c", "pendiente")), CORTE);
  assert.equal(d.debe, 500);
  assert.equal(d.porHacer, 18000);
});

test("fila cancelada que sigue en la nota cuenta como hecha (la nota la sigue cobrando)", () => {
  const d = deudaDeNotaDelPlan(nota([linea("r", 3000)]), filas(fila("r", "cancelado")), CORTE);
  assert.equal(d.debe, 3000);
});

test("si el editor de facturas le quitó `planItemId` a la línea, se reconoce por su posición y nombre", () => {
  const items = [{ name: "Resina", quantity: 1, unitPrice: 3000, discount: 0 }];
  const f = filas(fila("r", "pendiente", null, { nombre: "resina", invoiceId: "n1", invoiceLinea: 0 }));
  assert.equal(deudaDeNotaDelPlan(nota(items), f, CORTE).debe, 0);
  // Otro nombre en esa línea: ya no es la fila; cuenta como cargo (deuda).
  const otro = [{ name: "Blanqueamiento", quantity: 1, unitPrice: 3000, discount: 0 }];
  assert.equal(deudaDeNotaDelPlan(nota(otro), f, CORTE).debe, 3000);
});

test("descuento de la nota e IVA aparte: las líneas suman exactamente el total", () => {
  const items = [linea("r", 1000.5), linea("e", 333.33), linea("c", 250)];
  const imp = importesPorLinea(items, 100, 16, false);
  const total = 1.16 * (1000.5 + 333.33 + 250 - 100);
  assert.ok(Math.abs(imp.reduce((a, b) => a + b, 0) - total) < 0.05);
  const d = deudaDeNotaDelPlan(
    { ...nota(items), total: Math.round(imp.reduce((a, b) => a + b, 0) * 100) / 100, discount: 100, taxRate: 16, taxIncluded: false },
    filas(fila("r", "hecho", dia(1)), fila("e", "pendiente"), fila("c", "pendiente")),
    CORTE,
  );
  assert.equal(d.hecho, imp[0]);
  assert.equal(Math.round((d.hecho + d.porHacer) * 100) / 100, d.aceptado);
});

// ── La cuenta del plan en la ficha ──────────────────────────────────────────

test("cuenta del plan: Plan aceptado · Hecho · Pagado · Debe, y Por hacer", () => {
  const c = cuentaDelPlan({
    total: 18000,
    facturas: [{ id: "n1", invoiceNumber: "F-1", status: "PARTIAL", total: 18000, paid: 1000, hecho: 3000, vencido: 0 }],
  });
  assert.equal(c.aceptado, 18000);
  assert.equal(c.hecho, 3000);
  assert.equal(c.pagado, 1000);
  assert.equal(c.debe, 2000);
  assert.equal(c.saldoAFavor, 0);
  assert.equal(c.porHacer, 15000);
  assert.equal(c.saldo, 17000, "el saldo de la nota (lo que se puede abonar) no cambia");
  const adelanto = cuentaDelPlan({ total: 18000, facturas: [{ id: "n1", invoiceNumber: "F-1", status: "PARTIAL", total: 18000, paid: 5000, hecho: 3000 }] });
  assert.equal(adelanto.debe, 0);
  assert.equal(adelanto.saldoAFavor, 2000);
  // Una factura de la vía vieja (sin «hecho») cuenta entera, como siempre.
  const vieja = cuentaDelPlan({ total: 900, facturas: [{ id: "f", invoiceNumber: "F-9", status: "PENDING", total: 900, paid: 0 }] });
  assert.equal(vieja.debe, 900);
  assert.equal(vieja.porHacer, 0);
});

// ── Cerrar plan ────────────────────────────────────────────────────────────

test("cerrar plan: la nota se queda en lo hecho; lo pagado de más pasa a favor; las filas que se quedan se reanotan", () => {
  const f = filas(fila("r", "pendiente"), fila("e", "hecho", dia(10)), fila("c", "pendiente"));
  const a = ajustarNotaAlCerrar(nota(PLAN, { paid: 9000 }), f)!;
  assert.deepEqual(a.items.map((it: any) => it.name), ["Endodoncia"]);
  assert.deepEqual(a.quitadas.map((q) => q.nombre), ["Resina", "Corona"]);
  assert.equal(a.total, 7000);
  assert.equal(a.aFavor, 2000);
  assert.equal(a.paid, 7000);
  assert.equal(a.balance, 0);
  assert.equal(a.status, "PAID");
  assert.equal(a.lineaNueva.get("e"), 0, "la endodoncia pasa a la línea 0");
  // Pagó menos que lo hecho: sigue debiendo, nada a favor.
  const b = ajustarNotaAlCerrar(nota(PLAN, { paid: 2000 }), f)!;
  assert.equal(b.aFavor, 0);
  assert.equal(b.balance, 5000);
  assert.equal(b.status, "PARTIAL");
});

test("cerrar plan sin nada hecho: la nota se cancela y todo lo pagado queda a favor", () => {
  const a = ajustarNotaAlCerrar(nota(PLAN, { paid: 4000 }), filas(fila("r", "pendiente"), fila("e", "pendiente"), fila("c", "pendiente")))!;
  assert.equal(a.status, "CANCELLED");
  assert.equal(a.aFavor, 4000);
  assert.equal(a.paid, 0);
});

test("cerrar plan con todo hecho: la nota no cambia (null)", () => {
  assert.equal(ajustarNotaAlCerrar(nota(PLAN), filas(fila("r", "hecho", dia(1)), fila("e", "hecho", dia(1)), fila("c", "hecho", dia(1)))), null);
});

test("cerrar plan: el descuento de la nota se reparte en proporción a lo que se queda", () => {
  const n = { ...nota(PLAN), discount: 1800, total: 16200 };
  const a = ajustarNotaAlCerrar(n, filas(fila("r", "hecho", dia(1)), fila("e", "pendiente"), fila("c", "pendiente")))!;
  assert.equal(a.discount, 300);
  assert.equal(a.total, 2700);
});

test("de dónde sale el saldo a favor: primero el anticipo aplicado, luego los cobros del más nuevo al más viejo", () => {
  const pagos = [
    { id: "p1", amount: 3000, method: "cash", paidAt: dia(20) },
    { id: "p2", amount: 2000, method: "card", paidAt: dia(5) },
    { id: "pa", amount: 1000, method: "anticipo", paidAt: dia(30) },
    { id: "rf", amount: 500, method: "refund", paidAt: dia(1) },
  ];
  const o = origenDelSaldoAFavor(3500, 1000, pagos);
  assert.equal(o.deAnticipo, 1000);
  assert.deepEqual(o.deCobros, [{ paymentId: "p2", monto: 2000 }, { paymentId: "p1", monto: 500 }]);
});

test("motivo del cierre: obligatorio, limpio y con tope", () => {
  assert.equal(motivoDeCierre(""), null);
  assert.equal(motivoDeCierre("  no "), null);
  assert.equal(motivoDeCierre("  ya   no viene "), "ya no viene");
  assert.equal(motivoDeCierre("x".repeat(500))!.length, 300);
  assert.equal(motivoDeCierre(42), null);
});

// ── Caja / Finanzas: computeReceivables ─────────────────────────────────────

function baseDeSaldos(facturas: Array<{ id: string; status: string; balance: number; total: number; dueDate: Date | null; createdAt?: Date }>) {
  const db = {
    invoice: {
      findMany: async ({ where, take }: any) => {
        const y: any[] = where.AND ?? [];
        return facturas
          .filter((f) => where.clinicId === "cl-1" && !where.status.notIn.includes(f.status) && f.balance > 0)
          .filter((f) => y.every((c) => (c.id?.gt !== undefined ? f.id > c.id.gt : true)))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map((f) => ({ id: f.id, balance: f.balance, total: f.total, dueDate: f.dueDate, createdAt: f.createdAt ?? dia(60) }));
      },
      aggregate: async () => ({ _sum: {} }),
    },
    clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
    $queryRaw: async () => [],
  };
  return db as any;
}

const leidas = (m: Record<string, { nota: NotaParaDeuda; filas: Map<string, FilaParaDeuda> }>) =>
  async (_c: string, ids: string[]) => new Map(ids.filter((id) => m[id]).map((id) => [id, { planId: "p1", ...m[id] } as NotaDePlanLeida] as const));

test("Caja / Finanzas: el plan de $18,000 recién aceptado NO sale como «Por cobrar»; sale en «Por hacer»", async () => {
  const db = baseDeSaldos([
    { id: "n-plan", status: "PENDING", balance: 18000, total: 18000, dueDate: null, createdAt: new Date("2026-10-26T15:00:00Z") },
    { id: "otra", status: "PENDING", balance: 700, total: 700, dueDate: new Date("2026-10-01T06:00:00Z") },
  ]);
  const ahora = new Date("2026-10-26T18:00:00Z");
  const s = await computeReceivables("cl-1", ahora, db, async () => new Map(), {
    leerNotasDePlan: leidas({ "n-plan": { nota: { ...nota(PLAN, { createdAt: new Date("2026-10-26T15:00:00Z") }), id: "n-plan" }, filas: filas(fila("r", "pendiente"), fila("e", "pendiente"), fila("c", "pendiente")) } }),
  });
  assert.equal(s.porCobrar, 700, "solo la factura normal");
  assert.equal(s.vencido, 700, "la factura normal vencida, como siempre");
  assert.equal(s.porHacer, 18000);
  assert.deepEqual(s.porHacerPorFactura, { "n-plan": 18000 });
  assert.equal(s.porHacerEmitidoHoy, 18000, "Caja resta esto del «Por cobrar» del día");
  // Ningún peso desaparece: lo de antes = por cobrar + por hacer.
  const antes = await computeReceivables("cl-1", ahora, db, async () => new Map(), { leerNotasDePlan: async () => new Map() });
  assert.equal(antes.porCobrar, s.porCobrar + s.porHacer);
});

test("Caja / Finanzas: con lo hecho, «Por cobrar» = hecho − pagado y «Vencido» = lo hecho hace más de 30 días", async () => {
  const db = baseDeSaldos([{ id: "n-plan", status: "PARTIAL", balance: 14000, total: 18000, dueDate: null }]);
  const s = await computeReceivables("cl-1", new Date("2026-10-26T18:00:00Z"), db, async () => new Map(), {
    leerNotasDePlan: leidas({
      "n-plan": { nota: { ...nota(PLAN, { paid: 4000 }), id: "n-plan" }, filas: filas(fila("r", "hecho", dia(45)), fila("e", "hecho", dia(31)), fila("c", "pendiente")) },
    }),
  });
  assert.equal(s.porCobrar, 6000);
  assert.equal(s.vencido, 6000);
  assert.deepEqual(s.vencidoPorFactura, { "n-plan": 6000 });
  assert.equal(s.porHacer, 8000);
});

test("Caja / Finanzas: si no se pueden leer las notas de plan, todo cuenta como antes (nunca revienta)", async () => {
  const db = baseDeSaldos([{ id: "n-plan", status: "PENDING", balance: 18000, total: 18000, dueDate: null }]);
  const s = await computeReceivables("cl-1", new Date("2026-10-26T18:00:00Z"), db, async () => new Map(), {
    leerNotasDePlan: async () => { throw new Error("se cayó la base"); },
  });
  assert.equal(s.porCobrar, 18000);
  assert.equal(s.porHacer, 0);
});
