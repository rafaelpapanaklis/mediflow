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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppointmentStatus } from "@/lib/agenda/types";
import {
  citaContada,
  citaViva,
  esSinConfirmar,
  estadoNormalizado,
  ESTADOS_MUERTOS,
  pintaDeEstado,
  PINTA_POR_ESTADO,
} from "../estados";
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

/* ── El PENDING legacy: el estado que el tipo no tiene y la base sí ────── */

test("«PENDING» no deja la pinta en undefined — tumbaba la vista entera", () => {
  // El enum de Postgres tiene DIEZ valores y el tipo de TS solo NUEVE:
  // `PENDING` sigue existiendo y además es el `@default` de la columna. Una
  // sola fila así dejaba `pinta` en `undefined` y la primera lectura de
  // `pinta.chipTexto` lanzaba DENTRO del render de la vista Día.
  const pinta = pintaDeEstado("PENDING");
  assert.ok(pinta, "PENDING tiene que tener pinta");
  assert.equal(pinta.chipTexto, "Agendada", "PENDING es una cita agendada sin confirmar");
  assert.deepEqual(pinta, PINTA_POR_ESTADO.SCHEDULED);
});

test("estadoNormalizado lleva PENDING a SCHEDULED y deja en paz a los nueve", () => {
  assert.equal(estadoNormalizado("PENDING"), "SCHEDULED");
  for (const e of LOS_NUEVE) assert.equal(estadoNormalizado(e), e);
});

test("ningún valor inesperado de la base puede dejar la pinta en undefined", () => {
  // Defensa en profundidad: si mañana alguien añade un estado al enum de
  // Postgres y se olvida del tipo, la agenda lo pinta como «sin confirmar» en
  // vez de caerse.
  for (const basura of ["PENDING", "LO_QUE_SEA", "", "scheduled"]) {
    const pinta = pintaDeEstado(basura);
    assert.ok(pinta && typeof pinta.chipTexto === "string", `«${basura}» sin pinta`);
  }
  assert.equal(citaViva("PENDING"), true);
  assert.equal(citaViva("LO_QUE_SEA"), true);
});

/* ── Los predicados que comparten las tres vistas ──────────────────────── */

test("«sin confirmar» incluye el PENDING legacy", () => {
  // El fallo que encontró ws1-t2 en la nota ámbar del Mes: con
  // `status === "SCHEDULED"` a pelo, un día con cinco citas en PENDING decía
  // «0 sin confirmar». Y esa nota existe para decir «llama a estos pacientes».
  assert.equal(esSinConfirmar("SCHEDULED"), true);
  assert.equal(esSinConfirmar("PENDING"), true);
  for (const e of LOS_NUEVE) {
    if (e === "SCHEDULED") continue;
    assert.equal(esSinConfirmar(e), false, `${e} no está «sin confirmar»`);
  }
});

test("«N citas» cuenta todo menos las canceladas, plantones incluidos", () => {
  assert.equal(citaContada("CANCELLED"), false);
  assert.equal(citaContada("NO_SHOW"), true, "el plantón se dibuja, así que cuenta");
  assert.equal(citaContada("PENDING"), true);
  for (const e of LOS_NUEVE) {
    assert.equal(citaContada(e), e !== "CANCELLED", `citaContada(${e})`);
  }
});

test("las dos cuentas son distintas a propósito: un plantón cuenta pero no ocupa", () => {
  // «N citas» y «minutos ocupados» no pueden usar el mismo criterio: un
  // plantón ocupó un renglón del libro pero no ocupó el sillón.
  assert.equal(citaContada("NO_SHOW"), true);
  assert.equal(citaViva("NO_SHOW"), false);
  // Y una cancelada no cuenta para ninguna de las dos.
  assert.equal(citaContada("CANCELLED"), false);
  assert.equal(citaViva("CANCELLED"), false);
});

/* ── La agenda y la ficha del paciente dicen lo MISMO de cada estado ───── */

// Se integraron por separado: la ficha (#277) arregló su tabla de citas con
// sus nombres y la agenda (#284) decidió los suyos a mano. Al juntarlas, la
// misma cita salía «Agendada» en la ficha y «Sin confirmar» en la agenda, y
// el rojo significaba «cancelada» en una pantalla y «no asistió» en la otra.
// Estos candados comparan los TRES mapas (Resumen, Citas y agenda) leyendo el
// código de la ficha tal cual, sin copiarlo aquí.

const RAIZ = process.cwd();
const FICHA_RESUMEN = "src/components/dashboard/pacientes-rediseno/resumen.tsx";
const FICHA_CITAS = "src/app/dashboard/patients/[id]/patient-detail-client.tsx";

