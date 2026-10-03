// Suscripciones de Mercado Pago (`/preapproval`) y sus cobros
// (`/authorized_payments`) — cliente REST con fetch, como lib/mercadopago.ts.
// Sin SDK. Los campos son los del SDK oficial (mercadopago/sdk-nodejs,
// src/clients/preApproval y src/clients/invoice) y de la doc de México; no se
// inventa ninguno. Siempre con el token OAuth de la CLÍNICA.
//
// Errores, con el mismo contrato que `getPayment`:
//   · red, 5xx o 429 → LANZA (transitorio: el webhook responde 500 y MP reintenta);
//   · 401/403 → LANZA (el token de la clínica ya no sirve: no es «no existe»);
//   · otro 4xx en una consulta → null (no existe / no es de esta cuenta);
//   · otro 4xx al crear o actualizar → ErrorMp con el mensaje de MP.

import type { CobroMp } from "./core";

const MP_API = "https://api.mercadopago.com";

export class ErrorMp extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ErrorMp";
  }
}

export interface CrearSuscripcion {
  reason: string;
  externalReference: string;
  payerEmail: string;
  backUrl: string;
  autoRecurring: {
    frequency: number;
    frequency_type: "days" | "months";
    start_date: string;
    end_date: string;
    transaction_amount: number;
  };
}

export interface SuscripcionMp {
  id: string;
  status: string | null;
  initPoint: string | null;
  externalReference: string | null;
  collectorId: string | null;
  transactionAmount: number | null;
  nextPaymentDate: string | null;
}

function aSuscripcion(d: Record<string, any>): SuscripcionMp {
  const monto = Number(d?.auto_recurring?.transaction_amount);
  return {
    id: String(d.id ?? ""),
    status: typeof d.status === "string" ? d.status : null,
    initPoint: typeof d.init_point === "string" ? d.init_point : null,
    externalReference: d.external_reference != null ? String(d.external_reference) : null,
    collectorId: d.collector_id != null ? String(d.collector_id) : null,
    transactionAmount: Number.isFinite(monto) ? monto : null,
    nextPaymentDate: typeof d.next_payment_date === "string" ? d.next_payment_date : null,
  };
}

function aCobro(d: Record<string, any>): CobroMp {
  const monto = Number(d?.transaction_amount);
  const intento = Number(d?.retry_attempt);
  return {
    id: String(d.id ?? ""),
    preapprovalId: d.preapproval_id != null ? String(d.preapproval_id) : null,
    status: typeof d.status === "string" ? d.status : null,
    paymentId: d.payment?.id != null ? String(d.payment.id) : null,
    paymentStatus: typeof d.payment?.status === "string" ? d.payment.status : null,
    paymentStatusDetail: typeof d.payment?.status_detail === "string" ? d.payment.status_detail : null,
    transactionAmount: Number.isFinite(monto) ? monto : null,
    currencyId: typeof d.currency_id === "string" ? d.currency_id : null,
    debitDate: typeof d.debit_date === "string" ? d.debit_date : null,
    retryAttempt: Number.isFinite(intento) ? intento : null,
  };
}

async function llamar(
  token: string,
  ruta: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown; idempotencia?: string },
): Promise<{ ok: boolean; status: number; datos: any }> {
  const res = await fetch(`${MP_API}${ruta}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.idempotencia ? { "X-Idempotency-Key": init.idempotencia } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status >= 500 || res.status === 429) throw new Error(`MercadoPago error ${res.status}`);
  if (res.status === 401 || res.status === 403) throw new Error(`MercadoPago auth error ${res.status}`);
  const datos = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, datos };
}

function mensajeMp(datos: any, status: number): string {
  const m = typeof datos?.message === "string" ? datos.message : typeof datos?.error === "string" ? datos.error : "";
  return m ? `Mercado Pago (${status}): ${m}` : `Mercado Pago respondió ${status}`;
}

/** Ids de MP: alfanuméricos (preapproval) o numéricos (cobros, pagos). */
function idValido(id: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(id);
}

/**
 * POST /preapproval con `status: "pending"`: la suscripción nace SIN tarjeta y
 * el paciente la registra en el `init_point` de Mercado Pago.
 */
export async function crearSuscripcion(token: string, s: CrearSuscripcion): Promise<SuscripcionMp> {
  const r = await llamar(token, "/preapproval", {
    method: "POST",
    idempotencia: s.externalReference,
    body: {
      reason: s.reason,
      external_reference: s.externalReference,
      payer_email: s.payerEmail,
      auto_recurring: { ...s.autoRecurring, currency_id: "MXN" },
      back_url: s.backUrl,
      status: "pending",
    },
  });
  if (!r.ok) throw new ErrorMp(mensajeMp(r.datos, r.status), r.status);
  const sus = aSuscripcion(r.datos);
  if (!sus.id) throw new ErrorMp("Mercado Pago no devolvió la suscripción", r.status);
  return sus;
}

export async function consultarSuscripcion(token: string, id: string): Promise<SuscripcionMp | null> {
  if (!idValido(id)) return null;
  const r = await llamar(token, `/preapproval/${encodeURIComponent(id)}`, { method: "GET" });
  return r.ok ? aSuscripcion(r.datos) : null;
}

/** PUT /preapproval/{id}: solo `status` y/o `auto_recurring.transaction_amount` (lo que MP deja cambiar). */
export async function actualizarSuscripcion(
  token: string,
  id: string,
  cambio: { status?: "authorized" | "paused" | "cancelled"; monto?: number },
): Promise<SuscripcionMp> {
  if (!idValido(id)) throw new ErrorMp("id de suscripción inválido", 400);
  const body: Record<string, unknown> = {};
  if (cambio.status) body.status = cambio.status;
  if (cambio.monto != null) body.auto_recurring = { transaction_amount: cambio.monto, currency_id: "MXN" };
  const r = await llamar(token, `/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body });
  if (!r.ok) throw new ErrorMp(mensajeMp(r.datos, r.status), r.status);
  return aSuscripcion(r.datos);
}

export async function consultarCobro(token: string, id: string): Promise<CobroMp | null> {
  if (!idValido(id)) return null;
  const r = await llamar(token, `/authorized_payments/${encodeURIComponent(id)}`, { method: "GET" });
  return r.ok ? aCobro(r.datos) : null;
}

/** GET /authorized_payments/search?preapproval_id=… — el respaldo si un aviso no llegó. */
export async function buscarCobros(token: string, preapprovalId: string): Promise<CobroMp[]> {
  if (!idValido(preapprovalId)) return [];
  const q = new URLSearchParams({ preapproval_id: preapprovalId, limit: "50" });
  const r = await llamar(token, `/authorized_payments/search?${q}`, { method: "GET" });
  if (!r.ok) return [];
  return Array.isArray(r.datos?.results) ? r.datos.results.map(aCobro) : [];
}
