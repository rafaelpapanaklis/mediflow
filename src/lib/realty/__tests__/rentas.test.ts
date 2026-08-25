// ═══════════════════════════════════════════════════════════════════════
// RENTAS Y COBRANZA — las cuentas que no se pueden equivocar.
//
// Todo lo que se prueba aquí es PURO: sin Postgres, sin navegador, sin
// sesión. Corre en medio segundo.
//
//   npx tsx --test src/lib/realty/__tests__/rentas.test.ts
//
// Lo que cubre y POR QUÉ:
//
//   · El DINERO. Un cargo de 12 000 con un abono de 5 000 tiene que dejar
//     7 000 exactos, y doce meses de 4 166.67 tienen que sumar 50 000.04 y
//     no 50 000.039999999994. Por eso todo se calcula en centavos enteros.
//   · El CALENDARIO. Un contrato del 15-mar al 14-mar del año siguiente son
//     DOCE cobros, no trece; y el día 31 en febrero es el 28 (o el 29).
//   · El TOPE DE LA CDMX. Que "México" (el estado) NO se confunda con la
//     Ciudad de México es la diferencia entre bloquear un aumento legal en
//     Toluca y dejar pasar uno ilegal en la Roma.
//   · El FOLIO del recibo. Que el orden sea NUMÉRICO y no alfabético.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agingBucket,
  atNoonUTC,
  buildChargeSchedule,
  centsToNumber,
  chargeBalance,
  clampPaymentDay,
  daysBetween,
  folioFromReceiptUrl,
  formatReceiptFolio,
  monthKey,
  parseReceiptFolio,
  pickReminderStep,
  noticeChannelsFor,
  receiptUrlFor,
  sumCents,
  toCents,
  todayInTimezone,
} from "@/lib/realty/rent-charges";
import {
  annualIncreaseCapPct,
  applyIncreaseToCents,
  buildIncreaseAckLine,
  exceedsCap,
  isCdmxProperty,
  mergeNotesPreservingAcks,
  needsCapAck,
  normalizePlace,
  parseIncreaseAcks,
  stripAckLines,
  suggestIncrease,
} from "@/lib/realty/inpc";

// ── 1. EL CASO CONCRETO DEL CIERRE ─────────────────────────────────────
// Renta 12 000, pago parcial de 5 000, saldo 7 000, y su recibo con folio.
test("renta 12,000 con abono de 5,000 deja saldo de 7,000 y el cargo en PARCIAL", () => {
  const hoy = atNoonUTC(2026, 7, 20); // 20-ago-2026
  const bal = chargeBalance({
    amount: 12000,
    paid: 5000,
    dueAt: atNoonUTC(2026, 7, 5), // venció el 5-ago
    today: hoy,
  });

  assert.equal(bal.amountCents, 1_200_000);
  assert.equal(bal.paidCents, 500_000);
  assert.equal(bal.balanceCents, 700_000);
  assert.equal(centsToNumber(bal.balanceCents), 7000);
  // PARCIAL gana sobre VENCIDO a propósito: la antigüedad la lleva el
  // semáforo, no el estado (ver la nota de prioridad en rent-charges.ts).
  assert.equal(bal.status, "PARCIAL");
  assert.equal(bal.daysLate, 15);
  assert.equal(agingBucket(bal.balanceCents, bal.daysLate), "D1_15");
});

test("el recibo de ese pago sale con folio consecutivo y su liga resoluble", () => {
  // El folio se emite desde el MÁXIMO ya emitido, nunca desde un count.
  const maxEmitido = 122;
  const folio = formatReceiptFolio(maxEmitido + 1);
  assert.equal(folio, "REC-000123");

  const url = receiptUrlFor(folio);
  assert.equal(url, "/api/realty/payments/recibo/REC-000123");
  // La liga guardada en receiptUrl devuelve exactamente el mismo folio.
  assert.equal(folioFromReceiptUrl(url), "REC-000123");
  assert.equal(parseReceiptFolio(folio), 123);
});

