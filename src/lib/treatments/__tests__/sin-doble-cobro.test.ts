/**
 * «Que nada se cobre dos veces» (ws1-t12 · fase 2) — la regla pura: qué de lo que una pantalla va a
 * cobrar ya es una fila de un plan (y entonces se cobra en la nota del plan, no aparte).
 *
 * Run: npm run test:plan-sin-doble-cobro
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conceptosQueYaSonDelPlan,
  emparejarConElPlan,
  filaTomable,
  HECHO_RECIENTE_MS,
  modoInicialCobroHoy,
  nombresApartados,
  soloLoDeFuera,
  type FilaParaEmparejar,
  type PlanConCuenta,
} from "@/lib/treatments/sin-doble-cobro";
import { cuerpoMarcarHecho, marcarHecho, RUTA_MARCAR_HECHO } from "@/lib/treatments/marcar-hecho-cliente";
import { CODIGO_PLAN_CON_NOTA, cuerpoPlanConNota } from "@/lib/treatments/borrar-plan";

const AHORA = new Date("2026-10-21T18:00:00Z");
const fila = (id: string, p: Partial<FilaParaEmparejar> = {}): FilaParaEmparejar => ({
  id, planId: "plan1", nombre: "Resina", procedureId: "proc-r", dientes: [16], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: null, ...p,
});

test("mismo procedimiento y mismo diente = la fila del plan; otro diente no", () => {
  const filas = [fila("a", { dientes: [16] }), fila("b", { dientes: [26] })];
  const e = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r", diente: 26 }, { nombre: "Resina", procedureId: "proc-r", diente: 36 }], filas, AHORA);
  assert.deepEqual(e.delPlan.map((m) => [m.indice, m.filaId]), [[0, "b"]]);
  assert.deepEqual(e.fuera, [0, 1], "la resina del 36 no está en el plan: se cobra como hoy");
});

test("sin diente (la consulta no lo pide) toma una fila del mismo procedimiento; la limpieza de toda la boca vale para cualquier diente", () => {
  const filas = [fila("a"), fila("l", { nombre: "Limpieza", procedureId: "proc-l", dientes: [] })];
  const e = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r" }, { nombre: "Limpieza", procedureId: "proc-l", diente: 31 }], filas, AHORA);
  assert.deepEqual(e.delPlan.map((m) => m.filaId), ["a", "l"]);
  assert.deepEqual(e.fuera, [0, 0]);
});

test("cada unidad toma UNA unidad de fila: dos resinas hoy y una en el plan dejan una para la factura de la consulta", () => {
  const e = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r", cantidad: 2 }], [fila("a")], AHORA);
  assert.deepEqual(e.fuera, [1]);
  assert.equal(e.delPlan[0].unidades, 1);
  const dos = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r", cantidad: 2 }], [fila("a", { cantidad: 2 })], AHORA);
  assert.deepEqual(dos.fuera, [0]);
  // Dos cosas iguales no toman la misma fila dos veces.
  const repetida = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r" }, { nombre: "Resina", procedureId: "proc-r" }], [fila("a")], AHORA);
  assert.deepEqual(repetida.fuera, [0, 1]);
});

test("hecha hace poco (el «hecho → odontograma» de hoy) cuenta; hecha hace días o cancelada, no", () => {
  const reciente = fila("r", { estado: "hecho", hechoEn: new Date(AHORA.getTime() - 60_000) });
  const vieja = fila("v", { estado: "hecho", hechoEn: new Date(AHORA.getTime() - HECHO_RECIENTE_MS - 1) });
  const cancelada = fila("c", { estado: "cancelado" });
  assert.equal(filaTomable(reciente, AHORA), true);
  assert.equal(filaTomable(vieja, AHORA), false);
  assert.equal(filaTomable(cancelada, AHORA), false);
  assert.equal(filaTomable(fila("e", { estado: "en_curso" }), AHORA), true);
  const e = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r" }], [vieja, cancelada], AHORA);
  assert.deepEqual(e.fuera, [1], "trabajo nuevo: se cobra como hoy");
  const e2 = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r" }], [reciente], AHORA);
  assert.deepEqual(e2.fuera, [0]);
});

test("se reconoce por id, por nombre (sin acentos ni mayúsculas) o por TIPO de procedimiento; otro tipo no", () => {
  const e = emparejarConElPlan([{ nombre: "  RESINA " }], [fila("a", { procedureId: null })], AHORA);
  assert.deepEqual(e.fuera, [0]);
  // Dos procedimientos del tarifario con el mismo nombre: es el mismo trabajo (revisión, hallazgo 1).
  const e2 = emparejarConElPlan([{ nombre: "Resina", procedureId: "otra" }], [fila("a")], AHORA);
  assert.deepEqual(e2.fuera, [0]);
  const acento = emparejarConElPlan([{ nombre: "Extraccion" }], [fila("x", { nombre: "Extracción", procedureId: null, dientes: [] })], AHORA);
  assert.deepEqual(acento.fuera, [0]);
  // Otro procedimiento del tarifario, mismo tipo: «Restauración con resina» (ODO_RESINA del odontograma) = «Resina 2 caras» del plan.
  const tipo = emparejarConElPlan(
    [{ nombre: "Restauración con resina", codigo: "ODO_RESINA", procedureId: "proc-odo", diente: 16 }],
    [fila("a", { nombre: "Restauración resina 2 caras", procedureId: "proc-2c" })],
    AHORA,
  );
  assert.deepEqual(tipo.fuera, [0]);
  const otroTipo = emparejarConElPlan([{ nombre: "Blanqueamiento", procedureId: "proc-b", diente: 16 }], [fila("a")], AHORA);
  assert.deepEqual(otroTipo.fuera, [1]);
  const corona = emparejarConElPlan([{ nombre: "Corona de zirconio", procedureId: "z", diente: 16 }], [fila("a")], AHORA);
  assert.deepEqual(corona.fuera, [1], "una corona no es la resina del plan");
});

test("el odontograma propone una resina POR CARA: 16 M y 16 O son la resina «2 caras» del plan, no dos", () => {
  const caras = [
    { nombre: "Restauración con resina", codigo: "ODO_RESINA", procedureId: "proc-odo", diente: 16 },
    { nombre: "Restauración con resina", codigo: "ODO_RESINA", procedureId: "proc-odo", diente: 16 },
    { nombre: "Restauración con resina", codigo: "ODO_RESINA", procedureId: "proc-odo", diente: 26 },
  ];
  const e = emparejarConElPlan(caras, [fila("a", { nombre: "Resina 2 caras", procedureId: "proc-2c", dientes: [16] })], AHORA);
  assert.deepEqual(e.fuera, [0, 0, 1], "las dos caras del 16 son la fila; el 26 no está en el plan");
  // Una fila con dos dientes cubre los dos aunque diga cantidad 1.
  const dos = emparejarConElPlan(caras, [fila("a", { dientes: [16, 26] })], AHORA);
  assert.deepEqual(dos.fuera, [0, 0, 0]);
});

test("prefiere el mismo diente y, a igualdad, la fila que ya está en una nota", () => {
  const filas = [fila("libre", { dientes: [] }), fila("16", { dientes: [16] }), fila("nota", { dientes: [], invoiceId: "inv1" })];
  const e = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r", diente: 16 }], filas, AHORA);
  assert.equal(e.delPlan[0].filaId, "16");
  const e2 = emparejarConElPlan([{ nombre: "Resina", procedureId: "proc-r" }], [fila("libre"), fila("nota", { invoiceId: "inv1" })], AHORA);
  assert.deepEqual([e2.delPlan[0].filaId, e2.delPlan[0].enNota], ["nota", true]);
});

test("soloLoDeFuera deja en la factura suelta solo lo que no es de ningún plan, con su cantidad", () => {
  const cosas = [
    { nombre: "Resina", procedureId: "proc-r", cantidad: 3, price: 1250 },
    { nombre: "Blanqueamiento", procedureId: "proc-b", cantidad: 1, price: 3000 },
  ];
  const e = emparejarConElPlan(cosas, [fila("a", { cantidad: 2 })], AHORA);
  const fuera = soloLoDeFuera(cosas, e);
  assert.deepEqual(fuera.map((c) => [c.nombre, c.cantidad, c.price]), [["Resina", 1, 1250], ["Blanqueamiento", 1, 3000]]);
  assert.deepEqual(nombresApartados(cosas, e), ["Resina"]);
  const todo = emparejarConElPlan([cosas[0]], [fila("a", { cantidad: 5 })], AHORA);
  assert.deepEqual(soloLoDeFuera([cosas[0]], todo), [], "todo es del plan: no hay factura suelta");
});

const plan = (p: Partial<PlanConCuenta> = {}): PlanConCuenta => ({
  planId: "plan1", nombre: "Plan Ana", estado: "ACTIVE", conFilas: true, total: 5000, facturado: 5000, pagado: 1000, soloDelPlan: true,
  saldo: 4000, porFacturar: 0, notas: [{ invoiceId: "n1", invoiceNumber: "F-1", status: "PARTIAL", total: 5000, paid: 1000, createdAt: "2026-10-01T00:00:00Z" }],
  filas: [fila("a", { invoiceId: "n1" })], ...p,
});

test("«Cobrar hoy»: con plan que debe → abono a su nota; plan sin nota → crear la nota del plan; sin plan (o plan de texto) → la nota de siempre", () => {
  assert.deepEqual(modoInicialCobroHoy([plan()]), { modo: "abono", planId: "plan1" });
  assert.deepEqual(modoInicialCobroHoy([plan({ saldo: 0, porFacturar: 2500, notas: [] })]), { modo: "nota_del_plan", planId: "plan1" });
  assert.deepEqual(modoInicialCobroHoy([plan({ saldo: 0, porFacturar: 0 })]), { modo: "nota_nueva", planId: null }, "plan pagado: lo de hoy es otra cosa");
  assert.deepEqual(modoInicialCobroHoy([plan({ conFilas: false })]), { modo: "nota_nueva", planId: null }, "un plan de texto se cobra como siempre");
  assert.deepEqual(modoInicialCobroHoy([]), { modo: "nota_nueva", planId: null });
});

test("«Cobrar hoy» en nota nueva: un concepto que ya es del plan se señala (cobrarlo aparte = dos veces)", () => {
  const ya = conceptosQueYaSonDelPlan([{ nombre: "Blanqueamiento" }, { nombre: "Resina", procedureId: "proc-r" }], [plan()], AHORA);
  assert.deepEqual(ya, [{ indice: 1, plan: "Plan Ana" }]);
  assert.deepEqual(conceptosQueYaSonDelPlan([{ nombre: "Blanqueamiento" }], [plan()], AHORA), []);
});

const respuesta = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

test("marcar hecho: manda la acción de B (itemIds del plan); un PATCH que no la conoce («edición general») NO cuenta como hecho", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const ok = await marcarHecho("plan 1", ["f1", "f2"], "cita1", async (u, i) => { url = u; init = i; return respuesta(200, { success: true, items: [{ id: "f1", estado: "hecho" }] }); });
  assert.equal(ok.ok, true);
  assert.equal(url, RUTA_MARCAR_HECHO("plan 1"));
  assert.equal(url, "/api/treatments/plan%201");
  assert.equal(init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(init?.body)), { action: "marcar_hecho", itemIds: ["f1", "f2"], citaId: "cita1" });
  assert.deepEqual(cuerpoMarcarHecho(["f1"], null), { action: "marcar_hecho", itemIds: ["f1"] });
  assert.deepEqual(await marcarHecho("p", ["f"], null, async () => respuesta(200, { success: true })), { ok: false, noDisponible: true, status: 200 });
  assert.deepEqual(await marcarHecho("p", ["f"], null, async () => respuesta(200, { items: [] })), { ok: true, status: 200 });
  assert.deepEqual(await marcarHecho("p", ["f"], null, async () => respuesta(409, { error: "fila_hecha" })), { ok: false, status: 409, error: "fila_hecha" });
  assert.deepEqual(await marcarHecho("p", ["f"], null, async () => { throw new Error("red"); }), { ok: false, status: 0 });
});

test("borrar un plan con nota: 409 con código, folios y la salida (cancelarlo)", () => {
  const c = cuerpoPlanConNota(["F-12", ""]);
  assert.equal(c.code, CODIGO_PLAN_CON_NOTA);
  assert.deepEqual(c.notas, ["F-12"]);
  assert.match(c.error, /F-12/);
  assert.match(c.error, /cancelarlo/);
});
