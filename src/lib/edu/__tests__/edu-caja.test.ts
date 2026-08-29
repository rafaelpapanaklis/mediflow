/**
 * QUIÉN VE EL DINERO, Y CÓMO SE CUADRA UN TURNO — Ola 5 de DaleControl
 * INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-caja.test.ts
 *
 * (No hay `npm run test:edu-caja`: package.json es un archivo del producto
 * dental y esta ola no lo toca. Cuando el vertical se integre a main, es
 * UNA línea.)
 *
 * Todo se comprueba SIN base de datos: `visibility.ts` devuelve objetos
 * `where` sin ejecutarlos y la aritmética del corte es pura, así que aquí
 * se lee exactamente lo que Prisma recibiría.
 *
 * Lo que fija este archivo:
 *  1. 🔴 QUE UN ALUMNO NO VEA DINERO. Ni el precio, ni el cobro, ni el
 *     saldo — y que no dependa de un permiso apagado, sino del ALCANCE,
 *     que sigue diciendo "ninguna fila" aunque alguien le encienda
 *     caja.view a mano. Es la regla que se pidió explícitamente;
 *  2. lo mismo para el DOCENTE, y la lista blanca que deja fuera a
 *     cualquier rol futuro;
 *  3. el reparto de las seis keys nuevas por rol;
 *  4. que un corte sea del TURNO y no del día natural.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  EDU_VISIBILITY_NONE_DETAIL,
  eduChargeScopeWhere,
  eduPaymentScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
} from "../visibility";
import {
  EDU_ALL_PERMISSIONS,
  EDU_ROLE_DEFAULTS,
  getEduEffectivePermissions,
  hasEduPermission,
  type EduPermissionKey,
} from "../permissions";
import {
  EDU_CHARGE_EMPTY_FILTERS,
  eduCorteMethods,
  eduCorteSpanDays,
  eduHasChargeFilters,
  parseEduChargeFilters,
} from "../dinero-core";
import { EDU_PAYMENT_METHODS, EDU_ROLES, type EduRole } from "../types";

const INST = "inst_1";
const OTRO_INST = "inst_2";

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

// ═════════════════════════════════════════════════════════════════════
// 1 · 🔴 EL DINERO NO ES DE ALUMNOS NI DE DOCENTES
// ═════════════════════════════════════════════════════════════════════

test("🔴 un ALUMNO no ve NADA de dinero: ni el precio, ni el cobro, ni el saldo", () => {
  const scope = eduVisibility(actor("ALUMNO", "al_1"), "charges");
  assert.deepEqual(scope, { kind: "none" });
  assert.equal(eduScopeIsEmpty(scope), true);

  // Y el `where` que sale de ese alcance no devuelve NI UNA fila — no un
  // objeto vacío, que devolvería el instituto entero.
  const where = eduChargeScopeWhere({ institutionId: INST, scope });
  assert.deepEqual(where, { institutionId: INST, id: { in: [] } });
});

test("🔴 un DOCENTE tampoco: supervisa el tratamiento, no la caja", () => {
  const scope = eduVisibility(actor("DOCENTE", "doc_1"), "charges");
  assert.deepEqual(scope, { kind: "none" });
  assert.deepEqual(eduChargeScopeWhere({ institutionId: INST, scope }), {
    institutionId: INST,
    id: { in: [] },
  });
});

test("🔴 el alumno NO ve 'lo suyo' en dinero — a diferencia de sus pacientes y sus citas", () => {
  // Ésta es la asimetría de la ola y merece su propia prueba: en pacientes,
  // citas y casos el alumno ve LO SUYO recortado; en dinero no ve nada.
  // Un residente que puede consultar cuánto pagó su paciente sabe cuánto
  // vale su propia lista de espera.
  const a = actor("ALUMNO", "al_1");
  assert.deepEqual(eduVisibility(a, "patients"), { kind: "own", studentUserId: "al_1" });
  assert.deepEqual(eduVisibility(a, "appointments"), { kind: "own", studentUserId: "al_1" });
  assert.deepEqual(eduVisibility(a, "cases"), { kind: "own", studentUserId: "al_1" });
  assert.deepEqual(eduVisibility(a, "charges"), { kind: "none" });
});

test("🔴 encenderle 'caja.view' a un alumno NO le abre la caja: son dos cerraduras", () => {
  // El permiso abre la pantalla; el ALCANCE decide las filas. Con el
  // override más generoso posible, el alcance sigue diciendo "ninguna".
  const alumnoConTodo = {
    role: "ALUMNO" as EduRole,
    permissionsOverride: Object.keys(EDU_ALL_PERMISSIONS) as EduPermissionKey[],
  };
  assert.equal(hasEduPermission(alumnoConTodo, "caja.view"), true);
  assert.deepEqual(eduVisibility(actor("ALUMNO", "al_1"), "charges"), { kind: "none" });

  const docenteConTodo = { ...alumnoConTodo, role: "DOCENTE" as EduRole };
  assert.equal(hasEduPermission(docenteConTodo, "caja.charge"), true);
  assert.deepEqual(eduVisibility(actor("DOCENTE", "doc_1"), "charges"), { kind: "none" });
});

test("CAJA y DIRECCION ven todo el dinero del instituto", () => {
  for (const rol of ["CAJA", "DIRECCION"] as EduRole[]) {
    assert.deepEqual(eduVisibility(actor(rol), "charges"), { kind: "all" });
    assert.deepEqual(eduChargeScopeWhere({ institutionId: INST, scope: { kind: "all" } }), {
      institutionId: INST,
    });
  }
});

test("un rol que no existe todavía NO ve dinero (lista blanca, no lista negra)", () => {
  // Si mañana el schema gana COORDINADOR o RECTOR, la respuesta por
  // defecto tiene que ser "no ve dinero". Con lista negra, un olvido abre
  // la caja; con lista blanca, la deja cerrada.
  assert.deepEqual(eduVisibility({ role: "RECTOR" as EduRole, eduUserId: "x" }, "charges"), {
    kind: "none",
  });
  assert.deepEqual(eduVisibility(null as never, "charges"), { kind: "none" });
  assert.deepEqual(eduVisibility("CAJA" as never, "charges"), { kind: "none" });
});

test("un alcance que no sea 'all' cierra la consulta de dinero, venga de donde venga", () => {
  // eduVisibility nunca devuelve estos para "charges", pero si llegaran por
  // un cast o una llamada equivocada, tienen que CERRAR y no abrir.
  for (const scope of [
    { kind: "own", studentUserId: "al_1" },
    { kind: "supervised", supervisorUserId: "doc_1" },
    { kind: "none" },
  ] as const) {
    assert.deepEqual(eduChargeScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
      id: { in: [] },
    });
    assert.deepEqual(eduPaymentScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
      id: { in: [] },
    });
  }
});

test("🔴 sin institutionId LANZAN (un undefined borra el filtro de tenant)", () => {
  for (const fn of [eduChargeScopeWhere, eduPaymentScopeWhere]) {
    for (const malo of ["", undefined, null]) {
      assert.throws(
        () => fn({ institutionId: malo as unknown as string, scope: { kind: "all" } }),
        /institutionId/,
      );
    }
  }
});

test("el institutionId del where es el de la sesión y no se cuela otro", () => {
  const where = eduChargeScopeWhere({ institutionId: INST, scope: { kind: "all" } });
  assert.equal(where.institutionId, INST);
  assert.notEqual(where.institutionId, OTRO_INST);
});

test("la pantalla vacía del dinero explica POR QUÉ, en español", () => {
  const texto = EDU_VISIBILITY_NONE_DETAIL.charges;
  assert.ok(texto && texto.length > 40, "falta el texto de charges");
  assert.match(texto, /dirección y caja/i);
});

// ═════════════════════════════════════════════════════════════════════
// 2 · EL REPARTO DE LAS SEIS KEYS
// ═════════════════════════════════════════════════════════════════════

const KEYS_OLA_5: EduPermissionKey[] = [
  "tarifarios.view",
  "tarifarios.manage",
  "caja.view",
  "caja.charge",
  "caja.refund",
  "caja.corte",
];

test("las seis keys de la Ola 5 están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_5) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("DIRECCION las tiene las seis: poner precios es decidir cuánto cuesta la escuela", () => {
  for (const k of KEYS_OLA_5) {
    assert.equal(
      hasEduPermission({ role: "DIRECCION", permissionsOverride: [] }, k),
      true,
      `a DIRECCION le falta ${k}`,
    );
  }
});

test("CAJA las tiene todas MENOS tarifarios.manage: quien cobra no se pone su propio precio", () => {
  const caja = { role: "CAJA" as EduRole, permissionsOverride: [] };
  assert.equal(hasEduPermission(caja, "tarifarios.view"), true, "caja tiene que poder consultar el tarifario");
  assert.equal(hasEduPermission(caja, "tarifarios.manage"), false);
  for (const k of ["caja.view", "caja.charge", "caja.refund", "caja.corte"] as EduPermissionKey[]) {
    assert.equal(hasEduPermission(caja, k), true, `a CAJA le falta ${k}`);
  }
});

test("🔴 DOCENTE y ALUMNO no tienen NI UNA key de dinero", () => {
  for (const rol of ["DOCENTE", "ALUMNO"] as EduRole[]) {
    for (const k of KEYS_OLA_5) {
      assert.equal(
        hasEduPermission({ role: rol, permissionsOverride: [] }, k),
        false,
        `${rol} tiene ${k} y no debería`,
      );
    }
    // Y en el default, escrito: ninguna key que empiece por caja. o
    // tarifarios.
    const defaults = EDU_ROLE_DEFAULTS[rol];
    assert.deepEqual(
      defaults.filter((k) => k.startsWith("caja.") || k.startsWith("tarifarios.")),
      [],
      `${rol} trae keys de dinero en su default`,
    );
  }
});

test("los cuatro roles siguen teniendo un default válido tras agregar las seis", () => {
  const catalogo = new Set<string>(Object.keys(EDU_ALL_PERMISSIONS));
  for (const rol of EDU_ROLES) {
    const keys = EDU_ROLE_DEFAULTS[rol];
    assert.ok(keys, `falta el default de ${rol}`);
    assert.equal(new Set(keys).size, keys.length, `el default de ${rol} repite keys`);
    for (const k of keys) assert.ok(catalogo.has(k), `${rol} trae una key fuera del catálogo: ${k}`);
    assert.ok(getEduEffectivePermissions({ role: rol, permissionsOverride: [] }).length > 0);
  }
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL CORTE ES DEL TURNO, NO DEL DÍA
// ═════════════════════════════════════════════════════════════════════

const MX = "America/Mexico_City";

test("🔴 la ventana se mide en la zona del INSTITUTO, no en UTC", () => {
  // 29-ago 15:00 y 20:00 en México son el MISMO día para la escuela; en
  // UTC son el 29 y el 30. Contando en UTC, el corte diría "lleva 2 días
  // abierto" a las ocho de la noche del primer día.
  const abre = new Date("2026-08-29T21:00:00.000Z"); // 15:00 en México
  const ahora = new Date("2026-08-30T02:00:00.000Z"); // 20:00 del MISMO 29
  assert.equal(eduCorteSpanDays(abre, ahora, MX), 1);
  assert.equal(eduCorteSpanDays(abre, ahora, "UTC"), 2);
});

test("un turno que cruza la medianoche cuenta DOS días, y la pantalla lo dice", () => {
  const abre = new Date("2026-08-30T02:00:00.000Z"); // 29-ago 20:00 México
  const ahora = new Date("2026-08-30T16:00:00.000Z"); // 30-ago 10:00 México
  assert.equal(eduCorteSpanDays(abre, ahora, MX), 2);
});

test("un turno abierto hace tres días cuenta cuatro días naturales", () => {
  const abre = new Date("2026-08-27T15:00:00.000Z");
  const ahora = new Date("2026-08-30T15:00:00.000Z");
  assert.equal(eduCorteSpanDays(abre, ahora, MX), 4);
});

test("un 'hasta' anterior a la apertura no produce un número negativo de días", () => {
  const abre = new Date("2026-08-30T15:00:00.000Z");
  const antes = new Date("2026-08-28T15:00:00.000Z");
  assert.equal(eduCorteSpanDays(abre, antes, MX), 1);
});

// ── Los renglones del corte ──────────────────────────────────────────

test("🔴 lo devuelto va en su propia columna, no restado del cobrado", () => {
  const filas = eduCorteMethods([
    { method: "CASH", amountCents: 100000, isRefund: false },
    { method: "CASH", amountCents: 50000, isRefund: false },
    { method: "CASH", amountCents: 30000, isRefund: true },
    { method: "CARD", amountCents: 200000, isRefund: false },
  ]);
  const efectivo = filas.find((f) => f.method === "CASH");
  // Un corte que enseña un solo neto esconde que hubo que devolver
  // $300 — que es justo el número por el que pregunta la dirección.
  assert.equal(efectivo?.chargedCents, 150000);
  assert.equal(efectivo?.refundedCents, 30000);
  assert.equal(efectivo?.netCents, 120000);
  assert.equal(efectivo?.count, 3);

  const tarjeta = filas.find((f) => f.method === "CARD");
  assert.equal(tarjeta?.netCents, 200000);
  assert.equal(tarjeta?.refundedCents, 0);
});

test("el corte trae SIEMPRE los cuatro métodos, también en cero", () => {
  const filas = eduCorteMethods([]);
  assert.deepEqual(
    filas.map((f) => f.method),
    EDU_PAYMENT_METHODS,
  );
  for (const f of filas) {
    assert.equal(f.chargedCents, 0);
    assert.equal(f.refundedCents, 0);
    assert.equal(f.netCents, 0);
    assert.equal(f.count, 0);
  }
});

test("un método desconocido no tumba el corte ni se cuela en otro renglón", () => {
  const filas = eduCorteMethods([
    { method: "CRIPTO" as never, amountCents: 999999, isRefund: false },
    { method: "CASH", amountCents: 1000, isRefund: false },
  ]);
  assert.equal(filas.reduce((a, f) => a + f.netCents, 0), 1000);
});

test("devolver MÁS de lo cobrado deja el neto en negativo y se ve (no se esconde en un cero)", () => {
  // La capa de datos no lo permite —una devolución no puede superar lo
  // pagado— pero si un día pasara, el corte tiene que enseñarlo, no
  // taparlo con un Math.max.
  const filas = eduCorteMethods([
    { method: "CASH", amountCents: 1000, isRefund: false },
    { method: "CASH", amountCents: 5000, isRefund: true },
  ]);
  assert.equal(filas.find((f) => f.method === "CASH")?.netCents, -4000);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · LOS FILTROS DE LA PANTALLA
// ═════════════════════════════════════════════════════════════════════

test("🔴 los filtros NO leen ningún institutionId de la query", () => {
  const f = parseEduChargeFilters({
    institutionId: OTRO_INST,
    instituto: OTRO_INST,
    estado: "PAID",
  });
  assert.equal(JSON.stringify(f).includes(OTRO_INST), false);
  assert.equal(f.status, "PAID");
});

test("por defecto se lista el TURNO abierto, no el histórico", () => {
  assert.equal(parseEduChargeFilters({}).soloTurno, true);
  assert.equal(parseEduChargeFilters({ ver: "todos" }).soloTurno, false);
  assert.equal(EDU_CHARGE_EMPTY_FILTERS.soloTurno, true);
});

test("un estado inventado se descarta en vez de colarse al where", () => {
  assert.equal(parseEduChargeFilters({ estado: "REGALADO" }).status, null);
  assert.equal(parseEduChargeFilters({ estado: "CANCELLED" }).status, "CANCELLED");
});

test("un id con forma rara se descarta", () => {
  assert.equal(parseEduChargeFilters({ paciente: "abc-123_X" }).patientId, "abc-123_X");
  assert.equal(parseEduChargeFilters({ paciente: "'; drop table" }).patientId, null);
  assert.equal(parseEduChargeFilters({ paciente: "x".repeat(41) }).patientId, null);
});

test("ver el histórico cuenta como filtro (para que se pueda limpiar)", () => {
  assert.equal(eduHasChargeFilters(EDU_CHARGE_EMPTY_FILTERS), false);
  assert.equal(eduHasChargeFilters(parseEduChargeFilters({ ver: "todos" })), true);
  assert.equal(eduHasChargeFilters(parseEduChargeFilters({ q: "C-0001" })), true);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · EL CANDADO DEL TENANT, RECORRIENDO LOS ENDPOINTS
//
// `resolveFeeSchedule(institutionId, patientId)` recibe el institutionId
// SUELTO porque así lo nombra el contrato de esta ola — es la excepción a
// la regla del vertical, que dice que las funciones lo sacan del contexto
// de sesión. La excepción se paga con esta prueba: ningún endpoint del
// vertical puede leer un institutionId de un body o de un query, así que
// el único valor que puede llegar a esa firma es el de la sesión.
// ═════════════════════════════════════════════════════════════════════

test("🔴 NINGÚN endpoint de /api/instituto lee el institutionId del body o del query", () => {
  const raiz = join(__dirname, "..", "..", "..", "app", "api", "instituto");

  function recorrer(dir: string, out: string[]): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) recorrer(p, out);
      else if (name.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  const archivos = recorrer(raiz, []);
  assert.ok(archivos.length > 0, "no se encontró un solo endpoint: revisa la ruta del test");

  // Las formas de colarlo: leerlo de un cuerpo JSON, de la URL, o pasarle
  // a una función un objeto con esa clave que no venga del contexto.
  const prohibido = [
    /body\s*\.\s*institutionId/,
    /body\s*\[\s*["'`]institutionId["'`]\s*\]/,
    /searchParams\s*\.\s*get\s*\(\s*["'`]institutionId["'`]/,
    /params\s*\.\s*institutionId/,
    /institutionId\s*:\s*(?!.*ctx)/,
  ];

  const culpables: string[] = [];
  for (const f of archivos) {
    // Los comentarios explican precisamente esta regla; se quitan antes de
    // buscar para no acusar al archivo que la documenta.
    const texto = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const re of prohibido) {
      if (re.test(texto)) culpables.push(`${relative(raiz, f).split(sep).join("/")} — ${re}`);
    }
  }

  assert.deepEqual(
    culpables,
    [],
    `endpoints que leen un institutionId de fuera de la sesión:\n${culpables.join("\n")}`,
  );
});
