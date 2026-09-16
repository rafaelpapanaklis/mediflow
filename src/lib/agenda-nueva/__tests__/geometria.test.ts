/**
 * La aritmética de la cuadrícula de la agenda nueva.
 *
 * Lo que se vigila aquí es lo que el README del diseño da masticado y lo que
 * nos ha mordido antes: las cuentas exactas de `top`/`height`, y que la hora
 * salga SIEMPRE de la zona de la clínica y nunca del reloj del proceso.
 *
 * Run: npm run test:agenda-nueva-geometria
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  altoDeCita,
  carrilDeCita,
  comoHora,
  deHora,
  diaEnTz,
  minutosDeAhora,
  minutosEnTz,
  topDeAhora,
  topDeCita,
  topDeHora,
  ventanaDeRejilla,
} from "../geometria";
import { ALTO_HORA } from "../tokens";

const MX = "America/Mexico_City";
/** Una zona sin horario de verano y con media hora de desfase: rompe atajos. */
const INDIA = "Asia/Kolkata";

/* ── Las dos fórmulas del README ───────────────────────────────────────── */

test("topDeCita: (inicio − 8:00)/60 × 112 + 1, tal cual el README", () => {
  // 8:00 → la primera línea, con el +1 de aire.
  assert.equal(topDeCita(8 * 60), 1);
  // 11:00 → 3 h × 112 + 1.
  assert.equal(topDeCita(11 * 60), 3 * ALTO_HORA + 1);
  // 11:30 → media hora más.
  assert.equal(topDeCita(11 * 60 + 30), 3 * ALTO_HORA + 56 + 1);
  // El ejemplo literal del prototipo: 11:20 de «ahora» cae en 373.33.
  assert.ok(Math.abs(topDeAhora(11 * 60 + 20) - 373.333) < 0.01);
});

test("altoDeCita: duración/60 × 112 − 2", () => {
  assert.equal(altoDeCita(60), ALTO_HORA - 2);
  assert.equal(altoDeCita(45), 45 / 60 * ALTO_HORA - 2);
  assert.equal(altoDeCita(30), 54);
  // Una cita de duración rara no puede dar un alto negativo.
  assert.equal(altoDeCita(0), 0);
  assert.equal(altoDeCita(1), 0);
});

test("topDeHora: k · 112 + 6", () => {
  assert.equal(topDeHora(8), 6);
  assert.equal(topDeHora(20), 12 * ALTO_HORA + 6);
});

test("las cuentas respetan un inicio de rejilla distinto de las 8", () => {
  const siete = 7 * 60;
  assert.equal(topDeCita(7 * 60, siete), 1);
  assert.equal(topDeCita(8 * 60, siete), ALTO_HORA + 1);
  assert.equal(topDeHora(7, siete), 6);
});

/* ── La ventana de la rejilla ──────────────────────────────────────────── */

test("ventanaDeRejilla: con la clínica dentro de 8–18 sale el lienzo del diseño", () => {
  const v = ventanaDeRejilla(8, 18);
  assert.equal(v.horaInicio, 8);
  assert.equal(v.horaFin, 20);
  assert.equal(v.minutoInicio, 480);
  // 12 h × 112 + 8 = 1352, el número exacto del README.
  assert.equal(v.alto, 1352);
  assert.equal(v.horas.length, 13);
});

test("ventanaDeRejilla: se ensancha antes de esconder una cita", () => {
  // Abre a las 7 → la rejilla baja a las 7, no recorta.
  const temprano = ventanaDeRejilla(7, 18);
  assert.equal(temprano.horaInicio, 7);
  assert.equal(temprano.horaFin, 20);

  // Cierra a las 22 → la rejilla sube a las 22.
  const tarde = ventanaDeRejilla(8, 22);
  assert.equal(tarde.horaInicio, 8);
  assert.equal(tarde.horaFin, 22);

  // Nunca se sale del día.
  const extremo = ventanaDeRejilla(0, 24);
  assert.equal(extremo.horaInicio, 0);
  assert.equal(extremo.horaFin, 24);
});

/* ── La zona horaria de la clínica ─────────────────────────────────────── */

test("minutosEnTz da la hora de PARED de la clínica, no la del proceso", () => {
  // 2026-09-02 17:00 UTC = 11:00 en Ciudad de México (UTC−6).
  const iso = "2026-09-02T17:00:00.000Z";
  assert.equal(minutosEnTz(iso, MX), 11 * 60);
  assert.equal(minutosEnTz(iso, "UTC"), 17 * 60);
  // Media hora de desfase: 22:30 en Kolkata.
  assert.equal(minutosEnTz(iso, INDIA), 22 * 60 + 30);
});

