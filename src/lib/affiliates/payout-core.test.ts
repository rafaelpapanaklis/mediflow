/**
 * Tests unitarios del MOTOR DE COMISIONES de afiliados.
 *
 * Run: npm run test:afiliados
 *
 * Foco crítico (este código decide DINERO REAL que se le paga a un socio: cada
 * fila que escribe el webhook de Stripe termina en una transferencia):
 *  - El PRIMER cobro es el mes promocional ($19/$29/$39). Pagar comisión ahí le
 *    cuesta a la plataforma más de lo que cobró, así que tiene que dar `null`.
 *  - El PAGO ÚNICO es, por definición, irrepetible: un segundo disparo le paga
 *    dos veces $650 por la misma clínica y ese dinero ya no vuelve.
 *  - Una factura ANUAL cubre 12 meses: pagar 1 le roba 11 al afiliado y pagar
 *    13 se los regala.
 *  - Los MONTOS no se congelan: si la clínica sube de plan, la comisión del
 *    cobro siguiente es la del plan NUEVO. Congelarla paga de menos.
 *  - Con equipos de vendedores la suma DEBE cuadrar al centavo: si
 *    sellerMxn + overrideMxn > totalMxn, la plataforma paga de más en cada
 *    venta y para siempre.
 *
 * Todos los montos se pasan por CONFIG explícita (la que el admin edita en
 * /admin) para comprobar que dentro del motor no hay ni un número escrito a
 * mano: cambiar la config tiene que cambiar el resultado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAYOUT_CONFIG,
  PLAN_KEYS,
  commissionKindLabel,
  equivalentPct,
  fixedAmountFor,
  monthsCovered,
  normalizePayoutMode,
  normalizePlanKey,
  normalizeProgramMode,
  paybackMonths,
  resolveCommission,
  roundMxn,
  simulateProgram,
  type PayoutConfig,
  type ResolveCommissionInput,
} from "./payout-core";
import { computeSellerSplitFromTotal } from "./team";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Config con overrides puntuales. Ningún test muta el default compartido. */
function cfg(over: Partial<PayoutConfig> = {}): PayoutConfig {
  return { ...DEFAULT_PAYOUT_CONFIG, ...over };
}

/**
 * Entrada de resolveCommission con el caso feliz por defecto: clínica PRO que
 * paga su cobro #2 (el primero que sí comisiona) de un plan mensual.
 */
function input(over: Partial<ResolveCommissionInput> = {}): ResolveCommissionInput {
  return {
    plan: "PRO",
    amountMxn: 689,
    invoiceNo: 2,
    months: 1,
    mode: "recurring",
    oneTimeAlreadyPaid: false,
    cfg: DEFAULT_PAYOUT_CONFIG,
    levelPct: 12,
    programMode: "fixed",
    ...over,
  };
}

/** Precios de plan. En producción salen de plan_configs, jamás del motor. */
const PRECIOS = { BASIC: 499, PRO: 689, CLINIC: 1499 };

const utc = (iso: string) => new Date(iso);

// ── Los defaults del motor son los DEFAULT de la tabla ──────────────────────

test("los defaults del motor son los mismos que los DEFAULT del SQL", () => {
  // Se usan cuando la tabla existe pero la fila id=1 todavía no. Si alguien los
  // cambia aquí y no en sql/afiliados-comisiones.sql, dos clínicas idénticas
  // cobran distinto según si el admin abrió o no la pantalla de config.
  assert.deepEqual(DEFAULT_PAYOUT_CONFIG, {
    defaultMode: "fixed",
    defaultPayoutMode: "recurring",
    allowAffiliateChoice: true,
    recurringBasicMxn: 40,
    recurringProMxn: 90,
    recurringClinicMxn: 250,
    oneTimeBasicMxn: 350,
    oneTimeProMxn: 650,
    oneTimeClinicMxn: 1400,
    startAtInvoiceNo: 2,
    oneTimeAtInvoiceNo: 2,
  });
  assert.deepEqual(PLAN_KEYS, ["BASIC", "PRO", "CLINIC"]);
});

// ── 1. El primer cobro NO paga (mes promocional) ────────────────────────────

test("el primer cobro NO paga: es el mes promocional de $19/$29/$39", () => {
  // startAtInvoiceNo = 2. Comisionar el cobro #1 significa pagarle $90 al
  // afiliado por una factura de $19: pérdida directa en cada alta.
  assert.equal(resolveCommission(input({ invoiceNo: 1 })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, mode: "onetime" })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, programMode: "pct" })), null, "pct también espera");
});

test("el arranque de la comisión lo manda la config, no el número 2", () => {
  const c = cfg({ startAtInvoiceNo: 4 });
  assert.equal(resolveCommission(input({ invoiceNo: 3, cfg: c })), null);
  assert.deepEqual(resolveCommission(input({ invoiceNo: 4, cfg: c })), {
    kind: "recurring",
    totalMxn: 90,
    months: 1,
  });
  // startAtInvoiceNo = 1 → hasta el primer cobro comisiona (programa sin promo).
  assert.deepEqual(resolveCommission(input({ invoiceNo: 1, cfg: cfg({ startAtInvoiceNo: 1 }) })), {
    kind: "recurring",
    totalMxn: 90,
    months: 1,
  });
});

