/**
 * LA TARIFA SE RESUELVE EN EL SERVIDOR — la prueba central de la Ola 5 de
 * DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-tarifas.test.ts
 *
 * (No hay `npm run test:edu-tarifas`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * ── POR QUÉ SE PUEDE PROBAR SIN BASE DE DATOS ───────────────────────────
 * `resolveFeeSchedule`, `resolveUnitPrice` y `resolveEduChargeLines`
 * reciben su FUENTE de datos como último parámetro, con la de Prisma por
 * defecto. Aquí se les pasa una fuente en memoria, así que lo que se prueba
 * son las funciones REALES —con sus guardias, sus errores y su orden de
 * decisión— y no una copia. Es la misma idea que hace comprobable
 * visibility.ts: separar la decisión de la consulta.
 *
 * Lo que fija este archivo:
 *  1. qué lista de precios le toca a un paciente, incluida la línea del
 *     contrato "si lo trajo un alumno, la lista de alumno";
 *  2. de dónde sale el precio y qué pasa cuando la lista que le toca NO
 *     cubre ese procedimiento;
 *  3. 🔴 QUE EL PRECIO QUE MANDA EL CLIENTE SE DESCARTA — la regla sin la
 *     cual el resto es decoración;
 *  4. la aritmética del dinero en centavos enteros;
 *  5. que las uniones de types.ts no se desincronicen de los enums de
 *     Prisma (chequeo de TIPOS, lo verifica `tsc --noEmit`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  EduChargeStatus as PrismaChargeStatus,
  EduFeeRule as PrismaFeeRule,
  EduPaymentMethod as PrismaPaymentMethod,
} from "@prisma/client";
import {
  resolveEduChargeLines,
  resolveFeeSchedule,
  resolveUnitPrice,
  type EduFeeItemData,
  type EduFeeScheduleData,
  type EduPacienteTarifaData,
  type EduProcedureData,
  type EduTarifaFuente,
} from "../tarifas";
import {
  eduChargeStatusFor,
  eduChargeTotals,
  eduLineTotalCents,
  eduMoney,
  eduMoneyInputValue,
  eduSaldoVivoCents,
  normalizeEduKey,
  normalizeEduProcedureCode,
  parseEduMoneyCents,
  parseEduMoneyCentsMax,
  parseEduQuantity,
} from "../dinero-core";
import type { EduChargeStatus, EduFeeRule, EduPaymentMethod } from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: las uniones de types.ts == los enums de Prisma
//     Si una ola agrega un valor al schema y no lo agrega a types.ts (o al
//     revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _feeRule: Exacto<EduFeeRule, PrismaFeeRule> = true;
const _chargeStatus: Exacto<EduChargeStatus, PrismaChargeStatus> = true;
const _paymentMethod: Exacto<EduPaymentMethod, PrismaPaymentMethod> = true;
void _feeRule;
void _chargeStatus;
void _paymentMethod;

// ─────────────────────────────────────────────────────────────────────
// Utilería: una fuente de datos en memoria
// ─────────────────────────────────────────────────────────────────────
const INST = "inst_1";
const OTRO_INST = "inst_2";

function lista(over: Partial<EduFeeScheduleData> & { id: string; key: string }): EduFeeScheduleData {
  return {
    name: over.key,
    rule: "MANUAL",
    isDefault: false,
    isActive: true,
    orderIndex: 0,
    ...over,
  };
}

const PUBLICO = lista({
  id: "fs_pub",
  key: "publico",
  name: "Público general",
  isDefault: true,
  orderIndex: 1,
});

const ALUMNO = lista({
  id: "fs_alu",
  key: "alumno",
  name: "Paciente de alumno",
  rule: "REFERRED_BY_STUDENT",
  orderIndex: 2,
});

const CONVENIO = lista({
  id: "fs_conv",
  key: "convenio-sindicato",
  name: "Convenio sindicato",
  orderIndex: 3,
});

const SOLO: EduPacienteTarifaData = {
  id: "pac_solo",
  referredByStudentId: null,
  referredByStudentName: null,
  referredByStudentMatricula: null,
};

const TRAIDO: EduPacienteTarifaData = {
  id: "pac_traido",
  referredByStudentId: "stu_1",
  referredByStudentName: "Sofía Ibarra",
  referredByStudentMatricula: "A-014",
};

const ENDO: EduProcedureData = {
  id: "proc_endo",
  code: "ENDO-1",
  name: "Endodoncia unirradicular",
  category: "Endodoncia",
  durationMinutes: 90,
  isActive: true,
};

const RESINA: EduProcedureData = {
  id: "proc_resina",
  code: "RES-1",
  name: "Resina simple",
  category: "Operatoria",
  durationMinutes: 45,
  isActive: true,
};

const BAJA: EduProcedureData = { ...RESINA, id: "proc_baja", code: "OLD-1", isActive: false };

interface Datos {
  listas?: EduFeeScheduleData[];
  pacientes?: EduPacienteTarifaData[];
  procedimientos?: EduProcedureData[];
  precios?: EduFeeItemData[];
}

/** Fuente en memoria. Respeta el tenant: otro institutionId no ve nada. */
function fuente(d: Datos): EduTarifaFuente {
  const listas = d.listas ?? [PUBLICO, ALUMNO];
  const pacientes = d.pacientes ?? [SOLO, TRAIDO];
  const procedimientos = d.procedimientos ?? [ENDO, RESINA, BAJA];
  const precios = d.precios ?? [];
  return {
    async listas(institutionId) {
      return institutionId === INST ? listas : [];
    },
    async paciente(institutionId, patientId) {
      if (institutionId !== INST) return null;
      return pacientes.find((p) => p.id === patientId) ?? null;
    },
    async procedimientos(institutionId, ids) {
      if (institutionId !== INST) return [];
      return procedimientos.filter((p) => ids.includes(p.id));
    },
    async precios(institutionId, ids) {
      if (institutionId !== INST) return [];
      return precios.filter((p) => ids.includes(p.procedureId));
    },
  };
}

