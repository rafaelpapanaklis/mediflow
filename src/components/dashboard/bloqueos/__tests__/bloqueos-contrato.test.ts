/**
 * EL CONTRATO CON ws1-t2 — que un payload raro no tumbe Configuración.
 *
 * Run: npx tsx --test src/components/dashboard/bloqueos/__tests__/bloqueos-contrato.test.ts
 *
 * Esta pantalla se programó contra una API que todavía no existe. Lo que se
 * vigila aquí no es «que el servidor conteste bien» —eso no se puede probar
 * desde este lado— sino lo contrario: que cuando conteste MAL, o distinto, la
 * pestaña siga en pie. Cada parser descarta lo que no entiende; ninguno lanza.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBloqueo, parseBloqueos, parseConflicto, parseFestivos,
  parseRespuestaFestivos, parseTipo,
} from "../tipos";

const OK = {
  id: "b1", doctorId: null, doctorNombre: null, kind: "VACACIONES", reason: "Congreso",
  inicio: "2026-11-12T20:00:00.000Z", fin: "2026-11-13T00:00:00.000Z",
  diaCompleto: false, holidayKey: null, creadoPor: "Ana", creadoEl: "2026-11-01T10:00:00.000Z",
  puedoRetirarlo: true,
};

test("un bloqueo sin rango legible se descarta en vez de pintarse mal", () => {
  assert.ok(parseBloqueo(OK));
  assert.equal(parseBloqueo({ ...OK, inicio: "no-es-fecha" }), null);
  assert.equal(parseBloqueo({ ...OK, fin: null }), null);
  assert.equal(parseBloqueo({ ...OK, id: "" }), null);
  assert.equal(parseBloqueo(null), null);
  assert.equal(parseBloqueo("texto"), null);
});

test("puedoRetirarlo falla CERRADO: sin el campo no sale el botón de retirar", () => {
  const sinCampo = { ...OK } as Record<string, unknown>;
  delete sinCampo.puedoRetirarlo;
  assert.equal(parseBloqueo(sinCampo)!.puedoRetirarlo, false);
  // Y nada que no sea el booleano `true` cuenta como permiso.
  assert.equal(parseBloqueo({ ...OK, puedoRetirarlo: "true" })!.puedoRetirarlo, false);
  assert.equal(parseBloqueo({ ...OK, puedoRetirarlo: 1 })!.puedoRetirarlo, false);
  assert.equal(parseBloqueo({ ...OK, puedoRetirarlo: true })!.puedoRetirarlo, true);
});

test("una lista con filas rotas conserva las buenas", () => {
  const r = parseBloqueos({ bloqueos: [OK, null, { id: "x" }, { ...OK, id: "b2" }] });
  assert.deepEqual(r.map((b) => b.id), ["b1", "b2"]);
  assert.deepEqual(parseBloqueos(null), []);
  assert.deepEqual(parseBloqueos({ bloqueos: "no es lista" }), []);
});

test("un kind desconocido cae a OTRO y no deja la etiqueta en blanco", () => {
  assert.equal(parseTipo("PUENTE"), "OTRO");
  assert.equal(parseTipo(undefined), "OTRO");
  assert.equal(parseTipo("FESTIVO"), "FESTIVO");
});

test("el 409 solo se trata como choque si de verdad lo es", () => {
  assert.equal(parseConflicto(null), null);
  assert.equal(parseConflicto({ error: "OTRA_COSA", total: 3 }), null);
  // La revisión que dice «todo libre» NO puede leerse como un choque.
  assert.equal(parseConflicto({ error: "CITAS_EN_EL_RANGO", total: 0, citas: [] }), null);

  const c = parseConflicto({
    error: "CITAS_EN_EL_RANGO", total: 9,
    citas: [{ id: "c1", fecha: "2026-11-12", hora: "16:00", pacienteNombre: "María Gómez", doctorNombre: "Dr. Pérez", doctorId: "d1" }],
  })!;
  // `total` manda sobre la muestra: es lo que dice «y 8 más».
  assert.equal(c.total, 9);
  assert.equal(c.citas.length, 1);
});

test("`total` nunca queda por debajo de las citas que sí llegaron", () => {
  const c = parseConflicto({
    error: "CITAS_EN_EL_RANGO", total: "muchas",
    citas: [{ id: "c1" }, { id: "c2" }],
  })!;
  assert.equal(c.total, 2);
});

test("los festivos se aceptan con `chocaron` en cualquiera de las dos formas", () => {
  // Cadenas sueltas…
  const a = parseRespuestaFestivos({ creados: ["navidad"], chocaron: ["nochebuena"] });
  assert.deepEqual(a.creados, ["navidad"]);
  assert.deepEqual(a.chocaron.map((c) => c.key), ["nochebuena"]);
  assert.equal(a.chocaron[0].total, 0);

  // …u objetos con el detalle.
  const b = parseRespuestaFestivos({
    creados: [{ key: "navidad" }],
    chocaron: [{ key: "nochebuena", total: 2, citas: [{ id: "c1" }, { id: "c2" }] }],
  });
  assert.deepEqual(b.creados, ["navidad"]);
  assert.equal(b.chocaron[0].total, 2);
  assert.equal(b.chocaron[0].citas.length, 2);

  // Y un cuerpo que no se parece a nada no revienta.
  assert.deepEqual(parseRespuestaFestivos("ups"), { creados: [], chocaron: [] });
});

test("un festivo sin fecha válida no entra en el catálogo", () => {
  const base = { key: "navidad", nombre: "Navidad", fecha: "2026-12-25", oficial: true, porDefecto: true, aplicado: false };
  assert.equal(parseFestivos({ festivos: [base] }).length, 1);
  assert.equal(parseFestivos({ festivos: [{ ...base, fecha: "25/12/2026" }] }).length, 0);
  assert.equal(parseFestivos({ festivos: [{ ...base, key: "" }] }).length, 0);
  // `porDefecto` se respeta TAL CUAL: nada lo marca «por ayudar».
  assert.equal(parseFestivos({ festivos: [{ ...base, porDefecto: false }] })[0].porDefecto, false);
});
