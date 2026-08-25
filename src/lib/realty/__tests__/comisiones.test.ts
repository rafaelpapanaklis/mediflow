// ═══════════════════════════════════════════════════════════════════════
// ARITMÉTICA DEL REPARTO DE COMISIONES — la prueba que tiene que existir
// porque aquí se decide cuánto cobra cada persona.
//
// Es PURA: no necesita Postgres, ni sesión, ni navegador. Corre en medio
// segundo y cubre lo que de verdad se rompe con dinero: el centavo que
// sobra, el float que miente y el entero que se desborda.
//
//   npx tsx --test src/lib/realty/__tests__/comisiones.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bpsToPct,
  buildRanking,
  buildReceipt,
  computeSplits,
  currentPeriodKey,
  formatMinutes,
  formatMoney,
  formatPct,
  inferTemplates,
  isValidPeriodKey,
  periodKeyFor,
  periodRange,
  pctToBps,
  shiftPeriodKey,
  sumMoney,
  toCents,
  type RealtyReceiptSplitRow,
} from "@/lib/realty/commissions";

// ── EL CASO DE RAFAEL ──────────────────────────────────────────────────

test("una comisión de $150,000 repartida 40/40/20 da 60,000 / 60,000 / 30,000", () => {
  const r = computeSplits(150_000, [
    { key: "a", party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 40 },
    { key: "b", party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 40 },
    { key: "c", party: "OFICINA", mode: "PCT", pct: 20 },
  ]);

  assert.equal(r.valid, true, r.problems.map((p) => p.message).join(" · "));
  assert.deepEqual(
    r.rows.map((x) => x.amount),
    [60_000, 60_000, 30_000],
  );
  assert.equal(r.differenceCents, 0);
  assert.equal(r.assignedCents, 15_000_000);
  assert.equal(r.totalBps, 10_000);
});

// ── El centavo que sobra ───────────────────────────────────────────────

test("33.33 + 33.33 + 33.34 de $100 suma EXACTAMENTE $100", () => {
  const r = computeSplits(100, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 33.33 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 33.33 },
    { party: "OFICINA", mode: "PCT", pct: 33.34 },
  ]);
  assert.equal(r.valid, true);
  assert.equal(r.assignedCents, 10_000);
  assert.equal(
    r.rows.reduce((a, x) => a + x.amountCents, 0),
    10_000,
  );
});

test("tres tercios exactos de $100 reparten el centavo que sobra, no lo pierden", () => {
  // 33.33% × 3 = 99.99%: NO cierra, y el motor lo tiene que decir en pesos.
  const noCierra = computeSplits(100, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 33.33 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 33.33 },
    { party: "OFICINA", mode: "PCT", pct: 33.33 },
  ]);
  assert.equal(noCierra.valid, false);
  assert.equal(noCierra.differenceCents, 1);
  assert.match(noCierra.problems.map((p) => p.message).join(" "), /Falta repartir/);

  // Con el 100% completo, el residuo de la división entera se entrega y la
  // suma cuadra al centavo.
  const cierra = computeSplits(0.05, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 50 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 50 },
  ]);
  assert.equal(cierra.assignedCents, 5);
  assert.deepEqual(
    cierra.rows.map((x) => x.amountCents),
    [3, 2],
  );
});

// ── El float que miente ────────────────────────────────────────────────

test("toCents no hereda el error binario de multiplicar por 100", () => {
  assert.equal(toCents("179.99"), 17_999);
  assert.equal(toCents(179.99), 17_999);
  assert.equal(toCents("1.005"), 101); // el tercer decimal redondea el segundo
  assert.equal(toCents("$ 1,234.56"), 123_456);
  assert.equal(toCents(""), 0);
  assert.equal(toCents(null), 0);
  assert.equal(toCents("basura"), 0);
  assert.equal(toCents({ toString: () => "349.50" }), 34_950); // Prisma.Decimal
});

