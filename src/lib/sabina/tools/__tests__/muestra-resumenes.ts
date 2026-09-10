// Utilidad de mano: imprime el `resumen` de cada herramienta contra la clínica
// sembrada, que es la línea que de verdad va a leer el modelo. No es un test.
import "./preparar";
import { CATALOGO_SABINA, ejecutarHerramienta } from "../index";
import { sumarDias } from "../fechas";
import { HOY_N, adminNorte, base, conPermisos } from "./siembra";

function params(nombre: string): Record<string, unknown> {
  switch (nombre) {
    case "citas_del_dia": return { fecha: HOY_N };
    case "agenda_ocupacion":
    case "ausencias": return { desde: sumarDias(HOY_N, -30), hasta: HOY_N };
    case "pacientes_nuevos":
    case "ingresos_por_periodo":
    case "tratamientos_por_ingreso": return { desde: sumarDias(HOY_N, -10), hasta: HOY_N };
    case "buscar_paciente": return { termino: "Ana" };
    default: return {};
  }
}

async function main() {
  const db = base();
  for (const t of CATALOGO_SABINA) {
    const r = await ejecutarHerramienta(t.nombre, adminNorte(db), params(t.nombre));
    console.log(`\n${t.nombre}\n  ${r.ok ? r.resumen : JSON.stringify(r)}`);
  }
  const limitado = conPermisos(db, ["today.view", "agenda.view", "patients.view"]);
  const sin = await ejecutarHerramienta("resumen_clinica", limitado, {});
  console.log(`\nresumen_clinica (recepción SIN facturación)\n  ${sin.ok ? sin.resumen : ""}`);
  const denegado = await ejecutarHerramienta("ingresos_por_periodo", limitado, params("ingresos_por_periodo"));
  console.log(`\ningresos_por_periodo (sin billing.view)\n  ${JSON.stringify(denegado)}`);
}
main();
