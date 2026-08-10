/**
 * Tests unitarios de los BONOS POR RED de afiliados.
 *
 * Run: npm run test:bonos-red
 *
 * POR QUÉ ESTE ARCHIVO EXISTE. A diferencia del "Bono por Clínicas Activas"
 * —que es una promesa comercial con seguimiento manual—, estos bonos los otorga
 * y los PAGA una máquina: un cron mensual que escribe comisiones reales por
 * decenas o cientos de miles de pesos. El punto exacto donde un bug cuesta
 * dinero que ya no vuelve es la IDEMPOTENCIA del barrido, y por eso el cerebro
 * del cron (`decideNetworkSweep`) es una función pura: se puede martillear sin
 * base de datos.
 *
 * Foco crítico:
 *  - Alcanzar un escalón NO paga: nace `pending_choice` y ahí se queda hasta
 *    que el afiliado elige. Un plan de acciones que emita un pago sobre un
 *    award sin elección le entrega dinero que todavía no decidió cómo cobrar.
 *  - El cron corriendo DOS VECES el mismo mes no puede pagar dos veces. El
 *    candado duro es el índice único de affiliate_commissions."stripeInvoiceId",
 *    así que aquí se prueban las dos mitades: que la referencia del mes sea
 *    determinista (misma entrada → misma cadena, o el índice no choca) y que el
 *    filtro por `lastMonthlyKey` no vuelva a emitir el pago.
 *  - `once_paid` está cerrado PARA SIEMPRE: una segunda comisión sobre un pago
 *    único es dinero duplicado sin contraparte.
 *  - Pausa y reactivación son simétricas y NO cuestan un nuevo periodo de 3
 *    meses: el trato publicado es "mientras sostengas".
 *  - Los montos se CONGELAN al otorgar: editar la config después no puede mover
 *    lo que ya se prometió.
 *
 * Ni un umbral ni un monto se escriben a mano en las aserciones sin pasar antes
 * por una config explícita: si el motor tuviera un número tecleado dentro,
 * cambiar la config no cambiaría el resultado y estos tests lo verían.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NETWORK_BONUS,
  MIN_PAID_INVOICES,
  NETWORK_BONUS_KIND,
  NETWORK_TIER_KEYS,
  SUSTAIN_MONTHS,
  buildNetworkBonusView,
  commissionRefMonthly,
  commissionRefOnce,
  compareChoices,
  decideNetworkSweep,
  isSustained,
  monthsElapsed,
  monthsLeftToAward,
  networkBonusTiers,
  normalizeAwardStatus,
  normalizeChoice,
  normalizeNetworkBonus,
  periodKey,
  type AwardSnapshot,
  type NetworkBonusConfig,
  type NetworkBonusTier,
  type NetworkSweepAction,
} from "./network-bonus-core";
import { clinicQualifies } from "./qualifying-clinic";

// ── Utilería de los tests ─────────────────────────────────────────────────

/** Config de prueba con números DISTINTOS a los defaults: si el motor tuviera
 *  un umbral tecleado dentro, estos tests fallarían. */
const CFG: NetworkBonusConfig = {
  networkBonusEnabled: true,
  networkTier1Clinics: 4,
  networkTier1OnceMxn: 2000,
  networkTier1MonthlyMxn: 250,
  networkTier2Clinics: 10,
  networkTier2OnceMxn: 8000,
  networkTier2MonthlyMxn: 1000,
  networkTier3Clinics: 30,
  networkTier3OnceMxn: 24000,
  networkTier3MonthlyMxn: 3000,
  networkTier4Clinics: 100,
  networkTier4OnceMxn: 90000,
  networkTier4MonthlyMxn: 10000,
  networkTier5Clinics: 300,
  networkTier5OnceMxn: 300000,
  networkTier5MonthlyMxn: 40000,
};

const TIERS: NetworkBonusTier[] = networkBonusTiers(CFG);

