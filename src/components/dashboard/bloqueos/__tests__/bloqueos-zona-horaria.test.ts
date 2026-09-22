/**
 * LA ARITMÉTICA DE ZONA HORARIA DE LOS BLOQUEOS (ws1-t3).
 *
 * Run: npx tsx --test src/components/dashboard/bloqueos/__tests__/bloqueos-zona-horaria.test.ts
 * (sin script en package.json: ese archivo no está entre las rutas de esta
 * tarea. Añadirle `test:bloqueos` es una línea, y va en el reporte.)
 *
 * Por qué existe: `inicio`/`fin` son instantes UTC y la pantalla los pinta en
 * la zona de la CLÍNICA. El caso que rompe todo lo ingenuo es un bloqueo que
 * termina por la tarde en México: en UTC ya es el día siguiente, y un
 * `toISOString().slice(0,10)` lo pinta un día corrido. Es el bug que Rafael
 * fotografió en /admin, y aquí está clavado en una aserción — el test
 * comprueba a la vez que la forma ingenua falla y que la que se usa acierta.
 *
 * 🔴 LOS INSTANTES LOS FABRICA EL SERVIDOR, TAMBIÉN AQUÍ. Hasta ws1-t3 este
 * archivo los sacaba de un `rangoALaUtc` que vivía en la pantalla, y esa
 * función era justo el error: el navegador no puede convertir a UTC porque no
 * conoce la zona de la clínica. Ahora el test hace el recorrido entero —lo
 * tecleado → `cuerpoDeBloqueo` → `parseRangoTecleado` (el MISMO que corre en
 * la API) → lo pintado—, así que además de la zona horaria vigila que el
 * cuerpo siga siendo el que el servidor entiende.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandasDelDia, cuerpoDeBloqueo, diasDelBloqueo, diaDeInstante, horaDeInstante,
  type RangoLocal,
} from "../fechas";
import { parseRangoTecleado } from "@/lib/agenda-bloqueos/core";
import type { BloqueoDTO } from "../tipos";

const MX = "America/Mexico_City";
const TJ = "America/Tijuana";

/** Cierra toda la clínica: el alcance no es lo que mira este archivo. */
const CLINICA = { modoDoctor: false, miDoctorId: null, doctorElegido: "" };

/**
 * EL RECORRIDO COMPLETO: lo que se teclea → lo que el servidor guardaría.
 *
 * `null` cuando la pantalla no manda nada (rango incompleto o imposible).
 */
function comoLoGuardaElServidor(rango: RangoLocal, tz: string) {
  const cuerpo = cuerpoDeBloqueo(rango, CLINICA);
  if (!cuerpo) return null;
  const { startsAt, endsAt } = parseRangoTecleado(cuerpo, tz);
  return { inicio: startsAt.toISOString(), fin: endsAt.toISOString() };
}

const bloq = (inicio: string, fin: string, extra: Partial<BloqueoDTO> = {}): BloqueoDTO => ({
  id: "b1", doctorId: null, doctorNombre: null, kind: "VACACIONES", reason: "x",
  inicio, fin, diaCompleto: true, holidayKey: null, creadoPor: "a", creadoEl: inicio,
  puedoRetirarlo: true, ...extra,
});

test("día completo del 24-dic al 2-ene: nueve días, ni uno más", () => {
  const r = comoLoGuardaElServidor(
    { desde: "2026-12-24", hasta: "2027-01-02", diaCompleto: true, horaInicio: "", horaFin: "" }, MX)!;
  assert.equal(r.inicio, "2026-12-24T06:00:00.000Z");
  assert.equal(r.fin,    "2027-01-03T06:00:00.000Z");  // corte EXCLUSIVO

  const b = bloq(r.inicio, r.fin);
  assert.deepEqual(diasDelBloqueo(b, MX), { primero: "2026-12-24", ultimo: "2027-01-02" });

  const d24 = bandasDelDia([b], "2026-12-24", MX)[0];
  assert.equal(d24.todoElDia, true);
  assert.equal(d24.vieneDeAntes, false);
  assert.equal(d24.sigueDespues, true);

  const d2 = bandasDelDia([b], "2027-01-02", MX)[0];
  assert.equal(d2.todoElDia, true);
  assert.equal(d2.vieneDeAntes, true);
  // El 2 acaba en el borde: NO promete un 3 cerrado que la rejilla enseña abierto.
  assert.equal(d2.sigueDespues, false);

  assert.equal(bandasDelDia([b], "2027-01-03", MX).length, 0, "el 3 NO está bloqueado");
  assert.equal(bandasDelDia([b], "2026-12-23", MX).length, 0, "el 23 tampoco");
});

