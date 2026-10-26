/**
 * ws1-t4 · Sabina `comparar_sedes` y la «Clave de la sede».
 *
 * Run: npm run test:sede-clave
 *
 * Una sede hermana con clave que esta persona no ha tecleado en este navegador
 * NO entra en la comparación: sale solo su nombre, en `conClave`, y el resumen
 * le dice al modelo que no invente cifras. La regla (qué sede está cerrada) es
 * la de @/lib/sede-clave/gate.server, que aquí se dobla: lo que se prueba es
 * que Sabina la respete. Sobre la misma base de mentira que comparar-sedes.test.ts.
 */
import "./preparar";
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let cerradas = new Set<string>();
let preguntas: Array<{ supabaseId: string; ids: string[] }> = [];
mock.module("@/lib/sede-clave/gate.server", {
  namedExports: {
    sedesCerradasPara: async (supabaseId: string, ids: readonly string[]) => {
      preguntas.push({ supabaseId, ids: [...ids] });
      return new Set(ids.filter((id) => cerradas.has(id)));
    },
    sedesConClave: async () => new Set<string>(),
    sedeCerradaPara: async () => false,
  },
});

beforeEach(() => {
  cerradas = new Set();
  preguntas = [];
});

async function cargar() {
  const { correrHerramienta } = await import("../base");
  const { compararSedes } = await import("../comparar-sedes");
  const { ingresosPorPeriodo } = await import("../ingresos-por-periodo");
  const s = await import("./sedes-siembra");
  return { correrHerramienta, compararSedes, ingresosPorPeriodo, ...s };
}

test("sin claves, la comparación es la de siempre (las dos sedes)", async () => {
  const { correrHerramienta, compararSedes, baseDeSedes, rafaEnNorte, NOMBRE_NORTE, NOMBRE_SUR } = await cargar();
  const r: any = await correrHerramienta(compararSedes, rafaEnNorte(baseDeSedes()), {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.datos.sedes.map((x: any) => x.nombre), [NOMBRE_NORTE, NOMBRE_SUR]);
  assert.deepEqual(r.datos.conClave, []);
});

test("la hermana con clave sin desbloquear: fuera de la comparación, solo su nombre, y el resumen lo dice", async () => {
  const {
    correrHerramienta, compararSedes, ingresosPorPeriodo, baseDeSedes, rafaEnNorte, rafaEnSur,
    NOMBRE_NORTE, NOMBRE_SUR, SB_RAFA,
  } = await cargar();
  const { CL_SUR } = await import("./siembra");
  cerradas = new Set([CL_SUR]);

  const r: any = await correrHerramienta(compararSedes, rafaEnNorte(baseDeSedes()), {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.datos.sedes.map((x: any) => x.nombre), [NOMBRE_NORTE], "solo la activa");
  assert.deepEqual(r.datos.conClave, [NOMBRE_SUR]);
  assert.equal(r.datos.totalSedes, 1, "la cerrada no cuenta como comparable");
  assert.equal(r.datos.truncado, false, "no se le echa la culpa al tope");
  assert.ok(r.resumen.includes(NOMBRE_SUR) && r.resumen.includes("clave de sede"), r.resumen);
  assert.ok(r.resumen.includes("NO inventes"), r.resumen);
  assert.equal(r.resumen.includes("Solo tienes una sede"), false, "no tiene una sola sede: no la puede mirar");
  assert.equal(JSON.stringify(r).includes(CL_SUR), false, "ni el id de la sede cerrada");

  // Ninguna cifra de la sede cerrada en la respuesta.
  const soloSur: any = await correrHerramienta(ingresosPorPeriodo, rafaEnSur(baseDeSedes()), {
    desde: r.datos.desde, hasta: r.datos.hasta, agrupar: "mes",
  });
  const netosSur = soloSur.datos.ingresosNetos;
  assert.ok(netosSur > 0, "la siembra de Centro tiene ingresos");
  assert.equal(JSON.stringify(r).includes(String(netosSur)), false, `se coló la cifra de Centro (${netosSur})`);

  // La pregunta se hizo con la persona de la SESIÓN y solo por las hermanas.
  assert.equal(preguntas.length, 1);
  assert.equal(preguntas[0].supabaseId, SB_RAFA);
  assert.deepEqual(preguntas[0].ids, [CL_SUR]);
});

test("si no se puede saber qué sedes tienen clave, Sabina mira solo la activa", async () => {
  const { correrHerramienta, compararSedes, baseDeSedes, rafaEnNorte, NOMBRE_NORTE } = await cargar();
  const { CL_SUR } = await import("./siembra");
  // sedesCerradasPara falla cerrado: todas las hermanas «cerradas».
  cerradas = new Set([CL_SUR]);
  const r: any = await correrHerramienta(compararSedes, rafaEnNorte(baseDeSedes()), { metrica: "dinero" });
  assert.deepEqual(r.datos.sedes.map((x: any) => x.nombre), [NOMBRE_NORTE]);
});
