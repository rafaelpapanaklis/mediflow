/**
 * El «siguiente paso» del panel de la cita, por ROL.
 *
 * Esta suite existe por un fallo concreto que encontró el revisor: el panel
 * elegía UNA sola acción por estado y preguntaba a `possibleTransitions` SIN
 * pasarle el rol. Ese filtro es solo estructural, así que daba por buenas
 * transiciones que el rol tenía prohibidas: se pintaba el botón negro, el
 * servidor devolvía 403 y el usuario se quedaba sin camino. En concreto, **un
 * doctor no tenía ninguna forma de pasar su cita a «en consulta»**.
 *
 * Aquí se comprueba la tabla de decisión que sustituyó a aquello: para cada
 * rol y cada estado, el primer destino de la lista de preferencia que la
 * máquina de estados le permite de verdad.
 *
 * Run: npm run test:agenda-nueva-siguiente-paso
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Role } from "@prisma/client";
import { possibleTransitions } from "@/lib/agenda/transitions";
import type { AppointmentStatus } from "@/lib/agenda/types";

/**
 * La MISMA tabla que usa el panel (`SIGUIENTES` en `panel-cita.tsx`). Se copia
 * aquí a propósito: el panel es un componente de React y montarlo pediría un
 * renderizador; lo que se quiere fijar es la decisión, no el JSX. La prueba de
 * abajo comprueba que las dos listas no se separen.
 */
const SIGUIENTES: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"],
  CONFIRMED: ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"],
  CHECKED_IN: ["IN_PROGRESS", "IN_CHAIR"],
  IN_CHAIR: ["IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["CHECKED_OUT"],
  CANCELLED: ["SCHEDULED"],
  NO_SHOW: ["SCHEDULED"],
};

/** Lo que el panel pinta en el botón negro: el primero que este rol puede dar. */
function siguientePaso(
  estado: AppointmentStatus,
  role: Role,
  opts: { now?: Date; inicio?: Date } = {},
): AppointmentStatus | null {
  const now = opts.now ?? new Date("2026-09-02T18:00:00.000Z");
  const inicio = opts.inicio ?? new Date("2026-09-02T17:00:00.000Z");
  const permitidas = possibleTransitions(estado, { role, now, appointmentStart: inicio });
  return (SIGUIENTES[estado] ?? []).find((d) => permitidas.includes(d)) ?? null;
}

/* ── El fallo que motivó todo esto ─────────────────────────────────────── */

test("un DOCTOR con una cita agendada SÍ puede empezar la consulta", () => {
  // Antes se le pintaba «Confirmar cita» (que es de recepción) y el servidor
  // le devolvía 403; no le quedaba ningún camino.
  assert.equal(siguientePaso("SCHEDULED", "DOCTOR"), "IN_CHAIR");
  assert.notEqual(siguientePaso("SCHEDULED", "DOCTOR"), "CONFIRMED");

  // Y desde ahí llega a «en consulta».
  assert.equal(siguientePaso("IN_CHAIR", "DOCTOR"), "IN_PROGRESS");
  assert.equal(siguientePaso("IN_PROGRESS", "DOCTOR"), "COMPLETED");
});

test("RECEPCIÓN con un paciente en sala puede sentarlo en el sillón", () => {
  // «Pasar a consulta» es clínico: a recepción le tocaba el 403.
  assert.equal(siguientePaso("CHECKED_IN", "RECEPTIONIST"), "IN_CHAIR");
  assert.equal(siguientePaso("CHECKED_IN", "DOCTOR"), "IN_PROGRESS");
});

test("nadie se queda sin siguiente paso en el camino normal de su rol", () => {
  const camino: Array<[Role, AppointmentStatus[]]> = [
    ["RECEPTIONIST", ["SCHEDULED", "CONFIRMED", "CHECKED_IN"]],
    ["DOCTOR", ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]],
    ["ADMIN", ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED"]],
  ];
  for (const [role, estados] of camino) {
    for (const estado of estados) {
      assert.ok(
        siguientePaso(estado, role) !== null,
        `${role} se queda sin botón con una cita en ${estado}`,
      );
    }
  }
});

