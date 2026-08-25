import { NextResponse } from "next/server";
import {
  getBarberAffiliateSummary,
  rootBarbershopIdOf,
  saveBarberAffiliatePayout,
} from "@/lib/barber/affiliates";
import { affiliatesErrorResponse, readJsonBody, requireBarberAffiliates } from "../_lib";

/**
 * POST /api/barber/affiliates/payout — a dónde le depositamos al socio.
 *
 * Texto libre a propósito (CLABE, banco y titular, "efectivo en la
 * sucursal"): el pago lo hace Rafael a mano, no hay dispersión automática
 * que exija un formato. Lo guardamos para que al pagar tenga los datos a la
 * vista, y el comprobante vuelve en la comisión (payoutRef/payoutProofUrl).
 */
export const dynamic = "force-dynamic";

const MAX_METHOD = 80;
const MAX_DETAILS = 240;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, max);
  return v.length > 0 ? v : null;
}

export async function POST(req: Request) {
  const auth = await requireBarberAffiliates();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readJsonBody(req);
    const saved = await saveBarberAffiliatePayout(
      rootBarbershopIdOf(auth.ctx),
      clean(body.method, MAX_METHOD),
      clean(body.details, MAX_DETAILS),
    );
    if (!saved) {
      return NextResponse.json(
        {
          ok: false,
          code: "SCHEMA_MISSING",
          error: "El programa de socios todavía no está activado en esta instalación.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, summary: await getBarberAffiliateSummary(auth.ctx) });
  } catch (err) {
    return affiliatesErrorResponse(err);
  }
}