test("diaEnTz: una cita de madrugada UTC sigue siendo del día anterior en México", () => {
  // 03:00 UTC del día 3 = 21:00 del día 2 en Ciudad de México.
  const iso = "2026-09-03T03:00:00.000Z";
  assert.equal(diaEnTz(iso, MX), "2026-09-02");
  assert.equal(diaEnTz(iso, "UTC"), "2026-09-03");
});

test("la línea de «ahora» SOLO se pinta el día de hoy, y en la zona de la clínica", () => {
  const ventana = ventanaDeRejilla(8, 18);
  // 2026-09-02 17:20 UTC = 11:20 en México.
  const ahora = new Date("2026-09-02T17:20:00.000Z");

  assert.equal(
    minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora }),
    11 * 60 + 20,
  );
  // Otro día: nada.
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: MX, ventana, ahora }), null);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-01", timezone: MX, ventana, ahora }), null);
});

test("la línea de «ahora» cambia de DÍA según la zona, no según el servidor", () => {
  // Lienzo de 24 h para que aquí la ÚNICA variable sea el día, no si la hora
  // cabe o no en la rejilla (eso se prueba aparte, más abajo).
  const ventana = ventanaDeRejilla(0, 24);
  // 2026-09-03 04:00 UTC: en México todavía es el 2 (22:00); en UTC ya es el 3.
  const ahora = new Date("2026-09-03T04:00:00.000Z");

  // Con la zona de la CLÍNICA, «ahora» cae en el día 2 a las 22:00.
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora }), 22 * 60);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: MX, ventana, ahora }), null);

  // Con el proceso en UTC —lo que pasa en Vercel— sería el día 3 a las 04:00.
  // Justo al revés. Ésta es la confusión que evita pasar la zona de la clínica.
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: "UTC", ventana, ahora }), 4 * 60);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: "UTC", ventana, ahora }), null);
});

test("en el lienzo 8–20 del diseño, una hora de noche no pinta línea ningún día", () => {
  const ventana = ventanaDeRejilla(8, 18); // lienzo 8–20
  const ahora = new Date("2026-09-03T04:00:00.000Z"); // 22:00 en México
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora }), null);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: MX, ventana, ahora }), null);
});

test("«ahora» fuera del lienzo no se pinta", () => {
  const ventana = ventanaDeRejilla(8, 18); // lienzo 8–20
  // 06:30 en México = 12:30 UTC.
  const temprano = new Date("2026-09-02T12:30:00.000Z");
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora: temprano }), null);
});

/* ── Horas ─────────────────────────────────────────────────────────────── */

test("comoHora y deHora se deshacen la una a la otra", () => {
  for (const m of [0, 1, 59, 480, 691, 1080, 1439]) {
    assert.equal(deHora(comoHora(m)), m);
  }
  assert.equal(comoHora(480), "08:00");
  assert.equal(comoHora(1080), "18:00");
});

test("deHora rechaza lo que no es una hora", () => {
  assert.equal(deHora(null), null);
  assert.equal(deHora(""), null);
  assert.equal(deHora("nueve"), null);
  assert.equal(deHora("25:00"), null);
  assert.equal(deHora("08:70"), null);
  assert.equal(deHora("8:00"), 480);
  assert.equal(deHora(" 08:00 "), 480);
});

/* ── Carriles (citas solapadas) ────────────────────────────────────────── */

test("con un solo carril la tarjeta va entera, con los 8 px del diseño", () => {
  assert.deepEqual(carrilDeCita(0, 1), { left: "8px", width: "calc(100% - 16px)" });
});

test("con varios carriles ninguna tarjeta se sale ni se encima", () => {
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < n; i++) {
      const { left, width } = carrilDeCita(i, n);
      assert.ok(left.length > 0 && width.length > 0, `carril ${i}/${n} sin geometría`);
      // El porcentaje de cada carril es el mismo para todos.
      assert.ok(width.includes(`${100 / n}%`), `ancho inesperado en ${i}/${n}: ${width}`);
    }
    // El primero arranca en 0 % (más su margen) y el último no pasa del 100 %.
    assert.ok(carrilDeCita(0, n).left.startsWith("calc(0%"));
    assert.ok(carrilDeCita(n - 1, n).left.includes(`${((n - 1) * 100) / n}%`));
  }
});
