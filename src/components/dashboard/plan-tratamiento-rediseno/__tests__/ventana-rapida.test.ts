/**
 * La ventana rápida «Armar el plan» (ws1-t5, fase 2 · P3): chips del odontograma → renglones con
 * procedimiento, precio y fase; lo que se manda a la API (contrato de filas de t12) y cómo se lee
 * lo que contesta.
 *
 * Run: npm run test:plan-ventana
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hallazgosPorTratar, totalProcedimientos, type EntradaOdontograma, type Renglon } from "../plan-clinico";
import { agregarDesdeChip, chipsDelPlan, filasParaGuardar, nombrePorDefecto, sillon, type Chip } from "../armar-plan";
import { cuerpoDeAlta, guardarPlan, presentarDisponible, presentarPlan, RUTA_PRESENTAR, type AltaDePlan } from "../guardar-plan";
import { leerFilas } from "@/lib/treatments/items";
import type { ProcedimientoTarifario } from "@/lib/treatments/sugerir-procedimiento";

let n = 0;
const p = (name: string, basePrice: number, duration: number | null): ProcedimientoTarifario =>
  ({ id: `p${++n}`, name, basePrice, duration, category: "dental", code: null, isActive: true });

const TARIFARIO = [
  p("Profilaxis (limpieza)", 600, 30), p("Extracción simple", 800, 30),
  p("Restauración resina 1 cara", 700, 30), p("Restauración resina 2 caras", 900, 45), p("Restauración resina 3 caras", 1200, 60),
  p("Corona metal-porcelana", 4500, 60), p("Endodoncia multirradicular", 4500, 120),
];

/** El paciente de la maqueta: cinco hallazgos por tratar y una corona ya hecha. */
const ENTRADAS: EntradaOdontograma[] = [
  { toothNumber: 16, surface: "M", conditionId: "caries" },
  { toothNumber: 16, surface: "O", conditionId: "caries" },
  { toothNumber: 26, surface: "O", conditionId: "caries" },
  { toothNumber: 36, surface: null, conditionId: "pulpitis" },
  { toothNumber: 18, surface: null, conditionId: "ext_indicated" },
  { toothNumber: 31, surface: "L", conditionId: "calculus" },
  { toothNumber: 41, surface: "L", conditionId: "calculus" },
  { toothNumber: 42, surface: "L", conditionId: "calculus" },
  { toothNumber: 46, surface: null, conditionId: "crown" },
];
const HALLAZGOS = hallazgosPorTratar(ENTRADAS);

let id = 0;
const ctx = (motivo = "m") => ({ tarifario: TARIFARIO, entradas: ENTRADAS, nuevoId: () => `t${++id}`, motivo, idioma: "es" as const });
const chips = (renglones: Renglon[]) => chipsDelPlan(HALLAZGOS, TARIFARIO, ENTRADAS, renglones);
const tocar = (renglones: Renglon[], clave: string): Renglon[] => {
  const c = chips(renglones).find((x) => x.clave === clave);
  assert.ok(c, `no hay chip ${clave}`);
  return agregarDesdeChip(renglones, c as Chip, ctx());
};

test("un chip por hallazgo, el cálculo de toda la boca en uno solo, cada uno con lo que entra al tocarlo", () => {
  const cs = chips([]);
  assert.deepEqual(cs.map((c) => [c.clave, c.dientes.join(","), c.sugerencia?.nombre, c.puesto]), [
    ["h:36:pulpitis", "36", "Endodoncia multirradicular", false],
    ["h:16:caries", "16", "Restauración resina 2 caras", false],
    ["h:18:ext_indicated", "18", "Extracción simple", false],
    ["h:26:caries", "26", "Restauración resina 1 cara", false],
    ["g:limpieza", "31,41,42", "Profilaxis (limpieza)", false],
  ]);
});