test("un arranque corrupto cae al default seguro, NO comisiona el mes promocional", () => {
  // Con la columna nula o no finita (un ALTER a mano en Supabase, que aquí es
  // el flujo normal) el respaldo es DEFAULT_PAYOUT_CONFIG.startAtInvoiceNo = 2,
  // nunca 1: si degradara a 1, el cobro promocional de $19 pagaría $90 de
  // comisión — exactamente lo que esta regla existe para impedir.
  assert.equal(resolveCommission(input({ invoiceNo: 1, cfg: cfg({ startAtInvoiceNo: NaN }) })), null);
  assert.equal(
    resolveCommission(input({ invoiceNo: 1, cfg: cfg({ startAtInvoiceNo: null as unknown as number }) })),
    null,
  );
  // Y el cobro #2 sí paga con ese mismo arranque corrupto.
  assert.deepEqual(resolveCommission(input({ invoiceNo: 2, cfg: cfg({ startAtInvoiceNo: NaN }) })), {
    kind: "recurring",
    totalMxn: 90,
    months: 1,
  });
});

test("una factura de PRORRATEO no paga un mes fijo completo", () => {
  // Un upgrade a mitad de ciclo cobra unos días sueltos de un periodo que ya
  // comisionó el cobro del ciclo. Pagar ahí el fijo entero es pagar dos veces
  // el mismo mes: el siguiente cobro ya paga el fijo del plan NUEVO.
  assert.equal(resolveCommission(input({ isProration: true })), null);
  assert.equal(resolveCommission(input({ isProration: true, mode: "onetime" })), null);
  // En modo % NO cambia nada: se paga el % de lo que se haya cobrado, como hoy.
  assert.deepEqual(
    resolveCommission(input({ isProration: true, programMode: "pct", amountMxn: 200, levelPct: 12 })),
    { kind: "pct", totalMxn: 24, months: 1 },
  );
});

test("un número de cobro no numérico no genera comisión", () => {
  // getInvoiceNo() puede devolver basura si la consulta degrada: ante la duda,
  // NO se escribe una comisión con un monto inventado.
  assert.equal(resolveCommission(input({ invoiceNo: NaN })), null);
  assert.equal(resolveCommission(input({ invoiceNo: Number("no-es-un-numero") })), null);
  assert.equal(resolveCommission(input({ invoiceNo: Infinity })), null);
});

// ── 2 y 3. Fijo recurrente ──────────────────────────────────────────────────

test("el cobro #2 recurrente paga el fijo del plan", () => {
  assert.deepEqual(resolveCommission(input()), { kind: "recurring", totalMxn: 90, months: 1 });
});

test("el recurrente sigue pagando en los cobros posteriores", () => {
  // No es un pago de alta: mientras la clínica pague, el afiliado cobra.
  for (const invoiceNo of [2, 3, 7, 25]) {
    assert.deepEqual(
      resolveCommission(input({ invoiceNo })),
      { kind: "recurring", totalMxn: 90, months: 1 },
      `invoiceNo=${invoiceNo}`,
    );
  }
});

test("una factura anual paga el fijo × los 12 meses que cubre", () => {
  assert.deepEqual(resolveCommission(input({ months: 12 })), {
    kind: "recurring",
    totalMxn: 1080, // 90 × 12
    months: 12,
  });
});

test("los meses se redondean y se clampan a [1, 12]", () => {
  // months entra ya calculado por monthsCovered, pero el motor no confía: un
  // 24 colado por un periodo raro pagaría 2 años de comisión de una sentada.
  assert.equal(resolveCommission(input({ months: 24 }))!.totalMxn, 1080);
  assert.equal(resolveCommission(input({ months: 0 }))!.totalMxn, 90);
  assert.equal(resolveCommission(input({ months: -5 }))!.totalMxn, 90);
  assert.equal(resolveCommission(input({ months: NaN }))!.totalMxn, 90);
  assert.deepEqual(resolveCommission(input({ months: 1.6 })), {
    kind: "recurring",
    totalMxn: 180,
    months: 2,
  });
});

// ── 4 y 5. Pago único ───────────────────────────────────────────────────────

test("el pago único se entrega en su cobro exacto", () => {
  assert.deepEqual(resolveCommission(input({ mode: "onetime" })), {
    kind: "onetime",
    totalMxn: 650,
    months: 1,
  });
});

test("con el pago único ya entregado NUNCA se vuelve a pagar", () => {
  // El candado real es oneTimePaidAt (transacción del webhook); esta es la
  // primera barrera. Un doble disparo son $650 regalados por clínica.
  assert.equal(resolveCommission(input({ mode: "onetime", oneTimeAlreadyPaid: true })), null);
  assert.equal(
    resolveCommission(input({ mode: "onetime", oneTimeAlreadyPaid: true, invoiceNo: 2 })),
    null,
    "ni siquiera en el cobro de disparo",
  );
  assert.equal(
    resolveCommission(input({ mode: "onetime", oneTimeAlreadyPaid: true, months: 12 })),
    null,
    "ni con una factura anual",
  );
});

test("el pago único ANTES de su cobro no paga", () => {
  // La mitad que sigue viva de la regla: por debajo del cobro de disparo no hay
  // pago único. Con el disparo movido al #5, el #3 y el #4 quedan fuera aunque
  // ya hayan pasado el arranque.
  const c = cfg({ startAtInvoiceNo: 2, oneTimeAtInvoiceNo: 5 });
  assert.equal(resolveCommission(input({ mode: "onetime", invoiceNo: 3, cfg: c })), null);
  assert.equal(resolveCommission(input({ mode: "onetime", invoiceNo: 4, cfg: c })), null);
  assert.deepEqual(resolveCommission(input({ mode: "onetime", invoiceNo: 5, cfg: c })), {
    kind: "onetime",
    totalMxn: 650,
    months: 1,
  });
});