const PRECIOS: EduFeeItemData[] = [
  { feeScheduleId: PUBLICO.id, procedureId: ENDO.id, priceCents: 250000 }, // $2,500
  { feeScheduleId: ALUMNO.id, procedureId: ENDO.id, priceCents: 90000 }, //  $900
  { feeScheduleId: PUBLICO.id, procedureId: RESINA.id, priceCents: 60000 }, // $600
  // RESINA NO tiene precio en la lista de alumno: es el caso de "esa lista
  // no cubre este procedimiento".
];

// ═════════════════════════════════════════════════════════════════════
// 1 · QUÉ LISTA LE TOCA A ESTE PACIENTE
// ═════════════════════════════════════════════════════════════════════

test("🔴 al paciente que trajo un alumno le toca la lista de alumno", async () => {
  const m = await resolveFeeSchedule(INST, TRAIDO.id, fuente({}));
  assert.equal(m?.feeScheduleId, ALUMNO.id);
  assert.equal(m?.feeScheduleKey, "alumno");
  assert.equal(m?.isDefault, false);
});

test("al paciente que llegó solo le toca la lista predeterminada", async () => {
  const m = await resolveFeeSchedule(INST, SOLO.id, fuente({}));
  assert.equal(m?.feeScheduleId, PUBLICO.id);
  assert.equal(m?.isDefault, true);
  assert.match(m?.reason ?? "", /llegó solo/i);
});

test("el motivo dice QUIÉN lo trajo, con su nombre y su matrícula", async () => {
  const m = await resolveFeeSchedule(INST, TRAIDO.id, fuente({}));
  // Es lo que se pinta en caja: "Paciente de alumno · Lo trajo Sofía
  // Ibarra (A-014)". Sin el nombre, quien cobra no puede comprobar nada.
  assert.match(m?.reason ?? "", /Sofía Ibarra/);
  assert.match(m?.reason ?? "", /A-014/);
});

test("sin lista de alumno ACTIVA cae a la predeterminada, y el motivo NO miente", async () => {
  const m = await resolveFeeSchedule(
    INST,
    TRAIDO.id,
    fuente({ listas: [PUBLICO, { ...ALUMNO, isActive: false }] }),
  );
  assert.equal(m?.feeScheduleId, PUBLICO.id);
  assert.equal(m?.isDefault, true);
  // Decirle "llegó solo a la clínica" a quien cobra, cuando SÍ lo trajo un
  // alumno y lo que falta es la lista, sería mentirle.
  assert.match(m?.reason ?? "", /Sofía Ibarra/);
  assert.match(m?.reason ?? "", /no hay una lista activa/i);
});

