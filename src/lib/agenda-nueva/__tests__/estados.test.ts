/**
 * Los nueve estados de cita y cómo se pintan.
 *
 * Esta suite existe por un fallo concreto: en la tabla de citas de la ficha
 * del paciente había estados que caían en un «no sé qué es esto» y se pintaban
 * mal. El diseño de la agenda nueva solo trae CINCO pintas y el sistema tiene
 * NUEVE, así que aquí se comprueba, estado por estado, que ninguno se queda sin
 * decidir y que los dos que el diseño no contempla —cancelada y no asistió— no
 * se confunden con «atendida».
 *
 * Run: npm run test:agenda-nueva-estados
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { citaViva, ESTADOS_MUERTOS, PINTA_POR_ESTADO } from "../estados";
import { AGENDA_TOKENS } from "../tokens";

/** Los nueve del enum, escritos a mano para que el test no dependa del mapa. */
const LOS_NUEVE: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_CHAIR",
  "IN_PROGRESS",
  "COMPLETED",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
];

test("los NUEVE estados tienen pinta propia, ninguno se queda sin decidir", () => {
  const claves = Object.keys(PINTA_POR_ESTADO).sort();
  assert.deepEqual(claves, [...LOS_NUEVE].sort());
  assert.equal(claves.length, 9);
});

test("ninguna pinta se queda a medias", () => {
  for (const estado of LOS_NUEVE) {
    const p = PINTA_POR_ESTADO[estado];
    assert.ok(p, `${estado} sin pinta`);
    assert.ok(p.fondo.length > 0, `${estado} sin fondo`);
    assert.ok(p.borde.length > 0, `${estado} sin borde`);
    assert.ok(p.chipTexto.length > 0, `${estado} sin texto de chip`);
    assert.ok(p.chipFondo.length > 0, `${estado} sin fondo de chip`);
    assert.ok(p.chipTinta.length > 0, `${estado} sin tinta de chip`);
    assert.ok(p.opacidad > 0 && p.opacidad <= 1, `${estado} con opacidad rara: ${p.opacidad}`);
    assert.ok(["solid", "dashed"].includes(p.estiloBorde), `${estado} con borde raro`);
  }
});

test("cada estado tiene un chip DISTINTO: ninguno se confunde con otro", () => {
  const textos = LOS_NUEVE.map((e) => PINTA_POR_ESTADO[e].chipTexto);
  assert.equal(new Set(textos).size, textos.length, `chips repetidos: ${textos.join(", ")}`);
});

/* ── Las dos que el diseño NO tiene ────────────────────────────────────── */

test("«no asistió» NO se pinta como «atendida» — el fallo que se arregló", () => {
  const noVino = PINTA_POR_ESTADO.NO_SHOW;
  const atendida = PINTA_POR_ESTADO.COMPLETED;
  const salio = PINTA_POR_ESTADO.CHECKED_OUT;

  assert.notEqual(noVino.fondo, atendida.fondo);
  assert.notEqual(noVino.fondo, salio.fondo);
  assert.notEqual(noVino.chipTexto, atendida.chipTexto);
  assert.equal(noVino.chipTexto, "No asistió");
  // Va en la familia roja, que es propia y no la comparte nadie más.
  assert.equal(noVino.fondo, AGENDA_TOKENS.rojoFondo);
});

test("«cancelada» es reconocible de un vistazo: apagada, punteada y tachada", () => {
  const c = PINTA_POR_ESTADO.CANCELLED;
  assert.equal(c.estiloBorde, "dashed");
  assert.equal(c.tachado, true);
  assert.ok(c.opacidad < 0.7, "una cancelada tiene que verse apagada");
  // Y es la ÚNICA tachada: si mañana alguien tacha otra, este test avisa.
  const tachadas = LOS_NUEVE.filter((e) => PINTA_POR_ESTADO[e].tachado);
  assert.deepEqual(tachadas, ["CANCELLED"]);
});

/* ── Las cinco del diseño ──────────────────────────────────────────────── */

test("«sin confirmar» es la del borde punteado del diseño", () => {
  assert.equal(PINTA_POR_ESTADO.SCHEDULED.estiloBorde, "dashed");
  assert.equal(PINTA_POR_ESTADO.SCHEDULED.fondo, AGENDA_TOKENS.superficie);
  // Confirmada es la misma tarjeta blanca pero con el borde sólido.
  assert.equal(PINTA_POR_ESTADO.CONFIRMED.estiloBorde, "solid");
  assert.equal(PINTA_POR_ESTADO.CONFIRMED.chipFondo, AGENDA_TOKENS.chipVerdeFondo);
});

test("el ámbar es SOLO de la sala de espera", () => {
  // CHECKED_IN = el paciente llegó y espera: ámbar.
  assert.equal(PINTA_POR_ESTADO.CHECKED_IN.fondo, AGENDA_TOKENS.ambarClaro);
  // Ningún otro estado usa el fondo ámbar. En particular IN_CHAIR no: el
  // paciente ya está en el consultorio, no en la sala.
  const ambarinos = LOS_NUEVE.filter((e) => PINTA_POR_ESTADO[e].fondo === AGENDA_TOKENS.ambarClaro);
  assert.deepEqual(ambarinos, ["CHECKED_IN"]);
});

test("«en sillón» y «en consulta» comparten familia morada pero no chip ni ícono", () => {
  const sillon = PINTA_POR_ESTADO.IN_CHAIR;
  const consulta = PINTA_POR_ESTADO.IN_PROGRESS;
  assert.equal(sillon.fondo, AGENDA_TOKENS.moradoTinte);
  assert.equal(consulta.fondo, AGENDA_TOKENS.moradoTinte);
  assert.notEqual(sillon.chipTexto, consulta.chipTexto);
  assert.notEqual(sillon.icono, consulta.icono);
  assert.equal(sillon.icono, "chair");
});

test("«atendida» y «salió» se ven apagadas, como pide el diseño", () => {
  assert.ok(PINTA_POR_ESTADO.COMPLETED.opacidad < 1);
  assert.ok(PINTA_POR_ESTADO.CHECKED_OUT.opacidad < 1);
});

/* ── Citas vivas ───────────────────────────────────────────────────────── */

test("solo cancelada y no asistió dejan de ocupar sitio", () => {
  assert.deepEqual([...ESTADOS_MUERTOS].sort(), ["CANCELLED", "NO_SHOW"]);
  for (const e of LOS_NUEVE) {
    const esperado = e !== "CANCELLED" && e !== "NO_SHOW";
    assert.equal(citaViva(e), esperado, `citaViva(${e})`);
  }
});

test("ESTADOS_MUERTOS se deriva del mapa, no de una lista aparte", () => {
  // Si alguien marcara `muerta` en otro estado, la lista tiene que seguirlo
  // sola: es lo que evita que las dos se desincronicen.
  const desdeElMapa = LOS_NUEVE.filter((e) => PINTA_POR_ESTADO[e].muerta);
  assert.deepEqual([...ESTADOS_MUERTOS], desdeElMapa);
});
