// WS1-T5 — lo que se añadió a src/lib/mercadopago.ts es OPCIONAL: la
// preferencia de labs y proveedores sale exactamente igual que antes, y la del
// anticipo lleva la comisión en PESOS, la caducidad y el modo binario.
// Correr: npm run test:anticipos

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPreference, getPayment } from "../../mercadopago";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function capturar(respuesta: { status?: number; body: unknown }) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(respuesta.body), { status: respuesta.status ?? 200 });
  }) as typeof fetch;
  return llamadas;
}

const BASE = {
  items: [{ title: "Orden", quantity: 1, unit_price: 1000 }],
  externalReference: "ord1",
  notificationUrl: "https://x.test/api/webhooks/mercadopago?ref=lab:ord1",
  backUrls: { success: "https://x.test/s", failure: "https://x.test/f", pending: "https://x.test/p" },
};

describe("createPreference", () => {
  it("labs/proveedores (sin opcionales): el cuerpo es el de siempre", async () => {
    const llamadas = capturar({ body: { id: "pref1", init_point: "https://mp/1" } });
    await createPreference("TOKEN", BASE);
    const body = JSON.parse(String(llamadas[0].init.body));
    assert.deepEqual(Object.keys(body).sort(), [
      "auto_return",
      "back_urls",
      "external_reference",
      "items",
      "notification_url",
    ]);
  });

  it("anticipo: marketplace_fee en pesos, caducidad, binario y sin OXXO", async () => {
    const llamadas = capturar({ body: { id: "pref2", init_point: "https://mp/2" } });
    const vence = new Date("2026-09-22T16:30:00Z");
    await createPreference("TOKEN", {
      ...BASE,
      marketplaceFee: 15,
      expiresAt: vence,
      binaryMode: true,
      excludedPaymentTypes: ["ticket", "atm"],
    });
    const body = JSON.parse(String(llamadas[0].init.body));
    assert.equal(body.marketplace_fee, 15);
    assert.equal(body.expires, true);
    assert.equal(body.expiration_date_to, vence.toISOString());
    assert.equal(body.binary_mode, true);
    assert.deepEqual(body.payment_methods, { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] });
    assert.equal((llamadas[0].init.headers as Record<string, string>).Authorization, "Bearer TOKEN");
  });

  it("con comisión 0 NO se manda marketplace_fee", async () => {
    const llamadas = capturar({ body: { id: "p", init_point: "u" } });
    await createPreference("TOKEN", { ...BASE, marketplaceFee: 0 });
    assert.equal("marketplace_fee" in JSON.parse(String(llamadas[0].init.body)), false);
  });
});

describe("getPayment", () => {
  it("devuelve además cuándo se aprobó, quién cobró y quién pagó", async () => {
    capturar({
      body: {
        id: 123,
        status: "approved",
        status_detail: "accredited",
        external_reference: "anticipo:dep1",
        transaction_amount: 300,
        currency_id: "MXN",
        date_approved: "2026-09-22T16:10:00.000-06:00",
        collector_id: 999,
        payer: { email: "p@correo.test" },
        payment_method_id: "visa",
      },
    });
    const p = await getPayment("TOKEN", "123");
    assert.deepEqual(p, {
      id: "123",
      status: "approved",
      externalReference: "anticipo:dep1",
      transactionAmount: 300,
      currencyId: "MXN",
      statusDetail: "accredited",
      dateApproved: "2026-09-22T16:10:00.000-06:00",
      collectorId: "999",
      payerEmail: "p@correo.test",
      paymentMethodId: "visa",
    });
  });

  it("401: por defecto null (labs, como siempre); con throwOnAuthError LANZA", async () => {
    capturar({ status: 401, body: {} });
    assert.equal(await getPayment("TOKEN", "1"), null);
    capturar({ status: 401, body: {} });
    await assert.rejects(() => getPayment("TOKEN", "1", { throwOnAuthError: true }));
  });

  it("un id que no es numérico ni se consulta (el id viaja en la URL)", async () => {
    const llamadas = capturar({ body: {} });
    assert.equal(await getPayment("TOKEN", "../users/me"), null);
    assert.equal(llamadas.length, 0);
  });
});