test("una lista MANUAL no se aplica sola, ni siquiera al paciente de alumno", async () => {
  const m = await resolveFeeSchedule(
    INST,
    TRAIDO.id,
    fuente({ listas: [PUBLICO, CONVENIO] }),
  );
  assert.equal(m?.feeScheduleId, PUBLICO.id);
});

test("sin lista predeterminada devuelve null: NO se inventa una", async () => {
  const m = await resolveFeeSchedule(
    INST,
    SOLO.id,
    fuente({ listas: [{ ...PUBLICO, isDefault: false }, CONVENIO] }),
  );
  // Caer a "la primera lista que haya" sería cobrar a ojo. La pantalla
  // dice qué falta marcar.
  assert.equal(m, null);
});

test("con DOS listas de la misma regla gana la de menor orderIndex (determinista)", async () => {
  const a = lista({ id: "fs_a", key: "alumno-a", rule: "REFERRED_BY_STUDENT", orderIndex: 5 });
  const b = lista({ id: "fs_b", key: "alumno-b", rule: "REFERRED_BY_STUDENT", orderIndex: 2 });
  // En los dos órdenes de entrada tiene que ganar la misma: si el precio
  // dependiera del orden en que Postgres devolvió las filas, el mismo
  // paciente pagaría distinto en dos consultas seguidas.
  for (const listas of [[PUBLICO, a, b], [PUBLICO, b, a]]) {
    const m = await resolveFeeSchedule(INST, TRAIDO.id, fuente({ listas }));
    assert.equal(m?.feeScheduleId, "fs_b");
  }
});

test("empate de orderIndex: desempata la clave, y siempre igual", async () => {
  const a = lista({ id: "fs_a", key: "zzz", rule: "REFERRED_BY_STUDENT", orderIndex: 2 });
  const b = lista({ id: "fs_b", key: "aaa", rule: "REFERRED_BY_STUDENT", orderIndex: 2 });
  for (const listas of [[PUBLICO, a, b], [PUBLICO, b, a]]) {
    const m = await resolveFeeSchedule(INST, TRAIDO.id, fuente({ listas }));
    assert.equal(m?.feeScheduleId, "fs_b");
  }
});

test("🔴 sin institutionId LANZA (un undefined borra el filtro de tenant)", async () => {
  for (const malo of ["", undefined, null]) {
    await assert.rejects(
      () => resolveFeeSchedule(malo as unknown as string, SOLO.id, fuente({})),
      /institutionId/,
    );
    await assert.rejects(
      () => resolveUnitPrice(malo as unknown as string, SOLO.id, ENDO.id, fuente({})),
      /institutionId/,
    );
  }
});

test("un paciente de OTRO instituto no resuelve tarifa: no existe para esta escuela", async () => {
  await assert.rejects(
    () => resolveFeeSchedule(OTRO_INST, TRAIDO.id, fuente({})),
    /no es de este instituto/i,
  );
});

test("un patientId con forma inválida se rechaza antes de consultar nada", async () => {
  await assert.rejects(() => resolveFeeSchedule(INST, "no vale;drop", fuente({})), /no es válido/i);
});

// ═════════════════════════════════════════════════════════════════════
// 2 · CUÁNTO CUESTA
// ═════════════════════════════════════════════════════════════════════

test("🔴 el paciente de alumno paga el precio de la lista de alumno", async () => {
  const p = await resolveUnitPrice(INST, TRAIDO.id, ENDO.id, fuente({ precios: PRECIOS }));
  assert.equal(p?.priceCents, 90000);
  assert.equal(p?.fromFeeScheduleId, ALUMNO.id);
  assert.equal(p?.fallback, false);
});

test("el paciente que llegó solo paga el de la lista predeterminada", async () => {
  const p = await resolveUnitPrice(INST, SOLO.id, ENDO.id, fuente({ precios: PRECIOS }));
  assert.equal(p?.priceCents, 250000);
  assert.equal(p?.fromFeeScheduleId, PUBLICO.id);
  assert.equal(p?.fallback, false);
});

