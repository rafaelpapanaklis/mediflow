/**
 * El tope de consultas en vuelo y la carga del panel de Cobro (ws1-t10).
 *
 *   npm run test:cobro-panel-rapido
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { limitarConcurrencia } from "../limitar-concurrencia";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("nunca hay más tareas en vuelo que el tope, y todas terminan", async () => {
  const correr = limitarConcurrencia(3);
  let enVuelo = 0;
  let maximo = 0;
  const salidas = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      correr(async () => {
        enVuelo += 1;
        maximo = Math.max(maximo, enVuelo);
        await espera(15);
        enVuelo -= 1;
        return i;
      }),
    ),
  );
  assert.deepEqual(salidas, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "cada tarea devuelve lo suyo, en su sitio");
  assert.equal(maximo, 3);
});

test("con tope, arrancan todas en cuanto hay hueco: 12 lecturas de 40 ms con tope 6 tardan ~2 vueltas, no 12", async () => {
  const correr = limitarConcurrencia(6);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 12 }, () => correr(() => espera(40))));
  const ms = Date.now() - t0;
  assert.ok(ms >= 75, `tardó ${ms} ms: no respeta el tope`);
  assert.ok(ms < 300, `tardó ${ms} ms: casi en fila (serían ~480)`);
});

test("un fallo de una tarea no traba a las demás ni deja el hueco ocupado", async () => {
  const correr = limitarConcurrencia(1);
  const malo = correr(async () => { throw new Error("cae"); });
  const bueno = correr(async () => "sigue");
  await assert.rejects(malo, /cae/);
  assert.equal(await bueno, "sigue");
  // Una tarea que lanza de forma síncrona también libera su hueco.
  await assert.rejects(correr((() => { throw new Error("sync"); }) as () => Promise<never>), /sync/);
  assert.equal(await correr(async () => 1), 1);
});

test("tope inválido (0, NaN, negativo) se trata como 1: nunca se queda sin correr", async () => {
  for (const n of [0, -3, NaN]) {
    assert.equal(await limitarConcurrencia(n)(async () => "ok"), "ok");
  }
});

// ── La carga del panel de Cobro: la forma, no los milisegundos ──────────────

const RAIZ = join(__dirname, "..", "..", "..");
const codigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("cargarPanelDeCobro: todo arranca junto con tope de 6, el catálogo se lee UNA vez y nada se pide en cadena", () => {
  const a = codigo("src/app/actions/orthodontics/cobro/cargarPanelDeCobro.ts");
  assert.match(a, /limitarConcurrencia\(6\)/);
  assert.equal((a.match(/listarProcedimientosDeOrtodoncia\(/g) ?? []).length, 1, "el catálogo se leía dos veces (extras y precio de la colocación)");
  assert.doesNotMatch(a, /precioDeColocacionDelCatalogo/);
  assert.match(a, /elegirPrecioColocacion\(filasCatalogo\)/);
  // La factura y sus condiciones salen del id del caso, sin esperarse una a la otra.
  assert.match(a, /invoiceIds: \[caso\.invoiceId!\]/);
  // Ninguna tanda con 7 o más lecturas (CLAUDE.md: el pooler se satura).
  for (const m of a.matchAll(/Promise\.all\(\[([^\]]*)\]\)/g)) {
    assert.ok(m[1].split(",").filter((x) => x.trim()).length < 7, `Promise.all demasiado ancho: ${m[1]}`);
  }
});

test("cargarPanelDeCobro: todas las lecturas siguen filtrando por la clínica de la SESIÓN y nada sale si el caso no pasa", () => {
  const a = codigo("src/app/actions/orthodontics/cobro/cargarPanelDeCobro.ts");
  assert.ok(a.indexOf("if (isFailure(casoResult)) return casoResult;") > 0);
  // Todo lo que se pide antes de saber si el caso pasa va con ctx.clinicId.
  const antes = a.slice(a.indexOf("const pCaso"), a.indexOf("const casoResult"));
  for (const linea of antes.split("\n").filter((l) => /const p[A-Z]/.test(l))) {
    assert.match(linea, /ctx\.clinicId|ctx,/, `lectura sin clínica de la sesión: ${linea.trim()}`);
  }
  assert.doesNotMatch(a, /clinicId: (input|params|treatmentPlan)/);
  // Y la respuesta al no pasar es la misma de siempre, antes de devolver datos.
  assert.ok(a.indexOf("return casoResult") < a.indexOf("return ok({"));
});

test("loadCasoParaCobro: el caso y el nombre de su técnica se piden juntos", () => {
  const c = codigo("src/app/actions/orthodontics/cobro/_ctx.ts");
  assert.match(c, /\[plan, techniqueName\] = await Promise\.all\(\[/);
  assert.doesNotMatch(c, /techniqueName: await/);
});