/** Fecha UTC cómoda: el cron corre el día 1. */
function utc(y: number, m: number, d = 1): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** Award de prueba con los valores del escalón `tier` de CFG. */
function award(over: Partial<AwardSnapshot> & { tier: number }): AwardSnapshot {
  const t = TIERS.find((x) => x.n === over.tier)!;
  return {
    id: `award-${over.tier}`,
    tier: over.tier,
    status: "tracking",
    clinics: t.clinics,
    onceMxn: t.onceMxn,
    monthlyMxn: t.monthlyMxn,
    qualifiedSince: null,
    lastMonthlyKey: null,
    lastCount: 0,
    ...over,
  };
}

/** Acciones de un tipo concreto en un plan. */
function only<T extends NetworkSweepAction["type"]>(
  actions: NetworkSweepAction[],
  type: T,
): Extract<NetworkSweepAction, { type: T }>[] {
  return actions.filter((a) => a.type === type) as Extract<NetworkSweepAction, { type: T }>[];
}

// ── 1. QUÉ CUENTA: el predicado ÚNICO ─────────────────────────────────────

test("clínica que califica: 2 mensualidades NO cuentan y 3 SÍ", () => {
  // La cláusula publicada dice "al menos 3 mensualidades pagadas". Una clínica
  // con 2 que entrara al conteo adelantaría un bono de decenas de miles.
  assert.equal(MIN_PAID_INVOICES, 3);
  assert.equal(clinicQualifies(0), false);
  assert.equal(clinicQualifies(1), false);
  assert.equal(clinicQualifies(2), false, "2 mensualidades NO pueden calificar");
  assert.equal(clinicQualifies(3), true, "3 mensualidades SÍ califican");
  assert.equal(clinicQualifies(99), true);
  // Nulos y basura degradan a "no califica", nunca a "sí".
  assert.equal(clinicQualifies(null), false);
  assert.equal(clinicQualifies(undefined), false);
  assert.equal(clinicQualifies(Number.NaN), false);
});

test("los bonos de red usan EL MISMO predicado, no una copia", async () => {
  // Si alguien volviera a declarar `clinicQualifies`/`MIN_PAID_INVOICES` en
  // otro módulo, este test seguiría pasando pero la identidad de referencia
  // rompería: es exactamente la duplicación que se quiere impedir.
  const core = await import("./network-bonus-core");
  const milestones = await import("./qualifying-clinic");
  assert.equal(core.MIN_PAID_INVOICES, milestones.MIN_PAID_INVOICES);
  assert.equal(core.MIN_PAID_INVOICES, MIN_PAID_INVOICES);
});

// ── 2. La config manda: ni un umbral tecleado ─────────────────────────────

test("networkBonusTiers ordena por umbral y descarta lo inutilizable", () => {
  const tiers = networkBonusTiers(CFG);
  assert.deepEqual(
    tiers.map((t) => t.clinics),
    [4, 10, 30, 100, 300],
    "los escalones salen de la CONFIG, no de los defaults",
  );
  // Un escalón con los DOS montos en 0 se apaga sin apagar los otros cuatro.
  const apagado = networkBonusTiers({ ...CFG, networkTier2OnceMxn: 0, networkTier2MonthlyMxn: 0 });
  assert.equal(apagado.length, 4);
  assert.equal(apagado.find((t) => t.clinics === 10), undefined);
  // Con un solo monto en 0 SÍ sale: es "solo pago único" / "solo mensual".
  const soloUnico = networkBonusTiers({ ...CFG, networkTier2MonthlyMxn: 0 });
  assert.equal(soloUnico.length, 5);
  assert.equal(soloUnico.find((t) => t.clinics === 10)!.monthlyMxn, 0);
  // Umbral en 0 = escalón sin sentido.
  assert.equal(networkBonusTiers({ ...CFG, networkTier1Clinics: 0 }).length, 4);
});