// ── 2. Dinero: centavos enteros, un solo redondeo al final ─────────────
test("sumar doce rentas con centavos no arrastra error binario", () => {
  const doce = new Array(12).fill(4166.67);
  const cents = sumCents(doce);
  assert.equal(cents, 5_000_004);
  assert.equal(centsToNumber(cents), 50000.04);
  // El mismo cálculo con `+` en punto flotante NO da 50000.04 exacto.
  const conFloats = doce.reduce((a, b) => a + b, 0);
  assert.notEqual(conFloats, 50000.04);
});

test("toCents acepta el Decimal de Prisma por su toString y la basura da 0", () => {
  assert.equal(toCents({ toString: () => "12000.00" }), 1_200_000);
  assert.equal(toCents("7,000"), 0); // una coma no es un número: 0, no NaN
  assert.equal(toCents("0.1"), 10);
  assert.equal(toCents(2.675), 268); // medio hacia arriba, sin el 2.67499…
  assert.equal(toCents(null), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(toCents(""), 0);
});

test("toCents es exacto también en importes grandes con tres decimales", () => {
  // El atajo `Math.round(n * 100 + 1e-9)` fallaba aquí: ese epsilon está en
  // centavos, pero el error de n*100 crece con la magnitud. Un edificio o un
  // local comercial caen justo en ese rango.
  assert.equal(toCents(9999999.995), 1_000_000_000); // $10,000,000.00
  assert.equal(toCents(601705.955), 60_170_596);
  assert.equal(toCents("999999999999.99"), 99_999_999_999_999); // tope de Decimal(14,2)
  assert.equal(toCents(163537.155), 16_353_716);
  // Y sigue siendo exacto en los chicos, que es donde ya funcionaba.
  assert.equal(toCents(12.345), 1235);
  assert.equal(toCents(-2.675), -268); // simétrico: medio lejos del cero
});

test("un sobrepago deja el saldo en cero, nunca en negativo", () => {
  const bal = chargeBalance({
    amount: 12000,
    paid: 12500,
    dueAt: atNoonUTC(2026, 7, 5),
    today: atNoonUTC(2026, 7, 6),
  });
  assert.equal(bal.balanceCents, 0);
  assert.equal(bal.status, "PAGADO");
  assert.equal(agingBucket(bal.balanceCents, bal.daysLate), "AL_CORRIENTE");
});

// ── 3. El calendario de cobros ─────────────────────────────────────────
test("un año exacto del 1-mar al 28-feb son DOCE cobros", () => {
  const plan = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 2, 1),
    endsAt: atNoonUTC(2027, 1, 28),
    paymentDay: 5,
    rentAmount: 12000,
  });
  assert.equal(plan.length, 12);
  assert.equal(plan[0].periodMonth, "2026-03");
  assert.equal(plan[11].periodMonth, "2027-02");
  assert.equal(monthKey(plan[0].dueAt), "2026-03");
  assert.equal(plan[0].dueAt.getUTCDate(), 5);
  assert.equal(plan[0].amountCents, 1_200_000);
});

test("del 15-mar al 14-mar con día de pago 15 son DOCE, no trece", () => {
  // El mes trece existe en el calendario, pero su renta vencería el 15 y el
  // contrato ya terminó el 14: cobrarla sería cobrar un mes que no se rentó.
  const plan = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 2, 15),
    endsAt: atNoonUTC(2027, 2, 14),
    paymentDay: 15,
    rentAmount: 9000,
  });
  assert.equal(plan.length, 12);
  assert.equal(plan[plan.length - 1].periodMonth, "2027-02");
});

test("el primer cobro nunca vence antes de que empiece el contrato", () => {
  // Arranca el 15 y el día de pago es el 5: el 5 de ese mes todavía no se
  // había mudado. El primer vencimiento se recorre al día de inicio.
  const plan = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 2, 15),
    endsAt: atNoonUTC(2027, 1, 28),
    paymentDay: 5,
    rentAmount: 10000,
  });
  assert.equal(plan[0].periodMonth, "2026-03");
  assert.equal(plan[0].dueAt.getUTCDate(), 15);
  assert.equal(plan[1].dueAt.getUTCDate(), 5);
});