test("12-nov de 14 a 18: el fin cae en otro día UTC y aun así se pinta el 12", () => {
  const r = comoLoGuardaElServidor(
    { desde: "2026-11-12", hasta: "", diaCompleto: false, horaInicio: "14:00", horaFin: "18:00" }, MX)!;
  assert.equal(r.inicio, "2026-11-12T20:00:00.000Z");
  assert.equal(r.fin,    "2026-11-13T00:00:00.000Z");

  // 🔴 EL BUG: `new Date(fin).toISOString().slice(0,10)` da "2026-11-13".
  assert.equal(new Date(r.fin).toISOString().slice(0, 10), "2026-11-13");
  // Y lo que hace el código de verdad:
  assert.equal(diaDeInstante(r.fin, MX), "2026-11-12");

  const b = bloq(r.inicio, r.fin, { diaCompleto: false });
  assert.deepEqual(diasDelBloqueo(b, MX), { primero: "2026-11-12", ultimo: "2026-11-12" });
  assert.equal(horaDeInstante(b.inicio, MX), "14:00");
  assert.equal(horaDeInstante(b.fin, MX),    "18:00");

  const banda = bandasDelDia([b], "2026-11-12", MX)[0];
  assert.equal(banda.desdeMin, 14 * 60);
  assert.equal(banda.hastaMin, 18 * 60);
  assert.equal(banda.todoElDia, false);
  assert.equal(bandasDelDia([b], "2026-11-13", MX).length, 0);
});

test("Tijuana (UTC-8) el 31 de diciembre por la tarde sigue siendo 31 de diciembre", () => {
  // 17:00 en Tijuana el 31-dic-2026 = 01:00Z del 1-ene-2027.
  const iso = "2027-01-01T01:00:00.000Z";
  assert.equal(new Date(iso).toISOString().slice(0, 10), "2027-01-01"); // el bug
  assert.equal(diaDeInstante(iso, TJ), "2026-12-31");                    // lo correcto
  assert.equal(horaDeInstante(iso, TJ), "17:00");
});

test("un bloqueo de un doctor no tapa la columna de otro; el de la clínica tapa todas", () => {
  const r = comoLoGuardaElServidor(
    { desde: "2026-11-12", hasta: "", diaCompleto: false, horaInicio: "09:00", horaFin: "11:00" }, MX)!;
  const deDoc = bloq(r.inicio, r.fin, { id: "d", doctorId: "doc-1", doctorNombre: "Dr. Pérez" });
  const deTodos = bloq(r.inicio, r.fin, { id: "c", doctorId: null });

  assert.equal(bandasDelDia([deDoc], "2026-11-12", MX, "doc-1").length, 1);
  assert.equal(bandasDelDia([deDoc], "2026-11-12", MX, "doc-2").length, 0);
  assert.equal(bandasDelDia([deTodos], "2026-11-12", MX, "doc-2").length, 1);
  // Sin acotar (Semana / Mes): entran los dos.
  assert.equal(bandasDelDia([deDoc, deTodos], "2026-11-12", MX, null).length, 2);
});

test("rangos imposibles no mandan nada al servidor", () => {
  const no = (r: any) => assert.equal(cuerpoDeBloqueo(r, CLINICA), null);
  no({ desde: "2026-11-20", hasta: "2026-11-12", diaCompleto: true, horaInicio: "", horaFin: "" });
  no({ desde: "2026-11-12", hasta: "", diaCompleto: false, horaInicio: "18:00", horaFin: "14:00" });
  no({ desde: "2026-11-12", hasta: "", diaCompleto: false, horaInicio: "14:00", horaFin: "14:00" });
  no({ desde: "2026-02-30", hasta: "", diaCompleto: true, horaInicio: "", horaFin: "" });
  no({ desde: "", hasta: "", diaCompleto: true, horaInicio: "", horaFin: "" });
});

test("una banda de duración cero no se pinta", () => {
  // Bloqueo que ACABA a las 00:00 del día que se mira: no tapa ese día.
  const b = bloq("2026-11-11T06:00:00.000Z", "2026-11-12T06:00:00.000Z");
  assert.equal(bandasDelDia([b], "2026-11-12", MX).length, 0);
  assert.equal(bandasDelDia([b], "2026-11-11", MX).length, 1);
});