test("normalizeNetworkBonus rellena huecos con los defaults del DDL y nunca lanza", () => {
  const vacio = normalizeNetworkBonus(null);
  assert.deepEqual(vacio, DEFAULT_NETWORK_BONUS);
  // Un campo basura cae a su default, no a 0 ni a NaN: un 0 silencioso apagaría
  // un escalón sin que nadie lo pidiera.
  const roto = normalizeNetworkBonus({ networkTier3OnceMxn: Number.NaN } as never);
  assert.equal(roto.networkTier3OnceMxn, DEFAULT_NETWORK_BONUS.networkTier3OnceMxn);
  // El interruptor solo se apaga con un `false` explícito.
  assert.equal(normalizeNetworkBonus({}).networkBonusEnabled, true);
  assert.equal(normalizeNetworkBonus({ networkBonusEnabled: false }).networkBonusEnabled, false);
  // Las 16 columnas están cubiertas por NETWORK_TIER_KEYS + el switch.
  assert.equal(NETWORK_TIER_KEYS.length * 3 + 1, 16);
});

// ── 3. La comparación entre las dos formas de cobro ───────────────────────

test("compareChoices calcula los meses de cruce, nunca los teclea", () => {
  // Cociente ENTERO: iguala en el 8, supera en el 9. Decirlo mal le vende mejor
  // una de las dos modalidades sobre una elección irreversible.
  const exacto = compareChoices(8000, 1000);
  assert.equal(exacto.monthsToMatch, 8);
  assert.equal(exacto.monthsToBeat, 9);
  assert.equal(exacto.monthlyYearlyMxn, 12000);
  assert.equal(exacto.bothAvailable, true);

  // Cociente NO entero: iguala y supera en el mismo mes.
  const roto = compareChoices(7300, 1000);
  assert.equal(roto.monthsToMatch, 8);
  assert.equal(roto.monthsToBeat, 8);

  // Con una sola modalidad no hay comparación posible: nulls, no ceros que la
  // UI pintaría como "0 meses".
  const solo = compareChoices(5000, 0);
  assert.equal(solo.bothAvailable, false);
  assert.equal(solo.monthsToMatch, null);
  assert.equal(solo.monthsToBeat, null);
});

// ── 4. El reloj de los meses sostenidos ───────────────────────────────────

test("monthsElapsed cuenta meses de CALENDARIO y redondea hacia abajo", () => {
  // Del 15 de enero al 14 de febrero van 0 meses; al 15, 1.
  assert.equal(monthsElapsed(utc(2026, 1, 15), utc(2026, 2, 14)), 0);
  assert.equal(monthsElapsed(utc(2026, 1, 15), utc(2026, 2, 15)), 1);
  assert.equal(monthsElapsed(utc(2026, 1, 1), utc(2026, 4, 1)), 3);
  assert.equal(monthsElapsed(utc(2025, 11, 1), utc(2026, 2, 1)), 3, "cruza el año");
  // Hacia atrás o sin fecha: 0, jamás un negativo que adelantaría un bono.
  assert.equal(monthsElapsed(utc(2026, 5, 1), utc(2026, 1, 1)), 0);
  assert.equal(monthsElapsed(null, utc(2026, 1, 1)), 0);
});

test("isSustained exige los SUSTAIN_MONTHS completos", () => {
  const desde = utc(2026, 1, 1);
  assert.equal(SUSTAIN_MONTHS, 3);
  assert.equal(isSustained(desde, utc(2026, 3, 1)), false, "2 meses no bastan");
  assert.equal(isSustained(desde, utc(2026, 4, 1)), true, "3 meses sí");
  assert.equal(monthsLeftToAward(desde, utc(2026, 2, 1)), 2);
  assert.equal(monthsLeftToAward(desde, utc(2026, 4, 1)), 0);
  assert.equal(isSustained(null, utc(2026, 4, 1)), false, "sin racha no se otorga");
});

test("periodKey es UTC y estable a los lados de la medianoche", () => {
  assert.equal(periodKey(new Date(Date.UTC(2026, 8, 1, 0, 0, 0))), "2026-09");
  assert.equal(periodKey(new Date(Date.UTC(2026, 8, 30, 23, 59, 59))), "2026-09");
  // El mes se rellena a dos dígitos: "2026-9" y "2026-09" serían DOS candados
  // distintos sobre el mismo mes.
  assert.equal(periodKey(utc(2026, 1, 1)), "2026-01");
});