test("el pago único se recupera si su cobro exacto ya pasó", () => {
  // ANTES era una igualdad (`!==`) y esto devolvía null para siempre: una
  // clínica que ya iba en su cobro #9 cuando se le congelaron los términos
  // (backstop del webhook para las referidas antes de esta ola, o el periodo en
  // que sql/afiliados-comisiones.sql aún no estaba aplicado) nunca vuelve a
  // pasar por el #2 → su afiliado cobraba $0 para siempre. Ahora es "en su
  // cobro o después". NO lo adelanta: el #1 lo sigue cortando el arranque.
  for (const invoiceNo of [2, 3, 4, 9, 12, 40]) {
    assert.deepEqual(
      resolveCommission(input({ mode: "onetime", invoiceNo })),
      { kind: "onetime", totalMxn: 650, months: 1 },
      `invoiceNo=${invoiceNo}`,
    );
  }
  // Y sigue siendo UNO: en cuanto el candado sella oneTimePaidAt, se acabó.
  assert.equal(resolveCommission(input({ mode: "onetime", invoiceNo: 10, oneTimeAlreadyPaid: true })), null);
});

test("el pago único recuperado se entrega UNA sola vez (#7 sí, #8 no)", () => {
  // Simulación del webhook cobro a cobro: el disparo era el #2, la clínica va
  // en el #7. Paga en el #7 y, en cuanto la $transaction sella oneTimePaidAt,
  // el #8 ya no ve nada. El "una sola vez" NUNCA dependió del número de cobro.
  let oneTimeAlreadyPaid = false;
  const cobrados: number[] = [];
  for (const invoiceNo of [7, 8, 9]) {
    const r = resolveCommission(input({ mode: "onetime", invoiceNo, oneTimeAlreadyPaid }));
    if (r) {
      cobrados.push(r.totalMxn);
      oneTimeAlreadyPaid = true; // claimOneTimePayout dentro de la $transaction
    }
  }
  assert.deepEqual(cobrados, [650], "un solo pago de $650 en toda la vida de la clínica");
});

test("con el disparo por debajo del arranque, el pago único cae en el arranque", () => {
  // /api/admin/affiliates/payout-config rechaza guardar disparo < arranque, pero
  // una fila vieja (o un UPDATE a mano en Supabase) puede tenerlo. ANTES esa
  // config no pagaba NUNCA: el arranque cortaba el #2 y la igualdad los
  // siguientes. Ahora el arranque manda y el pago único sale en el #4.
  const trampa = cfg({ startAtInvoiceNo: 4, oneTimeAtInvoiceNo: 2 });
  for (const invoiceNo of [1, 2, 3]) {
    assert.equal(
      resolveCommission(input({ mode: "onetime", invoiceNo, cfg: trampa })),
      null,
      `invoiceNo=${invoiceNo} (por debajo del arranque)`,
    );
  }
  for (const invoiceNo of [4, 5, 12]) {
    assert.deepEqual(
      resolveCommission(input({ mode: "onetime", invoiceNo, cfg: trampa })),
      { kind: "onetime", totalMxn: 650, months: 1 },
      `invoiceNo=${invoiceNo}`,
    );
  }
});

test("un cobro de disparo corrupto cae al default, no deja pasar cualquier cobro", () => {
  // Con `<` en vez de `!==`, un NaN en la columna haría verdadera la condición
  // contraria y pagaría en el primer cobro que pase el arranque. El respaldo es
  // el default del programa (2), igual que en startAtInvoiceNo.
  const roto = cfg({ startAtInvoiceNo: 1, oneTimeAtInvoiceNo: NaN });
  assert.equal(resolveCommission(input({ mode: "onetime", invoiceNo: 1, cfg: roto })), null);
  assert.deepEqual(resolveCommission(input({ mode: "onetime", invoiceNo: 2, cfg: roto })), {
    kind: "onetime",
    totalMxn: 650,
    months: 1,
  });
  const nulo = cfg({ startAtInvoiceNo: 1, oneTimeAtInvoiceNo: null as unknown as number });
  assert.equal(resolveCommission(input({ mode: "onetime", invoiceNo: 1, cfg: nulo })), null);
});

test("el pago único NO se multiplica por los meses de una factura anual", () => {
  // "Único" es único: 650, no 650 × 12. Y se graba con months = 1.
  assert.deepEqual(resolveCommission(input({ mode: "onetime", months: 12 })), {
    kind: "onetime",
    totalMxn: 650,
    months: 1,
  });
});

// ── 5-bis. El plan ANUAL comisiona desde su PRIMERA factura ─────────────────
// `startAtInvoiceNo` existe para no pagar comisión sobre el MES PROMOCIONAL
// ($19/$29/$39 del primer mes en facturación mensual). El plan anual no tiene
// promoción: se cobra el año completo de golpe ($3,264 / $5,376 / $13,404), así
// que esa razón no aplica y la factura #1 sí comisiona. Sin esta excepción, el
// afiliado que vende anual espera 12 meses a que llegue la factura #2.

test("anual recurrente: la factura #1 de 12 meses paga el fijo × 12", () => {
  assert.deepEqual(resolveCommission(input({ invoiceNo: 1, months: 12 })), {
    kind: "recurring",
    totalMxn: 1080, // 90 × 12, Profesional
    months: 12,
  });
  // Y con los otros dos planes, con SUS montos de la config.
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 12, plan: "BASIC" }))!.totalMxn, 480);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 12, plan: "CLINIC" }))!.totalMxn, 3000);
});

