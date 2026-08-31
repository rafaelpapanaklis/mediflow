/**
 * PAGOS A MESES — DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-pagos.test.ts
 *
 * Todo se comprueba SIN base de datos: la aritmética del plan es pura
 * (pagos-core.ts) y `visibility.ts` devuelve objetos `where` sin
 * ejecutarlos.
 *
 * Lo que fija este archivo:
 *  1. 🔴 QUE LOS CENTAVOS NO SE PIERDAN. Un total que no divide exacto
 *     reparte el piso y la diferencia ENTERA cae en la PRIMERA
 *     mensualidad: la suma da el saldo EXACTO, siempre (y hay una prueba
 *     con un total que no divide, como pidió el encargo).
 *  2. 🔴 QUE "VENCIDA" SEA DEL CALENDARIO, no de una columna: el día del
 *     vencimiento la mensualidad sigue PENDIENTE ("vence hoy" es hoy), y
 *     un día después está VENCIDA — sin que ningún cron escriba nada.
 *  3. Las fechas: la primera SIEMPRE al mes siguiente, y el día de corte
 *     se RECORTA al mes que lo aguante (corte 31 → 28 de febrero, 29 si
 *     el bisiesto alcanza) sin correrse al mes siguiente.
 *  4. Que un ALUMNO y un DOCENTE no vean un plan NI una mensualidad —
 *     por ALCANCE, no por permiso apagado — y que los cuatro endpoints
 *     nuevos exijan la key correcta (caja.view / caja.charge /
 *     caja.refund: NO hay keys nuevas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EduPaymentPlanStatus as PrismaEduPaymentPlanStatus } from "@prisma/client";
import {
  EDU_PAYMENT_PLAN_STATUSES,
  EDU_PAYMENT_PLAN_STATUS_LABELS,
  EDU_INSTALLMENT_STATUS_LABELS,
  EDU_ROLES,
  type EduPaymentPlanStatus,
  type EduRole,
} from "../types";
import {
  EDU_PLAN_MAX_MONTHS,
  EDU_PLAN_MIN_MONTHS,
  eduFechaLarga,
  eduInstallmentStatus,
  eduInstallmentsDueBetween,
  eduInstallmentsVencidas,
  eduPlanAddDaysISO,
  eduPlanDueDates,
  eduPlanRequestFailed,
  eduPlanResumen,
  eduPlanSplitCents,
  parseEduPaymentPlanStatus,
  parseEduPlanFilters,
  parseEduPlanRequest,
  type EduInstallmentRow,
  type EduPlanRow,
} from "../pagos-core";
import {
  eduInstallmentScopeWhere,
  eduPaymentPlanScopeWhere,
  eduVisibility,
} from "../visibility";
import { EDU_ROLE_DEFAULTS, hasEduPermission } from "../permissions";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: la unión de types.ts == el enum de Prisma.
//     Si una ola agrega un estado al schema y no aquí (o al revés),
//     `tsc --noEmit` falla en esta línea. En runtime no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _estadosCoinciden: Exacto<EduPaymentPlanStatus, PrismaEduPaymentPlanStatus> = true;
void _estadosCoinciden;

const INST = "inst_uno";

// ═════════════════════════════════════════════════════════════════════
// 1 · EL REPARTO DE LOS CENTAVOS
// ═════════════════════════════════════════════════════════════════════

test("🔴 un total que NO divide exacto: la diferencia ENTERA va en la PRIMERA y la suma es EXACTA", () => {
  // $1,000.00 entre 3: 33333.33… centavos no existen. El reparto correcto
  // es $333.34 + $333.33 + $333.33 — ni un centavo perdido ni inventado.
  const montos = eduPlanSplitCents(100_000, 3);
  assert.ok(montos);
  assert.deepEqual(montos, [33_334, 33_333, 33_333]);
  assert.equal(
    montos.reduce((a, b) => a + b, 0),
    100_000,
    "la suma de las mensualidades ES el saldo",
  );
});

test("más totales que no dividen: la suma SIEMPRE es exacta y el residuo SIEMPRE va en la primera", () => {
  const casos: [number, number][] = [
    [100_001, 3], // residuo 2
    [99_999, 12], // residuo 3
    [1_234_567, 7],
    [55, 48], // apenas alcanza: 1 centavo por mensualidad + residuo 7
    [2_147_483_647, 48], // el tope teórico de un Int4 tampoco pierde nada
  ];
  for (const [total, meses] of casos) {
    const montos = eduPlanSplitCents(total, meses);
    assert.ok(montos, `${total} entre ${meses} debe poder repartirse`);
    assert.equal(montos.length, meses);
    assert.equal(
      montos.reduce((a, b) => a + b, 0),
      total,
      `${total} entre ${meses}: la suma debe ser exacta`,
    );
    const base = montos[montos.length - 1];
    for (let i = 1; i < montos.length; i++) {
      assert.equal(montos[i], base, "de la segunda en adelante son PAREJAS");
    }
    assert.ok(montos[0] >= base, "la primera carga el residuo, nunca menos que la base");
    assert.ok(montos[0] - base < meses, "el residuo es menor que el número de meses");
  }
});

test("un total que SÍ divide exacto queda parejo, primera incluida", () => {
  const montos = eduPlanSplitCents(120_000, 12);
  assert.ok(montos);
  assert.deepEqual(montos, new Array(12).fill(10_000));
});

test("el reparto rechaza lo que no es un plan", () => {
  assert.equal(eduPlanSplitCents(100_000, 1), null, "1 mes no es 'a meses'");
  assert.equal(eduPlanSplitCents(100_000, EDU_PLAN_MAX_MONTHS + 1), null, "49 ya es un crédito");
  assert.equal(eduPlanSplitCents(2, 3), null, "no alcanza ni un centavo por mensualidad");
  assert.equal(eduPlanSplitCents(100.5, 3), null, "centavos fraccionarios no existen");
  assert.equal(eduPlanSplitCents(100_000, 2.5), null);
  assert.ok(eduPlanSplitCents(3, 3), "el mínimo absoluto: un centavo por mensualidad");
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LAS FECHAS DE VENCIMIENTO
// ═════════════════════════════════════════════════════════════════════

test("la PRIMERA mensualidad siempre vence el mes SIGUIENTE, en el día de corte", () => {
  assert.deepEqual(eduPlanDueDates("2026-08-31", 15, 3), [
    "2026-09-15",
    "2026-10-15",
    "2026-11-15",
  ]);
});

test("🔴 el día de corte se RECORTA al mes que lo aguante y REGRESA cuando alcanza", () => {
  // Corte el 31, empezando en diciembre: enero 31, febrero 28 (2027 no es
  // bisiesto), marzo 31 otra vez. Nunca se corre al mes siguiente — eso
  // pondría dos mensualidades en el mismo mes.
  assert.deepEqual(eduPlanDueDates("2026-12-15", 31, 4), [
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
    "2027-04-30",
  ]);
});

test("en año bisiesto, febrero aguanta 29", () => {
  assert.deepEqual(eduPlanDueDates("2028-01-10", 31, 2), ["2028-02-29", "2028-03-31"]);
});

test("el calendario cruza el fin de año sin perderse", () => {
  assert.deepEqual(eduPlanDueDates("2026-11-05", 5, 3), ["2026-12-05", "2027-01-05", "2027-02-05"]);
});

test("entradas inválidas de fechas: null, no una excepción", () => {
  assert.equal(eduPlanDueDates("2026-13-01", 15, 3), null, "mes 13 no existe");
  assert.equal(eduPlanDueDates("hoy", 15, 3), null);
  assert.equal(eduPlanDueDates("2026-08-31", 0, 3), null);
  assert.equal(eduPlanDueDates("2026-08-31", 32, 3), null);
  assert.equal(eduPlanDueDates("2026-08-31", 15, 0), null);
});

test("eduPlanAddDaysISO: aritmética de calendario en UTC, sin sorpresas de zona", () => {
  assert.equal(eduPlanAddDaysISO("2026-08-31", 7), "2026-09-07");
  assert.equal(eduPlanAddDaysISO("2026-12-28", 7), "2027-01-04");
  assert.equal(eduPlanAddDaysISO("2028-02-28", 1), "2028-02-29", "bisiesto");
  assert.equal(eduPlanAddDaysISO("31/08/2026", 7), null);
  assert.equal(eduPlanAddDaysISO("2026-08-31", 1.5), null);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · 🔴 EL ESTADO SE DERIVA DEL CALENDARIO, NUNCA DE UNA COLUMNA
// ═════════════════════════════════════════════════════════════════════

const HOY = "2026-08-31";

test("🔴 'vence hoy' es HOY: el día del vencimiento sigue PENDIENTE, y un día después está VENCIDA", () => {
  assert.equal(eduInstallmentStatus({ paidAt: null, dueDateISO: HOY }, HOY), "PENDIENTE");
  assert.equal(eduInstallmentStatus({ paidAt: null, dueDateISO: "2026-08-30" }, HOY), "VENCIDA");
  assert.equal(eduInstallmentStatus({ paidAt: null, dueDateISO: "2026-09-01" }, HOY), "PENDIENTE");
});

test("PAGADA gana al calendario: una mensualidad con pago nunca está vencida, ni con la fecha pasada", () => {
  assert.equal(
    eduInstallmentStatus({ paidAt: "2026-08-01T10:00:00.000Z", dueDateISO: "2020-01-01" }, HOY),
    "PAGADA",
  );
  assert.equal(
    eduInstallmentStatus({ paidAt: new Date("2026-08-01T10:00:00.000Z"), dueDateISO: HOY }, HOY),
    "PAGADA",
  );
});

test("el estado cambia con el HOY que se le pasa — no hay nada guardado que se pueda quedar viejo", () => {
  const inst = { paidAt: null, dueDateISO: "2026-08-31" };
  assert.equal(eduInstallmentStatus(inst, "2026-08-31"), "PENDIENTE");
  assert.equal(eduInstallmentStatus(inst, "2026-09-01"), "VENCIDA");
});

// ═════════════════════════════════════════════════════════════════════
// 4 · EL RESUMEN Y LAS LISTAS DE URGENCIA
// ═════════════════════════════════════════════════════════════════════

let contadorId = 0;
function mensualidad(
  number: number,
  amountCents: number,
  dueDateISO: string,
  todayISO: string,
  paid = false,
): EduInstallmentRow {
  contadorId += 1;
  const paidAt = paid ? "2026-08-01T10:00:00.000Z" : null;
  return {
    id: `i_${contadorId}`,
    number,
    amountCents,
    dueDateISO,
    status: eduInstallmentStatus({ paidAt, dueDateISO }, todayISO),
    paidAt,
    method: paid ? "CASH" : null,
    receivedByName: paid ? "Caja Uno" : null,
  };
}

function plan(
  status: EduPaymentPlanStatus,
  installments: EduInstallmentRow[],
  extra: Partial<EduPlanRow> = {},
): EduPlanRow {
  contadorId += 1;
  return {
    id: `p_${contadorId}`,
    status,
    chargeId: "c_1",
    chargeFolio: "C-0001",
    patientId: "pa_1",
    patientName: "María Rodríguez",
    patientFolio: "P-0001",
    months: installments.length,
    installmentCents: installments[installments.length - 1]?.amountCents ?? 0,
    downPaymentCents: 0,
    dueDay: 15,
    chargeTotalCents: installments.reduce((a, i) => a + i.amountCents, 0),
    ...eduPlanResumen(installments),
    createdByName: "Caja Uno",
    createdAt: "2026-08-01T10:00:00.000Z",
    cancelledAt: null,
    cancelledByName: null,
    cancelReason: null,
    settledAt: null,
    installments,
    ...extra,
  };
}

test("eduPlanResumen: los números del plan salen de sus mensualidades, no de columnas", () => {
  const r = eduPlanResumen([
    mensualidad(1, 33_334, "2026-08-15", HOY, true), // pagada
    mensualidad(2, 33_333, "2026-08-30", HOY), // vencida (ayer)
    mensualidad(3, 33_333, "2026-09-15", HOY), // pendiente
  ]);
  assert.equal(r.planCents, 100_000);
  assert.equal(r.paidCount, 1);
  assert.equal(r.pendingCents, 66_666);
  assert.equal(r.overdueCount, 1);
  assert.equal(r.overdueCents, 33_333);
  assert.equal(r.nextDueISO, "2026-08-30", "la siguiente es la más vieja SIN pagar");
});

test("eduInstallmentsDueBetween: extremo derecho EXCLUSIVO, solo planes ACTIVOS y sin las pagadas", () => {
  const activo = plan("ACTIVO", [
    mensualidad(1, 100, "2026-08-31", HOY), // hoy: entra
    mensualidad(2, 100, "2026-09-06", HOY), // dentro
    mensualidad(3, 100, "2026-09-07", HOY), // = hasta → FUERA (exclusivo)
  ]);
  const conPagada = plan("ACTIVO", [mensualidad(1, 100, "2026-09-01", HOY, true)]);
  const cancelado = plan("CANCELADO", [mensualidad(1, 100, "2026-09-02", HOY)]);
  const liquidado = plan("LIQUIDADO", [mensualidad(1, 100, "2026-09-03", HOY, true)]);

  const semana = eduInstallmentsDueBetween(
    [activo, conPagada, cancelado, liquidado],
    HOY,
    "2026-09-07",
  );
  assert.deepEqual(
    semana.map((x) => x.installment.dueDateISO),
    ["2026-08-31", "2026-09-06"],
    "una pagada no vence, un plan cancelado no se le debe a nadie y el límite derecho no entra",
  );
});

test("eduInstallmentsVencidas: solo de planes ACTIVOS, la más vieja primero", () => {
  const a = plan("ACTIVO", [
    mensualidad(1, 100, "2026-08-01", HOY),
    mensualidad(2, 100, "2026-07-01", HOY),
  ]);
  const c = plan("CANCELADO", [mensualidad(1, 100, "2026-01-01", HOY)]);
  const v = eduInstallmentsVencidas([a, c]);
  assert.deepEqual(
    v.map((x) => x.installment.dueDateISO),
    ["2026-07-01", "2026-08-01"],
  );
});

// ═════════════════════════════════════════════════════════════════════
// 5 · PARSEO DE LO QUE VIENE DEL CLIENTE
// ═════════════════════════════════════════════════════════════════════

test("parseEduPlanRequest: meses acotados, día de corte 1-31, y el error escrito para una persona", () => {
  // La guarda exportada, no `.ok` a secas: con strict:false el booleano
  // no estrecha la unión y `tsc` reventaría leyendo `.plan` / `.error`.
  const ok = parseEduPlanRequest({ months: 12, dueDay: 15 });
  assert.deepEqual(eduPlanRequestFailed(ok) ? null : ok.plan, { months: 12, dueDay: 15 });

  const sinCorte = parseEduPlanRequest({ months: "6" });
  assert.deepEqual(eduPlanRequestFailed(sinCorte) ? null : sinCorte.plan, {
    months: 6,
    dueDay: null,
  });

  for (const raw of [
    { months: 1 },
    { months: EDU_PLAN_MAX_MONTHS + 1 },
    { months: "doce" },
    {},
    null,
    [],
  ]) {
    const r = parseEduPlanRequest(raw);
    assert.equal(r.ok, false, `${JSON.stringify(raw)} no es un plan válido`);
  }
  const malCorte = parseEduPlanRequest({ months: 6, dueDay: 32 });
  assert.match(eduPlanRequestFailed(malCorte) ? malCorte.error : "", /1 a 31/);
});

test("parseEduPlanFilters: el default es ACTIVO (la cartera viva), 'todos' lo pide una persona", () => {
  assert.deepEqual(parseEduPlanFilters({}), { status: "ACTIVO", q: null });
  assert.deepEqual(parseEduPlanFilters({ estado: "todos" }), { status: null, q: null });
  assert.deepEqual(parseEduPlanFilters({ estado: "CANCELADO" }).status, "CANCELADO");
  assert.deepEqual(
    parseEduPlanFilters({ estado: "loquesea" }).status,
    "ACTIVO",
    "lo que no se reconoce cae al default",
  );
  assert.equal(parseEduPlanFilters({ q: "  maría  " }).q, "maría");
  // 🔴 Aquí no se lee ningún institutionId: no existe la llave.
  assert.equal("institutionId" in parseEduPlanFilters({ institutionId: "otra" }), false);
});

test("parseEduPaymentPlanStatus reconoce el enum y nada más", () => {
  for (const s of EDU_PAYMENT_PLAN_STATUSES) {
    assert.equal(parseEduPaymentPlanStatus(s), s);
  }
  assert.equal(parseEduPaymentPlanStatus("VENCIDO"), null, "'vencido' no es un estado del plan");
  assert.equal(parseEduPaymentPlanStatus(2), null);
});

test("cada estado tiene su etiqueta legible: la UI jamás pinta el valor del enum", () => {
  for (const s of EDU_PAYMENT_PLAN_STATUSES) {
    assert.ok(EDU_PAYMENT_PLAN_STATUS_LABELS[s].length > 2);
  }
  for (const s of ["PENDIENTE", "PAGADA", "VENCIDA"] as const) {
    assert.ok(EDU_INSTALLMENT_STATUS_LABELS[s].length > 2);
  }
  assert.equal(eduFechaLarga("2026-09-15"), "15 de septiembre de 2026");
  assert.equal(eduFechaLarga("no-fecha"), "—");
});

// ═════════════════════════════════════════════════════════════════════
// 6 · 🔴 QUIÉN VE LOS PLANES: el DINERO, todo o nada
// ═════════════════════════════════════════════════════════════════════

function actor(role: EduRole) {
  return { role, eduUserId: "u_1" };
}

test("🔴 un ALUMNO no ve un plan NI una mensualidad — por ALCANCE, aunque le enciendan caja.view", () => {
  for (const role of ["ALUMNO", "DOCENTE"] as EduRole[]) {
    const scope = eduVisibility(actor(role), "charges");
    const wherePlan = eduPaymentPlanScopeWhere({ institutionId: INST, scope });
    const whereInst = eduInstallmentScopeWhere({ institutionId: INST, scope });
    // El `where` cerrado: tenant puesto y ni una fila posible.
    assert.deepEqual(wherePlan, { institutionId: INST, id: { in: [] } });
    assert.deepEqual(whereInst, { institutionId: INST, id: { in: [] } });
  }
});

test("CAJA y DIRECCION ven todos los planes del instituto — y SOLO de su instituto", () => {
  for (const role of ["CAJA", "DIRECCION"] as EduRole[]) {
    const scope = eduVisibility(actor(role), "charges");
    assert.deepEqual(eduPaymentPlanScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
    });
    assert.deepEqual(eduInstallmentScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
    });
  }
});

test("sin institutionId, las funciones de alcance LANZAN (un undefined borraría el filtro de tenant)", () => {
  const scope = eduVisibility(actor("CAJA"), "charges");
  assert.throws(() => eduPaymentPlanScopeWhere({ institutionId: "", scope }));
  assert.throws(() => eduInstallmentScopeWhere({ institutionId: "", scope }));
});

test("un alcance que no sea 'all' —venga de donde venga— cierra la consulta", () => {
  for (const scope of [
    { kind: "own", studentUserId: "u_1" } as const,
    { kind: "supervised", supervisorUserId: "u_1" } as const,
    { kind: "none" } as const,
  ]) {
    assert.deepEqual(eduPaymentPlanScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
      id: { in: [] },
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 7 · LOS ENDPOINTS EXIGEN LA KEY CORRECTA — y NO hay keys nuevas
// ═════════════════════════════════════════════════════════════════════

test("los cuatro endpoints de pagos a meses reusan caja.view / caja.charge / caja.refund", () => {
  const api = join(__dirname, "..", "..", "..", "app", "api", "instituto", "caja");
  const casos: [string[], string][] = [
    [["cobros", "[id]", "plan", "route.ts"], "caja.charge"],
    [["planes", "route.ts"], "caja.view"],
    [["planes", "[id]", "cancelar", "route.ts"], "caja.refund"],
    [["mensualidades", "[id]", "pagar", "route.ts"], "caja.charge"],
  ];
  for (const [partes, key] of casos) {
    const ruta = join(api, ...partes);
    assert.ok(existsSync(ruta), `falta el endpoint ${partes.join("/")}`);
    const texto = readFileSync(ruta, "utf8");
    assert.ok(
      texto.includes(`eduApiGuard("${key}")`),
      `${partes.join("/")} debe exigir ${key}`,
    );
  }
});

test("el reparto de las keys por rol no cambió: cobra caja, cancela quien devuelve, el alumno nada", () => {
  for (const role of EDU_ROLES) {
    const u = { role, permissionsOverride: null };
    const esperaDinero = role === "CAJA" || role === "DIRECCION";
    assert.equal(
      hasEduPermission(u, "caja.view"),
      esperaDinero,
      `${role} y caja.view`,
    );
    assert.equal(hasEduPermission(u, "caja.charge"), esperaDinero, `${role} y caja.charge`);
    assert.equal(hasEduPermission(u, "caja.refund"), esperaDinero, `${role} y caja.refund`);
  }
  // Y el default del rol es la lista, no una condición escondida.
  assert.ok(EDU_ROLE_DEFAULTS.CAJA.includes("caja.charge"));
  assert.ok(!EDU_ROLE_DEFAULTS.ALUMNO.includes("caja.view"));
  assert.ok(!EDU_ROLE_DEFAULTS.DOCENTE.includes("caja.view"));
});