// ── 5. El ciclo de vida: alcanzar NO es cobrar ────────────────────────────

test("llegar al umbral por primera vez arranca la racha y NO paga nada", () => {
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [], now: utc(2026, 1) });
  // Alcanza el escalón de 4 y el de 10: los dos arrancan (son acumulables).
  const started = only(actions, "start-tracking");
  assert.equal(started.length, 2);
  assert.deepEqual(started.map((a) => a.clinics).sort((x, y) => x - y), [4, 10]);
  // Y NADA de dinero en la primera pasada.
  assert.equal(only(actions, "award").length, 0);
  assert.equal(only(actions, "pay-monthly").length, 0);
});

test("cumplidos los 3 meses se OTORGA, pero seguir otorgado NO paga", () => {
  const enRacha = award({ tier: 2, status: "tracking", qualifiedSince: utc(2026, 1), lastCount: 10 });

  // A los 2 meses todavía no.
  const antes = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [enRacha], now: utc(2026, 3) });
  assert.equal(only(antes, "award").length, 0);
  assert.equal(only(antes, "refresh-tracking").length, 1);

  // A los 3, sí.
  const justo = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [enRacha], now: utc(2026, 4) });
  const otorgado = only(justo, "award");
  assert.equal(otorgado.length, 1);
  assert.equal(otorgado[0].tier, 2);
  assert.equal(otorgado[0].onceMxn, 8000);
  assert.equal(otorgado[0].monthlyMxn, 1000);

  // ⚠️ EL PUNTO DEL PROGRAMA: otorgar NO es pagar.
  assert.equal(only(justo, "pay-monthly").length, 0, "otorgar no puede generar un pago");
});

test("un award en pending_choice NO paga por más corridas que pasen", () => {
  const esperando = award({ tier: 2, status: "pending_choice", lastCount: 10 });
  for (const mes of [5, 6, 7, 8, 9]) {
    const actions = decideNetworkSweep({
      count: 10,
      tiers: TIERS,
      awards: [esperando],
      now: utc(2026, mes),
    });
    assert.equal(
      only(actions, "pay-monthly").length,
      0,
      `mes ${mes}: mientras no elija no se paga NADA`,
    );
    assert.equal(only(actions, "award").length, 0, "y no se vuelve a otorgar");
  }
});

test("pending_choice NO se revoca si su red se cae: ya se ganó", () => {
  const esperando = award({ tier: 2, status: "pending_choice", lastCount: 10 });
  const actions = decideNetworkSweep({
    count: 0,
    tiers: TIERS,
    awards: [esperando],
    now: utc(2026, 6),
  });
  // Solo se anota el nuevo conteo observado; el bono sigue en pie.
  assert.deepEqual(actions.map((a) => a.type), ["touch"]);
});

// ── 6. EL CANDADO: el cron dos veces el mismo mes ─────────────────────────

test("la referencia de la mensualidad es determinista (el candado del índice único)", () => {
  // Misma entrada → misma cadena. Si variara (un timestamp, un random), el
  // índice único de affiliate_commissions NUNCA chocaría y el cron pagaría dos
  // veces sin que nada lo detuviera.
  assert.equal(commissionRefMonthly("abc", "2026-09"), "netbonus:abc:2026-09");
  assert.equal(commissionRefMonthly("abc", "2026-09"), commissionRefMonthly("abc", "2026-09"));
  // Meses distintos → candados distintos (si no, el segundo mes no se pagaría).
  assert.notEqual(commissionRefMonthly("abc", "2026-09"), commissionRefMonthly("abc", "2026-10"));
  // Awards distintos → candados distintos.
  assert.notEqual(commissionRefMonthly("abc", "2026-09"), commissionRefMonthly("xyz", "2026-09"));
  // El pago único tiene su propio candado, para siempre.
  assert.equal(commissionRefOnce("abc"), "netbonus:abc:once");
  assert.notEqual(commissionRefOnce("abc"), commissionRefMonthly("abc", "2026-09"));
  assert.equal(NETWORK_BONUS_KIND, "network_bonus");
});

