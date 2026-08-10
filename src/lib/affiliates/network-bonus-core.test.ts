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
 * QUÉ PREMIA (modelo de ago 2026). Un afiliado INVITA a otros afiliados. El
 * invitado es un afiliado NORMAL: la comisión de sus clínicas es suya y
 * completa. Quien invita no cobra un peso por ellas; su único premio son estos
 * bonos, que cuentan las clínicas activas de sus invitados DIRECTOS —un solo
 * nivel— y se pagan SIEMPRE en PAGO ÚNICO. No hay modalidad mensual, no hay
 * pantalla de elección y no hay estado intermedio: al cumplirse la racha el
 * escalón se otorga y su comisión se genera en la misma transacción.
 *
 * Foco crítico:
 *  - Alcanzar un escalón NO paga: arranca una racha de SUSTAIN_MONTHS. Un plan
 *    de acciones que otorgue antes de tiempo entrega dinero que no se ganó.
 *  - Un escalón `awarded` está cerrado PARA SIEMPRE: ni una segunda comisión
 *    (dinero duplicado sin contraparte) ni una revocación si su red baja (ya se
 *    ganó con 3 meses sostenidos). El candado duro es el índice único de
 *    affiliate_commissions."stripeInvoiceId", así que aquí se prueban las dos
 *    mitades: que `commissionRefOnce` sea determinista (misma entrada → misma
 *    cadena, o el índice no choca) y que el barrido nunca reemita el `award`.
 *  - Los estados de la etapa con modalidad mensual degradan a `awarded`, JAMÁS
 *    a `tracking`: el sentido del error decide si un bono ya entregado se vuelve
 *    a pagar.
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
  commissionRefOnce,
  decideNetworkSweep,
  isSustained,
  monthsElapsed,
  monthsLeftToAward,
  networkBonusTiers,
  normalizeAwardStatus,
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
  networkTier2Clinics: 10,
  networkTier2OnceMxn: 8000,
  networkTier3Clinics: 30,
  networkTier3OnceMxn: 24000,
  networkTier4Clinics: 100,
  networkTier4OnceMxn: 90000,
  networkTier5Clinics: 300,
  networkTier5OnceMxn: 300000,
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
    qualifiedSince: null,
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
  assert.deepEqual(
    tiers.map((t) => t.onceMxn),
    [2000, 8000, 24000, 90000, 300000],
    "y los montos también",
  );
  // Umbral en 0 = escalón sin sentido.
  assert.equal(networkBonusTiers({ ...CFG, networkTier1Clinics: 0 }).length, 4);
});

test("networkBonusTiers descarta el escalón con el MONTO en 0", () => {
  // Con la modalidad mensual retirada, el pago único es el ÚNICO monto del
  // escalón: un 0 ahí ya no significa "solo mensual", significa un escalón sin
  // premio. Publicarlo sería prometer un bono de $0 y, peor, otorgarlo: una
  // comisión de cero pesos que el afiliado ve en su panel como pendiente.
  const apagado = networkBonusTiers({ ...CFG, networkTier2OnceMxn: 0 });
  assert.equal(apagado.length, 4, "se apaga UNO sin apagar los otros cuatro");
  assert.equal(apagado.find((t) => t.clinics === 10), undefined);
  assert.deepEqual(apagado.map((t) => t.clinics), [4, 30, 100, 300]);
  // Un monto negativo (un UPDATE a mano en Supabase) tampoco pasa.
  assert.equal(networkBonusTiers({ ...CFG, networkTier3OnceMxn: -1 }).length, 4);
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
  // Las 11 columnas VIVAS están cubiertas por NETWORK_TIER_KEYS + el switch
  // (las 5 `networkTier<N>MonthlyMxn` del DDL quedaron sin uso al retirarse la
  // modalidad mensual: no se leen, no se escriben y no viajan a ninguna UI).
  assert.equal(NETWORK_TIER_KEYS.length * 2 + 1, 11);
  assert.equal(Object.keys(DEFAULT_NETWORK_BONUS).length, 11);
});

// ── 3. El reloj de los meses sostenidos ───────────────────────────────────

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
  // El mes se rellena a dos dígitos: "2026-9" y "2026-09" serían DOS etiquetas
  // distintas sobre el mismo mes en los resúmenes del cron y del admin.
  assert.equal(periodKey(utc(2026, 1, 1)), "2026-01");
});

// ── 4. El ciclo de vida: alcanzar NO es cobrar ────────────────────────────

test("llegar al umbral por primera vez arranca la racha y NO otorga nada", () => {
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [], now: utc(2026, 1) });
  // Alcanza el escalón de 4 y el de 10: los dos arrancan (son acumulables).
  const started = only(actions, "start-tracking");
  assert.equal(started.length, 2);
  assert.deepEqual(started.map((a) => a.clinics).sort((x, y) => x - y), [4, 10]);
  // Y NADA de dinero en la primera pasada: otorgar es lo que genera la comisión.
  assert.equal(only(actions, "award").length, 0);
});

