/**
 * SPEI POR TRANSFERENCIA DIRECTA — reglas puras y candados de cableado (ws1-t3).
 *
 * Run: npm run test:spei-directo
 *
 * Lo que aquí NO puede fallar nunca (es dinero):
 *   1. El importe a transferir es EL MISMO que cobraría Stripe por ese plan y
 *      periodo — se compara contra la cuenta real de /api/billing/checkout
 *      leyendo su código, así que si el checkout cambia y esto no, truena.
 *   2. El IVA se suma exactamente cuando el checkout lo suma.
 *   3. Sin cuenta bancaria utilizable no se ofrece SPEI, y una CLABE que no pasa
 *      el dígito verificador no se guarda ni se muestra.
 *   4. Confirmar extiende el periodo igual que el SPEI de Stripe, y nunca acorta.
 *   5. Estar pendiente NO da acceso al panel: el gate es el de siempre.
 * El comportamiento con base de datos (crear, confirmar, rechazar) está en
 * spei-directo-servidor.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FALLBACK_PLAN_CONFIG } from "@/lib/plan-shared";
import { PLAN_IDS } from "@/lib/billing/plans";
import { isPlanExpired } from "@/lib/plan-status";
import { manualPeriodFields } from "@/lib/billing/proration";
import {
  centavosADecimal,
  centavosAMxn,
  clabeAgrupada,
  clabeValida,
  cuentaUsable,
  importeSpei,
  ivaEnCobro,
  periodoPagado,
  referenciaValida,
  subtotalCentavos,
  validarCuentaBancaria,
} from "./spei-directo-core";

const SRC = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Planes tal como los resuelve el checkout (getResolvedPlan): precio mensual y anual. */
const planes = PLAN_IDS.map((id) => ({
  id,
  priceMxn: FALLBACK_PLAN_CONFIG[id].priceMxnMonthly,
  priceMxnAnnual: FALLBACK_PLAN_CONFIG[id].priceMxnAnnual,
}));

/** Dígito verificador de una CLABE, calculado a mano e independiente del código. */
function clabeConDigito(primeros17: string): string {
  const pesos = [3, 7, 1];
  const suma = primeros17.split("").reduce((a, d, i) => a + ((Number(d) * pesos[i % 3]) % 10), 0);
  return primeros17 + String((10 - (suma % 10)) % 10);
}
// Un banco de mentira (999) con una plaza y cuenta inventadas: ningún dato real.
const CLABE_DE_PRUEBA = clabeConDigito("99900000000000012");

// ═══════════════════════════════════════════════════════════════════════════
// 1 · El importe es el del checkout
// ═══════════════════════════════════════════════════════════════════════════
test("el importe SPEI es el unitAmount del checkout, por plan y periodo", () => {
  const checkout = leer("app/api/billing/checkout/route.ts");
  // La cuenta de Stripe, tal cual está escrita en la ruta. Si alguien la cambia,
  // este candado avisa de que subtotalCentavos ya no la espeja.
  assert.ok(
    checkout.includes('const unitAmount = (billing === "annual" ? plan.priceMxnAnnual : plan.priceMxn) * 100;'),
    "el unitAmount del checkout cambió: actualiza subtotalCentavos (spei-directo-core.ts)",
  );
  for (const p of planes) {
    for (const billing of ["monthly", "annual"] as const) {
      const unitAmountDelCheckout = (billing === "annual" ? p.priceMxnAnnual : p.priceMxn) * 100;
      assert.equal(subtotalCentavos(p, billing), unitAmountDelCheckout, `${p.id} ${billing}`);
      // Sin IVA en el cobro de hoy: se transfiere exactamente el unitAmount.
      const sinIva = importeSpei({ plan: p, billing, conIva: false });
      assert.deepEqual(sinIva, { subtotalCents: unitAmountDelCheckout, ivaCents: 0, totalCents: unitAmountDelCheckout });
    }
  }
});

test("el anual es el TOTAL del año (priceMxnAnnual), no el mensual por doce", () => {
  const pro = planes.find((p) => p.id === "PRO")!;
  assert.equal(subtotalCentavos(pro, "annual"), pro.priceMxnAnnual * 100);
  assert.notEqual(subtotalCentavos(pro, "annual"), pro.priceMxn * 12 * 100);
});

