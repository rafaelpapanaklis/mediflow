/**
 * LA NOTA DE COBRO DEL PLAN (ws1-t12 · P6) — qué se cobra y dónde. Puro.
 *
 * Run: npm run test:plan-v2
 *
 * Regla de oro: NUNCA dos notas por la misma fila. Lo ya cobrado por el presupuesto se liga; lo que
 * el paciente firmó manda; lo no aceptado no se cobra; lo que crece va a la nota abierta o a una
 * adicional. Y «Cobrar hoy» abona a la nota del plan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cuentaDelPlan, notaAbierta, planearNota, type NotaDelPlan, type PresupuestoDelPlan } from "@/lib/treatments/cobro";
import { abonoAlPlan } from "@/lib/invoices/cobrar-hoy";
import type { FilaDelPlan } from "@/lib/treatments/items";

const T0 = new Date("2026-10-20T10:00:00Z");
const DESPUES = new Date("2026-10-21T10:00:00Z");

const fila = (id: string, extra: Partial<FilaDelPlan> = {}): FilaDelPlan => ({
  id, clinicId: "c1", planId: "p1", procedureId: null, nombre: `Proc ${id}`, dientes: [], caras: [], fase: "restauradora",
  faseNumero: null, cantidad: 1, precioCentavos: 100_00, estado: "pendiente", hechoEn: null, hechoPor: null, citaId: null,
  motivo: "", hallazgo: null, invoiceId: null, invoiceLinea: null, quoteItemId: null, orden: 0, canceladoEn: null,
  canceladoPor: null, createdById: null, createdAt: T0, updatedAt: T0, ...extra,
});
const nota = (id: string, extra: Partial<NotaDelPlan> = {}): NotaDelPlan => ({
  id, invoiceNumber: `F-${id}`, status: "PENDING", total: 100, paid: 0, cfdiUuid: null, createdAt: T0, ...extra,
});
const concepto = (quoteItemId: string, extra: Record<string, unknown> = {}) => ({
  quoteItemId, aceptado: true, nombre: `Proc ${quoteItemId}`, toothFdi: null, cantidad: 1, precio: 100, descuento: 0, descuentoGlobal: 0, ...extra,
});
const presupuesto = (extra: Partial<PresupuestoDelPlan> = {}): PresupuestoDelPlan => ({
  id: "q1", folio: "P-0001", aceptadoEn: T0, conceptos: [], cargos: [], facturaVieja: null, ...extra,
});

test("plan aceptado sin presupuesto: una línea por fila con precio, en una nota nueva; la cortesía no lleva línea", () => {
  const p = planearNota({
    filas: [fila("a", { precioCentavos: 1250_50, cantidad: 2, dientes: [16], procedureId: "proc" }), fila("b", { precioCentavos: 0 }), fila("c", { estado: "hecho", orden: 2 })],
    notas: [], facturasVivas: [], presupuesto: null,
  });
  assert.deepEqual(p.destino, { tipo: "nueva" });
  assert.deepEqual(p.lineas.map((l) => [l.filaId, l.quantity, l.unitPrice, l.neto, l.toothFdi, l.procedureId]), [
    ["a", 2, 1250.5, 2501, "16", "proc"],
    ["c", 1, 100, 100, null, null],
  ]);
  assert.deepEqual(p.omitidas, [{ filaId: "b", motivo: "sin_precio" }]);
});

test("idempotente: lo que ya tiene nota viva no se vuelve a cobrar (doble clic = nada)", () => {
  const p = planearNota({
    filas: [fila("a", { invoiceId: "n1" }), fila("b", { invoiceId: "n1" })],
    notas: [nota("n1")], facturasVivas: ["n1"], presupuesto: null,
  });
  assert.equal(p.destino, null);
  assert.deepEqual(p.lineas, []);
});

test("el plan crece: la nota abierta recibe la línea; pagada o timbrada → nota adicional", () => {
  const filas = [fila("a", { invoiceId: "n1" }), fila("b", { createdAt: DESPUES })];
  const abierta = planearNota({ filas, notas: [nota("n1")], facturasVivas: ["n1"], presupuesto: null });
  assert.equal(abierta.destino?.tipo, "agregar");
  assert.equal((abierta.destino as any).nota.id, "n1");
  assert.deepEqual(abierta.lineas.map((l) => l.filaId), ["b"]);
  const pagada = planearNota({ filas, notas: [nota("n1", { status: "PAID", paid: 100 })], facturasVivas: ["n1"], presupuesto: null });
  assert.deepEqual(pagada.destino, { tipo: "nueva" });
  const timbrada = planearNota({ filas, notas: [nota("n1", { cfdiUuid: "uuid" })], facturasVivas: ["n1"], presupuesto: null });
  assert.deepEqual(timbrada.destino, { tipo: "nueva" });
  // de dos abiertas, la más reciente
  assert.equal(notaAbierta([nota("vieja"), nota("nueva", { createdAt: DESPUES }), nota("cerrada", { status: "PAID", createdAt: new Date("2030-01-01") })])!.id, "nueva");
});

test("nota cancelada: sus filas se vuelven a cobrar y la liga vieja se reemplaza", () => {
  const p = planearNota({ filas: [fila("a", { invoiceId: "cancelada" })], notas: [nota("cancelada", { status: "CANCELLED" })], facturasVivas: [], presupuesto: null });
  assert.deepEqual(p.destino, { tipo: "nueva" });
  assert.deepEqual(p.reemplazar, ["cancelada"]);
  assert.equal(p.lineas.length, 1);
});

test("con presupuesto aceptado: manda lo firmado (descuento de línea y global), y lo no aceptado no se cobra", () => {
  const p = planearNota({
    filas: [fila("a", { quoteItemId: "qa", precioCentavos: 1000_00 }), fila("b", { quoteItemId: "qb", orden: 1 })],
    notas: [], facturasVivas: [],
    presupuesto: presupuesto({
      conceptos: [concepto("qa", { precio: 1000, descuento: 50, descuentoGlobal: 95 }), concepto("qb", { aceptado: false })],
    }),
  });
  assert.equal(p.lineas.length, 1);
  assert.deepEqual([p.lineas[0].filaId, p.lineas[0].quoteItemId, p.lineas[0].unitPrice, p.lineas[0].discount, p.lineas[0].neto], ["a", "qa", 1000, 145, 855]);
  assert.deepEqual(p.omitidas, [{ filaId: "b", motivo: "no_aceptada" }]);
});

test("lo que el presupuesto YA cobró («Se cobrará hoy» o la factura de siempre) se liga, no se cobra otra vez", () => {
  const filas = [fila("a", { quoteItemId: "qa" }), fila("b", { quoteItemId: "qb", orden: 1 })];
  const conCargo = planearNota({
    filas, notas: [], facturasVivas: [],
    presupuesto: presupuesto({ conceptos: [concepto("qa"), concepto("qb")], cargos: [{ quoteItemId: "qa", invoiceId: "hoy" }] }),
  });
  assert.deepEqual(conCargo.ligarExistentes, [{ filaId: "a", invoiceId: "hoy" }]);
  assert.deepEqual(conCargo.lineas.map((l) => l.filaId), ["b"]);
  const vieja = planearNota({
    filas, notas: [], facturasVivas: [],
    presupuesto: presupuesto({ conceptos: [concepto("qa"), concepto("qb")], facturaVieja: "todo" }),
  });
  assert.deepEqual(vieja.ligarExistentes.map((l) => l.invoiceId), ["todo", "todo"]);
  assert.equal(vieja.destino, null);
});

test("el editor rehízo los conceptos: la fila se reconoce por nombre + dientes + cantidad y se reanota", () => {
  const p = planearNota({
    filas: [fila("a", { nombre: "Resina", dientes: [16], quoteItemId: "viejo" })],
    notas: [], facturasVivas: [],
    presupuesto: presupuesto({ conceptos: [concepto("nuevo", { nombre: "resina", toothFdi: "16", precio: 900 })] }),
  });
  assert.deepEqual(p.religar, [{ filaId: "a", quoteItemId: "nuevo" }]);
  assert.equal(p.lineas[0].unitPrice, 900, "el precio firmado");
});

test("fila que estaba al aceptar y no está en el presupuesto: no se aceptó; la que se agregó después sí se cobra", () => {
  const p = planearNota({
    filas: [fila("antes", { createdAt: T0 }), fila("despues", { createdAt: DESPUES, orden: 1 })],
    notas: [], facturasVivas: [],
    presupuesto: presupuesto({ aceptadoEn: new Date("2026-10-20T12:00:00Z"), conceptos: [] }),
  });
  assert.deepEqual(p.omitidas, [{ filaId: "antes", motivo: "no_aceptada" }]);
  assert.deepEqual(p.lineas.map((l) => l.filaId), ["despues"]);
});

test("concepto aceptado sin fila (lo agregaron en el editor): se cobra una vez, sin fila; ya cobrado, no", () => {
  const base = { filas: [], notas: [], facturasVivas: [] };
  const p = planearNota({ ...base, presupuesto: presupuesto({ conceptos: [concepto("extra", { nombre: "Radiografía", precio: 350 })] }) });
  assert.deepEqual(p.lineas.map((l) => [l.filaId, l.quoteItemId, l.name, l.neto]), [[null, "extra", "Radiografía", 350]]);
  const ya = planearNota({ ...base, presupuesto: presupuesto({ conceptos: [concepto("extra")], cargos: [{ quoteItemId: "extra", invoiceId: "n1" }] }) });
  assert.equal(ya.destino, null);
});

test("después de cobrar, volver a planear con lo escrito no deja nada (la regla de oro, de punta a punta)", () => {
  const filas = [fila("a", { quoteItemId: "qa" }), fila("b", { createdAt: DESPUES, orden: 1 })];
  const pres = presupuesto({ conceptos: [concepto("qa"), concepto("extra")] });
  const primero = planearNota({ filas, notas: [], facturasVivas: [], presupuesto: pres });
  assert.equal(primero.lineas.length, 3);
  // Lo que escribe el ejecutor: filas ligadas a la nota y cargos anotados de los conceptos.
  const ligadas = filas.map((f) => ({ ...f, invoiceId: "n1" }));
  const cargos = primero.lineas.filter((l) => l.quoteItemId).map((l) => ({ quoteItemId: l.quoteItemId, invoiceId: "n1" }));
  const segundo = planearNota({ filas: ligadas, notas: [nota("n1")], facturasVivas: ["n1"], presupuesto: { ...pres, cargos } });
  assert.equal(segundo.destino, null);
  assert.deepEqual(segundo.lineas, []);
});

test("la cuenta del plan: facturado, pagado (anticipo incluido), saldo y lo que falta por facturar", () => {
  const c = cuentaDelPlan({
    total: 5000,
    facturas: [
      { id: "n1", invoiceNumber: "F-1", status: "PARTIAL", total: 3000, paid: 1200 },
      { id: "n2", invoiceNumber: "F-2", status: "PAID", total: 1000, paid: 1000 },
      { id: "n3", invoiceNumber: "F-3", status: "CANCELLED", total: 900, paid: 0 },
    ],
  });
  assert.deepEqual([c.total, c.facturado, c.pagado, c.saldo, c.porFacturar], [5000, 4000, 2200, 1800, 1000]);
  assert.deepEqual(c.notas.map((n) => n.id), ["n1", "n2"], "la cancelada no cuenta");
  assert.equal(c.soloDelPlan, true);
});

test("Cobrar hoy con plan: el pago abona a las notas del plan, de la más vieja a la más nueva, nunca de más", () => {
  const notas = [
    { invoiceId: "n2", invoiceNumber: "F-2", status: "PENDING", total: 500, paid: 0, createdAt: DESPUES },
    { invoiceId: "n1", invoiceNumber: "F-1", status: "PARTIAL", total: 1000, paid: 700, createdAt: T0 },
    { invoiceId: "n0", invoiceNumber: "F-0", status: "PAID", total: 100, paid: 100, createdAt: T0 },
  ];
  const a = abonoAlPlan(notas, "450");
  assert.equal(a.falta, null);
  assert.deepEqual(a.reparto, [{ invoiceId: "n1", invoiceNumber: "F-1", monto: 300 }, { invoiceId: "n2", invoiceNumber: "F-2", monto: 150 }]);
  assert.deepEqual([a.abonado, a.debe, a.saldoQueda], [450, 800, 350]);
  assert.equal(abonoAlPlan(notas, 801).falta, "pago_mayor");
  assert.equal(abonoAlPlan(notas, 0).falta, "pago_invalido");
  assert.equal(abonoAlPlan(notas, "doce").falta, "pago_invalido");
  assert.equal(abonoAlPlan([notas[2]], 10).falta, "sin_nota");
  assert.equal(abonoAlPlan(notas, 800).saldoQueda, 0);
});