test("el día 31 se recorta al último día del mes (y febrero bisiesto)", () => {
  assert.equal(clampPaymentDay(2026, 1, 31), 28); // feb 2026
  assert.equal(clampPaymentDay(2028, 1, 31), 29); // feb 2028, bisiesto
  assert.equal(clampPaymentDay(2026, 3, 31), 30); // abril
  assert.equal(clampPaymentDay(2026, 0, 31), 31); // enero
  // Un día inválido cae al 1, no revienta.
  assert.equal(clampPaymentDay(2026, 0, 0), 1);
  assert.equal(clampPaymentDay(2026, 0, 99), 31);
  assert.equal(clampPaymentDay(2026, 0, -3), 1);
  // Un string truthy pero no numérico devolvía NaN, y de ahí salían cargos
  // con `dueAt: Invalid Date`. Esta función es pública y client-safe.
  assert.equal(clampPaymentDay(2026, 0, "abc" as unknown as number), 1);
  assert.equal(clampPaymentDay(2026, 0, NaN), 1);
  assert.equal(clampPaymentDay(2026, 0, "5" as unknown as number), 5);
});

test("ningún cargo sale con una fecha inválida aunque el día de pago sea basura", () => {
  const plan = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 0, 1),
    endsAt: atNoonUTC(2026, 2, 31),
    paymentDay: "abc" as unknown as number,
    rentAmount: 8000,
  });
  assert.equal(plan.length, 3);
  for (const row of plan) {
    assert.equal(Number.isNaN(row.dueAt.getTime()), false, `dueAt inválido en ${row.periodMonth}`);
    assert.equal(row.dueAt.getUTCDate(), 1);
  }
});

test("un endsAt anterior al inicio no genera ningún cobro", () => {
  const plan = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 5, 1),
    endsAt: atNoonUTC(2026, 2, 1),
    paymentDay: 1,
    rentAmount: 8000,
  });
  assert.equal(plan.length, 0);
});

test("diez años EXACTOS caben; el dedazo de doscientos años no", () => {
  const diezAnios = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 0, 1),
    endsAt: atNoonUTC(2035, 11, 31),
    paymentDay: 1,
    rentAmount: 5000,
  });
  assert.equal(diezAnios.length, 120); // el tope, no un cargo menos
});

test("un dedazo en el año no puede insertar miles de cobros", () => {
  const plan = buildChargeSchedule({
    startsAt: atNoonUTC(2026, 0, 1),
    endsAt: atNoonUTC(2226, 0, 1), // 200 años
    paymentDay: 1,
    rentAmount: 5000,
  });
  assert.equal(plan.length, 120); // el techo, no 2 400
});

// ── 4. Fechas y zona horaria ───────────────────────────────────────────
test("el mediodía UTC mantiene el mismo día de calendario en México", () => {
  const d = atNoonUTC(2026, 7, 5);
  assert.equal(d.toISOString().slice(0, 10), "2026-08-05");
  const enMexico = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  assert.equal(enMexico, "2026-08-05");
});

test("todayInTimezone lee el día de la cuenta, no el del servidor", () => {
  // A las 03:00 UTC del 6 de agosto, en México todavía es el 5.
  const instante = new Date("2026-08-06T03:00:00.000Z");
  const hoy = todayInTimezone("America/Mexico_City", instante);
  assert.equal(hoy.toISOString().slice(0, 10), "2026-08-05");
  // Una zona inválida no truena: cae a México.
  const fallback = todayInTimezone("Zona/Inventada", instante);
  assert.equal(fallback.toISOString().slice(0, 10), "2026-08-05");
});

test("daysBetween cuenta días de calendario, no de 24 horas", () => {
  assert.equal(daysBetween(atNoonUTC(2026, 7, 5), atNoonUTC(2026, 7, 20)), 15);
  assert.equal(daysBetween(atNoonUTC(2026, 7, 20), atNoonUTC(2026, 7, 5)), -15);
  assert.equal(daysBetween(atNoonUTC(2026, 7, 5), atNoonUTC(2026, 7, 5)), 0);
});