test("plan de 5 procedimientos con 5 toques; la corona sugerida aparece tras la endodoncia", () => {
  let r: Renglon[] = [];
  for (const c of ["h:36:pulpitis", "h:16:caries", "h:18:ext_indicated", "h:26:caries", "g:limpieza"]) r = tocar(r, c);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((x) => [x.fase, x.procedimiento, x.dientes, x.caras.join(""), x.precio, x.minutos]), [
    ["urgencia", "Endodoncia multirradicular", "36", "", "4500", 120],
    ["higienica", "Restauración resina 2 caras", "16", "MO", "900", 45],
    ["higienica", "Extracción simple", "18", "", "800", 30],
    ["higienica", "Restauración resina 1 cara", "26", "O", "700", 30],
    ["higienica", "Profilaxis (limpieza)", "", "", "600", 30],  // toda la boca: sin dientes
  ]);
  assert.equal(totalProcedimientos(r), 4500 + 900 + 800 + 700 + 600);
  // Todos los chips de hallazgo quedan puestos; sale el encadenado.
  const cs = chips(r);
  assert.ok(cs.filter((c) => c.tipo === "hallazgo").every((c) => c.puesto));
  assert.deepEqual(cs.filter((c) => c.tipo === "encadenada").map((c) => [c.clave, c.sugerencia?.nombre]), [["e:corona:36", "Corona metal-porcelana"]]);
  r = tocar(r, "e:corona:36");
  assert.deepEqual([r[5].fase, r[5].procedimiento, r[5].dientes], ["restauradora", "Corona metal-porcelana", "36"]);
  assert.equal(chips(r).some((c) => c.tipo === "encadenada"), false);
  // Tocar un chip ya puesto no hace nada.
  const puesto = chips(r).find((c) => c.clave === "h:16:caries")!;
  assert.equal(agregarDesdeChip(r, puesto, ctx()), r);
  // Quitar la endodoncia libera su chip y se lleva el encadenado.
  const sinEndo = r.filter((x) => x.clave !== "endodoncia");
  assert.equal(chips(sinEndo).find((c) => c.clave === "h:36:pulpitis")!.puesto, false);
});

test("dos hallazgos del mismo diente que piden lo mismo: una resina con las caras juntas y su variante", () => {
  const ent: EntradaOdontograma[] = [
    { toothNumber: 16, surface: "M", conditionId: "caries" },
    { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 16, surface: "D", conditionId: "temp_rest" },
  ];
  const hs = hallazgosPorTratar(ent);
  let r: Renglon[] = [];
  for (const c of chipsDelPlan(hs, TARIFARIO, ent, [])) r = agregarDesdeChip(r, c, { ...ctx(), entradas: ent });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].procedimiento, r[0].caras.join(""), r[0].precio, r[0].origen], ["Restauración resina 3 caras", "MOD", "1200", ["16:caries", "16:temp_rest"]]);
  assert.ok(chipsDelPlan(hs, TARIFARIO, ent, r).every((c) => c.puesto));
});

test("si el doctor ya cambió el precio, juntar caras no se lo pisa", () => {
  const ent: EntradaOdontograma[] = [
    { toothNumber: 16, surface: "M", conditionId: "caries" },
    { toothNumber: 16, surface: "D", conditionId: "temp_rest" },
  ];
  const hs = hallazgosPorTratar(ent);
  const [c1, c2] = chipsDelPlan(hs, TARIFARIO, ent, []);
  let r = agregarDesdeChip([], c1, { ...ctx(), entradas: ent });
  r = r.map((x) => ({ ...x, precio: "650", precioDelTarifario: false }));
  r = agregarDesdeChip(r, chipsDelPlan(hs, TARIFARIO, ent, r).find((c) => c.clave === c2.clave)!, { ...ctx(), entradas: ent });
  assert.deepEqual([r.length, r[0].caras.join(""), r[0].precio], [1, "MD", "650"]);
});