test("anual pago único: la factura #1 entrega el pago único completo", () => {
  // El kind "onetime" es lo que hace que el webhook corra claimOneTimePayout
  // dentro de la $transaction y selle oneTimePaidAt; por eso se asegura el kind
  // exacto, no solo el monto.
  const r = resolveCommission(input({ invoiceNo: 1, months: 12, mode: "onetime" }));
  assert.deepEqual(r, { kind: "onetime", totalMxn: 650, months: 1 });
  // Sellado el pago (oneTimePaidAt ya no es null), la anual tampoco repite.
  assert.equal(
    resolveCommission(input({ invoiceNo: 1, months: 12, mode: "onetime", oneTimeAlreadyPaid: true })),
    null,
  );
  // Ni en la renovación del año siguiente (factura #2, otros 12 meses).
  assert.equal(
    resolveCommission(input({ invoiceNo: 2, months: 12, mode: "onetime", oneTimeAlreadyPaid: true })),
    null,
  );
});

test("la excepción anual NO rompe la regla del mes promocional", () => {
  // ⚠️ EL TEST QUE PROTEGE EL ARREGLO. Una mensualidad normal cubre 1 mes: su
  // cobro #1 es el promocional de $19/$29/$39 y NO puede comisionar $90.
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 1 })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 1, mode: "onetime" })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 1, plan: "BASIC" })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 1, plan: "CLINIC" })), null);
  // Un mes "raro" de 1.4 meses redondea a 1: sigue siendo promocional.
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 1.4 })), null);
  // Y basura en months tampoco abre la puerta (clamp a 1).
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: NaN })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 0 })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: -5 })), null);
});

test("un ciclo mensual de 31 días da months = 1 y no comisiona en el #1", () => {
  // La verificación que sostiene la excepción: el mes de calendario más largo
  // son 31 días y 31 / 30.44 = 1.018 → round 1. Ningún ciclo mensual real puede
  // colarse por la puerta del multi-mes. Se calcula con monthsCovered (lo mismo
  // que hace el webhook con el periodo de Stripe), no con un número a mano.
  const enero = monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-02-01T00:00:00.000Z"));
  assert.equal(enero, 1, "31 días");
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: enero })), null);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: enero, mode: "onetime" })), null);
  // Febrero (28) y un ciclo de 30 días, por completitud.
  for (const [desde, hasta] of [
    ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
    ["2026-04-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"],
  ]) {
    const m = monthsCovered(utc(desde), utc(hasta));
    assert.equal(m, 1, `${desde} → ${hasta}`);
    assert.equal(resolveCommission(input({ invoiceNo: 1, months: m })), null);
  }
  // El ciclo ANUAL real sí cruza el umbral: 12 meses.
  const anual = monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2027-01-01T00:00:00.000Z"));
  assert.equal(anual, 12);
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: anual }))!.totalMxn, 1080);
});

test("anual: la excepción también vale con el arranque movido y en semestral", () => {
  // La excepción mira los MESES de la factura, no el número de cobro: con el
  // arranque en el #4 una anual #1 comisiona igual.
  assert.equal(
    resolveCommission(input({ invoiceNo: 1, months: 12, cfg: cfg({ startAtInvoiceNo: 4 }) }))!.totalMxn,
    1080,
  );
  // Semestral (6 meses) también cuenta como multi-mes: 90 × 6.
  assert.deepEqual(resolveCommission(input({ invoiceNo: 1, months: 6 })), {
    kind: "recurring",
    totalMxn: 540,
    months: 6,
  });
  // El umbral son 2 meses exactos.
  assert.deepEqual(resolveCommission(input({ invoiceNo: 1, months: 2 })), {
    kind: "recurring",
    totalMxn: 180,
    months: 2,
  });
});

test("anual: un PRORRATEO multi-mes sigue sin comisionar en modo fijo", () => {
  // La excepción no le abre la puerta al prorrateo: ese periodo ya lo comisionó
  // el cobro del ciclo, y con montos fijos pagaría un año entero de más.
  assert.equal(resolveCommission(input({ invoiceNo: 1, months: 12, isProration: true })), null);
  assert.equal(
    resolveCommission(input({ invoiceNo: 1, months: 12, isProration: true, mode: "onetime" })),
    null,
  );
});

// ── 6. El plan VIGENTE manda (los montos no se congelan) ────────────────────

test("la misma llamada paga lo del plan vigente, no lo del plan de alta", () => {
  // Si la clínica sube de BASIC a CLINIC, el cobro siguiente comisiona $250.
  assert.equal(resolveCommission(input({ plan: "BASIC" }))!.totalMxn, 40);
  assert.equal(resolveCommission(input({ plan: "PRO" }))!.totalMxn, 90);
  assert.equal(resolveCommission(input({ plan: "CLINIC" }))!.totalMxn, 250);
  // Lo mismo en pago único.
  assert.equal(resolveCommission(input({ plan: "BASIC", mode: "onetime" }))!.totalMxn, 350);
  assert.equal(resolveCommission(input({ plan: "CLINIC", mode: "onetime" }))!.totalMxn, 1400);
});

test("un plan anual de CLINIC comisiona 250 × 12", () => {
  assert.deepEqual(resolveCommission(input({ plan: "CLINIC", months: 12 })), {
    kind: "recurring",
    totalMxn: 3000,
    months: 12,
  });
});

// ── 7. Modo pct (comportamiento histórico) ──────────────────────────────────