test("EL CANDADO: correr el cron dos veces el mismo mes no emite un segundo pago", () => {
  const now = utc(2026, 9);
  const key = periodKey(now);
  const activo = award({ tier: 2, status: "monthly_active", lastMonthlyKey: null, lastCount: 10 });
  // Con 10 clínicas también está por encima del escalón de 4, que en un
  // afiliado real ya estaría cobrado hace tiempo. Va en la foto para que las
  // aserciones de "no se escribe nada" midan el barrido completo del afiliado y
  // no un escalón suelto.
  const previo = award({ tier: 1, status: "once_paid", lastCount: 10 });

  // Primera corrida del mes: paga.
  const primera = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [previo, activo], now });
  const pagos = only(primera, "pay-monthly");
  assert.equal(pagos.length, 1, "solo el escalón mensual cobra; el único ya está cerrado");
  assert.equal(pagos[0].periodKey, key);
  assert.equal(pagos[0].monthlyMxn, 1000);

  // El aplicador escribe `lastMonthlyKey`. SEGUNDA corrida el MISMO mes:
  const yaPagado = { ...activo, lastMonthlyKey: key, lastCount: 10 };
  const segunda = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [previo, yaPagado], now });
  assert.equal(only(segunda, "pay-monthly").length, 0, "⚠️ NO puede pagar dos veces el mismo mes");
  // Y sin nada que anotar, tampoco escribe por escribir.
  assert.equal(segunda.length, 0);

  // Tercera, cuarta, décima corrida del mismo mes: igual.
  for (let i = 0; i < 10; i++) {
    assert.equal(
      only(
        decideNetworkSweep({ count: 10, tiers: TIERS, awards: [previo, yaPagado], now }),
        "pay-monthly",
      ).length,
      0,
    );
  }

  // El MES SIGUIENTE sí vuelve a pagar (si no, el mensual dejaría de serlo).
  const octubre = utc(2026, 10);
  const siguiente = decideNetworkSweep({
    count: 10,
    tiers: TIERS,
    awards: [previo, yaPagado],
    now: octubre,
  });
  const pagoOct = only(siguiente, "pay-monthly");
  assert.equal(pagoOct.length, 1);
  assert.equal(pagoOct[0].periodKey, "2026-10");
  assert.notEqual(
    commissionRefMonthly(pagoOct[0].awardId, pagoOct[0].periodKey),
    commissionRefMonthly(pagos[0].awardId, pagos[0].periodKey),
  );
});

test("el modo ÚNICO paga una sola vez: once_paid nunca vuelve a emitir nada", () => {
  const cerrado = award({ tier: 2, status: "once_paid", lastCount: 10 });
  for (const mes of [5, 6, 7, 12]) {
    const actions = decideNetworkSweep({
      count: 10,
      tiers: TIERS,
      awards: [cerrado],
      now: utc(2026, mes),
    });
    assert.equal(only(actions, "pay-monthly").length, 0, "un pago único no se repite");
    assert.equal(only(actions, "award").length, 0);
  }
  // Ni siquiera si su red sube muchísimo dentro del mismo escalón.
  const subiendo = decideNetworkSweep({
    count: 29,
    tiers: TIERS,
    awards: [cerrado],
    now: utc(2026, 7),
  });
  assert.equal(only(subiendo, "pay-monthly").length, 0);
});

// ── 7. Pausa y reactivación ───────────────────────────────────────────────

test("la red cae → PAUSADO y deja de pagar", () => {
  const activo = award({ tier: 2, status: "monthly_active", lastMonthlyKey: "2026-08", lastCount: 10 });
  const actions = decideNetworkSweep({ count: 9, tiers: TIERS, awards: [activo], now: utc(2026, 9) });
  const pausas = only(actions, "pause");
  assert.equal(pausas.length, 1);
  assert.equal(pausas[0].tier, 2);
  assert.equal(only(actions, "pay-monthly").length, 0, "un mensual pausado NO cobra");
});

