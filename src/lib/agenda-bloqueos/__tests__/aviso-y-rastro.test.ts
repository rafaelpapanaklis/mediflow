/**
 * AGENDAR SOBRE UN BLOQUEO: CUÁNDO SE PREGUNTA Y QUÉ RASTRO QUEDA. WS1-T3.
 *
 * Lo que estas pruebas defienden, por orden de importancia:
 *
 *  1. 🔴 QUE SIN BLOQUEO NO SALE EL DIÁLOGO. El 99 % de las citas no tocan
 *     ningún bloqueo, y ninguna de ellas puede ganar un clic extra. Si esta
 *     prueba se rompe, quince clínicas empiezan a pulsar «aceptar» en cada
 *     cita del día — y en tres días nadie lee ya el aviso, que es exactamente
 *     el problema que la tarea venía a arreglar. Va primero por eso.
 *
 *  2. Que el BORDE no cuenta: una cita que empieza justo cuando acaba el
 *     bloqueo no pregunta nada. Es el mismo intervalo semiabierto
 *     `[inicio, fin)` de todo el módulo; con el criterio contrario, cerrar la
 *     mañana haría preguntar por la primera cita de la tarde.
 *
 *  3. Que el ALCANCE se respeta: el bloqueo de una doctora no hace preguntar
 *     a sus compañeros, y el de la clínica pregunta a todos.
 *
 *  4. 🔴 QUE EL RASTRO NUNCA TOQUE `overrideReason`. Esa columna no es un
 *     campo de notas: el índice de exclusión `appt_doctor_no_overlap` es
 *     PARCIAL, con `WHERE … AND "overrideReason" IS NULL`, así que escribir
 *     cualquier cosa ahí SACA la cita del «dos citas no se pisan» —y
 *     `overlap-client.ts` hace lo mismo en la pantalla—. Si el rastro del
 *     bloqueo volviera a esa columna, cualquiera que pueda crear una cita
 *     tendría el bypass de solape que la casa reserva a ADMIN. Hay una prueba
 *     que lee las dos rutas y lo clava.
 *
 * Todo puro: sin base de datos, sin red, sin reloj.
 *
 * Run: npm run test:agenda-bloqueos-aviso
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRAZA_BLOQUEO_PREFIJO,
  bloqueoQueTapa,
  trazaDeBloqueo,
} from "../core";

/* ───────────────────────────── los datos ────────────────────────────── */

const DRA_RUIZ = "doc-ruiz";
const DR_SOLIS = "doc-solis";

/** Mantenimiento del 22 entero, de TODA la clínica (zona UTC para la prueba). */
const MANTENIMIENTO = {
  id: "blq-1",
  doctorId: null,
  doctorNombre: null,
  reason: "Mantenimiento de clínica",
  inicio: "2026-09-22T00:00:00.000Z",
  fin: "2026-09-23T00:00:00.000Z",
};

/** Congreso de la Dra. Ruiz, el 24 de 14:00 a 16:00. */
const CONGRESO = {
  id: "blq-2",
  doctorId: DRA_RUIZ,
  doctorNombre: "Dra. Ruiz",
  reason: "Congreso CDMX",
  inicio: "2026-09-24T14:00:00.000Z",
  fin: "2026-09-24T16:00:00.000Z",
};

const TODOS = [MANTENIMIENTO, CONGRESO];

/* ═══════════════════════════════════════════════════════════════════════
   1 · SIN BLOQUEO NO SE PREGUNTA NADA
   ═══════════════════════════════════════════════════════════════════════ */

test("sin bloqueos en el día, NO hay diálogo", () => {
  assert.equal(
    bloqueoQueTapa([], "2026-09-22T10:00:00.000Z", "2026-09-22T10:30:00.000Z", DRA_RUIZ),
    null,
  );
});

test("con bloqueos en OTROS días, la cita normal NO pregunta", () => {
  // El 23 no tiene nada: el mantenimiento acabó y el congreso es el 24.
  assert.equal(
    bloqueoQueTapa(TODOS, "2026-09-23T10:00:00.000Z", "2026-09-23T10:30:00.000Z", DRA_RUIZ),
    null,
  );
});