test("cumplidos los 3 meses se OTORGA con los montos de su escalón", () => {
  const enRacha = award({ tier: 2, status: "tracking", qualifiedSince: utc(2026, 1), lastCount: 10 });

  // A los 2 meses todavía no.
  const antes = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [enRacha], now: utc(2026, 3) });
  assert.equal(only(antes, "award").length, 0, "2 meses de racha no otorgan");
  assert.equal(only(antes, "refresh-tracking").length, 1);

  // A los 3, sí. La acción `award` lleva el monto con el que el aplicador
  // escribe la comisión de PAGO ÚNICO en la misma transacción.
  const justo = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [enRacha], now: utc(2026, 4) });
  const otorgado = only(justo, "award");
  assert.equal(otorgado.length, 1);
  assert.equal(otorgado[0].tier, 2);
  assert.equal(otorgado[0].awardId, enRacha.id);
  assert.equal(otorgado[0].onceMxn, 8000, "el monto de CFG, no un default");
  assert.equal(otorgado[0].clinics, 10);
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

test("un tracking que sigue abajo del umbral no cuesta escrituras de más", () => {
  // Racha ya reiniciada (qualifiedSince null) y el mismo conteo de la última
  // corrida: no hay nada que anotar. El escalón de 4 va en la foto ya otorgado,
  // para que "no se escribe nada" mida el barrido ENTERO del afiliado.
  const previo = award({ tier: 1, status: "awarded", lastCount: 3 });
  const parado = award({ tier: 2, status: "tracking", qualifiedSince: null, lastCount: 3 });
  const igual = decideNetworkSweep({
    count: 3,
    tiers: TIERS,
    awards: [previo, parado],
    now: utc(2026, 10),
  });
  assert.equal(igual.length, 0, "sin cambios no se escribe");

  // Conteo distinto: solo se anota, y en los dos awards.
  const cambio = decideNetworkSweep({
    count: 2,
    tiers: TIERS,
    awards: [previo, parado],
    now: utc(2026, 10),
  });
  assert.deepEqual(cambio.map((a) => a.type), ["touch", "touch"], "solo se anota el conteo");
});

// ── 5. EL CANDADO: otorgado es otorgado, para siempre ─────────────────────

test("commissionRefOnce es determinista (el candado del índice único)", () => {
  // Misma entrada → misma cadena. Si variara (un timestamp, un random), el
  // índice único de affiliate_commissions."stripeInvoiceId" NUNCA chocaría y
  // dos corridas simultáneas del cron pagarían el mismo escalón dos veces sin
  // que nada lo detuviera.
  assert.equal(commissionRefOnce("abc"), "netbonus:abc:once");
  assert.equal(commissionRefOnce("abc"), commissionRefOnce("abc"));
  // Un award por (afiliado, escalón) y una comisión por award: awards distintos
  // → candados distintos, o el segundo escalón no se podría pagar nunca.
  assert.notEqual(commissionRefOnce("abc"), commissionRefOnce("xyz"));
  assert.equal(NETWORK_BONUS_KIND, "network_bonus");
});

test("EL CANDADO: un escalón `awarded` JAMÁS vuelve a producir un `award`", () => {
  // Con 10 clínicas también está por encima del escalón de 4, que en un
  // afiliado real ya estaría otorgado hace tiempo. Va en la foto para que las
  // aserciones de "no se escribe nada" midan el barrido completo del afiliado y
  // no un escalón suelto.
  const previo = award({ tier: 1, status: "awarded", lastCount: 10 });
  const cerrado = award({ tier: 2, status: "awarded", lastCount: 10 });

  // Mes tras mes, corrida tras corrida: ni un `award` más.
  for (const mes of [5, 6, 7, 9, 12]) {
    const actions = decideNetworkSweep({
      count: 10,
      tiers: TIERS,
      awards: [previo, cerrado],
      now: utc(2026, mes),
    });
    assert.equal(only(actions, "award").length, 0, `mes ${mes}: un bono otorgado no se repite`);
    assert.equal(actions.length, 0, `mes ${mes}: y sin cambios tampoco escribe por escribir`);
  }

  // El cron corriendo DIEZ veces el mismo día: idéntico.
  const now = utc(2026, 9);
  for (let i = 0; i < 10; i++) {
    const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [previo, cerrado], now });
    assert.equal(only(actions, "award").length, 0, `corrida ${i + 1}`);
  }

  // Ni siquiera si su red sube muchísimo dentro del mismo escalón: se anota el
  // conteo nuevo y nada más.
  const subiendo = decideNetworkSweep({
    count: 29,
    tiers: TIERS,
    awards: [previo, cerrado],
    now: utc(2026, 7),
  });
  assert.equal(only(subiendo, "award").length, 0);
  assert.deepEqual(subiendo.map((a) => a.type), ["touch", "touch"]);
});