test("si la lista que le toca NO cubre el procedimiento, cae a la default y lo MARCA", async () => {
  const p = await resolveUnitPrice(INST, TRAIDO.id, RESINA.id, fuente({ precios: PRECIOS }));
  assert.equal(p?.priceCents, 60000);
  assert.equal(p?.fromFeeScheduleId, PUBLICO.id);
  // La marca es lo importante: sin ella, el paciente de alumno pagaría el
  // precio de público y nadie se enteraría.
  assert.equal(p?.fallback, true);
  assert.equal(p?.applied.feeScheduleId, ALUMNO.id);
});

test("sin precio en NINGUNA lista devuelve null (no un cero implícito)", async () => {
  const p = await resolveUnitPrice(INST, SOLO.id, ENDO.id, fuente({ precios: [] }));
  assert.equal(p, null);
});

test("un precio de CERO es un precio válido y no se confunde con 'sin precio'", async () => {
  // El tamizaje gratis de la escuela existe: "sin fila" y "cero" son cosas
  // distintas y tienen que poder distinguirse.
  const p = await resolveUnitPrice(
    INST,
    SOLO.id,
    ENDO.id,
    fuente({ precios: [{ feeScheduleId: PUBLICO.id, procedureId: ENDO.id, priceCents: 0 }] }),
  );
  assert.equal(p?.priceCents, 0);
  assert.notEqual(p, null);
});

test("un procedimiento dado de baja no se puede cobrar", async () => {
  await assert.rejects(
    () =>
      resolveUnitPrice(
        INST,
        SOLO.id,
        BAJA.id,
        fuente({ precios: [{ feeScheduleId: PUBLICO.id, procedureId: BAJA.id, priceCents: 100 }] }),
      ),
    /dado de baja/i,
  );
});

test("un procedimiento de otro instituto no existe para esta escuela", async () => {
  await assert.rejects(
    () => resolveUnitPrice(INST, SOLO.id, "proc_ajeno", fuente({ precios: PRECIOS })),
    /no es de este instituto/i,
  );
});

