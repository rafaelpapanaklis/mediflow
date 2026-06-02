// MercadoPago REST wrapper — token POR VENDEDOR (cada lab/proveedor pega su propio
// access token; el cobro va DIRECTO a su cuenta, sin comisión MediFlow). Sin SDK:
// fetch nativo. Modelado en createMercadoPagoPreference de src/app/api/portal/pay/route.ts.

const MP_API = "https://api.mercadopago.com";

export interface MercadoPagoItem {
  title: string;
  quantity: number;
  unit_price: number;
}

export interface CreatePreferenceOptions {
  items: MercadoPagoItem[];
  externalReference: string;
  notificationUrl: string;
  backUrls: { success: string; failure: string; pending: string };
}

export interface CreatePreferenceResult {
  id: string;
  initPoint: string;
}

/**
 * Crea una preferencia de checkout en la cuenta del vendedor (accessToken propio).
 * Devuelve el id de la preferencia y el init_point al que se redirige al comprador.
 */
export async function createPreference(
  accessToken: string,
  opts: CreatePreferenceOptions,
): Promise<CreatePreferenceResult> {
  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: opts.items.map((i) => ({ ...i, currency_id: "MXN" })),
      external_reference: opts.externalReference,
      notification_url: opts.notificationUrl,
      back_urls: opts.backUrls,
      auto_return: "approved",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.message === "string" ? data.message : `MercadoPago error ${res.status}`,
    );
  }
  return { id: data.id, initPoint: data.init_point };
}

export interface MercadoPagoPayment {
  id: string;
  status: string;
  externalReference: string | null;
}

/**
 * Consulta un pago en la cuenta del vendedor. status === "approved" ⇒ pagado.
 * externalReference debe coincidir con el id de la orden (defensa anti-spoof en el webhook).
 */
export async function getPayment(
  accessToken: string,
  paymentId: string,
): Promise<MercadoPagoPayment> {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.message === "string" ? data.message : `MercadoPago error ${res.status}`,
    );
  }
  return {
    id: String(data.id),
    status: data.status,
    externalReference: data.external_reference ?? null,
  };
}