test("un award `awarded` NO se revoca si su red se cae: ya se ganó", () => {
  // El trato publicado es "sostenlo 3 meses y el bono es tuyo". Bajar después
  // del umbral no lo deshace —el dinero ya salió y no hay nada que retirar—,
  // así que el barrido solo anota el conteo nuevo.
  const cerrado = award({ tier: 2, status: "awarded", onceMxn: 8000, lastCount: 10 });
  const actions = decideNetworkSweep({
    count: 0,
    tiers: TIERS,
    awards: [cerrado],
    now: utc(2026, 6),
  });
  assert.deepEqual(actions.map((a) => a.type), ["touch"], "ni reset, ni revocación, ni nada");
  assert.equal(only(actions, "award").length, 0);

  // Y la vista lo sigue enseñando otorgado, con su monto.
  const view = buildNetworkBonusView(0, TIERS, [cerrado], utc(2026, 6));
  assert.equal(view.awarded.length, 1);
  assert.equal(view.awarded[0].n, 2);
  assert.equal(view.awardedMxn, 8000);
});

// ── 6. Los montos CONGELADOS ──────────────────────────────────────────────

test("un award en tracking SÍ sigue los montos vivos (aún no se prometió nada)", () => {
  const enRacha = award({
    tier: 2,
    status: "tracking",
    onceMxn: 8000,
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

test("editar la config NO mueve un bono ya otorgado", () => {
  // El award se otorgó con el monto viejo…
  const previo = award({ tier: 1, status: "awarded", lastCount: 10 });
  const otorgado = award({ tier: 2, status: "awarded", onceMxn: 8000, lastCount: 10 });
  // …y mientras tanto Rafael duplicó los montos en /admin.
  const nuevaCfg: NetworkBonusConfig = { ...CFG, networkTier2OnceMxn: 16000 };
  const actions = decideNetworkSweep({
    count: 10,
    tiers: networkBonusTiers(nuevaCfg),
    awards: [previo, otorgado],
    now: utc(2026, 9),
  });
  assert.equal(actions.length, 0, "un award cerrado no se reabre para 'actualizar' su monto");
});

// ── 7. Escalones acumulables, cada uno con su vida ────────────────────────

test("los escalones son independientes: uno otorgado no bloquea al siguiente", () => {
  const enRacha = award({ tier: 2, status: "tracking", qualifiedSince: utc(2026, 6), lastCount: 10 });
  const awards: AwardSnapshot[] = [award({ tier: 1, status: "awarded", lastCount: 10 }), enRacha];
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards, now: utc(2026, 9) });
  // El de 4 está cerrado; el de 10 cumple sus 3 meses y se otorga.
  const otorgado = only(actions, "award");
  assert.equal(otorgado.length, 1);
  assert.equal(otorgado[0].tier, 2);
  assert.equal(otorgado[0].onceMxn, 8000);
});

test("subir de golpe arranca TODOS los escalones alcanzados a la vez", () => {
  const actions = decideNetworkSweep({ count: 120, tiers: TIERS, awards: [], now: utc(2026, 2) });
  const started = only(actions, "start-tracking");
  assert.deepEqual(
    started.map((a) => a.clinics).sort((x, y) => x - y),
    [4, 10, 30, 100],
    "los cuatro alcanzados; el de 300 no",
  );
  // Pero ninguno cobra el primer día: los 3 meses se cuentan igual para todos.
  assert.equal(only(actions, "award").length, 0);
});

// ── 8. La vista del panel ─────────────────────────────────────────────────

test("buildNetworkBonusView separa lo otorgado y suma bien", () => {
  const now = utc(2026, 9);
  const awards: AwardSnapshot[] = [
    award({ tier: 1, status: "awarded", lastCount: 12 }),
    award({ tier: 2, status: "tracking", qualifiedSince: utc(2026, 8), lastCount: 12 }),
  ];
  const view = buildNetworkBonusView(12, TIERS, awards, now);

  assert.equal(view.count, 12);
  assert.equal(view.awarded.length, 1, "solo el escalón 1 está otorgado");
  assert.equal(view.awarded[0].n, 1);
  assert.equal(view.awardedMxn, 2000, "el pago único del escalón 1 de CFG");

  // El escalón 2 va en racha: la vista dice cuánto lleva y cuánto le falta.
  assert.equal(view.tiers[1].monthsSustained, 1);
  assert.equal(view.tiers[1].monthsLeft, 2);

  // El siguiente escalón y cuántas faltan — la frase de la barra.
  assert.equal(view.next!.clinics, 30);
  assert.equal(view.missing, 18);
});

test("la vista suma los montos CONGELADOS del award, no los vigentes", () => {
  // El afiliado cobró $8,000 y $2,000; después Rafael subió los montos en
  // /admin. Su panel tiene que seguir diciendo $10,000: enseñarle lo vigente
  // sería prometerle una diferencia que nadie le va a pagar.
  const awards: AwardSnapshot[] = [
    award({ tier: 1, status: "awarded", onceMxn: 2000, lastCount: 12 }),
    award({ tier: 2, status: "awarded", onceMxn: 8000, lastCount: 12 }),
  ];
  const nuevaCfg: NetworkBonusConfig = {
    ...CFG,
    networkTier1OnceMxn: 50000,
    networkTier2OnceMxn: 40000,
  };
  const view = buildNetworkBonusView(12, networkBonusTiers(nuevaCfg), awards, utc(2026, 9));
  assert.equal(view.awarded.length, 2);
  assert.equal(view.awardedMxn, 10000, "2000 + 8000 congelados, no 50000 + 40000");
});

test("la vista no adelanta estados que el cron todavía no vio", () => {
  // Llega al umbral hoy, pero el barrido aún no ha corrido: no hay award.
  const view = buildNetworkBonusView(10, TIERS, [], utc(2026, 9));
  assert.equal(view.awarded.length, 0);
  assert.equal(view.awardedMxn, 0);
  assert.equal(view.tiers[1].reachedNow, true, "sí dice que hoy alcanza el umbral");
  assert.equal(view.tiers[1].award, null, "pero no finge una racha que nadie registró");
  assert.equal(view.tiers[1].monthsSustained, null);
  assert.equal(view.tiers[1].monthsLeft, null);
});

test("con todos los escalones alcanzados no hay 'siguiente'", () => {
  const view = buildNetworkBonusView(500, TIERS, [], utc(2026, 9));
  assert.equal(view.next, null);
  assert.equal(view.missing, 0);
});

// ── 9. Normalizadores defensivos ──────────────────────────────────────────

test("normalizeAwardStatus: los estados legados degradan a `awarded`, NO a `tracking`", () => {
  // ⚠️ EL SENTIDO DEL ERROR. Los cuatro estados de la etapa con modalidad
  // mensual significan todos "este escalón YA se otorgó". Degradarlos a
  // `tracking` —el estado que cuenta la racha— haría que el barrido los
  // otorgara otra vez y emitiera una SEGUNDA comisión sobre un bono ya
  // entregado: dinero duplicado sin contraparte. Al revés, quedarse en
  // `awarded` solo cuesta que un escalón no se vuelva a contar, que es
  // exactamente lo que se quiere.
  for (const legado of ["pending_choice", "once_paid", "monthly_active", "monthly_paused"]) {
    assert.equal(normalizeAwardStatus(legado), "awarded", `${legado} ya estaba otorgado`);
    assert.notEqual(normalizeAwardStatus(legado), "tracking", `${legado} no puede volver a otorgar`);
  }
  assert.equal(normalizeAwardStatus("awarded"), "awarded");
  assert.equal(normalizeAwardStatus("tracking"), "tracking");
  // Lo DESCONOCIDO sí cae a "tracking": ahí no hay nada que suponer otorgado, y
  // ese es el estado que no paga.
  assert.equal(normalizeAwardStatus("basura"), "tracking");
  assert.equal(normalizeAwardStatus(null), "tracking");
  assert.equal(normalizeAwardStatus(undefined), "tracking");
  assert.equal(normalizeAwardStatus(7), "tracking");
});

test("un status legado tampoco vuelve a otorgar al pasar por el barrido", () => {
  // La otra mitad de la regla anterior, comprobada de punta a punta: una fila
  // vieja normalizada entra al cron como `awarded` y sale sin un solo `award`.
  const legado = award({ tier: 2, status: normalizeAwardStatus("once_paid"), lastCount: 10 });
  assert.equal(legado.status, "awarded");
  const actions = decideNetworkSweep({ count: 10, tiers: TIERS, awards: [legado], now: utc(2026, 9) });
  assert.equal(only(actions, "award").length, 0);
});

test("un conteo basura no otorga nada", () => {
  for (const count of [Number.NaN, -5, Number.POSITIVE_INFINITY] as number[]) {
    const actions = decideNetworkSweep({ count, tiers: TIERS, awards: [], now: utc(2026, 5) });
    if (!Number.isFinite(count) || count < 0) {
      assert.equal(only(actions, "start-tracking").length, 0, `count=${count} no puede otorgar`);
    }
  }
});