test("sumar precios en centavos no produce 539.9899999999999", () => {
  assert.equal(sumMoney([179.99, 180, 180]), 539.99);
  assert.equal(0.1 + 0.2 === 0.3, false, "el float sigue siendo float");
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
});

// ── El entero que se desborda ──────────────────────────────────────────

test("una comisión enorme no se sale del entero seguro (por eso el producto va en BigInt)", () => {
  // 900 millones de comisión = 9e10 centavos. Por 10 000 puntos base son
  // 9e14... y con dos partes más, el cálculo intermedio en Number empieza a
  // perder precisión. El motor usa BigInt, así que tiene que cuadrar exacto.
  const r = computeSplits(900_000_000, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 33.33 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 33.33 },
    { party: "OFICINA", mode: "PCT", pct: 33.34 },
  ]);
  assert.equal(r.valid, true);
  assert.equal(r.assignedCents, 90_000_000_000);
  assert.equal(
    r.rows.reduce((a, x) => a + x.amountCents, 0),
    90_000_000_000,
  );
});

// ── Montos fijos y mezclas ─────────────────────────────────────────────

test("un monto fijo se toma tal cual y el porcentaje efectivo se deriva de él", () => {
  const r = computeSplits(100_000, [
    { party: "EXTERNO", externalName: "Otra inmobiliaria", mode: "AMOUNT", amount: 25_000 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 75 },
  ]);
  assert.equal(r.valid, true);
  assert.equal(r.rows[0].amount, 25_000);
  assert.equal(r.rows[0].pct, 25, "el % de una parte por monto se deriva del importe");
  assert.equal(r.rows[1].amount, 75_000);
});

test("los porcentajes se calculan sobre la comisión COMPLETA, no sobre lo que sobra", () => {
  // Si el 40% se calculara sobre el remanente tras el monto fijo, esto
  // "cerraría" y estaría mal: 40% de 100,000 son 40,000, no 24,000.
  const r = computeSplits(100_000, [
    { party: "EXTERNO", externalName: "Fuera", mode: "AMOUNT", amount: 40_000 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 40 },
  ]);
  assert.equal(r.rows[1].amount, 40_000);
  assert.equal(r.valid, false);
  assert.equal(r.differenceCents, 2_000_000, "faltan $20,000 por repartir");
});

test("pasarse de la comisión se rechaza y se dice de cuánto", () => {
  const r = computeSplits(10_000, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 60 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 60 },
  ]);
  assert.equal(r.valid, false);
  // 60% + 60% = 120% → se repartieron $12,000 de una comisión de $10,000.
  // differenceCents va en CENTAVOS: $2,000 de más son -200,000.
  assert.equal(r.differenceCents, -200_000);
  assert.equal(r.difference, -2_000);
  assert.match(r.problems.map((p) => p.message).join(" "), /Te pasaste por/);
});

// ── Validaciones que evitan filas anónimas ─────────────────────────────

test("una parte sin usuario y sin nombre no se puede guardar", () => {
  const r = computeSplits(1000, [{ party: "COLOCADOR", mode: "PCT", pct: 100 }]);
  assert.equal(r.valid, false);
  assert.equal(r.problems.some((p) => p.code === "FALTA_NOMBRE_EXTERNO"), true);
  assert.equal(r.problems.find((p) => p.code === "FALTA_NOMBRE_EXTERNO")?.index, 0);
});

test("la parte de la oficina no se le asigna a una persona", () => {
  const r = computeSplits(1000, [
    { party: "OFICINA", realtyUserId: "u1", mode: "PCT", pct: 100 },
  ]);
  assert.equal(r.problems.some((p) => p.code === "USUARIO_EN_PARTE_DE_CASA"), true);
  // Y aun así el importe se calcula: la fila se pinta, solo no se guarda.
  assert.equal(r.rows[0].amount, 1000);
  assert.equal(r.rows[0].realtyUserId, null);
});