// ── 5. El semáforo ─────────────────────────────────────────────────────
test("el semáforo mide la antigüedad del SALDO, no la de la fecha", () => {
  // Vencido hace 40 días pero sin saldo: está al corriente.
  assert.equal(agingBucket(0, 40), "AL_CORRIENTE");
  assert.equal(agingBucket(100, 0), "AL_CORRIENTE"); // vence hoy
  assert.equal(agingBucket(100, 1), "D1_15");
  assert.equal(agingBucket(100, 15), "D1_15");
  assert.equal(agingBucket(100, 16), "D16_30");
  assert.equal(agingBucket(100, 30), "D16_30");
  assert.equal(agingBucket(100, 31), "D30_MAS");
});

// ── 6. Los recordatorios escalonados ───────────────────────────────────
test("el aviso sale el día EXACTO del escalón y ningún otro", () => {
  const vence = atNoonUTC(2026, 7, 5);
  const paso = (dia: number) => pickReminderStep(vence, atNoonUTC(2026, 7, dia))?.key ?? null;

  // El de −5 cae en el mes anterior (31 de julio para un vencimiento el 5
  // de agosto): se pide con la fecha completa, no con un día del mes.
  assert.equal(pickReminderStep(vence, atNoonUTC(2026, 6, 31))?.key, "PREVIO_5");
  assert.equal(paso(5), "DIA_PAGO");
  assert.equal(paso(8), "VENCIDO_3");
  assert.equal(paso(13), "VENCIDO_8");
  // Los días de en medio NO mandan nada: un cargo viejo no puede escupir un
  // mensaje diario para siempre.
  assert.equal(paso(6), null);
  assert.equal(paso(9), null);
  assert.equal(paso(20), null);
  assert.equal(paso(1), null);
});

test("los cuatro escalones tienen tonos distintos", () => {
  const vence = atNoonUTC(2026, 7, 5);
  const tonos = [
    pickReminderStep(vence, atNoonUTC(2026, 6, 31))?.tone,
    pickReminderStep(vence, atNoonUTC(2026, 7, 5))?.tone,
    pickReminderStep(vence, atNoonUTC(2026, 7, 8))?.tone,
    pickReminderStep(vence, atNoonUTC(2026, 7, 13))?.tone,
  ];
  assert.deepEqual(tonos, ["amable", "recordatorio", "firme", "urgente"]);
});

test("🔴 el plan PROPIETARIO no manda WhatsApp: sale por correo y por el panel", () => {
  assert.deepEqual(noticeChannelsFor(false), ["CORREO", "PANEL"]);
  assert.deepEqual(noticeChannelsFor(true), ["WHATSAPP", "PANEL"]);
});

// ── 7. El tope de la Ciudad de México ──────────────────────────────────
test("🔴 el ESTADO de México NO es la Ciudad de México", () => {
  // Marcar Toluca como CDMX bloquearía un aumento perfectamente legal.
  assert.equal(isCdmxProperty({ state: "México", city: "Toluca" }), false);
  assert.equal(isCdmxProperty({ state: "Estado de México", city: "Naucalpan" }), false);
  assert.equal(isCdmxProperty({ state: "MEX", city: "Ecatepec" }), false);
  assert.equal(isCdmxProperty({ state: "Jalisco", city: "Guadalajara" }), false);
});

test("la CDMX se reconoce escrita de todas las formas en que se captura", () => {
  assert.equal(isCdmxProperty({ state: "CDMX" }), true);
  assert.equal(isCdmxProperty({ state: "cdmx" }), true);
  assert.equal(isCdmxProperty({ state: "Ciudad de México" }), true);
  assert.equal(isCdmxProperty({ state: "CIUDAD DE MEXICO" }), true);
  assert.equal(isCdmxProperty({ state: "Distrito Federal" }), true);
  assert.equal(isCdmxProperty({ state: "D.F." }), true);
  // Sin estado capturado manda la ciudad…
  assert.equal(isCdmxProperty({ state: "", city: "Ciudad de México" }), true);
  // …pero un estado capturado GANA sobre un dedazo en la ciudad.
  assert.equal(isCdmxProperty({ state: "Jalisco", city: "Ciudad de México" }), false);
  assert.equal(isCdmxProperty({}), false);
});

