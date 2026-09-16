// Utilidad de mano: imprime lo que Sabina recibiría de `oportunidades_perdidas`
// contra la clínica sembrada, y el peso que la herramienta añade a CADA llamada
// al modelo. No es un test. Correr: npx tsx --test --experimental-test-module-mocks src/lib/sabina/tools/__tests__/muestra-escapa.ts
import "./preparar";
import { correrHerramienta } from "../base";
import { oportunidadesPerdidas } from "../oportunidades-perdidas";
import { adminNorte, conPermisos } from "./siembra";
import { baseEscape } from "./escapa-siembra";
import { zodAJsonSchema } from "../../engine-core";
import { SABINA_TOOLS } from "../../engine-catalog";

async function main() {
  const db = baseEscape();

  const r = await correrHerramienta(oportunidadesPerdidas, adminNorte(db), {});
  console.log("\n══ RESUMEN (administradora, sin parámetros) ══\n");
  console.log(r.ok ? r.resumen : JSON.stringify(r));
  if (r.ok) console.log("\n-- dinero --\n" + JSON.stringify((r.datos as any).dinero, null, 2));

  for (const tipo of ["por_cobrar", "sin_agendar", "sin_respuesta", "sin_reagendar", "sin_contestar"]) {
    const x = await correrHerramienta(oportunidadesPerdidas, adminNorte(baseEscape()), { tipo });
    console.log(`\n══ tipo: ${tipo} ══\n` + (x.ok ? x.resumen : JSON.stringify(x)));
  }

  const media = await correrHerramienta(
    oportunidadesPerdidas,
    conPermisos(baseEscape(), ["today.view", "billing.view"]),
    {},
  );
  console.log("\n══ solo con billing.view ══\n" + (media.ok ? media.resumen : JSON.stringify(media)));

  // El peso: lo que ocupa esta herramienta dentro de lo FIJO de cada llamada.
  const esquema = (t: any) => JSON.stringify({ name: t.nombre, description: t.descripcion, input_schema: zodAJsonSchema(t.parametros) });
  const mia = esquema(oportunidadesPerdidas).length;
  const todo = SABINA_TOOLS.reduce((s, t) => s + esquema(t).length, 0);
  console.log(`\n══ PESO ══\n  esta herramienta: ${mia} caracteres`);
  console.log(`  catálogo entero (${SABINA_TOOLS.length} herramientas): ${todo} caracteres`);
  console.log(`  catálogo sin ella: ${todo - mia} caracteres  (+${((mia / (todo - mia)) * 100).toFixed(1)} %)`);
}
main();
