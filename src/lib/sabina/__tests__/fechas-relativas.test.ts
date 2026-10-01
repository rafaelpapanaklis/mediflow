/**
 * Fechas relativas de Sabina (ws1-t5, revisión en panel.108): jueves
 * 1-oct-2026, «el próximo lunes» salía martes 6. Se fija la convención del
 * resolvedor en varios días de la semana, con cambio de mes y de año, y que el
 * bloque del prompt sale del «hoy» de la ZONA de la clínica, no del proceso.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bloqueFechasRelativas,
  diaDeLaSemana,
  resolverFechaRelativa,
} from "../fechas-relativas";
import { construirSystemPrompt, fechasParaPrompt } from "../engine-core";

const r = resolverFechaRelativa;
const LUNES = 0;

test("el caso del reporte: jueves 1-oct-2026", () => {
  const hoy = "2026-10-01";
  assert.equal(diaDeLaSemana(hoy), 3, "1-oct-2026 es jueves");
  assert.equal(r("el próximo lunes", hoy), "2026-10-05");
  assert.equal(r("próximo lunes", hoy), "2026-10-05");
  assert.equal(r("este lunes", hoy), "2026-10-05");
  assert.equal(r("el lunes", hoy), "2026-10-05");
  assert.equal(r("el lunes que viene", hoy), "2026-10-05");
  assert.equal(r("¿El Próximo LUNES?", hoy), "2026-10-05");
  assert.equal(r("mañana", hoy), "2026-10-02");
  assert.equal(r("manana", hoy), "2026-10-02");
  assert.equal(r("pasado mañana", hoy), "2026-10-03");
  assert.equal(r("el 15", hoy), "2026-10-15");
  assert.equal(r("el 1", hoy), "2026-10-01", "el 1 es hoy");
  assert.equal(r("este jueves", hoy), "2026-10-01", "este + el día de hoy = hoy");
  assert.equal(r("el jueves", hoy), "2026-10-08");
  assert.equal(r("el próximo jueves", hoy), "2026-10-08");
  assert.equal(r("el miércoles", hoy), "2026-10-07");
  assert.equal(r("el viernes", hoy), "2026-10-02");
  assert.equal(r("el domingo", hoy), "2026-10-04");
});

test("«el lunes» cae SIEMPRE en lunes y entre 1 y 7 días, desde cada día de la semana", () => {
  // 2026-10-05 (lunes) … 2026-10-11 (domingo)
  const esperado: Record<string, string> = {
    "2026-10-05": "2026-10-12", // lunes → el de la otra semana
    "2026-10-06": "2026-10-12",
    "2026-10-07": "2026-10-12",
    "2026-10-08": "2026-10-12",
    "2026-10-09": "2026-10-12",
    "2026-10-10": "2026-10-12",
    "2026-10-11": "2026-10-12", // domingo → mañana
  };
  for (const [hoy, lunes] of Object.entries(esperado)) {
    for (const e of ["el lunes", "el próximo lunes"]) {
      assert.equal(r(e, hoy), lunes, `${e} desde ${hoy}`);
      assert.equal(diaDeLaSemana(r(e, hoy)!), LUNES);
    }
  }
  assert.equal(r("este lunes", "2026-10-05"), "2026-10-05", "dicho en lunes, «este lunes» es hoy");
  assert.equal(r("este lunes", "2026-10-11"), "2026-10-12");
  // Cada día de la semana, desde cada día: cae en ese día y nunca hacia atrás.
  const dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  for (let h = 0; h < 7; h++) {
    const hoy = `2026-10-${String(5 + h).padStart(2, "0")}`;
    dias.forEach((dia, i) => {
      const f = r(`el próximo ${dia}`, hoy)!;
      assert.equal(diaDeLaSemana(f), i, `${dia} desde ${hoy}`);
      assert.ok(f > hoy && f <= r(`el ${dia}`, hoy)!, `${dia} desde ${hoy}: ${f}`);
    });
  }
});

test("cambio de mes: sábado 31-oct-2026", () => {
  const hoy = "2026-10-31";
  assert.equal(diaDeLaSemana(hoy), 5);
  assert.equal(r("mañana", hoy), "2026-11-01");
  assert.equal(r("pasado mañana", hoy), "2026-11-02");
  assert.equal(r("el próximo lunes", hoy), "2026-11-02");
  assert.equal(r("el 15", hoy), "2026-11-15");
  assert.equal(r("el 31", hoy), "2026-10-31", "el 31 dicho el 31 es hoy");
  assert.equal(r("el 30", hoy), "2026-11-30");
});

test("cambio de año: jueves 31-dic-2026 y miércoles 30-dic-2026", () => {
  assert.equal(r("mañana", "2026-12-31"), "2027-01-01");
  assert.equal(r("pasado mañana", "2026-12-31"), "2027-01-02");
  assert.equal(r("el próximo lunes", "2026-12-31"), "2027-01-04");
  assert.equal(r("el 15", "2026-12-31"), "2027-01-15");
  assert.equal(r("pasado mañana", "2026-12-30"), "2027-01-01");
  assert.equal(r("el próximo miércoles", "2026-12-30"), "2027-01-06");
  assert.equal(r("este miércoles", "2026-12-30"), "2026-12-30");
});

test("«el N» que el mes siguiente no tiene salta al que sí, y el 29 de febrero bisiesto", () => {
  assert.equal(r("el 31", "2026-11-15"), "2026-12-31", "noviembre no tiene 31");
  assert.equal(r("el 30", "2027-01-31"), "2027-03-30", "febrero no tiene 30");
  assert.equal(r("el 29", "2027-02-10"), "2027-03-29", "2027 no es bisiesto");
  assert.equal(r("mañana", "2028-02-28"), "2028-02-29");
  assert.equal(r("el 29", "2028-02-10"), "2028-02-29");
  assert.equal(r("el 0", "2026-10-01"), null);
  assert.equal(r("el 32", "2026-10-01"), null);
  assert.equal(r("cuando puedas", "2026-10-01"), null);
});

test("el bloque del prompt dice lo mismo que el resolvedor (jueves 1-oct-2026)", () => {
  const b = bloqueFechasRelativas("2026-10-01");
  assert.match(b, /«El lunes», «este lunes» o «el próximo lunes»: lunes 5 de octubre de 2026 \(2026-10-05\)\./);
  assert.match(b, /Mañana: viernes 2 de octubre de 2026 \(2026-10-02\)\. Pasado mañana: sábado 3 de octubre de 2026 \(2026-10-03\)\./);
  assert.match(b, /Hoy es jueves: «este jueves» es hoy; «el jueves» o «el próximo jueves» es el jueves 8 de octubre de 2026 \(2026-10-08\)\./);
  assert.match(b, /«El N» sin mes: el día N de octubre de 2026\./);
  assert.doesNotMatch(b, /lunes 6|martes 5/);
  // Cada fecha con nombre del bloque es coherente: el nombre del día coincide con la fecha.
  for (const m of b.matchAll(/(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d+ de \w+ de \d{4} \((\d{4}-\d{2}-\d{2})\)/g)) {
    const dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    assert.equal(dias[diaDeLaSemana(m[2])], m[1], m[0]);
  }
  const fin = bloqueFechasRelativas("2026-12-31");
  assert.match(fin, /del 31 al 31 es de diciembre de 2026; del 1 al 30, de enero de 2027\./);
  assert.match(fin, /Mañana: viernes 1 de enero de 2027 \(2027-01-01\)/);
});

test("el «hoy» del bloque es el de la ZONA de la clínica, no el del proceso", () => {
  // Domingo 4-oct-2026 22:00 en CDMX = lunes 5-oct 04:00 UTC.
  const instante = new Date("2026-10-05T04:00:00Z");
  const mx = fechasParaPrompt(instante, "America/Mexico_City");
  assert.match(mx, /«El lunes», «este lunes» o «el próximo lunes»: lunes 5 de octubre de 2026 \(2026-10-05\)/);
  assert.match(mx, /Mañana: lunes 5 de octubre de 2026/);
  const utc = fechasParaPrompt(instante, "UTC");
  assert.match(utc, /Hoy es lunes: «este lunes» es hoy; «el lunes» o «el próximo lunes» es el lunes 12 de octubre de 2026/);
  // Bogotá (UTC-5) también sigue en domingo; Madrid ya va en lunes.
  assert.match(fechasParaPrompt(instante, "America/Bogota"), /Mañana: lunes 5 de octubre/);
  assert.match(fechasParaPrompt(instante, "Europe/Madrid"), /Hoy es lunes/);
  // Zona ilegible o vacía: CDMX, igual que hoyParaPrompt.
  assert.equal(fechasParaPrompt(instante, "Marte/Olympus"), mx);
  assert.equal(fechasParaPrompt(instante, ""), mx);
  // El caso del reporte a la hora de la prueba en panel.108 (jueves 1-oct, mediodía en CDMX).
  assert.match(
    fechasParaPrompt(new Date("2026-10-01T18:00:00Z"), "America/Mexico_City"),
    /«el próximo lunes»: lunes 5 de octubre de 2026 \(2026-10-05\)/,
  );
});

test("el prompt de Sabina lleva el bloque justo después de «Hoy es …», y sin él no cambia", () => {
  const fechas = bloqueFechasRelativas("2026-10-01");
  const con = construirSystemPrompt({ dificultad: "directa", hoy: "jueves, 1 de octubre de 2026 (2026-10-01)", fechas });
  assert.ok(con.includes(`Hoy es jueves, 1 de octubre de 2026 (2026-10-01).\n\n${fechas}\n`));
  const sin = construirSystemPrompt({ dificultad: "directa", hoy: "hoy" });
  assert.ok(!sin.includes("FECHAS YA CALCULADAS"));
  assert.equal(sin, construirSystemPrompt({ dificultad: "directa", hoy: "hoy", fechas: null }));
});