test("normalizePlace quita acentos, puntos y espacios de más", () => {
  assert.equal(normalizePlace("  Ciudad   de  México "), "CIUDAD DE MEXICO");
  assert.equal(normalizePlace("D.F."), "D F");
  assert.equal(normalizePlace(null), "");
});

test("el tope ES la inflación del año anterior, tal cual", () => {
  assert.equal(annualIncreaseCapPct(4.21), 4.21);
  assert.equal(annualIncreaseCapPct(null), null);
  // Deflación: si los precios bajaron, la renta no puede subir. No se
  // "acomoda" a cero por conveniencia.
  assert.equal(annualIncreaseCapPct(-0.5), -0.5);
});

test("exceedsCap solo muerde por encima del tope, con margen de un centésimo", () => {
  assert.equal(exceedsCap(4.21, 4.21), false);
  assert.equal(exceedsCap(4.2, 4.21), false);
  assert.equal(exceedsCap(4.22, 4.21), true);
  assert.equal(exceedsCap(9, 4.21), true);
  // Sin INPC capturado no hay tope que aplicar: no se inventa uno.
  assert.equal(exceedsCap(9, null), false);
});

test("🔴 sin INPC capturado, un aumento en la CDMX SIGUE pidiendo confirmación", () => {
  // Esta es la reja que fallaba ABIERTA. No saber cuál es el tope no es lo
  // mismo que no tener tope — y el peor momento para no saberlo es justo
  // cuando alguien está capturando un +35 % en la Roma.
  assert.equal(needsCapAck({ cdmx: true, pct: 35, capPct: null }), true);
  assert.equal(needsCapAck({ cdmx: true, pct: 4.21, capPct: null }), true);
  // Con tope conocido, solo por encima.
  assert.equal(needsCapAck({ cdmx: true, pct: 4.22, capPct: 4.21 }), true);
  assert.equal(needsCapAck({ cdmx: true, pct: 4.21, capPct: 4.21 }), false);
  assert.equal(needsCapAck({ cdmx: true, pct: 3, capPct: 4.21 }), false);
  // Fuera de la CDMX no aplica, con o sin dato.
  assert.equal(needsCapAck({ cdmx: false, pct: 35, capPct: null }), false);
  assert.equal(needsCapAck({ cdmx: false, pct: 35, capPct: 4.21 }), false);
  // Bajar la renta o dejarla igual nunca pide nada.
  assert.equal(needsCapAck({ cdmx: true, pct: 0, capPct: null }), false);
  assert.equal(needsCapAck({ cdmx: true, pct: -5, capPct: null }), false);
  assert.equal(needsCapAck({ cdmx: true, pct: NaN, capPct: null }), false);
});

test("un fijo pactado POR ENCIMA del tope se sugiere ya recortado en la CDMX", () => {
  const s = suggestIncrease({
    rule: "FIJO",
    fixedPct: 10,
    inpcPct: 4.21,
    inpcYear: 2025,
    currentRent: 12000,
    cdmx: true,
  });
  assert.equal(s.capPct, 4.21);
  assert.equal(s.suggestedPct, 4.21); // no 10
  assert.equal(centsToNumber(s.suggestedRentCents!), 12505.2);
});

test("fuera de la CDMX el mismo fijo se respeta y no hay tope", () => {
  const s = suggestIncrease({
    rule: "FIJO",
    fixedPct: 10,
    inpcPct: 4.21,
    inpcYear: 2025,
    currentRent: 12000,
    cdmx: false,
  });
  assert.equal(s.capPct, null);
  assert.equal(s.suggestedPct, 10);
  assert.equal(centsToNumber(s.suggestedRentCents!), 13200);
});

