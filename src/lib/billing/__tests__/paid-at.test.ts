/**
 * La fecha del cobro del modal de facturas.
 *
 * Run: npm run test:paid-at   (fija TZ=America/Mexico_City: la regla es sobre
 * la hora LOCAL, así que sin zona fija el test no diría nada)
 *
 * El fallo que cierra, en una línea: el modal hacía sus cuentas de "hoy" en
 * UTC y guardaba la fecha elegida como MEDIANOCHE UTC, que en México son las
 * 18:00 del día ANTERIOR. Dos consecuencias medibles, y las dos se prueban
 * aquí contra el código que de verdad las sufre (`bucketKeyForDate`, el que
 * agrupa los ingresos por día en la zona de la clínica):
 *
 *   1. de 18:00 a 23:59 el campo mostraba MAÑANA mientras el calendario de
 *      DateField marcaba HOY — y el `max` dejaba fechar un cobro a futuro;
 *   2. un cobro registrado el día 5 se guardaba en el día 4.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayLocalISO, paidAtInstant } from "../paid-at";
import { bucketKeyForDate } from "../../home/revenue-buckets";

const MX = "America/Mexico_City";

// La regla es sobre hora local: si el script no fijó la zona, todo lo de abajo
// mediría otra cosa y pasaría por casualidad. Se dice claro y se para.
test("el test corre en la zona de México (lo fija npm run test:paid-at)", () => {
  assert.equal(
    new Date(2026, 8, 7, 12, 0, 0).getTimezoneOffset(),
    360,
    "TZ no es America/Mexico_City (UTC-6): corre 'npm run test:paid-at', no tsx suelto",
  );
});

// ── 1 · "Hoy" es el de la pantalla, no el de Greenwich ──────────────────

test("REGRESIÓN: a las 19:00 de México, hoy sigue siendo hoy (UTC ya dice mañana)", () => {
  // 2026-09-08T01:00Z = 19:00 del 7 en México.
  const nocheDelSiete = new Date("2026-09-08T01:00:00Z");
  assert.equal(nocheDelSiete.toISOString().slice(0, 10), "2026-09-08", "premisa: en UTC ya es día 8");
  assert.equal(
    todayLocalISO(nocheDelSiete),
    "2026-09-07",
    "el campo escribía MAÑANA cada tarde a partir de las 18:00, y el max dejaba fechar a futuro",
  );
});

test("de día las dos cuentas coinciden (el fallo solo asomaba de tarde)", () => {
  const mediodia = new Date("2026-09-07T18:00:00Z"); // 12:00 en México
  assert.equal(todayLocalISO(mediodia), "2026-09-07");
});

// ── 2 · El día elegido es el día en que cae el cobro ────────────────────

test("REGRESIÓN: un cobro fechado el día 5 cae en el día 5, no en el 4", () => {
  const ahora = new Date("2026-09-07T18:00:00Z");
  // Lo que hacía ANTES el modal: new Date("2026-09-05") = medianoche UTC.
  const comoAntes = new Date("2026-09-05");
  assert.equal(
    bucketKeyForDate("mes", comoAntes, MX),
    "2026-09-04",
    "premisa del fallo: medianoche UTC cae el día ANTERIOR en México",
  );
  // Lo que hace ahora.
  const ahoraSi = paidAtInstant("2026-09-05", ahora);
  assert.ok(ahoraSi);
  assert.equal(bucketKeyForDate("mes", ahoraSi!, MX), "2026-09-05");
});

test("un cobro de HOY se guarda en el instante real (y así entra en el turno de caja)", () => {
  const ahora = new Date("2026-09-07T20:34:56Z");
  assert.equal(
    paidAtInstant(todayLocalISO(ahora), ahora)?.toISOString(),
    ahora.toISOString(),
    "hoy no se ancla a ninguna hora inventada: es el instante del cobro",
  );
});

test("el cobro de hoy nunca es futuro (el endpoint rechaza paidAt > ahora + 1 min)", () => {
  const ahora = new Date("2026-09-07T20:34:56Z");
  const guardado = paidAtInstant(todayLocalISO(ahora), ahora)!;
  assert.ok(guardado.getTime() <= ahora.getTime() + 60_000);
});

test("el mediodía local aguanta el día completo en la zona de la clínica", () => {
  const ahora = new Date("2026-09-07T18:00:00Z");
  // Todo septiembre, día a día: el ancla nunca se sale del día elegido.
  for (let d = 1; d <= 30; d++) {
    const iso = `2026-09-${String(d).padStart(2, "0")}`;
    const inst = paidAtInstant(iso, ahora);
    assert.ok(inst, `${iso} debe producir un instante`);
    assert.equal(bucketKeyForDate("mes", inst!, MX), iso, `${iso} se guardó en otro día`);
  }
});

// ── 3 · Lo que no es una fecha no inventa una ───────────────────────────

test("sin fecha o con basura devuelve undefined: manda el default(now()) del endpoint", () => {
  for (const malo of ["", "07/09/2026", "2026-9-7", "2026-13-01", "2026-02-31", "hoy"]) {
    assert.equal(paidAtInstant(malo), undefined, `"${malo}" no es una fecha y no debe guardarse`);
  }
});