test("el paso que se ofrece SIEMPRE lo permite la máquina de estados para ese rol", () => {
  // Es la invariante: si esto falla, hay un botón que devolverá 403.
  const roles: Role[] = ["RECEPTIONIST", "DOCTOR", "ADMIN", "SUPER_ADMIN"];
  const estados = Object.keys(SIGUIENTES) as AppointmentStatus[];
  const now = new Date("2026-09-02T18:00:00.000Z");
  const inicio = new Date("2026-09-02T17:00:00.000Z");

  for (const role of roles) {
    for (const estado of estados) {
      const paso = siguientePaso(estado, role, { now, inicio });
      if (paso === null) continue;
      const permitidas = possibleTransitions(estado, { role, now, appointmentStart: inicio });
      assert.ok(
        permitidas.includes(paso),
        `${role} · ${estado} → ${paso} no está permitido: el botón daría 403`,
      );
    }
  }
});

/* ── Reabrir es de administradores ─────────────────────────────────────── */

test("«Reabrir cita» solo se le ofrece a quien puede reabrirla", () => {
  for (const terminal of ["CANCELLED", "NO_SHOW"] as AppointmentStatus[]) {
    assert.equal(siguientePaso(terminal, "ADMIN"), "SCHEDULED");
    assert.equal(siguientePaso(terminal, "SUPER_ADMIN"), "SCHEDULED");
    // A recepción y a los doctores ni se les pinta: antes se les pintaba y
    // fallaba siempre.
    assert.equal(siguientePaso(terminal, "RECEPTIONIST"), null);
    assert.equal(siguientePaso(terminal, "DOCTOR"), null);
  }
});

/* ── La gracia del «no asistió» ────────────────────────────────────────── */

test("«No asistió» aparece solo tras los 15 minutos de gracia", () => {
  const inicio = new Date("2026-09-02T17:00:00.000Z");
  const antes = new Date("2026-09-02T17:10:00.000Z"); // 10 min
  const despues = new Date("2026-09-02T17:20:00.000Z"); // 20 min

  const conReloj = (now: Date) =>
    possibleTransitions("CONFIRMED", { role: "RECEPTIONIST", now, appointmentStart: inicio });

  assert.ok(!conReloj(antes).includes("NO_SHOW"), "antes de la gracia no se ofrece");
  assert.ok(conReloj(despues).includes("NO_SHOW"), "pasada la gracia sí");
});

/* ── La tabla del panel y la de aquí no se pueden separar ──────────────── */

test("la tabla SIGUIENTES de esta prueba es la misma que la del panel", () => {
  // Si alguien cambia una y no la otra, esta prueba deja de medir lo que dice
  // medir. Se compara contra el código fuente del componente.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync(
    `${process.cwd()}/src/components/dashboard/agenda-nueva/panel-cita.tsx`,
    "utf8",
  );
  const bloque = /const SIGUIENTES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(bloque, "no se encontró SIGUIENTES en panel-cita.tsx");

  for (const [estado, destinos] of Object.entries(SIGUIENTES)) {
    const fila = new RegExp(`${estado}:\\s*\\[([^\\]]*)\\]`).exec(bloque[1]!);
    assert.ok(fila, `${estado} no está en la tabla del panel`);
    const delPanel = fila[1]!
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter(Boolean);
    assert.deepEqual(delPanel, destinos, `la lista de ${estado} no coincide con la del panel`);
  }
});

/* ── Todos los destinos tienen etiqueta ────────────────────────────────── */

test("todo destino que el panel pueda ofrecer tiene nombre e ícono", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync(
    `${process.cwd()}/src/components/dashboard/agenda-nueva/panel-cita.tsx`,
    "utf8",
  );
  const acciones = /const ACCIONES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(acciones, "no se encontró ACCIONES en panel-cita.tsx");

  const destinos = new Set(Object.values(SIGUIENTES).flat());
  for (const d of destinos) {
    assert.match(
      acciones[1]!,
      new RegExp(`\\b${d}:\\s*\\{`),
      `${d} se puede ofrecer pero no tiene etiqueta en ACCIONES: saldría un botón en blanco`,
    );
  }
});