test("sin lista aplicable no hay precio que resolver", async () => {
  const p = await resolveUnitPrice(
    INST,
    SOLO.id,
    ENDO.id,
    fuente({ listas: [CONVENIO], precios: PRECIOS }),
  );
  assert.equal(p, null);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · 🔴 EL ANTIFRAUDE: EL PRECIO DEL CLIENTE SE DESCARTA
//
// Sin esto, todo lo de arriba es decoración: bastaría con abrir las
// herramientas del navegador y mandar el precio de "paciente de alumno"
// siendo público general.
// ═════════════════════════════════════════════════════════════════════

test("🔴 el precio que manda el cliente se DESCARTA cuando la línea trae procedureId", async () => {
  const r = await resolveEduChargeLines(
    INST,
    SOLO.id,
    // El navegador dice que la endodoncia cuesta $1.00.
    [{ procedureId: ENDO.id, unitPriceCents: "1.00" }],
    fuente({ precios: PRECIOS }),
  );
  // El servidor pone SU precio: $2,500 de la lista de público.
  assert.equal(r.lines[0].unitPriceCents, 250000);
  assert.equal(r.lines.length, 1);
});

test("🔴 el precio descartado QUEDA REGISTRADO en la línea (no en un log que nadie lee)", async () => {
  const r = await resolveEduChargeLines(
    INST,
    SOLO.id,
    [{ procedureId: ENDO.id, unitPriceCents: "1.00" }],
    fuente({ precios: PRECIOS }),
  );
  assert.equal(r.lines[0].clientPriceCents, 100);
  assert.equal(r.descartados, 1);
});

test("🔴 el descarte NO revienta el cobro: sale con el precio bueno, en silencio", async () => {
  const r = await resolveEduChargeLines(
    INST,
    SOLO.id,
    [
      { procedureId: ENDO.id, unitPriceCents: "1.00" },
      { procedureId: RESINA.id, unitPriceCents: "0.01" },
    ],
    fuente({ precios: PRECIOS }),
  );
  const totals = eduChargeTotals(
    r.lines.map((l) => ({
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
    })),
  );
  // $2,500 + $600. El intento de pagar $1.01 no movió el total ni un
  // centavo, y el cobro se emitió igual: reventar le avisaría al que lo
  // intenta que hay algo que intentar.
  assert.equal(totals.totalCents, 310000);
  assert.equal(r.descartados, 2);
});

test("mandar el precio CORRECTO no cuenta como descarte", async () => {
  const r = await resolveEduChargeLines(
    INST,
    TRAIDO.id,
    [{ procedureId: ENDO.id, unitPriceCents: "900.00" }],
    fuente({ precios: PRECIOS }),
  );
  assert.equal(r.lines[0].unitPriceCents, 90000);
  assert.equal(r.lines[0].clientPriceCents, null);
  assert.equal(r.descartados, 0);
});

test("no mandar precio es lo normal y no deja rastro", async () => {
  const r = await resolveEduChargeLines(
    INST,
    TRAIDO.id,
    [{ procedureId: ENDO.id, quantity: 2 }],
    fuente({ precios: PRECIOS }),
  );
  assert.equal(r.lines[0].unitPriceCents, 90000);
  assert.equal(r.lines[0].clientPriceCents, null);
  assert.equal(r.lines[0].quantity, 2);
  assert.equal(r.descartados, 0);
});

test("el precio del cliente tampoco se cuela por la lista de alumno de otro paciente", async () => {
  // El intento clásico: mandar el precio que vio en la pantalla de otro.
  const r = await resolveEduChargeLines(
    INST,
    SOLO.id,
    [{ procedureId: ENDO.id, unitPriceCents: "900.00" }],
    fuente({ precios: PRECIOS }),
  );
  assert.equal(r.lines[0].unitPriceCents, 250000);
  assert.equal(r.lines[0].clientPriceCents, 90000);
});

test("la LÍNEA LIBRE sí lleva el precio de quien cobra (el servidor no tiene opinión)", async () => {
  const r = await resolveEduChargeLines(
    INST,
    SOLO.id,
    [{ description: "Material de laboratorio", unitPriceCents: "350.50" }],
    fuente({ precios: PRECIOS }),
  );
  assert.equal(r.lines[0].procedureId, null);
  assert.equal(r.lines[0].unitPriceCents, 35050);
  // No hay nada que descartar: no había precio de servidor con el que
  // comparar. Por eso queda en null y no en "0 descartado".
  assert.equal(r.lines[0].clientPriceCents, null);
  assert.equal(r.descartados, 0);
});

test("una línea libre sin descripción se rechaza (un cobro sin concepto no es un cobro)", async () => {
  await assert.rejects(
    () => resolveEduChargeLines(INST, SOLO.id, [{ unitPriceCents: "100" }], fuente({})),
    /descripción/i,
  );
});

test("un procedimiento sin precio en ninguna lista no se puede cobrar, y se dice cuál", async () => {
  await assert.rejects(
    () =>
      resolveEduChargeLines(
        INST,
        SOLO.id,
        [{ procedureId: RESINA.id }],
        fuente({ precios: [PRECIOS[0], PRECIOS[1]] }),
      ),
    // Sin la bandera `s`: el tsconfig del repo apunta por debajo de es2018
    // y `[\s\S]` hace lo mismo en cualquier objetivo.
    /Resina simple[\s\S]*no tiene precio/i,
  );
});

test("una cantidad fuera de rango se rechaza en vez de recortarse", async () => {
  for (const q of [0, -1, 100, 2.5]) {
    await assert.rejects(
      () =>
        resolveEduChargeLines(
          INST,
          SOLO.id,
          [{ procedureId: ENDO.id, quantity: q }],
          fuente({ precios: PRECIOS }),
        ),
      /cantidad/i,
    );
  }
});

test("un descuento MAYOR que la línea se rechaza (es un dedazo, no una devolución)", async () => {
  await assert.rejects(
    () =>
      resolveEduChargeLines(
        INST,
        SOLO.id,
        [{ procedureId: ENDO.id, discountCents: "9000.00" }],
        fuente({ precios: PRECIOS }),
      ),
    /descuento/i,
  );
});

test("un cobro sin conceptos se rechaza", async () => {
  await assert.rejects(() => resolveEduChargeLines(INST, SOLO.id, [], fuente({})), /ni un concepto/i);
});

test("sin lista predeterminada no se puede cobrar del catálogo, y se dice qué falta", async () => {
  await assert.rejects(
    () =>
      resolveEduChargeLines(
        INST,
        SOLO.id,
        [{ procedureId: ENDO.id }],
        fuente({ listas: [CONVENIO], precios: PRECIOS }),
      ),
    /predeterminada/i,
  );
});

// ═════════════════════════════════════════════════════════════════════
// 4 · EL DINERO, EN CENTAVOS ENTEROS
// ═════════════════════════════════════════════════════════════════════

test("se lee lo que la gente teclea de verdad", () => {
  assert.equal(parseEduMoneyCents("1,234.50"), 123450);
  assert.equal(parseEduMoneyCents("$300"), 30000);
  assert.equal(parseEduMoneyCents("  300  "), 30000);
  assert.equal(parseEduMoneyCents("0"), 0);
  assert.equal(parseEduMoneyCents("0.05"), 5);
  assert.equal(parseEduMoneyCents("19.99"), 1999);
  assert.equal(parseEduMoneyCents(19.99), 1999);
  assert.equal(parseEduMoneyCents("1 234.00"), 123400);
});

test("🔴 no se redondea con coma flotante: 1.005 se RECHAZA, no se convierte en 1.00", () => {
  // Math.round(1.005 * 100) da 100 — o sea $1.00 por algo que costaba
  // $1.01. Aquí se pregunta en vez de decidir.
  assert.equal(parseEduMoneyCents("1.005"), null);
  assert.equal(parseEduMoneyCents("99.999"), null);
});

test("🔴 no se aceptan negativos: una devolución es otra fila, no un monto con signo", () => {
  assert.equal(parseEduMoneyCents("-100"), null);
  assert.equal(parseEduMoneyCents(-1), null);
});

test("lo que no es una cantidad devuelve null en vez de NaN", () => {
  for (const malo of ["", "abc", "1.2.3", "1e5", null, undefined, {}, [], NaN, Infinity]) {
    assert.equal(parseEduMoneyCents(malo), null, `aceptó ${JSON.stringify(malo)}`);
  }
});

test("el tope devuelve null en vez de guardar un número que no cabe en la columna", () => {
  assert.equal(parseEduMoneyCentsMax("100.00", 10000), 10000);
  assert.equal(parseEduMoneyCentsMax("100.01", 10000), null);
});

test("las cantidades van de 1 a 99 y el vacío vale 1", () => {
  assert.equal(parseEduQuantity(undefined), 1);
  assert.equal(parseEduQuantity(""), 1);
  assert.equal(parseEduQuantity("3"), 3);
  assert.equal(parseEduQuantity(0), null);
  assert.equal(parseEduQuantity(100), null);
  assert.equal(parseEduQuantity(1.5), null);
});

test("el dinero se pinta en pesos y un valor imposible no sale como $NaN", () => {
  assert.match(eduMoney(123450), /1,234\.50/);
  assert.equal(eduMoney(null), "—");
  assert.equal(eduMoney(NaN), "—");
  assert.equal(eduMoneyInputValue(123450), "1234.50");
  assert.equal(eduMoneyInputValue(null), "");
});

test("ida y vuelta: lo que se pinta en un input se vuelve a leer igual", () => {
  for (const cents of [0, 1, 99, 100, 30000, 123450, 999999]) {
    assert.equal(parseEduMoneyCents(eduMoneyInputValue(cents)), cents);
  }
});

// ── La aritmética del ticket ─────────────────────────────────────────

test("🔴 el invariante del ticket: subtotal − descuento == total, SIEMPRE", () => {
  const casos = [
    [{ quantity: 1, unitPriceCents: 250000, discountCents: 0 }],
    [{ quantity: 3, unitPriceCents: 60000, discountCents: 5000 }],
    [
      { quantity: 2, unitPriceCents: 90000, discountCents: 10000 },
      { quantity: 1, unitPriceCents: 0, discountCents: 0 },
    ],
    // Descuento absurdo: el total se queda en cero y el DESCUENTO se
    // recorta, para que la resta siga cuadrando en el recibo.
    [{ quantity: 1, unitPriceCents: 50000, discountCents: 90000 }],
  ];
  for (const lineas of casos) {
    const t = eduChargeTotals(lineas);
    assert.equal(
      t.subtotalCents - t.discountCents,
      t.totalCents,
      `no cuadra: ${JSON.stringify(t)}`,
    );
    assert.ok(t.totalCents >= 0);
    assert.ok(t.discountCents >= 0);
  }
});

test("una línea nunca vale menos que cero", () => {
  assert.equal(
    eduLineTotalCents({ quantity: 1, unitPriceCents: 50000, discountCents: 90000 }),
    0,
  );
  assert.equal(eduLineTotalCents({ quantity: 3, unitPriceCents: 10000, discountCents: 5000 }), 25000);
});

test("sumar centavos enteros no arrastra el error de la coma flotante", () => {
  // El caso de manual: 0.1 + 0.2 en float da 0.30000000000000004. En
  // centavos son 10 + 20 = 30, exacto, y multiplicado por 1000 renglones
  // sigue siendo exacto.
  const lineas = Array.from({ length: 1000 }, () => ({
    quantity: 1,
    unitPriceCents: 10,
    discountCents: 0,
  }));
  assert.equal(eduChargeTotals(lineas).totalCents, 10000);
});

// ── El estado y el saldo ─────────────────────────────────────────────

test("el estado se DERIVA de (total, pagado, cancelado)", () => {
  const s = (
    totalCents: number,
    paidCents: number,
    hasRefund = false,
    cancelled = false,
  ) => eduChargeStatusFor({ cancelled, totalCents, paidCents, hasRefund });

  assert.equal(s(100000, 0), "PENDING");
  assert.equal(s(100000, 40000), "PARTIAL");
  assert.equal(s(100000, 100000), "PAID");
  assert.equal(s(100000, 120000), "PAID");
  assert.equal(s(100000, 0, true), "REFUNDED");
  assert.equal(s(100000, 40000, true), "PARTIAL");
  assert.equal(s(100000, 50000, false, true), "CANCELLED");
  // Un cobro de cero nace LIQUIDADO: el tamizaje gratis de la escuela no
  // puede quedarse "por cobrar" para siempre en la lista de cobranza.
  assert.equal(s(0, 0), "PAID");
});

test("🔴 UN COBRO CANCELADO DEBE CERO (el bug que ya se pagó en el dental)", () => {
  // Allá, cancelar una factura marcaba el estado y dejaba el balance
  // intacto: la ficha del paciente seguía ofreciendo "Cobrar ahora ·
  // $1,800" de algo anulado, y lo mismo hacían el corte y cuatro pantallas.
  assert.equal(
    eduSaldoVivoCents({ status: "CANCELLED", totalCents: 180000, paidCents: 0 }),
    0,
  );
  assert.equal(
    eduSaldoVivoCents({ status: "PENDING", totalCents: 180000, paidCents: 0 }),
    180000,
  );
  assert.equal(
    eduSaldoVivoCents({ status: "PARTIAL", totalCents: 180000, paidCents: 50000 }),
    130000,
  );
  // Pagado de más no genera saldo negativo a favor del paciente.
  assert.equal(eduSaldoVivoCents({ status: "PAID", totalCents: 100, paidCents: 500 }), 0);
});

// ── Claves ───────────────────────────────────────────────────────────

test("la clave de una lista se normaliza (sin acentos, sin espacios, minúsculas)", () => {
  assert.equal(normalizeEduKey("Público general"), "publico-general");
  assert.equal(normalizeEduKey("  Convenio  IMSS  "), "convenio-imss");
  assert.equal(normalizeEduKey("alumno"), "alumno");
  assert.equal(normalizeEduKey(""), null);
  assert.equal(normalizeEduKey("···"), null);
  assert.equal(normalizeEduKey("x".repeat(41)), null);
});

test("la clave de un procedimiento se normaliza en MAYÚSCULAS", () => {
  assert.equal(normalizeEduProcedureCode(" endo-1 "), "ENDO-1");
  assert.equal(normalizeEduProcedureCode("res 1"), "RES1");
  assert.equal(normalizeEduProcedureCode(""), null);
  assert.equal(normalizeEduProcedureCode("x".repeat(21)), null);
});