test("sin el procedimiento en el tarifario: el renglón entra con el nombre sugerido y SIN precio", () => {
  const ent: EntradaOdontograma[] = [{ toothNumber: 85, surface: null, conditionId: "pulpitis" }];
  const hs = hallazgosPorTratar(ent);
  const [c] = chipsDelPlan(hs, TARIFARIO, ent, []);
  assert.equal(c.sugerencia?.elegir, true);
  const r = agregarDesdeChip([], c, { ...ctx(), entradas: ent });
  assert.deepEqual([r[0].procedimiento, r[0].procedimientoId, r[0].precio, r[0].precioDelTarifario], ["Pulpotomía", null, "", false]);
});

test("lo que se llena solo: el nombre del plan y el sillón", () => {
  assert.equal(nombrePorDefecto(new Date(2026, 9, 20), "es"), "Plan 20 oct 2026");
  assert.equal(nombrePorDefecto(new Date(2026, 9, 20), "en"), "Plan Oct 20, 2026");
  let r: Renglon[] = [];
  for (const c of ["h:36:pulpitis", "h:16:caries"]) r = tocar(r, c);
  assert.deepEqual(sillon(r), { minutos: 165, citas: 3 }); // urgencia 120 min = 2 citas; higiénica 45 min = 1
  assert.deepEqual(sillon([]), { minutos: 0, citas: 0 });
});

test("las filas que se mandan pasan TAL CUAL el contrato de t12 (leerFilas)", () => {
  let r: Renglon[] = [];
  for (const c of ["h:36:pulpitis", "h:16:caries", "g:limpieza"]) r = tocar(r, c);
  r.push({ id: "manual", fase: "mantenimiento", procedimiento: "Revisión", procedimientoId: null, dientes: "", caras: [], motivo: "",
    cantidad: "2", precio: "350.50", precioDelTarifario: false, minutos: 0 });
  r.push({ id: "vacio", fase: "higienica", procedimiento: "  ", procedimientoId: null, dientes: "", caras: [], motivo: "",
    cantidad: "1", precio: "", precioDelTarifario: false, minutos: 0 });  // sin procedimiento: no se manda
  const filas = filasParaGuardar(r);
  assert.equal(filas.length, 4);
  const leidas = leerFilas(filas);
  assert.equal(leidas.ok, true, JSON.stringify(leidas));
  assert.deepEqual(leidas.filas!.map((f) => [f.nombre, f.fase, f.dientes.join(","), f.caras.join(""), f.cantidad, f.precioCentavos, f.estado, f.hallazgo?.condicion ?? null]), [
    ["Endodoncia multirradicular", "urgencia", "36", "", 1, 450000, "pendiente", "pulpitis"],
    ["Restauración resina 2 caras", "higienica", "16", "MO", 1, 90000, "pendiente", "caries"],
    ["Profilaxis (limpieza)", "higienica", "", "", 1, 60000, "pendiente", "calculus"],
    ["Revisión", "mantenimiento", "", "", 2, 35050, "pendiente", null],
  ]);
  assert.equal(leidas.filas![0].procedureId, TARIFARIO.find((x) => x.name === "Endodoncia multirradicular")!.id);
  assert.deepEqual(leidas.filas![2].hallazgo, { condicion: "calculus", diente: null, caras: [], entryId: null });
});

// ═══════════════════════════════════════════════════════════════════════════
// Guardar y presentar
// ═══════════════════════════════════════════════════════════════════════════

const ALTA: AltaDePlan = {
  patientId: "pac1", doctorId: "doc1", name: "  Plan 20 oct 2026 ", description: "▸ texto", totalSessions: 3,
  sessionIntervalDays: 30, totalCost: 7500, confirmarSinCosto: false, items: [],
};

const respuesta = (status: number, cuerpo: unknown, tipo = "application/json") =>
  new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status, headers: { "content-type": tipo } });