/** Los diez del enum de Postgres: los nueve del tipo más el PENDING legacy. */
const LOS_DIEZ = ["PENDING", ...LOS_NUEVE];

/** `ESTADO: { key|labelKey: "…", tono: "…" }` del mapa de la ficha, por estado. */
function mapaDeLaFicha(ruta: string, nombreMapa: string): Map<string, { clave: string; tono: string }> {
  const src = readFileSync(join(RAIZ, ruta), "utf8");
  const inicio = src.indexOf(`const ${nombreMapa}`);
  assert.ok(inicio >= 0, `${ruta}: no encuentro ${nombreMapa}`);
  const cuerpo = src.slice(inicio, src.indexOf("};", inicio));
  const mapa = new Map<string, { clave: string; tono: string }>();
  const fila = /^\s*([A-Z_]+):\s*\{\s*(?:key|labelKey):\s*"([^"]+)",\s*tono:\s*"([^"]+)"\s*\}/gm;
  for (const m of cuerpo.matchAll(fila)) mapa.set(m[1], { clave: m[2], tono: m[3] });
  return mapa;
}

function textoEs(clave: string): string {
  const dic = JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries/es.json"), "utf8"));
  const valor = clave.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), dic);
  assert.equal(typeof valor, "string", `es.json no tiene «${clave}»`);
  return valor as string;
}

const RESUMEN = mapaDeLaFicha(FICHA_RESUMEN, "ESTADO_CITA");
const CITAS = mapaDeLaFicha(FICHA_CITAS, "APPT_STATUS_FULL");

test("la ficha conoce los diez estados, en Resumen y en Citas por igual", () => {
  assert.deepEqual([...RESUMEN.keys()].sort(), [...LOS_DIEZ].sort());
  assert.deepEqual([...CITAS.keys()].sort(), [...LOS_DIEZ].sort());
  for (const e of LOS_DIEZ) {
    assert.deepEqual(CITAS.get(e), RESUMEN.get(e), `${e}: Resumen y Citas no coinciden`);
  }
});

test("la agenda llama a cada estado igual que la ficha — «Agendada» es «Agendada»", () => {
  for (const e of LOS_DIEZ) {
    const enLaFicha = textoEs(RESUMEN.get(e)!.clave);
    assert.equal(pintaDeEstado(e).chipTexto, enLaFicha, `${e}: la agenda dice «${pintaDeEstado(e).chipTexto}» y la ficha «${enLaFicha}»`);
  }
});

test("el ámbar y el rojo significan lo mismo en las dos pantallas", () => {
  // Ámbar = el paciente espera en la sala. Rojo = el paciente no vino.
  const ambarEnFicha = LOS_DIEZ.filter((e) => RESUMEN.get(e)!.tono === "etiquetaAlerta");
  const ambarEnAgenda = LOS_NUEVE.filter((e) => PINTA_POR_ESTADO[e].fondo === AGENDA_TOKENS.ambarClaro);
  assert.deepEqual(ambarEnFicha, ["CHECKED_IN"]);
  assert.deepEqual(ambarEnFicha, ambarEnAgenda);

  const rojoEnFicha = LOS_DIEZ.filter((e) => RESUMEN.get(e)!.tono === "etiquetaPeligro");
  const rojoEnAgenda = LOS_NUEVE.filter((e) => PINTA_POR_ESTADO[e].fondo === AGENDA_TOKENS.rojoFondo);
  assert.deepEqual(rojoEnFicha, ["NO_SHOW"]);
  assert.deepEqual(rojoEnFicha, rojoEnAgenda);

  // Y el verde de «Confirmada», y el morado de sillón y consulta.
  assert.equal(RESUMEN.get("CONFIRMED")!.tono, "etiquetaExito");
  assert.equal(PINTA_POR_ESTADO.CONFIRMED.chipFondo, AGENDA_TOKENS.chipVerdeFondo);
  for (const e of ["IN_CHAIR", "IN_PROGRESS"] as const) {
    assert.equal(RESUMEN.get(e)!.tono, "etiquetaVioleta", `${e} en la ficha`);
    assert.equal(PINTA_POR_ESTADO[e].fondo, AGENDA_TOKENS.moradoTinte, `${e} en la agenda`);
  }
});

test("PENDING es «Agendada» en las dos, como lo trata el servidor", () => {
  assert.deepEqual(RESUMEN.get("PENDING"), RESUMEN.get("SCHEDULED"));
  assert.deepEqual(pintaDeEstado("PENDING"), PINTA_POR_ESTADO.SCHEDULED);
});
