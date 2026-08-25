import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  RealtyForbiddenError,
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
} from "@/lib/realty-auth";
import {
  RealtyBillingError,
  getRealtyBillingAccount,
  getRealtyStripe,
  realtyStripeUnavailable,
  type RealtyBillingAccount,
} from "@/lib/realty/billing";

/**
 * Puerta común de las rutas de /api/realty/billing/**.
 *
 * 🔴 El accountId sale del CONTEXTO DE SESIÓN, nunca del body ni del query:
 * es lo que impide que una cuenta toque la suscripción de otra.
 * El permiso es `billing.manage`, que por default solo tiene el rol OWNER
 * (MANAGER está excluido a propósito en permissions.ts).
 */
export interface RealtyBillingAuth {
  ctx: RealtyContext;
  account: RealtyBillingAccount;
}

export function realtyBillingErrorResponse(err: unknown): NextResponse {
  if (err instanceof RealtyForbiddenError) {
    return NextResponse.json(
      { error: "No tienes permiso para administrar la suscripción.", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  if (err instanceof RealtyBillingError) {
    return NextResponse.json(
      { error: err.message, code: err.code, ...(err.extra ?? {}) },
      { status: err.status },
    );
  }
  console.error("[realty/billing]", err);
  return NextResponse.json(
    { error: "Error interno", code: "INTERNAL" },
    { status: 500 },
  );
}

export async function requireRealtyBilling(): Promise<RealtyBillingAuth | NextResponse> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "No autorizado", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }
  try {
    assertRealtyPermission(ctx, "billing.manage");
    const account = await getRealtyBillingAccount(ctx);
    return { ctx, account };
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}

/** Cliente Stripe o un 503 honesto. Nunca truena por falta de env. */
export function requireRealtyStripe(): Stripe | NextResponse {
  const stripe = getRealtyStripe();
  if (!stripe) return NextResponse.json(realtyStripeUnavailable(), { status: 503 });
  return stripe;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}