test("la promo del primer mes NO aplica a SPEI: ni con IVA ni sin él baja del precio de lista", () => {
  const checkout = leer("app/api/billing/checkout/route.ts");
  assert.match(checkout, /const applyFirstMonthPromo =\s*method === "card" && billing === "monthly"/, "la promo es solo tarjeta+mensual");
  const core = leer("lib/billing/spei-directo-core.ts");
  assert.ok(!/FIRST_MONTH|promo/i.test(core.replace(/\/\*[\s\S]*?\*\//g, "")), "el cálculo SPEI no lee la promo");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · El IVA, cuando y como lo suma el checkout
// ═══════════════════════════════════════════════════════════════════════════
test("el IVA se suma bajo la MISMA condición que el checkout (STRIPE_AUTOMATIC_TAX === 'true')", () => {
  const checkout = leer("app/api/billing/checkout/route.ts");
  assert.ok(checkout.includes('const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === "true";'), "la condición del checkout cambió");
  assert.equal(ivaEnCobro({ STRIPE_AUTOMATIC_TAX: "true" }), true);
  for (const v of [undefined, "", "false", "TRUE", "1"]) assert.equal(ivaEnCobro({ STRIPE_AUTOMATIC_TAX: v }), false, String(v));
});

test("con IVA: subtotal + 16 %, en centavos enteros", () => {
  const i = importeSpei({ plan: { priceMxn: 689, priceMxnAnnual: 5378 }, billing: "monthly", conIva: true });
  assert.deepEqual(i, { subtotalCents: 68900, ivaCents: 11024, totalCents: 79924 });
  const a = importeSpei({ plan: { priceMxn: 689, priceMxnAnnual: 5378 }, billing: "annual", conIva: true });
  assert.equal(a.subtotalCents, 537800);
  assert.equal(a.totalCents, a.subtotalCents + a.ivaCents);
  assert.ok(Number.isInteger(a.ivaCents));
  for (const p of planes) {
    for (const billing of ["monthly", "annual"] as const) {
      const r = importeSpei({ plan: p, billing, conIva: true });
      assert.ok(Number.isInteger(r.totalCents) && r.totalCents > r.subtotalCents, `${p.id} ${billing}`);
    }
  }
});

test("formatos: decimal para copiar, MXN para mostrar", () => {
  assert.equal(centavosADecimal(79924), "799.24");
  assert.equal(centavosADecimal(68900), "689.00");
  assert.equal(centavosAMxn(68900), "$689.00");
  assert.equal(centavosAMxn(537800), "$5,378.00");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Sin cuenta utilizable no hay SPEI
// ═══════════════════════════════════════════════════════════════════════════
test("la CLABE se valida con su dígito verificador", () => {
  assert.equal(clabeValida(CLABE_DE_PRUEBA), true);
  assert.equal(clabeValida(clabeAgrupada(CLABE_DE_PRUEBA)), true, "con espacios también");
  // Cambiar cualquier dígito rompe el verificador.
  for (let i = 0; i < 17; i++) {
    const d = (Number(CLABE_DE_PRUEBA[i]) + 1) % 10;
    const mala = CLABE_DE_PRUEBA.slice(0, i) + d + CLABE_DE_PRUEBA.slice(i + 1);
    assert.equal(clabeValida(mala), false, `posición ${i}`);
  }
  for (const v of ["", "123", "9990000000000001", CLABE_DE_PRUEBA + "0", "99900000000000012x"]) assert.equal(clabeValida(v), false, v);
  assert.equal(clabeAgrupada(CLABE_DE_PRUEBA).split(" ").length, 6);
});

test("cuentaUsable: vacío, a medias o con CLABE mala ⇒ SPEI no se ofrece", () => {
  const ok = { banco: "Banco de prueba", beneficiario: "Empresa de prueba SA", clabe: CLABE_DE_PRUEBA };
  assert.equal(cuentaUsable(ok), true);
  assert.equal(cuentaUsable(null), false);
  assert.equal(cuentaUsable(undefined), false);
  assert.equal(cuentaUsable({}), false);
  assert.equal(cuentaUsable({ ...ok, banco: "  " }), false);
  assert.equal(cuentaUsable({ ...ok, beneficiario: "" }), false);
  assert.equal(cuentaUsable({ ...ok, clabe: "" }), false);
  assert.equal(cuentaUsable({ ...ok, clabe: "999000000000000129" }), false, "dígito verificador malo");
});

test("validarCuentaBancaria limpia lo escrito y explica el error", () => {
  const ok = validarCuentaBancaria({ banco: "  Banco  ", beneficiario: " Ana ", clabe: clabeAgrupada(CLABE_DE_PRUEBA) });
  assert.deepEqual(ok, { ok: true, cuenta: { banco: "Banco", beneficiario: "Ana", clabe: CLABE_DE_PRUEBA } });
  for (const [raw, frag] of [
    [{ banco: "", beneficiario: "A", clabe: CLABE_DE_PRUEBA }, /banco/i],
    [{ banco: "B", beneficiario: "", clabe: CLABE_DE_PRUEBA }, /beneficiario/i],
    [{ banco: "B", beneficiario: "A", clabe: "123" }, /18 dígitos/],
    [{ banco: "B", beneficiario: "A", clabe: "999000000000000129" }, /verificador/],
    [{ banco: "B".repeat(200), beneficiario: "A", clabe: CLABE_DE_PRUEBA }, /caracteres/],
  ] as const) {
    const r = validarCuentaBancaria(raw as any);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.match(r.error, frag);
  }
});

test("los datos bancarios no están en el código: ni en la lib, ni en el SQL, ni en las rutas nuevas", () => {
  const archivos = [
    "lib/billing/spei-directo-core.ts",
    "lib/billing/spei-directo.ts",
    "app/api/admin/banco-spei/route.ts",
    "app/api/billing/spei-transferencia/route.ts",
    "components/dashboard/cuenta-rediseno/planes-suspendida.tsx",
    "components/dashboard/cuenta-rediseno/espera-transferencia.tsx",
    "app/admin/settings/banco-spei.tsx",
    "app/admin/payments/spei-pendientes.tsx",
  ];
  const sql = readFileSync(join(SRC, "..", "sql", "spei-transferencia-directa.sql"), "utf8");
  for (const texto of [sql, ...archivos.map(leer)]) {
    assert.ok(!/\b\d{18}\b/.test(texto), "hay una secuencia de 18 dígitos (¿una CLABE?)");
  }
  assert.ok(!/INSERT\s+INTO/i.test(sql), "el SQL no siembra ninguna cuenta");
});

// ═══════════════════════════════════════════════════════════════════════════
// Referencia
// ═══════════════════════════════════════════════════════════════════════════
test("referenciaValida: «DC» + 6 del alfabeto sin ambiguos ni símbolos", () => {
  assert.equal(referenciaValida("DCK7M2QX"), true);
  for (const mala of ["DCK7M2Q", "DCK7M2QXX", "dcK7M2QX", "DC-K7M2QX", "DCK7M2Q0", "DCK7M2QO", "DCK7M2Q1", "DCK7M2QI", ""]) {
    assert.equal(referenciaValida(mala), false, mala);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Confirmar extiende el periodo como el SPEI de Stripe
// ═══════════════════════════════════════════════════════════════════════════
test("periodoPagado: cuenta nueva o vencida cuenta desde hoy", () => {
  const ahora = new Date("2026-09-26T12:00:00Z");
  const m = periodoPagado(ahora, { trialEndsAt: ahora, nextBillingDate: null }, "monthly");
  assert.equal(m.desde.getTime(), ahora.getTime());
  assert.equal(m.hasta.toISOString().slice(0, 10), "2026-10-26");
  const a = periodoPagado(ahora, { trialEndsAt: new Date("2026-01-01"), nextBillingDate: new Date("2026-02-01") }, "annual");
  assert.equal(a.desde.getTime(), ahora.getTime(), "un periodo ya vencido no se cuenta");
  assert.equal(a.hasta.toISOString().slice(0, 10), "2027-09-26");
});

test("periodoPagado: pagar por adelantado SUMA los días que le quedaban", () => {
  const ahora = new Date("2026-09-26T12:00:00Z");
  const fin = new Date("2026-10-10T12:00:00Z");
  const r = periodoPagado(ahora, { trialEndsAt: new Date("2026-10-01T12:00:00Z"), nextBillingDate: fin }, "monthly");
  assert.equal(r.desde.getTime(), fin.getTime(), "desde el final vigente: el máximo de las dos fechas");
  assert.equal(r.hasta.toISOString().slice(0, 10), "2026-11-10");
});

test("periodoPagado: fin de mes y bisiesto no se desbordan", () => {
  const ene31 = new Date("2027-01-31T12:00:00Z");
  assert.equal(periodoPagado(ene31, null, "monthly").hasta.toISOString().slice(0, 10), "2027-02-28");
  const feb29 = new Date("2028-02-29T12:00:00Z");
  assert.equal(periodoPagado(feb29, null, "annual").hasta.toISOString().slice(0, 10), "2029-02-28");
});

test("las dos fechas del clínica se mueven juntas y nunca se acorta (manualPeriodFields)", () => {
  const ahora = new Date("2026-09-26T12:00:00Z");
  const { hasta } = periodoPagado(ahora, { trialEndsAt: ahora }, "monthly");
  const f = manualPeriodFields({ trialEndsAt: ahora }, hasta);
  assert.equal(f.nextBillingDate.getTime(), hasta.getTime());
  assert.equal(f.trialEndsAt.getTime(), hasta.getTime());
  // Una cortesía más larga que el periodo pagado se respeta.
  const largo = new Date("2027-12-31T00:00:00Z");
  assert.equal(manualPeriodFields({ trialEndsAt: largo }, hasta).trialEndsAt.getTime(), largo.getTime());
});

test("confirmarSolicitudSpei usa la misma lógica que el resto del cobro (no la duplica)", () => {
  const lib = leer("lib/billing/spei-directo.ts");
  assert.match(lib, /from "@\/lib\/billing\/proration"/, "las fechas de la clínica salen de manualPeriodFields");
  assert.match(lib, /\.\.\.manualPeriodFields\(clinica, hasta\)/);
  assert.match(lib, /periodoPagado\(ahora, clinica, billing\)/);
  assert.match(lib, /getPlanLimits\(plan\)/, "el cupo de IA sale de plan_configs, como en el webhook");
  // Igual que la activación de Stripe: estado active + plan; y SIN tocar monthlyPrice.
  assert.match(lib, /subscriptionStatus: "active"/);
  assert.ok(!/monthlyPrice/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no escribe monthlyPrice");
  // La factura entra como cobro pagado del método «transfer» que ya entiende /admin/payments.
  assert.match(lib, /method: "transfer"/);
  assert.match(lib, /status: "paid"/);
  // Y la reclamación de la solicitud es condicional y va DENTRO de la transacción.
  assert.match(lib, /prisma\.\$transaction\(/);
  assert.match(lib, /where: \{ id: sol\.id, status: "pending" \}/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Pendiente no da acceso: el gate es el de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("una cuenta nueva con transferencia pendiente sigue SIN acceso (el estado no cambia hasta confirmar)", () => {
  const ahora = new Date("2026-09-26T12:00:00Z");
  const alta = { subscriptionStatus: "pending_payment", trialEndsAt: new Date("2026-09-20T00:00:00Z"), nextBillingDate: null };
  assert.equal(isPlanExpired(alta, ahora), true, "el gate la bloquea…");
  // …y crear la solicitud no toca la clínica: la lib solo escribe en spei_transfer_requests.
  const lib = leer("lib/billing/spei-directo.ts");
  const crear = lib.slice(lib.indexOf("export async function crearSolicitudSpei"), lib.indexOf("// ── Lista del admin"));
  assert.ok(!/prisma\.clinic\.(update|updateMany|upsert)/.test(crear), "crear la solicitud no activa nada");
  // Y el layout del panel NO se tocó: el bloqueo es el mismo de siempre.
  const layout = leer("app/dashboard/layout.tsx");
  assert.ok(!/spei/i.test(layout), "el layout no sabe de SPEI: sigue mandando a /dashboard/suspended");
  assert.match(layout, /if \(isExpired && pathname && !isAllowedWhileSuspended\(pathname\)\)\s*\{\s*redirect\("\/dashboard\/suspended"\)/);
});

test("confirmada, la clínica queda con acceso (active) aunque trialEndsAt siguiera vencido", () => {
  const ahora = new Date("2026-09-26T12:00:00Z");
  assert.equal(isPlanExpired({ subscriptionStatus: "active", trialEndsAt: new Date("2026-09-20") }, ahora), false);
});

test("la pantalla de pago espera a la clínica: pendiente ⇒ espera, sin cuenta ⇒ SPEI no se ofrece", () => {
  const page = leer("app/dashboard/suspended/page.tsx");
  assert.match(page, /solicitudPendienteDe\(user\.clinicId\)/, "el clinicId sale de la sesión");
  assert.match(page, /leerCuentaSpei\(\)/);
  assert.match(page, /<EsperaTransferencia/);
  const cliente = leer("app/dashboard/suspended/suspended-client.tsx");
  assert.match(cliente, /speiDisponible/, "el cliente filtra el método SPEI");
});
