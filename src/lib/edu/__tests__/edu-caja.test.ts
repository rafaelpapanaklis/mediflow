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
  eduCambioCents,
  eduCorteMethods,
  eduCorteMethodsVisibles,
  eduCorteSpanDays,
  eduCorteTerminalCents,
  eduHasChargeFilters,
  eduMetodosResumen,
  eduPagosFailed,
  eduPagosPideDevolucion,
  eduResolveChargeView,
  parseEduChargeFilters,
  parseEduPagosDivididos,
} from "../dinero-core";
import {
  EDU_CASH_METHOD,
  EDU_MAX_PAGOS_POR_OPERACION,
  EDU_PAYMENT_METHODS,
  EDU_PAYMENT_METHODS_COBRABLES,
  EDU_PAYMENT_METHOD_DESCRIPTIONS,
  EDU_PAYMENT_METHOD_LABELS,
  EDU_PAYMENT_METHOD_SHORT,
  EDU_ROLES,
  type EduRole,
} from "../types";

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

test("el corte trae SIEMPRE los SIETE métodos, también en cero", () => {
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

// ─────────────────────────────────────────────────────────────────────
// 4b · 🔴 EL COBRO RECIÉN EMITIDO NO DESAPARECE (arreglo de la Ola 6)
//
// El fallo, tal como se vio en producción: recepción cobra, el recibo
// sale… y la lista de /instituto/caja aparece VACÍA, porque el filtro por
// defecto es "solo el turno abierto" y no había ningún turno abierto.
// Desde el mostrador se ve exactamente igual que un cobro perdido.
// ─────────────────────────────────────────────────────────────────────

test("🔴 sin turno abierto y sin tocar el selector, el default enseña el HISTÓRICO", () => {
  const v = eduResolveChargeView(parseEduChargeFilters({}), false);
  assert.equal(v.soloTurno, false, "el cobro recién emitido tiene que verse");
  assert.equal(v.fallbackSinTurno, true, "y la pantalla tiene que poder decir por qué");
});

test("con turno abierto, el default sigue siendo el TURNO", () => {
  const v = eduResolveChargeView(parseEduChargeFilters({}), true);
  assert.equal(v.soloTurno, true);
  assert.equal(v.fallbackSinTurno, false);
});

test("si la persona ELIGIÓ el turno, se respeta aunque salga vacío", () => {
  // Es la diferencia entre un default y una decisión: quien puso el
  // selector en "solo el turno abierto" pidió eso, y verlo vacío es la
  // respuesta correcta a su pregunta.
  const f = parseEduChargeFilters({ ver: "turno" });
  assert.equal(f.turnoExplicito, true);
  const v = eduResolveChargeView(f, false);
  assert.equal(v.soloTurno, true);
  assert.equal(v.fallbackSinTurno, false);
});

test("elegir el histórico a mano nunca se marca como caída por falta de turno", () => {
  for (const hayTurno of [true, false]) {
    const v = eduResolveChargeView(parseEduChargeFilters({ ver: "todos" }), hayTurno);
    assert.equal(v.soloTurno, false);
    assert.equal(v.fallbackSinTurno, false);
  }
});

test("el parámetro `ver` distingue el default de la decisión", () => {
  assert.equal(parseEduChargeFilters({}).turnoExplicito, false);
  assert.equal(parseEduChargeFilters({ ver: "turno" }).turnoExplicito, true);
  assert.equal(parseEduChargeFilters({ ver: "todos" }).turnoExplicito, true);
  // Un valor inventado no cuenta como decisión: cae al default.
  assert.equal(parseEduChargeFilters({ ver: "loquesea" }).turnoExplicito, false);
  assert.equal(parseEduChargeFilters({ ver: "loquesea" }).soloTurno, true);
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

// ═════════════════════════════════════════════════════════════════════
// 6 · 🔴 EL PAGO DIVIDIDO: hasta TRES formas en UNA operación
//
// Lo que se vio en el mostrador: el paciente trae $500 en efectivo y el
// resto con tarjeta, y la caja solo aceptaba UN método. La salida era
// mentir en el método o partir el cobro en dos, que descuadra el recibo.
//
// `parseEduPagosDivididos` es la ÚNICA validación de esa lista y corre en
// LOS DOS LADOS (el servidor antes de la transacción, la pantalla
// mientras se teclea), así que lo que fije este bloque vale para ambos.
// ═════════════════════════════════════════════════════════════════════

/** Atajo: el resultado, o el error escrito, sin repetir la guarda. */
function pagos(raw: unknown, objetivo: number, opts: { exacto: boolean; canRefund?: boolean }) {
  return parseEduPagosDivididos(raw, objetivo, opts);
}

function error(r: ReturnType<typeof parseEduPagosDivididos>): string {
  assert.equal(r.ok, false, "se esperaba un error y la lista pasó");
  return eduPagosFailed(r) ? r.error : "";
}

test("una sola forma: lo de siempre, y sigue valiendo el `payment` único", () => {
  const lista = pagos(
    { payments: [{ method: "CASH", amountCents: "500.00" }] },
    50000,
    { exacto: false },
  );
  assert.equal(lista.ok, true);
  assert.equal(lista.ok && lista.pagos.length, 1);
  assert.equal(lista.ok && lista.sumaCents, 50000);
  assert.equal(lista.ok && lista.restanteCents, 0);

  // 🔴 COMPATIBILIDAD: el cuerpo viejo (`payment`, un objeto) se envuelve
  // en una lista de uno. Ningún cliente anterior deja de funcionar.
  const viejo = pagos({ payment: { method: "TRANSFER", amountCents: "300" } }, 50000, {
    exacto: false,
  });
  assert.equal(viejo.ok, true);
  assert.equal(viejo.ok && viejo.pagos[0].method, "TRANSFER");
  assert.equal(viejo.ok && viejo.pagos[0].amountCents, 30000);
  assert.equal(viejo.ok && viejo.restanteCents, 20000, "queda a deber lo que falta");
});

test("TRES formas suman exacto, y la CUARTA se rechaza", () => {
  const tres = pagos(
    {
      payments: [
        { method: "CASH", amountCents: "200" },
        { method: "CARD_DEBIT", amountCents: "200" },
        { method: "CARD_CREDIT", amountCents: "100" },
      ],
    },
    50000,
    { exacto: true },
  );
  assert.equal(tres.ok, true);
  assert.equal(tres.ok && tres.sumaCents, 50000);

  const cuatro = pagos(
    {
      payments: [
        { method: "CASH", amountCents: "100" },
        { method: "CARD_DEBIT", amountCents: "100" },
        { method: "CARD_CREDIT", amountCents: "100" },
        { method: "TRANSFER", amountCents: "200" },
      ],
    },
    50000,
    { exacto: true },
  );
  assert.match(error(cuatro), new RegExp(String(EDU_MAX_PAGOS_POR_OPERACION)));
});

test("métodos REPETIDOS sí valen: dos tarjetas distintas son dos formas legítimas", () => {
  const r = pagos(
    {
      payments: [
        { method: "CARD_CREDIT", amountCents: "250", reference: "AUT 1" },
        { method: "CARD_CREDIT", amountCents: "250", reference: "AUT 2" },
      ],
    },
    50000,
    { exacto: true },
  );
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.pagos.length, 2);
});

test("🔴 la suma NO puede pasarse del objetivo: no se cobra de más", () => {
  const r = pagos(
    {
      payments: [
        { method: "CASH", amountCents: "400" },
        { method: "CARD_DEBIT", amountCents: "300" },
      ],
    },
    50000,
    { exacto: false },
  );
  assert.match(error(r), /suman \$700\.00 y como mucho caben \$500\.00\. Sobran \$200\.00/);
});

test("🔴 con `exacto`, faltar es un error: una mensualidad se cobra completa", () => {
  const r = pagos({ payments: [{ method: "CASH", amountCents: "300" }] }, 33334, {
    exacto: true,
  });
  const msg = error(r);
  assert.match(msg, /Faltan \$33\.34/);
  assert.match(msg, /nunca entre meses/i, "el mensaje explica la regla, no solo el número");
});

test("🔴 MSI solo con tarjeta de CRÉDITO, y con un plazo del banco", () => {
  const conDebito = pagos(
    { payments: [{ method: "CARD_DEBIT", amountCents: "500", msiMonths: 6 }] },
    50000,
    { exacto: true },
  );
  assert.match(error(conDebito), /crédito/i);

  const plazoRaro = pagos(
    { payments: [{ method: "CARD_CREDIT", amountCents: "500", msiMonths: 7 }] },
    50000,
    { exacto: true },
  );
  assert.match(error(plazoRaro), /3, 6, 9, 12, 18/);

  const bien = pagos(
    { payments: [{ method: "CARD_CREDIT", amountCents: "500", msiMonths: 12 }] },
    50000,
    { exacto: true },
  );
  assert.equal(bien.ok && bien.pagos[0].msiMonths, 12);

  // Sin MSI, la columna queda en null y NO en 0: "no hubo" y "cero meses"
  // no son lo mismo.
  const sin = pagos({ payments: [{ method: "CARD_CREDIT", amountCents: "500" }] }, 50000, {
    exacto: true,
  });
  assert.equal(sin.ok && sin.pagos[0].msiMonths, null);
});

test('🔴 "Otro" exige el motivo y el CHEQUE exige su referencia', () => {
  assert.match(
    error(pagos({ payments: [{ method: "OTHER", amountCents: "500" }] }, 50000, { exacto: true })),
    /motivo/i,
  );
  assert.match(
    error(
      pagos({ payments: [{ method: "OTHER", amountCents: "500", notes: "ok" }] }, 50000, {
        exacto: true,
      }),
    ),
    /3 letras/,
    "dos caracteres no son una explicación",
  );
  const beca = pagos(
    { payments: [{ method: "OTHER", amountCents: "500", notes: "Beca 50 %" }] },
    50000,
    { exacto: true },
  );
  assert.equal(beca.ok, true);

  assert.match(
    error(pagos({ payments: [{ method: "CHECK", amountCents: "500" }] }, 50000, { exacto: true })),
    /referencia/i,
  );
  const cheque = pagos(
    { payments: [{ method: "CHECK", amountCents: "500", reference: "1234 · Banorte" }] },
    50000,
    { exacto: true },
  );
  assert.equal(cheque.ok, true);
});

test('🔴 el "CARD" LEGADO ya no se puede elegir, y el mensaje dice qué elegir', () => {
  const r = pagos({ payments: [{ method: "CARD", amountCents: "500" }] }, 50000, {
    exacto: true,
  });
  assert.match(error(r), /elige débito o crédito/i);
  // Pero SIGUE existiendo para leer lo de antes: no se borró del enum.
  assert.ok(EDU_PAYMENT_METHODS.includes("CARD"));
  assert.ok(!EDU_PAYMENT_METHODS_COBRABLES.includes("CARD"));
});

test("🔴 una DEVOLUCIÓN no se divide, y exige el permiso", () => {
  const dividida = pagos(
    {
      payments: [
        { method: "CASH", amountCents: "200", isRefund: true },
        { method: "CARD_DEBIT", amountCents: "300", isRefund: true },
      ],
    },
    50000,
    { exacto: false, canRefund: true },
  );
  assert.match(error(dividida), /no se divide/i);

  const sinPermiso = pagos(
    { payments: [{ method: "CASH", amountCents: "200", isRefund: true }] },
    50000,
    { exacto: false },
  );
  assert.match(error(sinPermiso), /caja\.refund/);

  const bien = pagos(
    { payments: [{ method: "CASH", amountCents: "200", isRefund: true }] },
    50000,
    { exacto: false, canRefund: true },
  );
  assert.equal(bien.ok, true);
  assert.equal(bien.ok && bien.pagos[0].isRefund, true);
});

test("un monto de cero, negativo o con basura no pasa", () => {
  for (const monto of ["0", "-100", "abc", "", "99.999"]) {
    const r = pagos({ payments: [{ method: "CASH", amountCents: monto }] }, 50000, {
      exacto: false,
    });
    assert.equal(r.ok, false, `"${monto}" no debería pasar`);
  }
});

// ═════════════════════════════════════════════════════════════════════
// 7 · EL CAMBIO, EL RESUMEN DE MÉTODOS Y LA LÍNEA DE LA TERMINAL
// ═════════════════════════════════════════════════════════════════════

test("el cambio se calcula, y si no alcanza NO se pinta un negativo", () => {
  assert.equal(eduCambioCents(100000, 85000), 15000);
  assert.equal(eduCambioCents(85000, 85000), 0, "pagó justo: el cambio es cero, no null");
  assert.equal(eduCambioCents(50000, 85000), null, "todavía falta");
  assert.equal(eduCambioCents(Number.NaN, 85000), null);
});

test("el resumen de métodos: sin repetir, sin devoluciones y de mayor a menor", () => {
  assert.equal(
    eduMetodosResumen([{ method: "CASH", isRefund: false, amountCents: 50000 }]),
    "Efectivo",
  );
  assert.equal(
    eduMetodosResumen([
      { method: "CARD_CREDIT", isRefund: false, amountCents: 20000 },
      { method: "CASH", isRefund: false, amountCents: 30000 },
    ]),
    "Efectivo + Crédito",
    "manda el monto, no el orden en que se registraron",
  );
  assert.equal(
    eduMetodosResumen([
      { method: "CASH", isRefund: false, amountCents: 10000 },
      { method: "CASH", isRefund: false, amountCents: 10000 },
    ]),
    "Efectivo",
    "el mismo método dos veces es UN chip",
  );
  assert.equal(
    eduMetodosResumen([{ method: "CASH", isRefund: true, amountCents: 50000 }]),
    "—",
    "una devolución no dice con qué pagó el paciente",
  );
});

test("el corte esconde el CARD legado en cero y lo enseña con movimientos", () => {
  const sinTarjetaVieja = eduCorteMethodsVisibles(eduCorteMethods([]));
  assert.deepEqual(
    sinTarjetaVieja.map((f) => f.method),
    EDU_PAYMENT_METHODS_COBRABLES,
    "los cobrables SIEMPRE, también en cero; el legado no",
  );

  const conTarjetaVieja = eduCorteMethodsVisibles(
    eduCorteMethods([{ method: "CARD", amountCents: 50000, isRefund: false }]),
  );
  assert.ok(
    conTarjetaVieja.some((f) => f.method === "CARD"),
    "con movimientos SÍ se enseña: ese dinero existe y hay que cuadrarlo",
  );
  assert.equal(conTarjetaVieja.length, EDU_PAYMENT_METHODS_COBRABLES.length + 1);
});

test("la línea TERMINAL suma débito + crédito + el legado, en NETO", () => {
  const filas = eduCorteMethods([
    { method: "CASH", amountCents: 100000, isRefund: false },
    { method: "CARD_DEBIT", amountCents: 30000, isRefund: false },
    { method: "CARD_CREDIT", amountCents: 50000, isRefund: false },
    { method: "CARD_CREDIT", amountCents: 10000, isRefund: true },
    { method: "CARD", amountCents: 20000, isRefund: false },
    { method: "TRANSFER", amountCents: 70000, isRefund: false },
  ]);
  assert.equal(eduCorteTerminalCents(filas), 30000 + 50000 - 10000 + 20000);
  // 🔴 Y el efectivo esperado NO cambia: una tarjeta no mete un peso en el
  // cajón. El arqueo sigue siendo solo EDU_CASH_METHOD.
  assert.equal(filas.find((f) => f.method === EDU_CASH_METHOD)?.netCents, 100000);
});

// ═════════════════════════════════════════════════════════════════════
// 8 · LOS SIETE MÉTODOS SON LOS DEL SCHEMA, Y TODOS TIENEN NOMBRE
// ═════════════════════════════════════════════════════════════════════

test("🔴 EDU_PAYMENT_METHODS espeja el enum EduPaymentMethod de prisma/schema.prisma", () => {
  const schema = readFileSync(
    join(__dirname, "..", "..", "..", "..", "prisma", "schema.prisma"),
    "utf8",
  );
  const bloque = /enum EduPaymentMethod \{([\s\S]*?)\}/.exec(schema);
  assert.ok(bloque, "no se encontró el enum EduPaymentMethod en el schema");
  const valores = bloque[1]
    .split("\n")
    .map((l) => l.replace(/\/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));

  assert.deepEqual(
    valores,
    EDU_PAYMENT_METHODS,
    "si una ola agrega un método al schema y no a types.ts, el corte y el CFDI lo pierden en silencio",
  );
  assert.equal(valores.length, 7);
});

test("cada método tiene etiqueta larga, corta y descripción: la UI jamás pinta el enum", () => {
  for (const m of EDU_PAYMENT_METHODS) {
    assert.ok(EDU_PAYMENT_METHOD_LABELS[m]?.length > 2, `falta la etiqueta larga de ${m}`);
    assert.ok(EDU_PAYMENT_METHOD_SHORT[m]?.length > 2, `falta la etiqueta corta de ${m}`);
    assert.ok(
      EDU_PAYMENT_METHOD_DESCRIPTIONS[m]?.length > 10,
      `falta la descripción de ${m}`,
    );
    // Y ninguna etiqueta es el valor del enum escrito tal cual.
    assert.notEqual(EDU_PAYMENT_METHOD_LABELS[m], m);
  }
  // El legado se llama por su nombre: quien lo lee en un corte viejo tiene
  // que entender por qué no dice si fue débito o crédito.
  assert.match(EDU_PAYMENT_METHOD_LABELS.CARD, /sin especificar/i);
});

// ═════════════════════════════════════════════════════════════════════
// 9 · LOS ENDPOINTS DEL DINERO SIGUEN EXIGIENDO SU KEY
//
// Se amplía la prueba que ya existía para los pagos a meses: aquí van los
// CUATRO puntos donde entra dinero, que son justo los que esta tarea
// tocó. Ninguno estrena permiso.
// ═════════════════════════════════════════════════════════════════════

test("los cuatro puntos donde entra dinero exigen caja.view / caja.charge / caja.refund", () => {
  const api = join(__dirname, "..", "..", "..", "app", "api", "instituto", "caja");
  const casos: [string[], string][] = [
    [["cobros", "route.ts"], "caja.charge"],
    [["cobros", "[id]", "pagos", "route.ts"], "caja.charge"],
    [["cobros", "[id]", "plan", "route.ts"], "caja.charge"],
    [["mensualidades", "[id]", "pagar", "route.ts"], "caja.charge"],
    [["corte", "route.ts"], "caja.corte"],
    [["planes", "[id]", "cancelar", "route.ts"], "caja.refund"],
  ];
  for (const [partes, key] of casos) {
    const ruta = join(api, ...partes);
    assert.ok(existsSync(ruta), `falta el endpoint ${partes.join("/")}`);
    assert.ok(
      readFileSync(ruta, "utf8").includes(`eduApiGuard("${key}")`),
      `${partes.join("/")} debe exigir ${key}`,
    );
  }
  // Y la devolución sigue pidiendo caja.refund ADEMÁS de caja.charge, en
  // las DOS formas del cuerpo (el pago suelto y la lista).
  const pagosRuta = join(api, "cobros", "[id]", "pagos", "route.ts");
  const texto = readFileSync(pagosRuta, "utf8");
  assert.match(texto, /caja\.refund/);
  assert.match(
    texto,
    /eduPagosPideDevolucion\(body\)/,
    "las TRES formas del cuerpo tienen que mirarse para el 403, con el helper compartido",
  );
});

// ─────────────────────────────────────────────────────────────────────
// 6b · 🔴 QUIÉN DECIDE QUE ALGO ES UNA DEVOLUCIÓN
//
// El tope se elige ANTES de validar y NO es el mismo (devolver se topa
// con lo pagado, cobrar con el saldo), así que leer el cuerpo con una
// regla distinta a la del parser deja el tope equivocado.
//
// El bug concreto que fija este bloque: `Boolean(raw.isRefund ??
// raw.payment?.isRefund)` NO cae al lado derecho cuando el izquierdo es
// `false` —`??` solo mira null y undefined—. Un cuerpo con
// `isRefund: false` arriba y `payment.isRefund: true` dentro se topaba
// contra el SALDO y fallaba después con "otro movimiento entró antes"
// sin que hubiera entrado ninguno: un error que miente.
// ─────────────────────────────────────────────────────────────────────

test("🔴 la devolución se detecta con la misma precedencia que el parser", () => {
  // `payments` gana a `payment`, y `payment` gana a la raíz.
  assert.equal(
    eduPagosPideDevolucion({ payments: [{ method: "CASH", amountCents: "100", isRefund: true }] }),
    true,
  );
  assert.equal(
    eduPagosPideDevolucion({ payment: { method: "CASH", amountCents: "100", isRefund: true } }),
    true,
  );
  assert.equal(eduPagosPideDevolucion({ method: "CASH", amountCents: "100", isRefund: true }), true);

  // 🔴 El caso del `??`: un `false` arriba NO puede tapar el `true` de
  // dentro. Si esto se rompe, el tope vuelve a ser el del cobro.
  assert.equal(
    eduPagosPideDevolucion({ isRefund: false, payment: { amountCents: "100", isRefund: true } }),
    true,
    "el `payment` manda sobre la raíz, también cuando la raíz dice false",
  );
  // Y al revés: con `payment` dentro, la raíz NO decide.
  assert.equal(
    eduPagosPideDevolucion({ isRefund: true, payment: { amountCents: "100", isRefund: false } }),
    false,
    "un `isRefund: true` colgado en la raíz no convierte un cobro en devolución",
  );

  // Lo normal: no hay devolución por ningún lado.
  assert.equal(eduPagosPideDevolucion({ payments: [{ amountCents: "100" }] }), false);
  assert.equal(eduPagosPideDevolucion({ amountCents: "100" }), false);
  assert.equal(eduPagosPideDevolucion(null), false);
  assert.equal(eduPagosPideDevolucion("no soy un cuerpo"), false);
});

test("el endpoint de pagos pregunta con el helper, no con un `??` a mano", () => {
  const ruta = join(
    __dirname,
    "..",
    "..",
    "..",
    "app",
    "api",
    "instituto",
    "caja",
    "cobros",
    "[id]",
    "pagos",
    "route.ts",
  );
  const texto = readFileSync(ruta, "utf8");
  assert.match(texto, /eduPagosPideDevolucion\(body\)/);
  assert.doesNotMatch(
    texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""),
    /isRefund\s*\?\?/,
    "el `??` con un booleano a la izquierda es el bug que este bloque cerró",
  );
});

// ─────────────────────────────────────────────────────────────────────
// 6c · 🔴 LO QUE EL SERVIDOR EXIGE, LA PANTALLA LO OFRECE
//
// Las dos reglas nuevas de `parseEduPagosDivididos` ("Otro" pide motivo,
// el cheque pide referencia) valen para TODO pago, y el modal de
// DEVOLUCIÓN no usa <EduFormasPago/> a propósito (una devolución es un
// solo movimiento). Sin estas dos comprobaciones, devolver con "Otro"
// era imposible desde la interfaz: el servidor lo rebotaba con 400 y no
// había ningún campo donde escribir el motivo.
// ─────────────────────────────────────────────────────────────────────

test("🔴 el modal de devolución ofrece motivo para “Otro” y pide el cheque por su nombre", () => {
  const pantalla = readFileSync(
    join(__dirname, "..", "..", "..", "components", "edu", "dinero", "caja-screen.tsx"),
    "utf8",
  );
  // El campo del motivo existe y VIAJA en el cuerpo de la devolución.
  assert.match(pantalla, /devNotas/, "falta el campo de motivo de la devolución");
  assert.match(pantalla, /notes:\s*devNotas\.trim\(\)\s*\|\|\s*null/);
  // Y el cheque deja de anunciarse como "opcional".
  assert.match(pantalla, /metodo === "CHECK" \? "Número de cheque y banco"/);
  // El botón se bloquea antes de mandar algo que el servidor rebotaría.
  assert.match(pantalla, /metodo === "OTHER" && devNotas\.trim\(\)\.length < 3/);
  assert.match(pantalla, /metodo === "CHECK" && referencia\.trim\(\) === ""/);
});

test("🔴 el detalle del plan NO pierde el método de lo cobrado antes del .sql", () => {
  // `EduPayment.installmentId` nace VACÍA (sql/edu-formas-pago.sql no hace
  // backfill, y no puede: una fila vieja no sabe a qué mensualidad fue).
  // Sin fallback al método del pago que la liquidó, toda la cartera viva
  // perdería el "pagada con efectivo" que ya enseñaba.
  const pantalla = readFileSync(
    join(__dirname, "..", "..", "..", "components", "edu", "dinero", "planes-screen.tsx"),
    "utf8",
  );
  assert.match(pantalla, /i\.payments\.length > 0/);
  assert.match(pantalla, /: i\.method\s*\n?\s*\? `Pagada con \$\{EDU_PAYMENT_METHOD_LABELS/);

  // El recibo imprimible ya lo tenía; se comprueba para que no se pierda.
  const recibo = readFileSync(
    join(__dirname, "..", "..", "..", "components", "edu", "dinero", "plan-recibo.tsx"),
    "utf8",
  );
  assert.match(recibo, /: i\.method\s*\n?\s*\? EDU_PAYMENT_METHOD_LABELS\[i\.method\]/);
});

test("y el .sql no promete un backfill que no puede hacer", () => {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "..", "sql", "edu-formas-pago.sql"),
    "utf8",
  );
  assert.match(sql, /0 backfill/);
  // Los comentarios fuera antes de buscar: la cabecera del propio archivo
  // dice "CERO DROP", y sin quitarla la prueba se acusaría a sí misma.
  const sentencias = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(sentencias, /\bDROP\b/i, "CERO DROP: es la regla del vertical");
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'CARD_DEBIT'/);
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'CARD_CREDIT'/);
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'CHECK'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "msiMonths"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "installmentId"/);
});