test("sin INPC capturado la regla INPC degrada: no truena y no inventa", () => {
  const s = suggestIncrease({
    rule: "INPC",
    fixedPct: null,
    inpcPct: null,
    inpcYear: null,
    currentRent: 12000,
    cdmx: true,
  });
  assert.equal(s.suggestedPct, null);
  assert.equal(s.suggestedRentCents, null);
  assert.equal(s.missing, "INPC_SIN_CAPTURAR");
  assert.equal(s.capPct, null);
});

test("el aumento se redondea al centavo AL FINAL, no a media cuenta", () => {
  // 12 000.00 × 1.0421 = 12 505.20 exactos.
  assert.equal(applyIncreaseToCents(1_200_000, 4.21), 1_250_520);
  // 9 333.33 × 1.0421 = 9 726.263... → 9 726.26 al centavo, y no un
  // 9 726.2629999999999 arrastrado hasta la pantalla.
  assert.equal(applyIncreaseToCents(933_333, 4.21), 972_626);
  assert.equal(centsToNumber(applyIncreaseToCents(933_333, 4.21)), 9726.26);
  assert.equal(applyIncreaseToCents(1_200_000, 0), 1_200_000);
});

// ── 8. La confirmación del tope QUEDA REGISTRADA ───────────────────────
test("la confirmación por encima del tope se escribe y se vuelve a leer", () => {
  const linea = buildIncreaseAckLine({
    date: "2026-08-25",
    userId: "usr_123",
    capPct: 4.21,
    appliedPct: 9,
    reason: "El inquilino aceptó por escrito en el anexo B",
  });
  const acks = parseIncreaseAcks(linea);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].date, "2026-08-25");
  assert.equal(acks[0].userId, "usr_123");
  assert.equal(acks[0].capPct, 4.21);
  assert.equal(acks[0].appliedPct, 9);
  assert.match(acks[0].reason, /anexo B/);
});

test("editar las notas del contrato NO borra las confirmaciones", () => {
  const linea = buildIncreaseAckLine({
    date: "2026-08-25",
    userId: "usr_123",
    capPct: 4.21,
    appliedPct: 9,
    reason: "motivo",
  });
  const antes = `El inquilino paga por SPEI.\n\n${linea}`;

  // El usuario reescribe sus notas SIN la línea marcada (no la ve).
  const despues = mergeNotesPreservingAcks(antes, "Ahora paga en efectivo.", []);
  assert.match(despues!, /Ahora paga en efectivo\./);
  assert.equal(parseIncreaseAcks(despues).length, 1);
  // Y lo que ve en el cuadro de texto no lleva la marca.
  assert.equal(stripAckLines(despues), "Ahora paga en efectivo.");
});

test("un motivo con saltos de línea no rompe el parser de la marca", () => {
  const linea = buildIncreaseAckLine({
    date: "2026-08-25",
    userId: "u",
    capPct: null,
    appliedPct: 12,
    reason: "una\nlínea\notra | con pipe",
  });
  assert.equal(linea.split("\n").length, 1);
  const acks = parseIncreaseAcks(`nota del usuario\n${linea}`);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].capPct, null);
  assert.equal(acks[0].appliedPct, 12);
});

// ── 9. El folio: orden NUMÉRICO, no alfabético ─────────────────────────
test("el folio se rellena a ancho fijo para que 10 vaya después de 9", () => {
  assert.equal(formatReceiptFolio(1), "REC-000001");
  assert.equal(formatReceiptFolio(9), "REC-000009");
  assert.equal(formatReceiptFolio(10), "REC-000010");
  // Ordenado como TEXTO, el ancho fijo da el mismo orden que como número.
  const folios = [1, 2, 9, 10, 99, 100].map(formatReceiptFolio);
  assert.deepEqual([...folios].sort(), folios);
});

test("un receiptUrl que no es de este vertical no se lee como folio", () => {
  assert.equal(folioFromReceiptUrl(null), "");
  assert.equal(folioFromReceiptUrl(""), "");
  assert.equal(folioFromReceiptUrl("https://otro.com/archivo.pdf"), "");
  assert.equal(parseReceiptFolio("REC-abc"), 0);
  assert.equal(parseReceiptFolio("000123"), 0);
});