test("sin comisión capturada no hay nada que repartir", () => {
  const r = computeSplits(0, [
    { party: "COLOCADOR", realtyUserId: "u1", mode: "PCT", pct: 100 },
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.problems.some((p) => p.code === "SIN_COMISION"), true);
});

test("un porcentaje fuera de rango se rechaza", () => {
  const r = computeSplits(1000, [
    { party: "COLOCADOR", realtyUserId: "u1", mode: "PCT", pct: 140 },
  ]);
  assert.equal(r.problems.some((p) => p.code === "PCT_FUERA_DE_RANGO"), true);
});

// ── Lo que encontraron los revisores ───────────────────────────────────

test("un importe absurdo NO lanza: computeSplits prometió no lanzar nunca", () => {
  // "1e307" pasa el Number.isFinite, pero ×100 se desborda a Infinity y
  // BigInt(Infinity) LANZA un RangeError. Tumbaba el editor de reparto en
  // pleno render y devolvía 500 en vez de 400. El input es texto libre.
  assert.equal(toCents("1e307"), 0);
  assert.equal(toCents("1e308"), 0);
  assert.equal(toCents(1e307), 0);
  assert.doesNotThrow(() =>
    computeSplits("1e307", [
      { party: "COLOCADOR", realtyUserId: "u1", mode: "AMOUNT", amount: "1e307" },
    ]),
  );
  const r = computeSplits(1000, [
    { party: "COLOCADOR", realtyUserId: "u1", mode: "AMOUNT", amount: "1e307" },
  ]);
  assert.equal(r.valid, false);
  // Un importe fuera del entero seguro no es dinero: cuenta como 0.
  assert.equal(r.rows[0].amount, 0);
});

test("toCents no devuelve -0 (formatMoney lo imprimiría como «-$0.00»)", () => {
  assert.equal(Object.is(toCents("-"), -0), false);
  assert.equal(toCents("-"), 0);
  assert.equal(toCents("-0.00"), 0);
  assert.equal(formatMoney(toCents("-")), formatMoney(0));
});

test("el signo es simétrico: toCents(-x) === -toCents(x)", () => {
  for (const v of ["1.005", "0.125", "179.99", "12.3456789"]) {
    assert.equal(toCents(`-${v}`), -toCents(v), `falla con ${v}`);
  }
});

test("🔴 partes por MONTO: si el dinero cierra, los porcentajes suman 100 EXACTO", () => {
  // Tres partes de $1.00 sobre una comisión de $3.00. Truncando daba 33.33
  // ×3 = 99.99% con el palomeo verde de "cierra al 100%" al lado.
  const r = computeSplits(3, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "AMOUNT", amount: 1 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "AMOUNT", amount: 1 },
    { party: "OFICINA", mode: "AMOUNT", amount: 1 },
  ]);
  assert.equal(r.valid, true, r.problems.map((p) => p.message).join(" · "));
  assert.equal(r.differenceCents, 0);
  assert.equal(r.totalBps, 10_000, "el % de la barra tiene que decir 100, no 99.99");
  assert.equal(r.rows.reduce((a, x) => a + pctToBps(x.pct), 0), 10_000);

  // El otro caso del revisor: $7 repartido en $1 y $6.
  const r2 = computeSplits(7, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "AMOUNT", amount: 1 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "AMOUNT", amount: 6 },
  ]);
  assert.equal(r2.valid, true);
  assert.equal(r2.totalBps, 10_000);
});

test("el 40/40/20 sigue enseñando 40/40/20 aunque el % ahora salga del importe", () => {
  const r = computeSplits(150_000, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 40 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 40 },
    { party: "OFICINA", mode: "PCT", pct: 20 },
  ]);
  assert.deepEqual(r.rows.map((x) => x.pct), [40, 40, 20]);
  assert.deepEqual(r.rows.map((x) => x.amount), [60_000, 60_000, 30_000]);
  assert.equal(r.totalBps, 10_000);
});

