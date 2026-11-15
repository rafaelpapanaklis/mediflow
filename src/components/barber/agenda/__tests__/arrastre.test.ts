// ARRASTRE — «no funciona el arrastrar» (Rafael, 15-nov, pase 8: «estoy en HOY»).
//
// Lo que se encontró en panel.108 con mouse y dedo de verdad: mover a otra
// hora, a otro barbero y a otro día, y alargar, SÍ funcionan. Fallaban dos
// callejones sin salida que se parecen a «no funciona»:
//   1. En Inicio, «Próximas visitas» es una lista que no se arrastra ni se
//      podía tocar.
//   2. En la Agenda en «Hoy», la única visita a la vista estaba Completada:
//      apretar y jalar no hacía nada y no decía nada.
// Estas pruebas vigilan la lógica pura del aviso y el cableado.
//
//   npx tsx --test src/components/barber/agenda/__tests__/arrastre.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DRAG_START_PX,
  LONG_PRESS_MS,
  avisarSinArrastre,
  motivoSinArrastre,
} from "../rejilla";

const leer = (rel: string) => readFileSync(rel, "utf8");

test("por qué no se mueve: completada/cancelada/no llegó, sin barbero, sin permiso", () => {
  const base = { canEdit: true, barberId: "b1" };
  assert.equal(motivoSinArrastre({ ...base, status: "PENDING" }), null);
  assert.equal(motivoSinArrastre({ ...base, status: "CONFIRMED" }), null);
  assert.equal(motivoSinArrastre({ ...base, status: "IN_PROGRESS" }), null);
  assert.equal(motivoSinArrastre({ ...base, status: "DONE" }), "terminal");
  assert.equal(motivoSinArrastre({ ...base, status: "CANCELLED" }), "terminal");
  assert.equal(motivoSinArrastre({ ...base, status: "NO_SHOW" }), "terminal");
  assert.equal(motivoSinArrastre({ canEdit: true, barberId: null, status: "PENDING" }), "sinBarbero");
  // Sin permiso manda sobre todo lo demás: el rol no mueve ninguna.
  assert.equal(motivoSinArrastre({ canEdit: false, barberId: "b1", status: "PENDING" }), "sinPermiso");
});

test("motivoSinArrastre dice que sí exactamente cuando las rejillas dejan arrastrar", () => {
  for (const archivo of ["src/components/barber/agenda/day-board.tsx", "src/components/barber/agenda/week-board.tsx"]) {
    const s = leer(archivo);
    // La regla del canDrag de la rejilla, la misma que motivoSinArrastre.
    assert.match(s, /canEdit && Boolean\(appt\.barberId\) && !isTerminalAppointmentStatus\(appt\.status\)/, archivo);
  }
});

test("cuándo se avisa: mouse al jalar más de DRAG_START_PX; dedo al mantener apretado", () => {
  // Mouse: un clic (sin moverse) NO avisa (abre el detalle, como siempre).
  assert.equal(avisarSinArrastre("mouse", 0, 0), false);
  assert.equal(avisarSinArrastre("mouse", 50, DRAG_START_PX), false);
  assert.equal(avisarSinArrastre("mouse", 50, DRAG_START_PX + 1), true);
  // Dedo: solo tras mantener apretado y quieto; si se movió antes, era scroll.
  assert.equal(avisarSinArrastre("touch", LONG_PRESS_MS - 1, 0), false);
  assert.equal(avisarSinArrastre("touch", LONG_PRESS_MS, 0), true);
  assert.equal(avisarSinArrastre("touch", LONG_PRESS_MS, 40), false);
});

test("cableado: el gancho avisa, las dos rejillas lo dicen con texto en es y en", () => {
  const gancho = leer("src/components/barber/agenda/use-card-drag.ts");
  assert.match(gancho, /if \(!o\.canDrag\(appt\)\) \{\s*watchDenied\(e, appt\);/);
  assert.match(gancho, /avisarSinArrastre\(pointerType, elapsed, moved\)/);
  for (const archivo of ["src/components/barber/agenda/day-board.tsx", "src/components/barber/agenda/week-board.tsx"]) {
    assert.match(leer(archivo), /onDenied: \(appt\) => \{[\s\S]*?motivoSinArrastre\(/, archivo);
  }
  for (const loc of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/barber/agenda.${loc}.json`));
    for (const k of ["terminal", "sinBarbero", "sinPermiso"]) assert.ok(d.move.denied[k], `${loc}: move.denied.${k}`);
    assert.match(d.move.denied.terminal, /\{status\}/);
  }
});

test("Inicio → Agenda: cada próxima visita abre ese día con la visita resaltada", () => {
  const inicio = leer("src/components/barber/dashboard/inicio-view.tsx");
  assert.match(inicio, /href=\{`\/barber\/agenda\?fecha=\$\{diaDeLaBarberia\(u\.startAt, tz\)\}&visita=\$\{encodeURIComponent\(u\.id\)\}`\}/);
  const pagina = leer("src/app/barber/(panel)/agenda/page.tsx");
  const cuerpo = pagina.slice(pagina.indexOf("export default async function"));
  const awaits = Array.from(cuerpo.matchAll(/await\s+([A-Za-z_$][\w$.]*)/g)).map((m) => m[1]);
  // Los parámetros se leen DESPUÉS del candado de pago.
  assert.deepEqual(awaits.slice(0, 3), ["getBarberContext", "requireBarberPaidAccess", "props.searchParams"]);
  assert.match(pagina, /highlightId=/);
  assert.match(leer("src/components/barber/agenda/appointment-card.tsx"), /data-appt-id=\{appt\.id\}/);
  assert.match(leer("src/components/barber/agenda/agenda-client.tsx"), /setAttribute\("data-resaltada", ""\)/);
  for (const loc of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/barber/inicio.${loc}.json`));
    assert.match(d.inicio.upcoming.open, /\{client\}/, loc);
  }
});