test("un pausado que sigue abajo no cobra y no cuesta escrituras de más", () => {
  const pausado = award({
    tier: 2,
    status: "monthly_paused",
    lastMonthlyKey: "2026-08",
    lastCount: 9,
  });
  // El escalón de 4, que sigue alcanzado y ya está cobrado: la foto completa
  // del afiliado, para que "no se escribe nada" mida el barrido entero.
  const previo = award({ tier: 1, status: "once_paid", lastCount: 9 });

  // Mismo conteo que la última vez: no hay nada que anotar.
  const igual = decideNetworkSweep({
    count: 9,
    tiers: TIERS,
    awards: [previo, pausado],
    now: utc(2026, 10),
  });
  assert.equal(only(igual, "pay-monthly").length, 0);
  assert.equal(igual.length, 0, "sin cambios no se escribe");

  // Conteo distinto: se anota en los dos awards, pero nadie cobra.
  const cambio = decideNetworkSweep({
    count: 7,
    tiers: TIERS,
    awards: [previo, pausado],
    now: utc(2026, 10),
  });
  assert.deepEqual(cambio.map((a) => a.type), ["touch", "touch"], "solo se anota el conteo");
});

test("la red vuelve a subir → REACTIVADO, y sin repetir los 3 meses", () => {
  const pausado = award({
    tier: 2,
    status: "monthly_paused",
    lastMonthlyKey: "2026-08",
    lastCount: 9,
    // Ojo: sin racha en curso. El trato es "mientras sostengas", así que volver
    // al umbral reactiva de inmediato en vez de exigir otros 3 meses.
    qualifiedSince: null,
  });
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [pausado], now: utc(2026, 9) });
  assert.equal(only(actions, "resume").length, 1);
  const pagos = only(actions, "pay-monthly");
  assert.equal(pagos.length, 1, "al reactivarse cobra el mes en curso");
  assert.equal(pagos[0].periodKey, "2026-09");
  // Y el ORDEN importa: primero reactivar, luego pagar. Al revés, un fallo
  // entre las dos escrituras dejaría una comisión emitida sobre un award que
  // sigue marcado como pausado. Se busca por posición relativa, no por índice
  // absoluto: en el mismo barrido caben acciones de otros escalones.
  const iResume = actions.findIndex((a) => a.type === "resume");
  const iPago = actions.findIndex((a) => a.type === "pay-monthly");
  assert.ok(iResume >= 0 && iPago > iResume, "reactivar va ANTES de pagar");
});

test("reactivar el MISMO mes en que ya cobró no duplica el pago", () => {
  // Caso real: cae y vuelve dentro del mismo mes, o el cron corre dos veces.
  const pausado = award({
    tier: 2,
    status: "monthly_paused",
    lastMonthlyKey: "2026-09",
    lastCount: 9,
  });
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [pausado], now: utc(2026, 9) });
  assert.equal(only(actions, "resume").length, 1, "sí se reactiva");
  assert.equal(only(actions, "pay-monthly").length, 0, "⚠️ pero NO cobra dos veces septiembre");
});

test("caer del umbral mientras se cuenta REINICIA la racha", () => {
  const enRacha = award({ tier: 2, status: "tracking", qualifiedSince: utc(2026, 1), lastCount: 10 });
  const caida = decideNetworkSweep({ count: 3, tiers: TIERS, awards: [enRacha], now: utc(2026, 3) });
  assert.equal(only(caida, "reset-streak").length, 1);
  assert.equal(only(caida, "award").length, 0);

  // Ya reiniciado, volver al umbral arranca el reloj DE NUEVO desde hoy.
  const reiniciado = { ...enRacha, qualifiedSince: null, lastCount: 3 };
  const vuelta = decideNetworkSweep({
    count: 10,
    tiers: TIERS,
    awards: [reiniciado],
    now: utc(2026, 4),
  });
  const refresh = only(vuelta, "refresh-tracking");
  assert.equal(refresh.length, 1);
  assert.equal(refresh[0].qualifiedSince.getTime(), utc(2026, 4).getTime());
  // Y no otorga: los 3 meses se cuentan desde abril, no desde enero.
  assert.equal(only(vuelta, "award").length, 0);
});

