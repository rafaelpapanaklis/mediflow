// ws1-t1 (tercera ronda) — panel de la cita: N-43 (anticipo pedido sin monto ni camino), N-44 (cita de la fila
// completada en segundos: «03:28–03:28», «5 min», «Confirmada» sin que nadie confirmara) y N-47 («Registrado»
// contra «Marcar llegada», «Confirmada / Confirmada»).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aCitaVista } from "../vista-modelo";
import { textoDuracion } from "../origen-cita";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const PANEL = leer("components/dashboard/agenda-nueva/panel-cita.tsx");

test("🔴→🟢 N-44: una cita que empezó y terminó el mismo minuto no dice «03:28–03:28» ni «5 min»", () => {
  const dto: any = {
    id: "w", startsAt: "2026-10-04T09:28:05Z", endsAt: "2026-10-04T09:28:15Z", status: "COMPLETED",
    patient: { id: "p", name: "Rosa" }, doctor: { id: "d", shortName: "Mariana" }, source: "STAFF",
  };
  const v = aCitaVista(dto, { timezone: "America/Mexico_City", doctores: [], unidades: [], ahora: new Date("2026-10-04T10:00:00Z") });
  assert.equal(v.rango, "03:28");
  assert.equal(textoDuracion(v.duracionReal, v.duracionMin), "menos de 1 min");
  assert.equal(textoDuracion(30, 30), "30 min");
  assert.match(PANEL, /textoDuracion\(cita\.duracionReal, cita\.duracionMin\)/);
  assert.match(PANEL, /\(dto\.isWalkIn \? PASOS_WALK_IN : PASOS\)\.map/);
  assert.match(PANEL, /const PASOS_WALK_IN = \["Sin cita \(fila\)", "Registrado"/);
});

test("🔴→🟢 N-47: el botón usa el verbo del estado y el paso no repite su nombre", () => {
  assert.match(PANEL, /CHECKED_IN: \{ etiqueta: "Registrar llegada"/);
  assert.match(PANEL, /k === pasoConDetalle && cita\.detalle !== etiqueta/);
});

test("🔴→🟢 N-43: el panel dice el monto del anticipo pedido y lleva a registrarlo", () => {
  assert.match(PANEL, /dto\.anticipoPedido \? <>Anticipo pedido de/);
  assert.match(PANEL, /Registrar el anticipo o copiar el texto otra vez/);
  const server = leer("lib/agenda/server.ts");
  assert.match(server, /status: \{ in: \["PAID", "PENDING"\] \}/);
  assert.equal((server.match(/return conAnticipoPedido\(/g) ?? []).length, 2);
});
