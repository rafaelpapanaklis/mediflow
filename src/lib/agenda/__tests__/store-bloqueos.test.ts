/**
 * LOS BLOQUEOS LLEGAN AL ESTADO DE LA AGENDA. WS1-T3.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ESTE ARCHIVO EXISTE
 *
 * WS1-T2 dejó el payload con `bloqueos` y las tres vistas sabiendo pintar la
 * franja, pero NADIE guardaba el campo: `AgendaStoreState` no lo tenía y el
 * reductor lo tiraba. `useBloqueosAgenda` leía `state.bloqueos`, no encontraba
 * nada y devolvía la lista vacía SIEMPRE. Todo lo demás compilaba, las pruebas
 * de la lógica pura pasaban… y la agenda se pintaba como si no hubiera
 * bloqueos aunque los hubiera.
 *
 * Un fallo así no lo ve un tipo ni un `next build`: solo lo ve alguien
 * abriendo la agenda de una clínica con un día cerrado. Estas pruebas lo
 * clavan en el reductor, que es puro y se prueba sin base ni navegador.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Run: npm run test:agenda-store-bloqueos
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaReducer, buildInitialState } from "../store";
import type { AgendaDayResponse } from "../types";
import type { BloqueoDTO } from "@/lib/agenda-bloqueos/core";

const BLOQUEO: BloqueoDTO = {
  id: "blq-1",
  doctorId: null,
  doctorNombre: null,
  kind: "MANTENIMIENTO",
  reason: "Mantenimiento de clínica",
  inicio: "2026-09-22T00:00:00.000Z",
  fin: "2026-09-23T00:00:00.000Z",
  diaCompleto: true,
  holidayKey: null,
  creadoPor: "Rafael",
  creadoEl: "2026-09-20T12:00:00.000Z",
  puedoRetirarlo: true,
};

function payload(extra: Partial<AgendaDayResponse> = {}): AgendaDayResponse {
  return {
    range: { from: "2026-09-22T06:00:00.000Z", to: "2026-09-23T06:00:00.000Z" },
    timezone: "America/Mexico_City",
    slotMinutes: 30,
    dayStart: 8,
    dayEnd: 20,
    appointments: [],
    doctors: [],
    resources: [],
    pendingValidation: [],
    waitlistCount: 0,
    ...extra,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   EL ESTADO INICIAL (la SSR)
   ═══════════════════════════════════════════════════════════════════════ */

test("el estado inicial se queda con los bloqueos del payload", () => {
  const s = buildInitialState(payload({ bloqueos: [BLOQUEO] }), "2026-09-22");
  assert.equal(s.bloqueos.length, 1);
  assert.equal(s.bloqueos[0].reason, "Mantenimiento de clínica");
});

test("un payload SIN bloqueos deja una lista vacía, nunca undefined", () => {
  // `undefined` haría reventar cualquier `.length` o `.map` de las vistas.
  const s = buildInitialState(payload(), "2026-09-22");
  assert.deepEqual(s.bloqueos, []);
});

/* ═══════════════════════════════════════════════════════════════════════
   LOAD_DAY
   ═══════════════════════════════════════════════════════════════════════ */

test("LOAD_DAY trae los bloqueos del día que se carga", () => {
  const inicial = buildInitialState(payload(), "2026-09-21");
  const s = agendaReducer(inicial, {
    type: "LOAD_DAY",
    dayISO: "2026-09-22",
    payload: payload({ bloqueos: [BLOQUEO] }),
  });
  assert.equal(s.bloqueos.length, 1);
});

test("LOAD_DAY con un payload sin el campo NO borra los que había", () => {
  // Las rutas que no lo mandan (hoy ninguna) no pueden apagar la franja: sería
  // decir «este día está libre» sin haberlo consultado.
  const conBloqueo = buildInitialState(payload({ bloqueos: [BLOQUEO] }), "2026-09-22");
  const s = agendaReducer(conBloqueo, {
    type: "LOAD_DAY",
    dayISO: "2026-09-22",
    payload: payload(),
  });
  assert.equal(s.bloqueos.length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════
   SET_BLOQUEOS — lo que despacha el loader al cambiar de día o de vista
   ═══════════════════════════════════════════════════════════════════════ */

test("SET_BLOQUEOS reemplaza la lista entera", () => {
  const inicial = buildInitialState(payload({ bloqueos: [BLOQUEO] }), "2026-09-22");
  const s = agendaReducer(inicial, { type: "SET_BLOQUEOS", bloqueos: [] });
  assert.deepEqual(s.bloqueos, []);
});

test("SET_BLOQUEOS con lista vacía SÍ vacía: navegar a un día libre lo apaga", () => {
  // Es el caso que importa: del 22 (cerrado) al 24 (abierto). Si se conservara
  // lo anterior, el 24 saldría en amarillo sin motivo.
  const inicial = buildInitialState(payload({ bloqueos: [BLOQUEO] }), "2026-09-22");
  const s = agendaReducer(inicial, { type: "SET_BLOQUEOS", bloqueos: [] });
  assert.equal(s.bloqueos.length, 0);
});

test("mover una cita NO toca los bloqueos", () => {
  // Las mutaciones optimistas del arrastre van por su acción; si de paso
  // pisaran esta lista, la franja parpadearía en cada movimiento.
  const inicial = buildInitialState(payload({ bloqueos: [BLOQUEO] }), "2026-09-22");
  const s = agendaReducer(inicial, { type: "SET_APPOINTMENTS", appointments: [] });
  assert.equal(s.bloqueos.length, 1);
});