test("un reparto que NO cierra no finge un 100%", () => {
  const r = computeSplits(100, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "AMOUNT", amount: 30 },
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.totalBps, 3_000, "30 de 100 son 30%, y así se tiene que ver");
});

test("🔴 formatPct NO recorta al 100%: pasarse tiene que verse", () => {
  // Recortar era mentir justo cuando más importa: la barra decía "100%"
  // mientras el chip de dinero decía "sobran $500".
  assert.equal(formatPct(150), "150%");
  assert.equal(formatPct(133.33), "133.33%");
  assert.equal(formatPct(40), "40%");
  assert.equal(formatPct(33.33), "33.33%");
  assert.equal(formatPct(0), "0%");

  const r = computeSplits(1000, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "PCT", pct: 50 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "PCT", pct: 50 },
    { party: "OFICINA", mode: "PCT", pct: 50 },
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.totalBps, 15_000);
  assert.equal(formatPct(r.totalBps / 100), "150%");
});

test("una sola parte del 200% no se cuenta como 100%", () => {
  // pctToBps recorta cada fila a 100 (valida lo tecleado). Sumar el total con
  // él hacía que esta fila contara 100% y la barra dijera "100%" mientras el
  // chip decía "sobran $100".
  const r = computeSplits(100, [
    { party: "COLOCADOR", realtyUserId: "u1", mode: "AMOUNT", amount: 200 },
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.differenceCents, -10_000, "sobran $100");
  assert.equal(r.totalBps, 20_000, "y eso son 200%, no 100%");
  assert.equal(formatPct(r.totalBps / 100), "200%");
});

test("una plantilla capturada por MONTO sí se reconoce como plantilla", () => {
  // Consecuencia en cadena del truncamiento: el pct que se guardaba no sumaba
  // 100 e inferTemplates descartaba el reparto en silencio.
  const r = computeSplits(3, [
    { party: "CAPTADOR", realtyUserId: "u1", mode: "AMOUNT", amount: 1 },
    { party: "COLOCADOR", realtyUserId: "u2", mode: "AMOUNT", amount: 1 },
    { party: "OFICINA", mode: "AMOUNT", amount: 1 },
  ]);
  const guardado = r.rows.map((x) => ({ dealId: "d1", party: x.party, pct: x.pct }));
  const plantillas = inferTemplates(guardado);
  assert.equal(plantillas[0].timesUsed, 1, "el reparto guardado tiene que sumar 100 y contar");
});

// ── Puntos base ────────────────────────────────────────────────────────

test("los porcentajes viven en puntos base para no comparar floats", () => {
  assert.equal(pctToBps(40), 4000);
  assert.equal(pctToBps("33.33"), 3333);
  assert.equal(pctToBps(100), 10_000);
  assert.equal(pctToBps(140), 10_000, "se recorta al 100%");
  assert.equal(pctToBps(-5), 0);
  assert.equal(bpsToPct(4050), 40.5);
});

// ── Plantillas deducidas del historial ─────────────────────────────────

test("las plantillas salen de los repartos que la cuenta YA usó, más usados primero", () => {
  const historial = [
    // 40/40/20 dos veces
    { dealId: "d1", party: "CAPTADOR" as const, pct: 40 },
    { dealId: "d1", party: "COLOCADOR" as const, pct: 40 },
    { dealId: "d1", party: "OFICINA" as const, pct: 20 },
    { dealId: "d2", party: "CAPTADOR" as const, pct: 40 },
    { dealId: "d2", party: "COLOCADOR" as const, pct: 40 },
    { dealId: "d2", party: "OFICINA" as const, pct: 20 },
    // 50/50 una vez
    { dealId: "d3", party: "CAPTADOR" as const, pct: 50 },
    { dealId: "d3", party: "COLOCADOR" as const, pct: 50 },
    // Uno a medias: NO es plantilla
    { dealId: "d4", party: "COLOCADOR" as const, pct: 60 },
  ];
  const t = inferTemplates(historial);
  assert.equal(t[0].timesUsed, 2);
  assert.equal(t[0].label, "40 / 40 / 20");
  assert.equal(t[1].timesUsed, 1);
  assert.equal(t[1].label, "50 / 50");
  assert.equal(
    t.some((x) => x.parts.length === 1 && x.parts[0].pct === 60),
    false,
    "un reparto que no suma 100% no es una plantilla",
  );
  // Los presets de fábrica rellenan detrás, sin duplicar los propios.
  assert.equal(t.filter((x) => x.suggested).length > 0, true);
  assert.equal(new Set(t.map((x) => x.id)).size, t.length, "sin plantillas repetidas");
});

// ── Recibo por periodo ─────────────────────────────────────────────────

function fila(over: Partial<RealtyReceiptSplitRow>): RealtyReceiptSplitRow {
  return {
    splitId: "s1",
    dealId: "d1",
    dealKind: "VENTA",
    dealStatus: "CERRADO",
    closedAt: "2026-08-10T18:00:00.000Z",
    propertyTitle: "Casa en Providencia",
    party: "COLOCADOR",
    realtyUserId: "u1",
    beneficiary: "Ana López",
    pct: 40,
    amount: 60_000,
    paidAt: null,
    ...over,
  };
}

test("el recibo separa devengado, pagado y lo que sigue en proceso", () => {
  const r = buildReceipt("2026-08-01", "2026-09-01", [
    fila({ splitId: "s1", amount: 60_000, paidAt: null }),
    fila({ splitId: "s2", dealId: "d2", amount: 40_000, paidAt: "2026-08-20T18:00:00.000Z" }),
    fila({ splitId: "s3", dealId: "d3", dealStatus: "EN_PROCESO", closedAt: null, amount: 15_000 }),
    // Una cancelada no suma en NINGUNA columna.
    fila({ splitId: "s4", dealId: "d4", dealStatus: "CANCELADO", amount: 99_999 }),
  ]);

  assert.equal(r.lines.length, 1);
  const linea = r.lines[0];
  assert.equal(linea.earned, 100_000, "devengado = solo lo CERRADO");
  assert.equal(linea.paid, 40_000);
  assert.equal(linea.pending, 60_000);
  assert.equal(linea.inProgress, 15_000, "en proceso no se devenga");
  assert.equal(linea.operations, 2, "dos operaciones cerradas distintas");
  assert.equal(r.totalEarned, 100_000);
  assert.equal(r.totalPending, 60_000);
});

test("el recibo agrupa la oficina aparte de las personas y ordena por lo que más se debe", () => {
  const r = buildReceipt("2026-08-01", "2026-09-01", [
    fila({ splitId: "s1", realtyUserId: "u1", beneficiary: "Ana", amount: 10_000 }),
    fila({ splitId: "s2", realtyUserId: "u2", beneficiary: "Beto", amount: 50_000 }),
    fila({ splitId: "s3", realtyUserId: null, party: "OFICINA", beneficiary: "La oficina", amount: 30_000 }),
    fila({ splitId: "s4", realtyUserId: null, party: "OFICINA", beneficiary: "La oficina", dealId: "d2", amount: 5_000 }),
  ]);
  assert.deepEqual(
    r.lines.map((l) => l.beneficiary),
    ["Beto", "La oficina", "Ana"],
  );
  assert.equal(r.lines[1].earned, 35_000, "las dos partes de la oficina se suman en una línea");
});

// ── Ranking ────────────────────────────────────────────────────────────

test("el ranking ordena por comisión ganada y usa la MEDIANA para la primera respuesta", () => {
  const rows = buildRanking([
    {
      realtyUserId: "u1",
      name: "Ana",
      active: true,
      closedDeals: 2,
      closedVolume: 5_000_000,
      earnedCommission: 120_000,
      inProgressDeals: 1,
      inProgressCommission: 30_000,
      leads: 10,
      leadsWon: 2,
      // Un prospecto contestado 3 días después (4320 min) desviaría la media
      // a ~880; la mediana aguanta y sigue diciendo 15.
      responseMinutes: [10, 12, 15, 20, 4320],
    },
    {
      realtyUserId: "u2",
      name: "Beto",
      active: true,
      closedDeals: 3,
      closedVolume: 3_000_000,
      earnedCommission: 90_000,
      inProgressDeals: 0,
      inProgressCommission: 0,
      leads: 4,
      leadsWon: 2,
      responseMinutes: [5, 5],
    },
  ]);

  assert.deepEqual(rows.map((r) => r.name), ["Ana", "Beto"]);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].medianResponseMinutes, 15);
  assert.equal(rows[0].avgResponseMinutes, 875, "el promedio SÍ se desvía; por eso se enseña la mediana");
  assert.equal(rows[0].conversionPct, 20);
  assert.equal(rows[0].unanswered, 5, "10 prospectos, 5 contestados");
  assert.equal(rows[1].conversionPct, 50);
});