test("modo pct: % del nivel sobre lo pagado, sin mirar los montos fijos", () => {
  assert.deepEqual(resolveCommission(input({ programMode: "pct" })), {
    kind: "pct",
    totalMxn: 82.68, // 689 × 12%
    months: 1,
  });
  // Con TODOS los fijos apagados sigue pagando: no los consulta.
  const apagada = cfg({
    recurringBasicMxn: 0,
    recurringProMxn: 0,
    recurringClinicMxn: 0,
    oneTimeBasicMxn: 0,
    oneTimeProMxn: 0,
    oneTimeClinicMxn: 0,
  });
  assert.deepEqual(resolveCommission(input({ programMode: "pct", cfg: apagada })), {
    kind: "pct",
    totalMxn: 82.68,
    months: 1,
  });
});

test("modo pct: ignora la modalidad y el candado del pago único", () => {
  // El reparto por % vive antes de las ramas de modalidad. Que una clínica
  // tenga "onetime" congelado no puede cortarle el % al afiliado.
  assert.deepEqual(
    resolveCommission(input({ programMode: "pct", mode: "onetime", oneTimeAlreadyPaid: true, invoiceNo: 7 })),
    { kind: "pct", totalMxn: 82.68, months: 1 },
  );
});

test("modo pct: conserva los meses cubiertos de la factura", () => {
  assert.deepEqual(resolveCommission(input({ programMode: "pct", amountMxn: 7440, months: 12 })), {
    kind: "pct",
    totalMxn: 892.8, // 7440 × 12%
    months: 12,
  });
});

test("modo pct: el mes promocional sigue sin pagar, la anual #1 sí paga", () => {
  // La excepción multi-mes vive en el guard COMPARTIDO del arranque, encima de
  // la rama pct: una sola regla en un solo lugar. Consecuencia querida: en pct
  // la anual #1 también comisiona, y no puede pagar de más porque el % se
  // aplica sobre lo que la clínica REALMENTE pagó (el año completo).
  assert.equal(resolveCommission(input({ programMode: "pct", invoiceNo: 1 })), null, "mensual #1");
  assert.equal(
    resolveCommission(input({ programMode: "pct", invoiceNo: 1, months: 1.4 })),
    null,
    "1.4 meses redondea a 1: sigue siendo promocional",
  );
  assert.deepEqual(
    resolveCommission(input({ programMode: "pct", invoiceNo: 1, months: 12, amountMxn: 5376 })),
    { kind: "pct", totalMxn: 645.12, months: 12 }, // 5376 × 12%
  );
});

test("modo pct: el resto del comportamiento histórico no se movió", () => {
  // Los mismos casos que las correcciones tocaron en modo fijo, comprobados en
  // pct: el % ni mira el cobro de disparo, ni la modalidad, ni el candado.
  for (const invoiceNo of [2, 3, 7, 25]) {
    assert.deepEqual(
      resolveCommission(input({ programMode: "pct", invoiceNo })),
      { kind: "pct", totalMxn: 82.68, months: 1 },
      `invoiceNo=${invoiceNo}`,
    );
  }
  // Con modalidad onetime, con el único ya pagado y con el disparo movido: el
  // % se paga igual, en todos los cobros.
  assert.deepEqual(
    resolveCommission(
      input({
        programMode: "pct",
        mode: "onetime",
        oneTimeAlreadyPaid: true,
        invoiceNo: 9,
        cfg: cfg({ oneTimeAtInvoiceNo: 5 }),
      }),
    ),
    { kind: "pct", totalMxn: 82.68, months: 1 },
  );
  // Y el prorrateo en pct sigue pagando el % de lo cobrado.
  assert.deepEqual(
    resolveCommission(input({ programMode: "pct", isProration: true, amountMxn: 200 })),
    { kind: "pct", totalMxn: 24, months: 1 },
  );
});

test("modo pct: un total de $0 SÍ devuelve fila (histórico intacto)", () => {
  // Documentado a propósito en el motor: en pct siempre hubo fila, aunque el
  // monto diera 0. Cambiarlo a null alteraría reportes viejos.
  assert.deepEqual(resolveCommission(input({ programMode: "pct", amountMxn: 0 })), {
    kind: "pct",
    totalMxn: 0,
    months: 1,
  });
  assert.deepEqual(resolveCommission(input({ programMode: "pct", levelPct: 0 })), {
    kind: "pct",
    totalMxn: 0,
    months: 1,
  });
});

// ── 8. monthsCovered ────────────────────────────────────────────────────────

test("monthsCovered: un ciclo mensual cubre 1 mes", () => {
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-01-31T00:00:00.000Z")), 1, "30 días");
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-02-01T00:00:00.000Z")), 1, "31 días");
  assert.equal(monthsCovered(utc("2026-02-01T00:00:00.000Z"), utc("2026-03-01T00:00:00.000Z")), 1, "febrero");
});

test("monthsCovered: un ciclo anual cubre 12 meses", () => {
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2027-01-01T00:00:00.000Z")), 12);
  // Semestral, por si algún día existe.
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-07-01T00:00:00.000Z")), 6);
});

test("monthsCovered: un periodo de 3 años se clampa a 12", () => {
  // Tope duro: ninguna factura puede comisionar más de un año de golpe.
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2029-01-01T00:00:00.000Z")), 12);
});

test("monthsCovered: pocos días cuentan como 1 mes, nunca 0", () => {
  // Toda factura pagada cubre al menos un mes de servicio; un 0 borraría la
  // comisión de un prorrateo o de un ciclo cortado.
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-01-05T00:00:00.000Z")), 1);
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-01-02T00:00:00.000Z")), 1);
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("2026-01-01T00:00:00.000Z")), 1);
});

