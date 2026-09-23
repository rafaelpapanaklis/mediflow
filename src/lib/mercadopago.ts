// MercadoPago REST wrapper — token POR VENDEDOR (cada lab/proveedor pega su propio
// access token; el cobro va DIRECTO a su cuenta, sin comisión DaleControl). Sin SDK:
// fetch nativo.

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
  // ── Opcionales (anticipo por WhatsApp, WS1-T5). Labs y proveedores no los
  //    mandan y su preferencia sale exactamente igual que antes. ──
  /**
   * Comisión del marketplace en PESOS (MP no acepta porcentaje). Solo tiene
   * efecto con un token obtenido por OAuth de la aplicación de DaleControl.
   * 0 o ausente = no se manda.
   */
  marketplaceFee?: number;
  /** El link deja de aceptar pagos a esta hora (expires + expiration_date_to). */
  expiresAt?: Date;
  /** true = el pago solo puede quedar aprobado o rechazado, nunca «pendiente». */
  binaryMode?: boolean;
  /** Tipos de pago que no se ofrecen (p. ej. "ticket" = OXXO, "atm"). */
  excludedPaymentTypes?: string[];
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
      ...(opts.marketplaceFee && opts.marketplaceFee > 0
        ? { marketplace_fee: opts.marketplaceFee }
        : {}),
      ...(opts.expiresAt
        ? {
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: opts.expiresAt.toISOString(),
          }
        : {}),
      ...(opts.binaryMode ? { binary_mode: true } : {}),
      ...(opts.excludedPaymentTypes?.length
        ? {
            payment_methods: {
              excluded_payment_types: opts.excludedPaymentTypes.map((id) => ({ id })),
            },
          }
        : {}),
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

/**
 * Cierra una preferencia para que deje de aceptar pagos (ws1-t1: el saldo de la
 * factura cambió y se hizo otro link). PUT con `expiration_date_to` = ahora.
 * Lanza si MP no lo acepta; quien llama decide si eso importa.
 */
export async function expirePreference(
  accessToken: string,
  preferenceId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!/^[\w-]+$/.test(preferenceId)) throw new Error("preferencia inválida");
  const res = await fetch(`${MP_API}/checkout/preferences/${preferenceId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expires: true, expiration_date_to: now.toISOString() }),
  });
  if (!res.ok) throw new Error(`MercadoPago error ${res.status}`);
}

export interface MercadoPagoPayment {
  id: string;
  status: string;
  externalReference: string | null;
  /** Monto realmente pagado (transaction_amount de MP, MXN). null si MP no lo manda. */
  transactionAmount: number | null;
  /** Moneda del pago (currency_id de MP, ej. "MXN"). null si MP no la manda. */
  currencyId: string | null;
  /**
   * Lo ya devuelto al comprador (transaction_amount_refunded de MP, MXN). Un
   * reembolso PARCIAL deja el pago `approved` con esto > 0. null si no viene.
   */
  transactionAmountRefunded: number | null;
  // ── Campos añadidos para el anticipo por WhatsApp (WS1-T5): solo lectura. ──
  /**
   * status_detail de MP: `cc_rejected_insufficient_amount` en un rechazo,
   * `reimbursed` en un contracargo que MP nos cubrió.
   */
  statusDetail: string | null;
  /** Cuándo lo aprobó MP (date_approved), ISO. */
  dateApproved: string | null;
  /** Cuenta que cobró (collector_id). */
  collectorId: string | null;
  payerEmail: string | null;
  paymentMethodId: string | null;
}

export interface GetPaymentOptions {
  /**
   * true = un 401/403 de MP LANZA en vez de devolver null. Con un token de
   * OAuth, 401 significa «el token ya no sirve» (la clínica revocó el permiso o
   * caducó), no «el pago no existe»: tragarlo con un 200 perdería el pago.
   */
  throwOnAuthError?: boolean;
}

/**
 * Consulta un pago en la cuenta del vendedor. status === "approved" ⇒ pagado.
 * externalReference debe coincidir con el id de la orden Y transactionAmount
 * cubrir el total (defensa anti-spoof y anti-monto-menor en el webhook).
 *
 * Contrato de errores (el webhook lo usa para decidir su status code):
 *  · Devuelve null en fallas DETERMINISTAS: paymentId no 100% numérico (nunca
 *    se fetchea — el id viaja en la URL de la API de MP, evita path traversal)
 *    o respuesta 4xx de MP (pago inexistente / token inválido). Reintentar la
 *    notificación no cambiaría nada.
 *  · LANZA en fallas TRANSITORIAS: red caída (el fetch lanza solo) o 5xx/429
 *    de MP. El webhook responde 500 y MercadoPago reintenta la notificación.
 */
export async function getPayment(
  accessToken: string,
  paymentId: string,
  options: GetPaymentOptions = {},
): Promise<MercadoPagoPayment | null> {
  if (!/^\d+$/.test(paymentId)) return null;

  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status >= 500 || res.status === 429) {
    throw new Error(`MercadoPago error ${res.status}`);
  }
  if (options.throwOnAuthError && (res.status === 401 || res.status === 403)) {
    throw new Error(`MercadoPago auth error ${res.status}`);
  }
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  return {
    id: String(data.id),
    status: data.status,
    externalReference: data.external_reference ?? null,
    transactionAmount:
      typeof data.transaction_amount === "number" && Number.isFinite(data.transaction_amount)
        ? data.transaction_amount
        : null,
    currencyId: typeof data.currency_id === "string" ? data.currency_id : null,
    transactionAmountRefunded:
      typeof data.transaction_amount_refunded === "number" && Number.isFinite(data.transaction_amount_refunded)
        ? data.transaction_amount_refunded
        : null,
    statusDetail: typeof data.status_detail === "string" ? data.status_detail : null,
    dateApproved: typeof data.date_approved === "string" ? data.date_approved : null,
    collectorId: data.collector_id != null ? String(data.collector_id) : null,
    payerEmail: typeof data.payer?.email === "string" ? data.payer.email : null,
    paymentMethodId: typeof data.payment_method_id === "string" ? data.payment_method_id : null,
  };
}