test("un asesor sin prospectos no divide entre cero", () => {
  const rows = buildRanking([
    {
      realtyUserId: "u1",
      name: "Nuevo",
      active: true,
      closedDeals: 0,
      closedVolume: 0,
      earnedCommission: 0,
      inProgressDeals: 0,
      inProgressCommission: 0,
      leads: 0,
      leadsWon: 0,
      responseMinutes: [],
    },
  ]);
  assert.equal(rows[0].conversionPct, 0);
  assert.equal(rows[0].medianResponseMinutes, null);
  assert.equal(rows[0].unanswered, 0);
});

test("formatMinutes se lee como lo diría una persona", () => {
  assert.equal(formatMinutes(null), "—");
  assert.equal(formatMinutes(38), "38 min");
  assert.equal(formatMinutes(135), "2 h 15 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatMinutes(1500), "1 d 1 h");
});

// ── Periodos en la zona de la cuenta ───────────────────────────────────

test("el periodo se calcula en la zona de la cuenta, no en UTC", () => {
  // 31 de agosto, 20:00 en Cancún = 1 de septiembre 01:00 UTC. Si el corte
  // se hiciera en UTC, esa operación caería en el mes equivocado y el recibo
  // de dos asesores dejaría de cuadrar con el del mes pasado.
  const instante = new Date("2026-09-01T01:00:00.000Z");
  assert.equal(periodKeyFor(instante, "America/Cancun"), "2026-08");
  assert.equal(periodKeyFor(instante, "UTC"), "2026-09");
});

test("el rango del periodo es SEMIABIERTO y empieza a medianoche local", () => {
  const { start, end } = periodRange("2026-08", "America/Mexico_City");
  // Agosto en CDMX es UTC-6, así que la medianoche local son las 06:00 UTC.
  assert.equal(start.toISOString(), "2026-08-01T06:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(start < end, true);
});

test("diciembre pasa a enero del año siguiente", () => {
  assert.equal(shiftPeriodKey("2026-12", 1), "2027-01");
  assert.equal(shiftPeriodKey("2027-01", -1), "2026-12");
  const { end } = periodRange("2026-12", "America/Mexico_City");
  assert.equal(end.toISOString().slice(0, 7), "2027-01");
});

test("un periodo inválido no revienta: cae al mes en curso", () => {
  assert.equal(isValidPeriodKey("2026-13"), false);
  assert.equal(isValidPeriodKey("2026-08"), true);
  assert.equal(isValidPeriodKey(null), false);
  const actual = currentPeriodKey("America/Mexico_City");
  const { start } = periodRange("basura", "America/Mexico_City");
  assert.equal(periodKeyFor(start, "America/Mexico_City"), actual);
});

test("una zona horaria inválida no tumba la pantalla", () => {
  assert.equal(isValidPeriodKey(periodKeyFor(new Date("2026-08-15T12:00:00Z"), "Marte/Olimpo")), true);
});