test("monthsCovered: fechas invertidas o inválidas caen a 1", () => {
  assert.equal(monthsCovered(utc("2027-01-01T00:00:00.000Z"), utc("2026-01-01T00:00:00.000Z")), 1, "invertidas");
  assert.equal(monthsCovered(utc("no-es-fecha"), utc("2026-01-01T00:00:00.000Z")), 1, "inválida");
  assert.equal(monthsCovered(utc("2026-01-01T00:00:00.000Z"), utc("no-es-fecha")), 1, "inválida");
  // El webhook construye las fechas desde epoch de Stripe: si viene null, no
  // llega un Date y el motor tampoco debe romperse.
  assert.equal(monthsCovered(null as unknown as Date, undefined as unknown as Date), 1);
  assert.equal(monthsCovered(0 as unknown as Date, 1 as unknown as Date), 1);
});

// ── 9. Redondeo a centavos y defensa ante no-finitos ────────────────────────

test("roundMxn: redondea a centavos", () => {
  assert.equal(roundMxn(100 / 3), 33.33);
  assert.equal(roundMxn(2 / 3), 0.67);
  assert.equal(roundMxn(86.125), 86.13, "medio centavo sube");
  assert.equal(roundMxn(-1 / 3), -0.33);
  assert.equal(roundMxn(90), 90);
});

test("roundMxn: un no-finito nunca se convierte en un monto", () => {
  // Escribir NaN en commissionMxn (Float NOT NULL) revienta el webhook o, peor,
  // deja una comisión imposible de pagar.
  assert.equal(roundMxn(NaN), 0);
  assert.equal(roundMxn(Infinity), 0);
  assert.equal(roundMxn(-Infinity), 0);
});

test("resolveCommission: entradas no finitas jamás producen NaN en el monto", () => {
  const conMontoRaro = [
    resolveCommission(input({ programMode: "pct", amountMxn: NaN })),
    resolveCommission(input({ programMode: "pct", amountMxn: Infinity })),
    resolveCommission(input({ programMode: "pct", levelPct: NaN })),
    resolveCommission(input({ programMode: "pct", levelPct: Infinity })),
  ];
  for (const r of conMontoRaro) {
    assert.ok(r !== null);
    assert.ok(Number.isFinite(r!.totalMxn), `totalMxn no finito: ${r!.totalMxn}`);
    assert.equal(r!.totalMxn, 0);
    assert.ok(Number.isFinite(r!.months));
  }
});

test("resolveCommission: redondea el % a centavos", () => {
  assert.equal(resolveCommission(input({ programMode: "pct", levelPct: 12.5 }))!.totalMxn, 86.13);
  assert.equal(resolveCommission(input({ programMode: "pct", amountMxn: 333, levelPct: 13 }))!.totalMxn, 43.29);
});

// ── 10. Los montos salen de la config (nada hardcodeado) ────────────────────

test("fixedAmountFor: cada plan y modalidad lee SU campo de la config", () => {
  const c = cfg({
    recurringBasicMxn: 1,
    recurringProMxn: 2,
    recurringClinicMxn: 3,
    oneTimeBasicMxn: 4,
    oneTimeProMxn: 5,
    oneTimeClinicMxn: 6,
  });
  assert.equal(fixedAmountFor("BASIC", "recurring", c), 1);
  assert.equal(fixedAmountFor("PRO", "recurring", c), 2);
  assert.equal(fixedAmountFor("CLINIC", "recurring", c), 3);
  assert.equal(fixedAmountFor("BASIC", "onetime", c), 4);
  assert.equal(fixedAmountFor("PRO", "onetime", c), 5);
  assert.equal(fixedAmountFor("CLINIC", "onetime", c), 6);
});

test("fixedAmountFor: un monto negativo, cero o corrupto vale 0", () => {
  assert.equal(fixedAmountFor("PRO", "recurring", cfg({ recurringProMxn: 0 })), 0);
  assert.equal(fixedAmountFor("PRO", "recurring", cfg({ recurringProMxn: -50 })), 0);
  assert.equal(fixedAmountFor("PRO", "recurring", cfg({ recurringProMxn: NaN })), 0);
  assert.equal(fixedAmountFor("PRO", "recurring", cfg({ recurringProMxn: Infinity })), 0);
  assert.equal(fixedAmountFor("PRO", "onetime", cfg({ oneTimeProMxn: null as unknown as number })), 0);
});

test("cambiar la config cambia el monto: el motor no tiene números propios", () => {
  assert.equal(resolveCommission(input({ cfg: cfg({ recurringProMxn: 123.45 }) }))!.totalMxn, 123.45);
  assert.equal(resolveCommission(input({ months: 2, cfg: cfg({ recurringProMxn: 123.45 }) }))!.totalMxn, 246.9);
  assert.equal(
    resolveCommission(input({ mode: "onetime", cfg: cfg({ oneTimeProMxn: 999.99 }) }))!.totalMxn,
    999.99,
  );
});

test("un monto fijo apagado (0) no escribe comisiones de $0", () => {
  // El admin apagó ese plan: mejor ninguna fila que una fila de cero que el
  // afiliado ve en su panel como "pendiente de pago".
  assert.equal(resolveCommission(input({ cfg: cfg({ recurringProMxn: 0 }) })), null);
  assert.equal(resolveCommission(input({ mode: "onetime", cfg: cfg({ oneTimeProMxn: 0 }) })), null);
  // Y un monto corrupto tampoco paga "infinito".
  assert.equal(resolveCommission(input({ cfg: cfg({ recurringProMxn: Infinity }) })), null);
  assert.equal(resolveCommission(input({ cfg: cfg({ recurringProMxn: NaN }) })), null);
});

// ── Normalizadores (lo que llega de la BD nunca es de fiar) ─────────────────

