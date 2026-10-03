/**
 * ws1-t8 — F16 de la auditoría de BEVADENT: los contadores de Ortodoncia que no concordaban.
 *  · Alertas decía «77 casos que revisar» con 45 casos activos: sumaba avisos, no casos.
 *  · Controles / agenda decía «20 sin próximo control» y Alertas 18: la misma lista, con dos cosas que Alertas no
 *    muestra (quien vino hoy y lo pospuesto 7 días). Ahora se dice en las dos pantallas.
 *
 * Run: npm run test:orto-casos-alertas
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisosEnTotal,
  marcarPospuestosSinControl,
  pacientesConAlerta,
  textoDeCuentaDeAlertas,
  textoSinControlEnAlertas,
  textoSinControlEnControles,
} from "../cuenta-de-alertas";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("un paciente en tres listas cuenta UNA vez; los avisos se dicen aparte", () => {
  const listas = [
    [{ patientId: "a" }, { patientId: "b" }], // mensualidad vencida
    [{ patientId: "a" }], // sin próximo control
    [{ patientId: "a" }, { patientId: "c" }], // plan incompleto
  ];
  assert.equal(pacientesConAlerta(listas), 3);
  assert.equal(avisosEnTotal(listas), 5);
  assert.equal(
    textoDeCuentaDeAlertas(3, 5),
    "3 pacientes que revisar (5 avisos: un paciente puede salir en más de una lista).",
  );
  assert.equal(textoDeCuentaDeAlertas(1, 1), "1 paciente que revisar.");
  assert.equal(textoDeCuentaDeAlertas(0, 0), "Sin alertas pendientes.");
});

test("la cifra de BEVADENT: 45 pacientes con 77 avisos ya no dice «77 casos»", () => {
  const listas = [
    Array.from({ length: 45 }, (_, i) => ({ patientId: `p${i}` })), // los 45 incompletos
    Array.from({ length: 18 }, (_, i) => ({ patientId: `p${i}` })), // sin próximo control
    Array.from({ length: 14 }, (_, i) => ({ patientId: `p${i + 20}` })), // vencidos
  ];
  const texto = textoDeCuentaDeAlertas(pacientesConAlerta(listas), avisosEnTotal(listas));
  assert.match(texto, /^45 pacientes que revisar \(77 avisos/);
  assert.doesNotMatch(texto, /77 casos/);
});

test("«Sin próximo control»: Controles lista a todos; lo que Alertas no muestra queda marcado y contado", () => {
  const ahora = new Date("2026-10-03T18:00:00Z");
  const filas: Array<{ patientId: string; diasSinControl: number | null; pospuestoHasta?: Date | null }> = [
    { patientId: "hoy", diasSinControl: 0 },
    { patientId: "pospuesto", diasSinControl: 40 },
    { patientId: "normal", diasSinControl: 50 },
    { patientId: "vencida", diasSinControl: 60 },
    { patientId: "otro-tipo", diasSinControl: 70 },
  ];
  const pospuestas = [
    { patientId: "pospuesto", tipo: "sin-proximo-control", hasta: new Date("2026-10-08T00:00:00Z") },
    { patientId: "vencida", tipo: "sin-proximo-control", hasta: new Date("2026-10-01T00:00:00Z") }, // ya no cuenta
    { patientId: "otro-tipo", tipo: "no-asistio", hasta: new Date("2026-10-08T00:00:00Z") }, // otra alerta
    { patientId: "hoy", tipo: "sin-proximo-control", hasta: new Date("2026-10-08T00:00:00Z") }, // vino hoy manda
  ];
  const r = marcarPospuestosSinControl(filas, pospuestas, ahora);
  assert.equal(r.filas.length, 5, "Controles no quita a nadie");
  assert.deepEqual(r.fuera, { vinieronHoy: 1, pospuestos: 1 });
  assert.equal(r.filas.find((f) => f.patientId === "pospuesto")?.pospuestoHasta?.toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(r.filas.find((f) => f.patientId === "vencida")?.pospuestoHasta, undefined);
  assert.equal(r.filas.find((f) => f.patientId === "hoy")?.pospuestoHasta, undefined);
});

test("20 en Controles y 18 en Alertas: cada pantalla explica la otra cifra", () => {
  const fuera = { vinieronHoy: 1, pospuestos: 1 };
  assert.equal(
    textoSinControlEnAlertas(18, fuera),
    "Controles / agenda cuenta 20: aquí no salen 1 que vino hoy (falta agendarle el siguiente) ni 1 pospuesto 7 días.",
  );
  assert.equal(textoSinControlEnControles(20, fuera), "Alertas muestra 18: no lista 1 que vino hoy ni 1 pospuesto 7 días desde Alertas.");
  assert.equal(textoSinControlEnAlertas(18, { vinieronHoy: 0, pospuestos: 0 }), null);
  assert.equal(textoSinControlEnControles(18, undefined), null);
  assert.match(textoSinControlEnAlertas(0, { vinieronHoy: 2, pospuestos: 0 }) ?? "", /cuenta 2: aquí no salen 2 que vinieron hoy \(falta agendarles/);
});

test("cableado: Alertas cuenta pacientes y explica la diferencia; Controles marca lo pospuesto", () => {
  const vista = sinComentarios(leer("components/specialties/orthodontics/modulo/vista-alertas.tsx"));
  assert.match(vista, /textoDeCuentaDeAlertas\(pacientesQueRevisar, totalAlerts\)/);
  assert.doesNotMatch(vista, /caso\$\{totalAlerts === 1/, "ya no dice «N casos» con la suma de avisos");
  assert.match(vista, /nota=\{notaSinControl\}/);
  const datos = sinComentarios(leer("lib/orthodontics/alerts-data.ts"));
  assert.match(datos, /sinControlFuera: \{ vinieronHoy: sinControlTodos\.length - sinControlCrudo\.length, pospuestos: sinControl\.pospuestas \}/);
  // La MISMA lista en las dos pantallas: Alertas parte de listMissingNextControl con el mismo historial.
  assert.match(datos, /listMissingNextControl\(cases, historial\.conControlFuturo\)/);
  const controles = sinComentarios(leer("lib/orthodontics/controles-data.ts"));
  assert.match(controles, /marcarPospuestosSinControl\(todos, pospuestas, ahora\)/);
  const vistaControles = sinComentarios(leer("components/specialties/orthodontics/modulo/vista-controles.tsx"));
  assert.match(vistaControles, /textoSinControlEnControles\(sinControl\.length, data\.sinControlFuera\)/);
  assert.match(vistaControles, /Pospuesto en Alertas hasta el/);
});
