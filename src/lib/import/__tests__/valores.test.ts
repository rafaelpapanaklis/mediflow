/**
 * ws1-t6 — lectura de valores de otro sistema: montos, teléfonos, nombres y horas.
 * PURO: sin base ni red.
 *
 * Run: npx tsx --test src/lib/import/__tests__/valores.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analizarMonto,
  crearLectorMontos,
  horaLocalAUtc,
  parseHora,
  partirNombreCompleto,
  phoneKey,
  separarFechaHora,
} from "../valores";

// ── Montos ─────────────────────────────────────────────────────────────────
test("montos: los formatos que no son ambiguos se leen bien", () => {
  const casos: Array<[unknown, number]> = [
    ["1500", 1500],
    [1500, 1500],
    ["$1,250.50", 1250.5],
    ["45,000.50", 45000.5],
    ["45.000,50", 45000.5],
    ["1.250.000", 1250000],
    ["1,250,000", 1250000],
    ["45,50", 45.5],
    ["45.5", 45.5],
    ["0.500", 0.5],
    ["MXN 3,400.00", 3400],
    ["CLP 45.000,00", 45000],
    ["-1,250.00", -1250],
    ["(1,250.00)", -1250],
    ["45.000-", -45000 + 0], // se lee ambiguo, ver abajo
  ];
  for (const [entrada, esperado] of casos) {
    const a = analizarMonto(entrada);
    if (entrada === "45.000-") {
      assert.equal(a.tipo, "ambiguo");
      continue;
    }
    assert.equal(a.tipo, "ok", `${entrada}`);
    if (a.tipo === "ok") assert.equal(a.valor, esperado, `${entrada}`);
  }
});

test("montos: «45.000» y «1,250» son AMBIGUOS y no se resuelven en silencio", () => {
  const a = analizarMonto("45.000");
  assert.equal(a.tipo, "ambiguo");
  if (a.tipo === "ambiguo") {
    assert.equal(a.miles, 45000);
    assert.equal(a.decimal, 45);
  }
  const b = analizarMonto("1,250");
  assert.equal(b.tipo, "ambiguo");
  if (b.tipo === "ambiguo") assert.equal(b.miles, 1250);

  // Sin ninguna evidencia en el archivo: queda PENDIENTE de confirmar.
  const lector = crearLectorMontos(["45.000", "12.500", "300"]);
  const r = lector.leer("45.000");
  assert.equal(r.pendiente, "45.000");
  assert.equal(r.valor, 45000, "la lectura provisional es la de miles, pero va marcada");
});

test("montos: UNA sola muestra que demuestra el formato NO basta (B1 del QA ws1-t10, ronda 2) — hacen falta 2", () => {
  // Antes de la decisión del 28-sep-2026, una sola «1.250,50» resolvía «45.000»
  // en silencio. Es dinero y el archivo puede mezclar columnas de sistemas
  // distintos: ahora una sola muestra no es evidencia suficiente.
  const unaSola = crearLectorMontos(["45.000", "1.250,50"]);
  assert.equal(unaSola.estilo, null);
  const r = unaSola.leer("45.000");
  assert.equal(r.pendiente, "45.000");
});

test("montos: DOS muestras del mismo archivo que demuestran el MISMO formato sí resuelven los ambiguos", () => {
  // Dos «…,50» de punto-miles → «45.000» es 45 000.
  const es = crearLectorMontos(["45.000", "1.250,50", "2.500,00"]);
  assert.equal(es.estilo, "ES");
  const r = es.leer("45.000");
  assert.equal(r.pendiente, undefined);
  assert.equal(r.valor, 45000);
  assert.match(r.aviso ?? "", /punto para miles/);
  // Con coma decimal, «45,000» es 45 con tres decimales.
  assert.equal(es.leer("45,000").valor, 45);

  // Dos que demuestran US: «45.000» es 45 con decimales, «45,000» es 45 000.
  const us = crearLectorMontos(["45.000", "45,000", "1,250.50", "2,500.00"]);
  assert.equal(us.estilo, "US");
  assert.equal(us.leer("45.000").valor, 45);
  assert.equal(us.leer("45,000").valor, 45000);

  // Si el archivo se contradice (demuestra los DOS formatos), no se elige por
  // él aunque cada uno aparezca una sola vez.
  const mixto = crearLectorMontos(["1.250,50", "1,250.50", "45.000"]);
  assert.equal(mixto.estilo, "mixto");
  assert.equal(mixto.leer("45.000").pendiente, "45.000");
});

test("montos: la decisión del usuario manda", () => {
  const miles = crearLectorMontos(["45.000"], "miles");
  assert.equal(miles.leer("45.000").valor, 45000);
  assert.equal(miles.leer("45.000").pendiente, undefined);
  const dec = crearLectorMontos(["45.000"], "decimales");
  assert.equal(dec.leer("45.000").valor, 45);
});

test("montos: lo que no es un monto es inválido, no un número raro", () => {
  for (const malo of ["abc", "12a5", "1.2.3", "1,2,3", "1.250,5,0", "-", "$"]) {
    assert.equal(analizarMonto(malo).tipo, "invalido", malo);
  }
  assert.equal(analizarMonto("").tipo, "vacio");
  assert.equal(analizarMonto("   ").tipo, "vacio");
});

// ── Teléfonos ──────────────────────────────────────────────────────────────
test("teléfonos: con y sin prefijo de país dan la misma llave", () => {
  const mx = ["55 1234 5678", "+52 55 1234 5678", "525512345678", "+52 1 55 1234 5678", "(55) 1234-5678", "0052 55 1234 5678"];
  for (const t of mx) assert.equal(phoneKey(t), "5512345678", t);
  const cl = ["9 1234 5678", "+56 9 1234 5678", "56912345678", "+56912345678"];
  for (const t of cl) assert.equal(phoneKey(t), "912345678", t);
  assert.equal(phoneKey("+57 300 123 4567"), "3001234567");
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey(null), "");
  // Dos números distintos no se confunden.
  assert.notEqual(phoneKey("55 1234 5678"), phoneKey("55 1234 5679"));
});

// ── Nombres ────────────────────────────────────────────────────────────────
test("nombre completo: se parte con criterio latinoamericano", () => {
  const casos: Array<[string, string, string, boolean]> = [
    ["Ana Ruiz", "Ana", "Ruiz", false],
    ["Juan Carlos Pérez García", "Juan Carlos", "Pérez García", false],
    ["María de los Ángeles Pérez López", "María de los Ángeles", "Pérez López", false],
    ["María del Carmen Ruiz", "María del Carmen", "Ruiz", false],
    ["Pérez García, Juan Carlos", "Juan Carlos", "Pérez García", false],
    ["Juan de la Cruz Pérez", "Juan", "de la Cruz Pérez", true], // «Juan de la Cruz» no está en el diccionario: dudoso
    ["Juan Pérez García", "Juan", "Pérez García", true],
    ["María José Pérez", "María José", "Pérez", true],
    ["Luis Miguel Hernández Ramírez de Arellano", "Luis Miguel Hernández", "Ramírez de Arellano", false],
    ["  Ana   Ruiz  ", "Ana", "Ruiz", false],
  ];
  for (const [entrada, first, last, dudoso] of casos) {
    const r = partirNombreCompleto(entrada);
    assert.deepEqual(r, { firstName: first, lastName: last, dudoso }, entrada);
  }
  assert.deepEqual(partirNombreCompleto("Madonna"), { firstName: "Madonna", lastName: "", dudoso: false });
  assert.deepEqual(partirNombreCompleto(""), { firstName: "", lastName: "", dudoso: false });
});

// ── Horas ──────────────────────────────────────────────────────────────────
test("hora: 24 h, AM/PM y variantes de escritura", () => {
  const casos: Array<[unknown, { h: number; m: number } | null | undefined]> = [
    ["15:30", { h: 15, m: 30 }],
    ["15:30:00", { h: 15, m: 30 }],
    ["15h30", { h: 15, m: 30 }],
    ["15:30 hrs", { h: 15, m: 30 }],
    ["3:30 PM", { h: 15, m: 30 }],
    ["3:30pm", { h: 15, m: 30 }],
    ["03:30 p. m.", { h: 15, m: 30 }],
    ["3:30 P.M.", { h: 15, m: 30 }],
    ["3 pm", { h: 15, m: 0 }],
    ["12:00 AM", { h: 0, m: 0 }],
    ["12:15 a.m.", { h: 0, m: 15 }],
    ["12:00 PM", { h: 12, m: 0 }],
    ["9:05 AM", { h: 9, m: 5 }],
    ["10:00", { h: 10, m: 0 }],
    [0.5, { h: 12, m: 0 }], // celda de hora de Excel (fracción del día)
    [0.6458333333333334, { h: 15, m: 30 }],
    [45566.375, { h: 9, m: 0 }], // fecha+hora en un solo número de serie
    [0, { h: 0, m: 0 }],
    ["", undefined],
    ["   ", undefined],
    [null, undefined],
    ["25:00", null],
    ["13:60", null],
    ["0 PM", null],
    ["13 PM", null],
    ["mañana", null],
    [45566, null], // un entero ≥ 1 es una fecha, no una hora
  ];
  for (const [entrada, esperado] of casos) {
    const r = parseHora(entrada);
    if (esperado === undefined || esperado === null) assert.equal(r, esperado, String(entrada));
    else assert.deepEqual({ h: r!.h, m: r!.m }, esperado, String(entrada));
  }
  // «03:30» sin AM/PM en la madrugada se marca: casi siempre es «15:30».
  assert.equal((parseHora("03:30") as any).dudosa, true);
  assert.equal((parseHora("3:30 pm") as any).dudosa, undefined);
  assert.equal((parseHora("15:30") as any).dudosa, undefined);
});

test("fecha y hora en la misma celda de texto", () => {
  assert.deepEqual(separarFechaHora("05/10/2026 15:30"), { fecha: "05/10/2026", hora: "15:30" });
  assert.deepEqual(separarFechaHora("2026-10-05T15:30:00"), { fecha: "2026-10-05", hora: "15:30:00" });
  assert.deepEqual(separarFechaHora("05/10/2026 3:30 PM"), { fecha: "05/10/2026", hora: "3:30 PM" });
  assert.deepEqual(separarFechaHora("05/10/2026"), { fecha: "05/10/2026", hora: null });
});

// ── Zona horaria ───────────────────────────────────────────────────────────
test("hora local → UTC en la zona de la clínica (México y Mérida son UTC-6 todo el año)", () => {
  assert.equal(horaLocalAUtc(2026, 10, 5, 15, 30, "America/Mexico_City")?.toISOString(), "2026-10-05T21:30:00.000Z");
  assert.equal(horaLocalAUtc(2026, 10, 5, 15, 30, "America/Merida")?.toISOString(), "2026-10-05T21:30:00.000Z");
  assert.equal(horaLocalAUtc(2026, 10, 5, 0, 0, "America/Mexico_City")?.toISOString(), "2026-10-05T06:00:00.000Z");
  // Cancún es UTC-5.
  assert.equal(horaLocalAUtc(2026, 10, 5, 15, 30, "America/Cancun")?.toISOString(), "2026-10-05T20:30:00.000Z");
  // Zona vacía o inválida → México, como el resto del producto.
  assert.equal(horaLocalAUtc(2026, 10, 5, 15, 30, "")?.toISOString(), "2026-10-05T21:30:00.000Z");
  assert.equal(horaLocalAUtc(2026, 10, 5, 15, 30, "No/Existe")?.toISOString(), "2026-10-05T21:30:00.000Z");
  // Chile tiene horario de verano: en octubre ya es UTC-3 tras el cambio, y la hora
  // que el salto se come («00:30» del 6-sep-2026 en Santiago) no existe.
  assert.equal(horaLocalAUtc(2026, 9, 6, 0, 30, "America/Santiago"), null);
  assert.equal(horaLocalAUtc(2026, 10, 5, 15, 30, "America/Santiago")?.toISOString(), "2026-10-05T18:30:00.000Z");
  assert.equal(horaLocalAUtc(2026, 7, 5, 15, 30, "America/Santiago")?.toISOString(), "2026-07-05T19:30:00.000Z");
});