test("el mismo día del congreso, pero a otra hora, NO pregunta", () => {
  assert.equal(
    bloqueoQueTapa(TODOS, "2026-09-24T09:00:00.000Z", "2026-09-24T09:30:00.000Z", DRA_RUIZ),
    null,
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   2 · EL BORDE NO CUENTA
   ═══════════════════════════════════════════════════════════════════════ */

test("la cita que empieza justo cuando ACABA el bloqueo no pregunta", () => {
  assert.equal(
    bloqueoQueTapa(TODOS, "2026-09-24T16:00:00.000Z", "2026-09-24T16:30:00.000Z", DRA_RUIZ),
    null,
  );
});

test("la cita que TERMINA justo cuando empieza el bloqueo no pregunta", () => {
  assert.equal(
    bloqueoQueTapa(TODOS, "2026-09-24T13:30:00.000Z", "2026-09-24T14:00:00.000Z", DRA_RUIZ),
    null,
  );
});

test("un minuto dentro del bloqueo YA pregunta", () => {
  const b = bloqueoQueTapa(
    TODOS,
    "2026-09-24T13:30:00.000Z",
    "2026-09-24T14:01:00.000Z",
    DRA_RUIZ,
  );
  assert.equal(b?.id, CONGRESO.id);
});

/* ═══════════════════════════════════════════════════════════════════════
   3 · EL ALCANCE
   ═══════════════════════════════════════════════════════════════════════ */

test("el bloqueo de TODA la clínica pregunta a cualquier doctor", () => {
  for (const doctorId of [DRA_RUIZ, DR_SOLIS, null]) {
    const b = bloqueoQueTapa(
      TODOS,
      "2026-09-22T10:00:00.000Z",
      "2026-09-22T10:30:00.000Z",
      doctorId,
    );
    assert.equal(b?.id, MANTENIMIENTO.id, `falló con doctorId=${String(doctorId)}`);
    assert.equal(b?.doctorId, null, "el alcance de clínica viaja como doctorId null");
  }
});

test("el bloqueo de UNA doctora NO pregunta a su compañero", () => {
  assert.equal(
    bloqueoQueTapa(TODOS, "2026-09-24T14:30:00.000Z", "2026-09-24T15:00:00.000Z", DR_SOLIS),
    null,
  );
});

test("el bloqueo de una doctora SÍ le pregunta a ella, con su nombre", () => {
  const b = bloqueoQueTapa(
    TODOS,
    "2026-09-24T14:30:00.000Z",
    "2026-09-24T15:00:00.000Z",
    DRA_RUIZ,
  );
  assert.equal(b?.id, CONGRESO.id);
  // El nombre es lo que deja escribir «Dra. Ruiz — Congreso CDMX» en vez de
  // pintar la clínica entera de amarillo por las vacaciones de una persona.
  assert.equal(b?.doctorNombre, "Dra. Ruiz");
  assert.equal(b?.reason, "Congreso CDMX");
});

test("sin doctor elegido, solo tapan los bloqueos de TODA la clínica", () => {
  // Un hueco sin doctor (la barra del Mes, una solicitud sin doctor) no puede
  // darse por cerrado porque UNA doctora esté en un congreso: los otros tres
  // atienden.
  assert.equal(
    bloqueoQueTapa(TODOS, "2026-09-24T14:30:00.000Z", "2026-09-24T15:00:00.000Z", null),
    null,
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   4 · FECHAS ROTAS: NO SE PREGUNTA, NO SE REVIENTA
   ═══════════════════════════════════════════════════════════════════════ */

test("una fecha ilegible no tumba la pantalla ni inventa un aviso", () => {
  assert.equal(bloqueoQueTapa(TODOS, "no-es-una-fecha", "tampoco", DRA_RUIZ), null);
  const conBasura = [{ ...MANTENIMIENTO, inicio: "???", fin: "???" }];
  assert.equal(
    bloqueoQueTapa(conBasura, "2026-09-22T10:00:00.000Z", "2026-09-22T10:30:00.000Z", null),
    null,
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   5 · 🔴 EL RASTRO NO PUEDE TOCAR `overrideReason`
   ═══════════════════════════════════════════════════════════════════════ */

const RUTA_POST = "src/app/api/appointments/route.ts";
const RUTA_PATCH = "src/app/api/appointments/[id]/route.ts";

/**
 * La fuente de una ruta, sin comentarios y con los espacios aplastados.
 *
 * ⚠️ ESTAS PRUEBAS SON UN CABLE TRAMPA, NO UNA PRUEBA DE COMPORTAMIENTO. Lo
 * de verdad importante —que escribir en `overrideReason` saca la cita del
 * índice de exclusión— solo se puede ejercitar contra Postgres, y aquí no hay
 * base. Lo que sí se puede es vigilar que nadie vuelva a escribir ahí sin
 * darse cuenta, y eso es lo que hacen: si alguien lo reintroduce, esto salta
 * y le manda a leer el §7 de `core.ts`.
 *
 * Se quitan comentarios y se aplastan espacios para que un salto de línea o un
 * `prettier` no las rompan: lo que se fija es la forma del código, no su
 * formato.
 */
function fuente(ruta: string): string {
  return readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ");
}

test("la constraint que esto protege sigue siendo PARCIAL sobre overrideReason", () => {
  // Si algún día deja de serlo, esta prueba avisa antes de que las de abajo
  // pierdan su sentido.
  const sql = readFileSync("prisma/migrations/20260424120000_fase_4_agenda/migration.sql", "utf8");
  assert.match(sql, /appt_doctor_no_overlap/);
  assert.match(sql, /"overrideReason" IS NULL/);
});

test("la pantalla también salta las citas con overrideReason: por eso no se toca", () => {
  // `overlap-client.ts` las descarta al calcular huecos ocupados. Escribir el
  // rastro ahí no solo rompería la constraint: pintaría el hueco como libre.
  const src = readFileSync("src/lib/agenda/overlap-client.ts", "utf8");
  assert.match(src, /if \(a\.overrideReason\) continue;/);
});

test("NINGUNA de las dos rutas escribe el rastro del bloqueo en overrideReason", () => {
  for (const ruta of [RUTA_POST, RUTA_PATCH]) {
    const src = fuente(ruta);
    assert.doesNotMatch(src, /overrideReason:\s*(rastro|traza)/i, ruta);
    assert.doesNotMatch(src, /overrideReason\s*=\s*(rastro|traza)/i, ruta);
    assert.doesNotMatch(src, /overrideReason[^;]{0,40}bloqueo/i, ruta);
  }
});

test("las dos rutas escriben overrideReason SOLO desde el cuerpo, como siempre", () => {
  assert.match(fuente(RUTA_POST), /overrideReason: body\.overrideReason \?\? null/);
  assert.match(fuente(RUTA_PATCH), /data\.overrideReason = body\.overrideReason;/);
});

test("el gate de rol de overrideReason sigue en pie en las dos rutas", () => {
  // Es lo que reserva el bypass de solape a ADMIN y SUPER_ADMIN. La tarea no
  // podía recortárselo a nadie, pero tampoco regalárselo a todos.
  for (const ruta of [RUTA_POST, RUTA_PATCH]) {
    assert.match(
      fuente(ruta),
      /if \(body\.overrideReason && !canOverrideOverlap\(session\.user\.role\)\)/,
      `${ruta}: desapareció el gate de canOverrideOverlap`,
    );
  }
});

test("el rastro se registra HAYA AVISADO O NO la pantalla", () => {
  // El caso que esto defiende: un doctor agenda para una compañera que tiene
  // un bloqueo personal. El navegador no recibe ese bloqueo (alcance por rol),
  // así que el diálogo no sale — pero el servidor sí lo ve. Si el rastro
  // colgara de la confirmación, ese caso sería el ÚNICO sin huella.
  for (const ruta of [RUTA_POST, RUTA_PATCH]) {
    const src = fuente(ruta);
    assert.match(src, /trazaBloqueo = bloqueoEncima \? trazaDeBloqueo\(bloqueoEncima\) : null/, ruta);
    assert.match(src, /avisadaDelBloqueo = body\.bloqueoConfirmado === true/, ruta);
    assert.match(src, /bloqueoSaltado: trazaBloqueo, bloqueoAvisado: avisadaDelBloqueo/, ruta);
  }
});

test("el campo del cuerpo es un BOOLEANO, no texto del cliente", () => {
  // `bloqueoConfirmado` solo dice «ya lo confirmé»: el motivo lo escribe el
  // servidor leyéndolo de la base. Si esto se convirtiera en texto, una fila
  // de auditoría guardaría lo que quisiera quien llama a la API, y el motivo
  // —que puede ser privado— viajaría por la red sin necesidad.
  for (const ruta of [RUTA_POST, RUTA_PATCH]) {
    const src = fuente(ruta);
    assert.match(src, /body\.bloqueoConfirmado === true/, ruta);
    assert.doesNotMatch(src, /bloqueoConfirmado\s*\?\?/, ruta);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   6 · EL TEXTO DEL RASTRO
   ═══════════════════════════════════════════════════════════════════════ */

test("el rastro lleva el MOTIVO que escribió la persona, con su prefijo", () => {
  assert.equal(
    trazaDeBloqueo({
      doctorId: null,
      startsAt: new Date(),
      endsAt: new Date(),
      reason: "Mantenimiento de clínica",
    }),
    "Bloqueo: Mantenimiento de clínica",
  );
});

test("un bloqueo sin motivo deja rastro igual, con la etiqueta del tipo", () => {
  const t = trazaDeBloqueo({
    doctorId: null,
    startsAt: new Date(),
    endsAt: new Date(),
    reason: "",
    kind: "MANTENIMIENTO",
  });
  assert.ok(t.startsWith(TRAZA_BLOQUEO_PREFIJO));
  assert.ok(t.length > TRAZA_BLOQUEO_PREFIJO.length, "no puede quedarse en el prefijo pelado");
});