test("un afiliado lejos del umbral no genera escrituras cada mes", () => {
  // Sin awards y sin llegar al primer escalón: el barrido no debe crear filas
  // "por si acaso" para cada afiliado del programa.
  const actions = decideNetworkSweep({ count: 2, tiers: TIERS, awards: [], now: utc(2026, 5) });
  assert.equal(actions.length, 0);
});

// ── 8. Los montos CONGELADOS ──────────────────────────────────────────────

test("editar la config NO mueve un bono ya otorgado", () => {
  // El award se otorgó con los montos viejos…
  const otorgado = award({
    tier: 2,
    status: "monthly_active",
    onceMxn: 8000,
    monthlyMxn: 1000,
    lastMonthlyKey: "2026-08",
    lastCount: 10,
  });
  // …y mientras tanto Rafael duplicó los montos en /admin.
  const nuevaCfg: NetworkBonusConfig = {
    ...CFG,
    networkTier2OnceMxn: 16000,
    networkTier2MonthlyMxn: 2000,
  };
  const actions = decideNetworkSweep({
    count: 10,
    tiers: networkBonusTiers(nuevaCfg),
    awards: [otorgado],
    now: utc(2026, 9),
  });
  const pagos = only(actions, "pay-monthly");
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].monthlyMxn, 1000, "⚠️ se paga lo CONGELADO, no lo vigente");
});

test("un award en tracking SÍ sigue los montos vivos (aún no se prometió nada)", () => {
  const enRacha = award({
    tier: 2,
    status: "tracking",
    onceMxn: 8000,
    monthlyMxn: 1000,
    qualifiedSince: utc(2026, 1),
    lastCount: 10,
  });
  const nuevaCfg: NetworkBonusConfig = { ...CFG, networkTier2OnceMxn: 16000 };
  const actions = decideNetworkSweep({
    count: 10,
    tiers: networkBonusTiers(nuevaCfg),
    awards: [enRacha],
    now: utc(2026, 4),
  });
  const otorgado = only(actions, "award");
  assert.equal(otorgado.length, 1);
  assert.equal(otorgado[0].onceMxn, 16000, "al otorgar se congela lo VIGENTE en ese instante");
});

// ── 9. Escalones acumulables, cada uno con su vida ────────────────────────

test("los escalones son independientes: uno cobrado no bloquea al siguiente", () => {
  const now = utc(2026, 9);
  const awards: AwardSnapshot[] = [
    award({ tier: 1, status: "once_paid", lastCount: 10 }),
    award({ tier: 2, status: "monthly_active", lastMonthlyKey: null, lastCount: 10 }),
  ];
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards, now });
  // El de 4 está cerrado; el de 10 cobra su mes.
  const pagos = only(actions, "pay-monthly");
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].tier, 2);
});

test("subir de golpe arranca TODOS los escalones alcanzados a la vez", () => {
  const actions = decideNetworkSweep({ count: 120, tiers: TIERS, awards: [], now: utc(2026, 2) });
  const started = only(actions, "start-tracking");
  assert.deepEqual(
    started.map((a) => a.clinics).sort((x, y) => x - y),
    [4, 10, 30, 100],
    "los cuatro alcanzados; el de 300 no",
  );
  assert.equal(only(actions, "pay-monthly").length, 0);
});

// ── 10. La vista del panel ────────────────────────────────────────────────