test("normalizePlanKey: un plan desconocido cae a PRO", () => {
  assert.equal(normalizePlanKey("BASIC"), "BASIC");
  assert.equal(normalizePlanKey("PRO"), "PRO");
  assert.equal(normalizePlanKey("CLINIC"), "CLINIC");
  for (const v of ["ENTERPRISE", "basic", "", null, undefined, 3]) {
    assert.equal(normalizePlanKey(v), "PRO", `valor=${String(v)}`);
  }
});

test("normalizePayoutMode / normalizeProgramMode: default seguro", () => {
  assert.equal(normalizePayoutMode("onetime"), "onetime");
  for (const v of ["recurring", "ONETIME", "", null, undefined]) {
    assert.equal(normalizePayoutMode(v), "recurring", `valor=${String(v)}`);
  }
  assert.equal(normalizeProgramMode("pct"), "pct");
  for (const v of ["fixed", "PCT", "", null, undefined]) {
    assert.equal(normalizeProgramMode(v), "fixed", `valor=${String(v)}`);
  }
});

test("commissionKindLabel: tolera los kind viejos de la BD", () => {
  assert.equal(commissionKindLabel("recurring"), "Fijo recurrente");
  assert.equal(commissionKindLabel("onetime"), "Pago único");
  assert.equal(commissionKindLabel("pct"), "% del nivel");
  // Filas anteriores al motor traen kind null: se muestran como % del nivel.
  assert.equal(commissionKindLabel(null), "% del nivel");
  assert.equal(commissionKindLabel(undefined), "% del nivel");
  assert.equal(commissionKindLabel("lo-que-sea"), "% del nivel");
});

// ── Equivalencias del simulador ─────────────────────────────────────────────

test("equivalentPct: qué porcentaje del precio representa el fijo", () => {
  assert.equal(equivalentPct(90, 689), 13.1, "$90 = 13.1% de $689");
  assert.equal(equivalentPct(250, 1499), 16.7);
  assert.equal(equivalentPct(40, 499), 8);
  assert.equal(equivalentPct(689, 689), 100);
});

test("equivalentPct: sin precio utilizable devuelve null, nunca Infinity", () => {
  assert.equal(equivalentPct(90, 0), null);
  assert.equal(equivalentPct(90, -100), null);
  assert.equal(equivalentPct(90, NaN), null);
  assert.equal(equivalentPct(NaN, 689), null);
});

test("paybackMonths: cuántos meses de suscripción cuesta el pago único", () => {
  assert.equal(paybackMonths(650, 689), 0.9);
  assert.equal(paybackMonths(350, 499), 0.7);
  assert.equal(paybackMonths(1400, 1499), 0.9);
  assert.equal(paybackMonths(650, 0), null);
  assert.equal(paybackMonths(NaN, 689), null);
});

// ── 11. simulateProgram ─────────────────────────────────────────────────────

test("simulateProgram: 10 clínicas PRO a $689 con $90 de fijo", () => {
  const sim = simulateProgram({ BASIC: 0, PRO: 10, CLINIC: 0 }, PRECIOS, DEFAULT_PAYOUT_CONFIG);
  assert.equal(sim.clinics, 10);
  assert.equal(sim.revenueMonthlyMxn, 6890);
  assert.equal(sim.revenueYearlyMxn, 82680);
  // Recurrente: 10 × 90 = 900 al mes = 13.1% del ingreso mensual.
  assert.equal(sim.recurring.costMxn, 900);
  assert.equal(sim.recurring.effectivePct, 13.1);
  assert.equal(sim.recurring.paybackMonths, null, "un costo continuo no se recupera");
  // Pago único: 10 × 650 = 6500 una vez, ≈0.9 meses de ingreso.
  assert.equal(sim.onetime.costMxn, 6500);
  assert.equal(sim.onetime.paybackMonths, 0.9);
  assert.equal(sim.onetime.effectivePct, 7.9, "contra el ingreso del primer año");
});

test("simulateProgram: la mezcla de planes suma cada plan con SU monto", () => {
  const sim = simulateProgram({ BASIC: 5, PRO: 10, CLINIC: 2 }, PRECIOS, DEFAULT_PAYOUT_CONFIG);
  assert.equal(sim.clinics, 17);
  assert.equal(sim.revenueMonthlyMxn, 12383); // 5×499 + 10×689 + 2×1499
  assert.equal(sim.recurring.costMxn, 1600); // 5×40 + 10×90 + 2×250
  assert.equal(sim.onetime.costMxn, 11050); // 5×350 + 10×650 + 2×1400
  assert.equal(sim.recurring.effectivePct, 12.9);
});

test("simulateProgram: con 0 clínicas no divide entre cero", () => {
  // La pantalla del admin abre con todo en 0: un NaN o un Infinity ahí se
  // renderiza tal cual y el admin decide sobre un número inventado.
  const sim = simulateProgram({ BASIC: 0, PRO: 0, CLINIC: 0 }, PRECIOS, DEFAULT_PAYOUT_CONFIG);
  assert.equal(sim.clinics, 0);
  assert.equal(sim.revenueMonthlyMxn, 0);
  assert.equal(sim.revenueYearlyMxn, 0);
  assert.equal(sim.recurring.costMxn, 0);
  assert.equal(sim.recurring.effectivePct, null);
  assert.equal(sim.onetime.costMxn, 0);
  assert.equal(sim.onetime.effectivePct, null);
  assert.equal(sim.onetime.paybackMonths, null);
});

