/**
 * CANDADO: el webhook de Stripe distingue las facturas de un MÓDULO de las del
 * plan (ws1-t5, 28-sep-2026).
 *
 *   npx tsx --test src/lib/marketplace/__tests__/webhook-facturas-de-modulo.test.ts
 *
 * El webhook entero no se puede invocar sin red (verifica la firma de Stripe y
 * escribe en Postgres). La DECISIÓN —¿esta factura es de un módulo?— es pura y
 * se prueba en `module-purchase-core.test.ts` (`referenciaDeFactura`). Aquí se
 * fija que el webhook la siga consultando en los tres sitios donde importa,
 * igual que `billing-guards.test.ts` hace con los helpers de prorrateo.
 *
 * Lo que pasaba antes: la suscripción de un módulo comparte el `customer` de
 * Stripe con la del plan, así que
 *   · una mensualidad de módulo RECHAZADA dejaba a la clínica entera en
 *     `past_due` (sin panel) con el plan al corriente;
 *   · una PAGADA mandaba «¡Tu plan está activo!» y generaba comisión de
 *     afiliado con las reglas del plan;
 *   · y al contratar el módulo no llegaba ningún correo que lo dijera.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUTA = join(__dirname, "..", "..", "..", "app", "api", "webhooks", "stripe", "route.ts");
const FUENTE = readFileSync(RUTA, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** El cuerpo de un `case "<evento>":` hasta el siguiente `case` del mismo nivel. */
function caso(evento: string): string {
  const i = FUENTE.indexOf(`case "${evento}"`);
  assert.notEqual(i, -1, `el webhook ya no maneja ${evento}`);
  const resto = FUENTE.slice(i + 10);
  const siguiente = resto.search(/\n      case "/);
  return siguiente === -1 ? resto : resto.slice(0, siguiente);
}

test("cobro fallido: una factura de módulo no suspende a la clínica", () => {
  const cuerpo = caso("invoice.payment_failed");
  assert.match(cuerpo, /await moduloDeFactura\(invoice\)/, "ya no se pregunta si la factura es de un módulo");
  assert.match(
    cuerpo,
    /canSuspend\s*=\s*moduloDeLaFactura === null\s*&&\s*canSuspendForFailedInvoice\(reason\)/,
    "la suspensión ya no depende de que la factura sea del plan",
  );
  // Y el `past_due` sigue colgando de esa decisión, no escrito por fuera.
  const iSuspende = cuerpo.indexOf(`subscriptionStatus: "past_due"`);
  const iDecision = cuerpo.indexOf("if (canSuspend)");
  assert.ok(iDecision !== -1 && iSuspende > iDecision, "past_due se escribe fuera de `if (canSuspend)`");
});

test("cobro fallido de módulo: igual se registra, para que salga en «por cobrar»", () => {
  assert.match(caso("invoice.payment_failed"), /recordStripeInvoice\(invoice, clinicId, "failed"\)/);
});

test("factura pagada de módulo: se registra el cobro y se corta ANTES de los correos de plan y de la comisión", () => {
  const cuerpo = caso("invoice.payment_succeeded");
  const iRegistro = cuerpo.indexOf("recordStripeInvoice(invoice, clinic.id)");
  const iCorte = cuerpo.search(/if \(\(await moduloDeFactura\(invoice\)\) !== null\) break;/);
  const iCorreoPlan = cuerpo.indexOf("sendPlanActivatedEmail(");
  const iRenovado = cuerpo.indexOf("sendPlanRenewedEmail(");
  const iComision = cuerpo.indexOf("affiliateCommission.create");
  for (const [nombre, i] of [["registro", iRegistro], ["corte", iCorte], ["correo de plan", iCorreoPlan], ["correo de renovación", iRenovado], ["comisión", iComision]] as const) {
    assert.notEqual(i, -1, `no se encontró: ${nombre}`);
  }
  assert.ok(iRegistro < iCorte, "el cobro del módulo tiene que quedar registrado antes de cortar");
  assert.ok(iCorte < iCorreoPlan && iCorte < iRenovado, "una factura de módulo no manda correos de plan");
  assert.ok(iCorte < iComision, "una factura de módulo no genera comisión con las reglas del plan");
});

test("al activarse un módulo comprado sale el correo «Módulo activado», después de escribir la fila", () => {
  const i = FUENTE.indexOf("async function activateModulePurchase(");
  assert.notEqual(i, -1);
  const cuerpo = FUENTE.slice(i, FUENTE.indexOf("async function syncModuleSubscription("));
  const iUpsert = cuerpo.indexOf("prisma.clinicModule.upsert(");
  const iCorreo = cuerpo.indexOf("notifyModuleActivated(");
  const iDuplicada = cuerpo.indexOf(`conflicto.type === "cancel_incoming"`);
  assert.ok(iUpsert !== -1 && iCorreo > iUpsert, "el correo sale antes de que el módulo esté activo");
  // La compra duplicada que se cancela no avisa de nada: vuelve antes.
  assert.ok(iDuplicada !== -1 && iDuplicada < iUpsert);
  assert.match(cuerpo, /origen: "compra"/);
  assert.match(cuerpo, /referencia: opts\.stripeSubscriptionId \?\? opts\.source\.sessionId/);
  // Fire-and-forget: un fallo del correo no tumba el 200 al webhook.
  assert.match(cuerpo, /notifyModuleActivated\(\{[\s\S]*?\}\)\.catch\(/);
});

test("la renovación de un módulo no vuelve a mandar el correo de activación", () => {
  const i = FUENTE.indexOf("async function syncModuleSubscription(");
  const cuerpo = FUENTE.slice(i, FUENTE.indexOf("async function cancelModuleSubscription("));
  assert.doesNotMatch(cuerpo, /notifyModuleActivated/);
});

test("sin metadata, la factura se comprueba contra clinic_modules por su suscripción", () => {
  const i = FUENTE.indexOf("async function moduloDeFactura(");
  assert.notEqual(i, -1);
  const cuerpo = FUENTE.slice(i);
  assert.match(cuerpo, /referenciaDeFactura\(/);
  assert.match(cuerpo, /clinicModule\.findUnique\(\{\s*where: \{ stripeSubscriptionId: ref\.stripeSubscriptionId \}/);
  // Si la base falla se trata como factura del plan (lo de siempre), no se lanza.
  assert.match(cuerpo, /catch \(e\) \{[\s\S]*return null;/);
});