test("buildNetworkBonusView separa lo pendiente de lo elegido y suma bien", () => {
  const now = utc(2026, 9);
  const awards: AwardSnapshot[] = [
    award({ tier: 1, status: "once_paid", lastCount: 12 }),
    award({ tier: 2, status: "pending_choice", lastCount: 12 }),
  ];
  const view = buildNetworkBonusView(12, TIERS, awards, now);

  assert.equal(view.count, 12);
  assert.equal(view.pending.length, 1);
  assert.equal(view.pending[0].n, 2);
  assert.equal(view.chosen.length, 1);
  assert.equal(view.chosen[0].n, 1);
  assert.equal(view.oncePaidMxn, 2000, "el pago único del escalón 1 de CFG");
  assert.equal(view.monthlyActiveMxn, 0, "un pending_choice NO suma a lo que cobra al mes");

  // El siguiente escalón y cuántas faltan — la frase de la barra.
  assert.equal(view.next!.clinics, 30);
  assert.equal(view.missing, 18);
});

test("la vista de un award otorgado compara SUS montos, no los vigentes", () => {
  const congelado = award({
    tier: 2,
    status: "pending_choice",
    onceMxn: 8000,
    monthlyMxn: 1000,
    lastCount: 10,
  });
  const nuevaCfg: NetworkBonusConfig = {
    ...CFG,
    networkTier2OnceMxn: 40000,
    networkTier2MonthlyMxn: 1000,
  };
  const view = buildNetworkBonusView(10, networkBonusTiers(nuevaCfg), [congelado], utc(2026, 9));
  // 8000/1000 = 8 meses, no 40000/1000 = 40: al afiliado se le enseña el cruce
  // de LO SUYO antes de una elección irreversible.
  assert.equal(view.pending[0].comparison.monthsToMatch, 8);
});

test("la vista no adelanta estados que el cron todavía no vio", () => {
  // Llega al umbral hoy, pero el barrido aún no ha corrido: no hay award.
  const view = buildNetworkBonusView(10, TIERS, [], utc(2026, 9));
  assert.equal(view.pending.length, 0);
  assert.equal(view.chosen.length, 0);
  assert.equal(view.tiers[1].reachedNow, true, "sí dice que hoy alcanza el umbral");
  assert.equal(view.tiers[1].award, null, "pero no finge una racha que nadie registró");
  assert.equal(view.tiers[1].monthsSustained, null);
});

test("con todos los escalones alcanzados no hay 'siguiente'", () => {
  const view = buildNetworkBonusView(500, TIERS, [], utc(2026, 9));
  assert.equal(view.next, null);
  assert.equal(view.missing, 0);
});

// ── 11. Normalizadores defensivos ─────────────────────────────────────────

test("normalizeAwardStatus y normalizeChoice degradan a lo SEGURO", () => {
  // Un estado desconocido cae a "tracking": el estado que NO paga. Caer a
  // "monthly_active" por un typo en la BD sería pagar sin haber otorgado.
  assert.equal(normalizeAwardStatus("monthly_active"), "monthly_active");
  assert.equal(normalizeAwardStatus("pending_choice"), "pending_choice");
  assert.equal(normalizeAwardStatus("basura"), "tracking");
  assert.equal(normalizeAwardStatus(null), "tracking");
  assert.equal(normalizeAwardStatus(undefined), "tracking");

  // La elección NO tiene default: null obliga al caller a rechazar el request
  // en vez de elegir por el afiliado sobre algo irreversible.
  assert.equal(normalizeChoice("once"), "once");
  assert.equal(normalizeChoice("monthly"), "monthly");
  assert.equal(normalizeChoice("mensual"), null);
  assert.equal(normalizeChoice(""), null);
  assert.equal(normalizeChoice(null), null);
});

test("un conteo basura no otorga nada", () => {
  for (const count of [Number.NaN, -5, Number.POSITIVE_INFINITY] as number[]) {
    const actions = decideNetworkSweep({ count, tiers: TIERS, awards: [], now: utc(2026, 5) });
    if (!Number.isFinite(count) || count < 0) {
      assert.equal(only(actions, "start-tracking").length, 0, `count=${count} no puede otorgar`);
    }
  }
});
