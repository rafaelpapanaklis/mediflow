// «Agendar» desde la ficha / Mensajes (?nueva=) daba 400 BAD_DURATION (t4, pase 15).
//   npx tsx --test src/components/barber/agenda/__tests__/dialogo-inicial.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { durationToSend, initialCustomMinutes } from "../dialogo-inicial";
import { clampAppointmentMinutes, totalServiceMinutes, BARBER_SLOT_MINUTES } from "@/lib/barber/agenda";

const catalogo = [
  { id: "corte", durationMin: 30 },
  { id: "barba", durationMin: 25 },
  { id: "cejas", durationMin: 10 },
];

/**
 * Lo mismo que hace el diálogo, paso a paso: duración inicial → el usuario
 * elige servicios → duración que se ve → `durationMin` del POST. Y la regla
 * del servidor (appointments/route.ts): si llega durationMin y no es válida,
 * 400 BAD_DURATION; si llega null, la calcula del catálogo.
 */
function dialogo(source: Parameters<typeof initialCustomMinutes>[0], elegidos: string[]) {
  const customMinutes = initialCustomMinutes(source, catalogo);
  const chosen = catalogo.filter((s) => elegidos.includes(s.id));
  const catalogMinutes = chosen.length > 0 ? totalServiceMinutes(chosen) : 0;
  const visible = customMinutes ?? catalogMinutes;
  const enviado = durationToSend(customMinutes);
  const wants = enviado !== undefined && enviado !== null;
  const servidor = wants && clampAppointmentMinutes(enviado) === null ? "400 BAD_DURATION" : "ok";
  const guardada = wants ? clampAppointmentMinutes(enviado) : totalServiceMinutes(chosen);
  return { customMinutes, visible, enviado, servidor, guardada };
}

test("el prefill VIEJO de ?nueva= (startAt = endAt, sin servicios) ya no fija 0 min ni da 400", () => {
  const ahora = "2026-11-15T23:45:00.000Z";
  // Antes: initialCustomMinutes devolvía 0 (0 ≠ un hueco mínimo) y viajaba durationMin: 0.
  assert.equal(clampAppointmentMinutes(0), null, "0 min es justo lo que el servidor rechaza");
  const r = dialogo({ startAt: ahora, endAt: ahora, services: [] }, ["corte"]);
  assert.equal(r.customMinutes, null);
  assert.equal(r.enviado, null);
  assert.equal(r.servidor, "ok");
  assert.equal(r.visible, 30);
  assert.equal(r.guardada, 30);
});

test("?nueva= ahora no trae fuente: la duración sale de los servicios elegidos", () => {
  const uno = dialogo(null, ["corte"]);
  assert.deepEqual([uno.customMinutes, uno.enviado, uno.servidor, uno.visible], [null, null, "ok", 30]);
  const dos = dialogo(null, ["corte", "barba"]);
  assert.equal(dos.visible, 55);
  assert.equal(dos.guardada, 55);
  // Sin servicios todavía, el campo no inventa nada (y «Agendar» pide servicio).
  assert.equal(dialogo(null, []).visible, 0);
  // El mínimo es el del catálogo: un hueco.
  assert.equal(totalServiceMinutes([{ durationMin: 5 }]), Math.max(BARBER_SLOT_MINUTES, 5));
});

test("Repetir una visita que duró distinto que su catálogo conserva su duración", () => {
  const r = dialogo(
    { startAt: "2026-11-08T17:00:00.000Z", endAt: "2026-11-08T18:00:00.000Z", services: [{ serviceId: "corte" }] },
    ["corte"],
  );
  assert.equal(r.customMinutes, 60);
  assert.equal(r.enviado, 60);
  assert.equal(r.servidor, "ok");
});

test("Repetir / Editar una visita que duró lo de su catálogo sigue al catálogo", () => {
  const r = dialogo(
    { startAt: "2026-11-08T17:00:00.000Z", endAt: "2026-11-08T17:30:00.000Z", services: [{ serviceId: "corte" }] },
    ["corte", "cejas"],
  );
  assert.equal(r.customMinutes, null);
  assert.equal(r.visible, 40);
});

test("una fuente con duración negativa o rota tampoco fija la duración", () => {
  assert.equal(
    initialCustomMinutes({ startAt: "2026-11-08T18:00:00.000Z", endAt: "2026-11-08T17:00:00.000Z", services: [] }, catalogo),
    null,
  );
  assert.equal(initialCustomMinutes({ startAt: "x", endAt: "y", services: [] }, catalogo), null);
  assert.equal(durationToSend(0), null);
});
