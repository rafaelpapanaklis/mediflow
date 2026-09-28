/**
 * Horas y fechas del módulo de Ortodoncia, en la zona de la clínica (ws1-t3).
 *
 * Run: npx tsx --test src/components/specialties/orthodontics/modulo/__tests__/fechas.test.ts
 *
 * El fallo: las vistas se pintan en el servidor y formateaban sin `timeZone`,
 * así que salía la hora del SERVIDOR. Estos tests fijan el resultado sea cual
 * sea la zona de la máquina que los corre: se repiten con TZ=UTC y con otras.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ZONA_POR_DEFECTO, fechaEnZona, horaEnZona, zonaValida } from "../fechas";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
// Espacios duros fuera, y «sept»/«sep.» → «sep»: la abreviatura del mes cambia
// con la versión de ICU de cada Node; lo que se prueba aquí es el DÍA y la HORA.
const limpio = (t: string) => t.replace(/[\u00a0\u202f]/g, " ").replace(/\bsept?\.?(?= )/, "sep");

// 28-sep-2026 15:00 UTC = 09:00 en Ciudad de México (UTC-6, sin horario de verano).
const CONTROL = new Date("2026-09-28T15:00:00.000Z");
// 28-sep-2026 01:30 UTC = 27-sep 19:30 en Ciudad de México.
const FALTA = new Date("2026-09-28T01:30:00.000Z");

test("la hora de un control sale en la zona de la clínica", () => {
  assert.equal(limpio(horaEnZona(CONTROL, "America/Mexico_City")), "09:00 a.m.");
  assert.equal(limpio(horaEnZona(CONTROL, "America/Tijuana")), "08:00 a.m.");
  assert.equal(limpio(horaEnZona(CONTROL, "America/Cancun")), "10:00 a.m.");
});

test("el día de una falta sale en la zona de la clínica: las 19:30 del 27 no son «el 28»", () => {
  assert.equal(limpio(fechaEnZona(FALTA, "America/Mexico_City")), "27 sep 2026");
  assert.equal(limpio(fechaEnZona(FALTA, "UTC")), "28 sep 2026", "es lo que salía en un servidor en UTC");
});

test("una fecha de calendario (vencimiento) es ese día en cualquier zona", () => {
  for (const zona of ["America/Mexico_City", "UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", null]) {
    assert.equal(limpio(fechaEnZona("2026-10-05", zona)), "05 oct 2026", String(zona));
  }
  assert.equal(limpio(fechaEnZona("2026-01-01", "America/Tijuana")), "01 ene 2026", "ni se va al año anterior");
  assert.equal(limpio(fechaEnZona("2026-10-05T00:00:00.000Z", null)), "05 oct 2026");
});

test("sin fecha, o con algo ilegible, una raya", () => {
  assert.equal(fechaEnZona(null, "America/Mexico_City"), "—");
  assert.equal(fechaEnZona(undefined, null), "—");
  assert.equal(fechaEnZona("", null), "—");
  assert.equal(fechaEnZona("mañana", null), "—");
  assert.equal(fechaEnZona(new Date("no es fecha"), null), "—");
});

test("una zona vacía o mal escrita no tumba la pantalla: se usa la de por defecto", () => {
  assert.equal(ZONA_POR_DEFECTO, "America/Mexico_City");
  assert.equal(zonaValida(null), ZONA_POR_DEFECTO);
  assert.equal(zonaValida(""), ZONA_POR_DEFECTO);
  assert.equal(zonaValida("Marte/Olympus"), ZONA_POR_DEFECTO);
  assert.equal(zonaValida("America/Tijuana"), "America/Tijuana");
  assert.equal(limpio(horaEnZona(CONTROL, "Marte/Olympus")), "09:00 a.m.");
  assert.equal(limpio(horaEnZona(CONTROL, null)), "09:00 a.m.");
});

test("da lo mismo en un servidor en UTC, en Tokio o en Nueva York", () => {
  // Se corre el MISMO cálculo en un proceso aparte con otra zona de máquina.
  const guion = `
    const { horaEnZona, fechaEnZona } = require(${JSON.stringify(join(__dirname, "..", "fechas.ts"))});
    const l = (t) => t.replace(/[\\u00a0\\u202f]/g, " ").replace(/\\bsept?\\.?(?= )/, "sep");
    process.stdout.write([
      l(horaEnZona(new Date("2026-09-28T15:00:00.000Z"), "America/Mexico_City")),
      l(fechaEnZona(new Date("2026-09-28T01:30:00.000Z"), "America/Mexico_City")),
      l(fechaEnZona("2026-10-05", "America/Mexico_City")),
    ].join("|"));
  `;
  for (const TZ of ["UTC", "Asia/Tokyo", "America/New_York", "Pacific/Kiritimati"]) {
    const salida = execFileSync(process.execPath, ["--import", "tsx", "-e", guion], {
      cwd: RAIZ,
      env: { ...process.env, TZ },
      encoding: "utf8",
    });
    assert.equal(salida, "09:00 a.m.|27 sep 2026|05 oct 2026", `servidor en ${TZ}`);
  }
});

test("las vistas reciben la zona de la clínica y ya no formatean por su cuenta", () => {
  const tablero = sinComentarios(leer("src/components/specialties/orthodontics/modulo/vista-tablero.tsx"));
  const alertas = sinComentarios(leer("src/components/specialties/orthodontics/modulo/vista-alertas.tsx"));
  const tabla = sinComentarios(leer("src/components/specialties/orthodontics/OrthoPacientesTable.tsx"));
  assert.match(tablero, /horaEnZona\(c\.startsAt, zonaHoraria\)/);
  assert.match(alertas, /fechaEnZona\(d, zonaHoraria\)/);
  for (const [nombre, codigo] of [["tablero", tablero], ["alertas", alertas], ["tabla", tabla]] as const) {
    assert.ok(!/toLocale(Time|Date)String\(/.test(codigo), `${nombre}: ninguna fecha formateada sin zona`);
  }
  assert.match(
    sinComentarios(leer("src/app/dashboard/orthodontics/tablero/page.tsx")),
    /zonaHoraria=\{user\.clinic\.timezone\}/,
    "la zona sale de la clínica de la sesión",
  );
  assert.match(
    sinComentarios(leer("src/app/dashboard/orthodontics/alertas/page.tsx")),
    /zonaHoraria=\{user\.clinic\.timezone\}/,
  );
});