test("el POST lleva los siete campos de siempre, el texto del plan y las filas", async () => {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const r = await guardarPlan(ALTA, async (url, init) => { llamadas.push({ url, init }); return respuesta(201, { id: "plan1" }); });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "/api/treatments");
  assert.equal(llamadas[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(llamadas[0].init?.body)), {
    patientId: "pac1", doctorId: "doc1", name: "Plan 20 oct 2026", description: "▸ texto",
    totalSessions: 3, sessionIntervalDays: 30, totalCost: 7500, items: [],
  });
  assert.deepEqual([r.ok, r.modo, r.plan?.id], [true, "texto", "plan1"]);
  assert.equal(cuerpoDeAlta({ ...ALTA, totalCost: 0, confirmarSinCosto: true }).confirmarSinCosto, true);
});

test("la API dice si guardó filas; sin SQL guarda el texto y no es un error", async () => {
  const conFilas = await guardarPlan(ALTA, async () => respuesta(201, { id: "plan1", items: [], filasGuardadas: true }));
  assert.equal(conFilas.modo, "filas");
  const sinFilas = await guardarPlan(ALTA, async () => respuesta(201, { id: "plan1" }));
  assert.deepEqual([sinFilas.ok, sinFilas.modo], [true, "texto"]);
  // ws1-t12 · fase 2: P2 sin el SQL contesta `items: []` y `filasGuardadas: false` — eso es texto.
  const sinSql = await guardarPlan(ALTA, async () => respuesta(201, { id: "plan1", items: [], filasGuardadas: false }));
  assert.equal(sinSql.modo, "texto");
});

test("errores: el de una fila dice cuál; el de la API se enseña tal cual; sin red, status 0", async () => {
  const fila = await guardarPlan(ALTA, async () => respuesta(400, { code: "precio_invalido", indice: 2 }));
  assert.deepEqual([fila.ok, fila.claveError, fila.fila], [false, "planTratamiento.filas.error.precio_invalido", 3]);
  const api = await guardarPlan(ALTA, async () => respuesta(403, { error: "No tienes permiso para editar tratamientos." }));
  assert.deepEqual([api.ok, api.error, api.status], [false, "No tienes permiso para editar tratamientos.", 403]);
  const red = await guardarPlan(ALTA, async () => { throw new TypeError("Failed to fetch"); });
  assert.deepEqual([red.ok, red.status], [false, 0]);
  const raro = await guardarPlan(ALTA, async () => respuesta(200, "<html>", "text/html"));
  assert.equal(raro.ok, false);
});

test("«presentar»: Pronto mientras la ruta no exista; un 404 de la API (plan) es un error, no «Pronto»", async () => {
  assert.equal(RUTA_PRESENTAR("a b"), "/api/treatments/a%20b/presentar");
  assert.equal(await presentarDisponible(async () => respuesta(404, "<html>", "text/html")), false);
  assert.equal(await presentarDisponible(async () => new Response(null, { status: 204 })), true);
  assert.equal(await presentarDisponible(async () => { throw new Error("x"); }), false);
  let metodo: string | undefined;
  await presentarDisponible(async (_u, init) => { metodo = init?.method; return new Response(null, { status: 204 }); });
  assert.equal(metodo, "OPTIONS", "sondear no escribe");

  assert.deepEqual(await presentarPlan("plan1", async () => respuesta(404, "<html>", "text/html")), { ok: false, pronto: true });
  assert.deepEqual(await presentarPlan("plan1", async () => respuesta(404, { error: "Plan no encontrado" })), { ok: false, error: "Plan no encontrado" });
  assert.deepEqual(await presentarPlan("plan1", async () => respuesta(200, { quoteId: "q1", folio: "P-0031", enlaceFirma: "/presupuesto/abc" })),
    { ok: true, quoteId: "q1", folio: "P-0031", enlaceFirma: "/presupuesto/abc" });
});