test("simulateProgram: cantidades basura no ensucian el resultado", () => {
  // Los inputs del simulador son <input type="number">: llegan strings vacíos,
  // negativos y decimales.
  const sim = simulateProgram(
    { BASIC: -5, PRO: NaN, CLINIC: 2.9 },
    PRECIOS,
    DEFAULT_PAYOUT_CONFIG,
  );
  assert.equal(sim.clinics, 2, "2.9 se trunca, los inválidos no cuentan");
  assert.equal(sim.revenueMonthlyMxn, 2998);
  assert.equal(sim.recurring.costMxn, 500);
  assert.equal(sim.onetime.costMxn, 2800);
});

test("simulateProgram: bajar el fijo baja el % efectivo", () => {
  const sim = simulateProgram({ BASIC: 0, PRO: 10, CLINIC: 0 }, PRECIOS, cfg({ recurringProMxn: 45 }));
  assert.equal(sim.recurring.costMxn, 450);
  assert.equal(sim.recurring.effectivePct, 6.5);
});

// ── 12. Split con vendedor: la suma DEBE cuadrar al centavo ─────────────────

/** [total, % del nivel del padre, % congelado del vendedor]. */
const SPLITS: Array<[number, number, number]> = [
  [1080, 12, 5],
  [1080, 7, 3], // 462.86 + 617.14: decimales feos
  [350, 15, 7], // 163.33 + 186.67
  [90, 10, 10], // el vendedor se lleva todo
  [1234.56, 11, 4],
  [250, 15, 14.9],
  [40, 3, 1],
  [650, 9, 2],
  [1400, 20, 13],
];

test("computeSellerSplitFromTotal: vendedor + override === total, al centavo", () => {
  // REGLA DE ORO. Si esto se rompe, la plataforma paga de más (o de menos) en
  // CADA venta de equipo: el override se calcula por RESTA justamente por esto.
  for (const s of SPLITS) {
    const r = computeSellerSplitFromTotal(s[0], s[1], s[2]);
    assert.equal(
      r.sellerMxn + r.overrideMxn,
      r.totalMxn,
      `total=${s[0]} nivel=${s[1]}% vendedor=${s[2]}% → ${r.sellerMxn} + ${r.overrideMxn}`,
    );
    assert.ok(r.sellerMxn >= 0 && r.overrideMxn >= 0, "ninguna porción puede ser negativa");
  }
});

test("computeSellerSplitFromTotal: reparte por proporción del nivel del padre", () => {
  // Con montos fijos el % del vendedor ya no aplica a la factura: se reparte el
  // total resuelto en proporción al nivel del padre.
  const anual = computeSellerSplitFromTotal(1080, 12, 5);
  assert.equal(anual.sellerMxn, 450); // 1080 × 5/12
  assert.equal(anual.overrideMxn, 630);
  assert.equal(anual.overridePct, 7);

  const feo = computeSellerSplitFromTotal(1080, 7, 3);
  assert.equal(feo.sellerMxn, 462.86); // 1080 × 3/7 = 462.857…
  assert.equal(feo.overrideMxn, 617.14);

  const trescientos = computeSellerSplitFromTotal(350, 15, 7);
  assert.equal(trescientos.sellerMxn, 163.33); // 350 × 7/15 = 163.333…
  assert.equal(trescientos.overrideMxn, 186.67);
});

test("computeSellerSplitFromTotal: mismo % que el nivel → el vendedor se lleva todo", () => {
  const r = computeSellerSplitFromTotal(90, 10, 10);
  assert.equal(r.sellerMxn, 90);
  assert.equal(r.overrideMxn, 0, "el padre no cobra override, pero tampoco sale negativo");
  assert.equal(r.overridePct, 0);
});

test("computeSellerSplitFromTotal: sin nivel del padre todo queda como override", () => {
  // No se puede repartir "una proporción de nada": el vendedor no gana y el
  // total NO se pierde ni se duplica.
  for (const nivel of [0, -3, NaN, Infinity]) {
    const r = computeSellerSplitFromTotal(500, nivel, 5);
    assert.equal(r.sellerMxn, 0, `nivel=${nivel}`);
    assert.equal(r.overrideMxn, 500, `nivel=${nivel}`);
    assert.equal(r.sellerMxn + r.overrideMxn, r.totalMxn);
  }
});

test("computeSellerSplitFromTotal: un % de vendedor mayor al nivel se clampa", () => {
  // Nunca se paga de más: el tope del vendedor es el % del nivel del padre.
  const r = computeSellerSplitFromTotal(1000, 10, 25);
  assert.equal(r.sellerPct, 10);
  assert.equal(r.sellerMxn, 1000);
  assert.equal(r.overrideMxn, 0);
  assert.equal(r.sellerMxn + r.overrideMxn, r.totalMxn, "sigue cuadrando");
});

test("computeSellerSplitFromTotal: un % de vendedor inválido no gana nada", () => {
  for (const pct of [0, -5, NaN]) {
    const r = computeSellerSplitFromTotal(650, 9, pct);
    assert.equal(r.sellerMxn, 0, `pct=${pct}`);
    assert.equal(r.overrideMxn, 650, `pct=${pct}`);
  }
});

test("computeSellerSplitFromTotal: el total se redondea a centavos", () => {
  const r = computeSellerSplitFromTotal(100 / 3, 10, 5);
  assert.equal(r.totalMxn, 33.33);
  assert.equal(r.sellerMxn + r.overrideMxn, r.totalMxn);
  const noFinito = computeSellerSplitFromTotal(NaN, 10, 5);
  assert.equal(noFinito.totalMxn, 0);
  assert.equal(noFinito.sellerMxn, 0);
  assert.equal(noFinito.overrideMxn, 0);
});
