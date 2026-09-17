/**
 * CANDADOS DE «AUTOCOMPLETAR LA PÁGINA WEB» (ws1-t6).
 *
 * Run: npx tsx --test src/components/dashboard/pagina-web-autocompletar/__tests__/pagina-web-autocompletar.test.ts
 *
 * Copia el patrón de `hoy-rediseno/__tests__/hoy-rediseno.test.ts`: se prueba
 * leyendo el código fuente, porque lo que se vigila es CABLEADO —
 *   · PROPONE, NO PUBLICA: ni el panel ni su ruta escriben en `Clinic`;
 *   · el modelo no ve precios y el navegador no le manda texto;
 *   · con la bandera apagada, esto no existe;
 *   · ni tokens propios, ni colores a mano, ni letra de máquina.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "pagina-web-autocompletar");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = archivosNuevos.find((a) => a.nombre === "autocompletar.module.css")!.texto;
const panel = archivosNuevos.find((a) => a.nombre === "panel-autocompletar.tsx")!.texto;
const ruta = leer("app/api/clinic-landing/autocompletar/route.ts");
const nucleo = leer("lib/landing-autocompletar/core.ts");
const config = leer("app/dashboard/landing/landing-config-client.tsx");

// La palabra prohibida se arma en trozos para que un grep sobre la carpeta no
// se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina; las cifras van con tabular-nums", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
  }
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test("la hoja no declara tokens propios ni colores a mano: solo LEE", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  for (const a of archivosNuevos) {
    const lineasConHex = a.texto.split("\n").filter((l) => /#[0-9a-f]{6}\b/i.test(l) && !l.includes("var(--"));
    assert.deepEqual(lineasConHex, [], `${a.nombre} trae un color escrito a mano`);
  }
  // Los tokens llegan por herencia de la raíz del rediseño de página web, que
  // es la que monta CLASES_MENU. El panel se pinta DENTRO de ella.
  assert.match(leer("components/dashboard/pagina-web-rediseno/raiz.tsx"), /CLASES_MENU/);
  const raizAbre = config.indexOf("<RaizPaginaWeb");
  const raizCierra = config.indexOf("</RaizPaginaWeb>");
  const montaje = config.indexOf("<PanelAutocompletar");
  assert.ok(raizAbre >= 0 && montaje > raizAbre && montaje < raizCierra, "el panel no está dentro de <RaizPaginaWeb>");
});

test("con la bandera apagada esto no existe: se monta SOLO en la rama if (rediseno)", () => {
  assert.equal((config.match(/<PanelAutocompletar/g) ?? []).length, 1, "el panel se monta más de una vez");
  const ini = config.indexOf("if (rediseno) {");
  const finRama = config.indexOf("\n  return (", ini);
  const montaje = config.indexOf("<PanelAutocompletar");
  assert.ok(ini >= 0 && finRama > ini, "no se encontró la rama del rediseño");
  assert.ok(montaje > ini && montaje < finRama, "el panel se coló en el camino de siempre");
  // Y la ruta tampoco contesta sin la bandera.
  assert.match(ruta, /menuDosNivelesEncendido\(ctx\.clinicId\)/);
});

test("PROPONE, NO PUBLICA: ni la ruta ni el núcleo ni el panel escriben en la base", () => {
  const ESCRITURA = /\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw/;
  assert.ok(!ESCRITURA.test(ruta), "la ruta de autocompletar escribe en la base");
  assert.ok(!/prisma/.test(nucleo), "el núcleo tiene que ser puro");
  // El panel solo habla con SU ruta (que no escribe). Guardar es cosa de
  // `onAprobar`, que es el save() de la pantalla: el PATCH de siempre.
  const destinos = [...panel.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(destinos.length > 0);
  for (const d of destinos) assert.equal(d, "/api/clinic-landing/autocompletar");
  assert.ok(!/method:\s*"(PATCH|PUT|DELETE)"/.test(panel), "el panel guarda por su cuenta");
  assert.match(config, /onAprobar=\{async \(data, mensaje\) => \{\s*const ok = await save\(data, mensaje\);/, "onAprobar no pasa por save()");
});

test("la ruta pide sesión, landing.edit y saldo ANTES de gastar, y el clinicId sale de la sesión", () => {
  assert.match(ruta, /denyIfMissingPermission\(ctx, "landing\.edit"\)/);
  const post = ruta.slice(ruta.indexOf("export async function POST"));
  const orden = ["await entrar()", "persistentRateLimit(", "canSpend(clinicId)", "await chat("].map((x) => post.indexOf(x));
  assert.ok(orden.every((i) => i >= 0), "falta un paso del POST");
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, "el POST gasta antes de comprobar");
  assert.ok(!/body\??\.clinicId|clinicId:\s*body/.test(ruta), "el clinicId no puede venir del navegador");
  // Monedero, no cupo del plan: un solo libro de cuentas.
  assert.match(ruta, /chargeUsage\(/);
  assert.ok(!/addAiTokens|aiTokenLimitError/.test(ruta), "cobra dos veces: monedero y cupo");
});

test("el modelo no recibe precios y el navegador no le manda texto", () => {
  // Lo único que el POST lee del body son ids; los nombres salen de la base.
  const post = ruta.slice(ruta.indexOf("export async function POST"));
  assert.deepEqual([...post.matchAll(/body\?\.(\w+)/g)].map((m) => m[1]).filter((v, i, l) => l.indexOf(v) === i), ["servicios"]);
  assert.match(post, /content: `HECHOS:\\n\$\{JSON\.stringify\(hechos\)\}`/, "al modelo le llega algo más que los hechos");
  const hechos = nucleo.slice(nucleo.indexOf("export interface Hechos"), nucleo.indexOf("export const INSTRUCCIONES_DE_REDACCION"));
  assert.ok(!/precio|price|cedula/i.test(hechos.replace(/\/\*\*[\s\S]*?\*\//g, "")), "los hechos llevan precio o cédula");
});

test("cada dato dice de dónde salió, y aprobar avisa de que se publica", () => {
  assert.ok(panel.includes("Copiado de tu tarifario"));
  assert.ok(panel.includes('href="/dashboard/procedures"'));
  assert.ok(panel.includes('href="/dashboard/team"'));
  assert.ok(panel.includes("Hoy en tu página:"));
  assert.ok(panel.includes("Esto propone, no publica."));
  assert.ok(panel.includes("lo ven tus pacientes en cuanto se guarda"));
  assert.ok(panel.includes("saldo de IA"));
});
