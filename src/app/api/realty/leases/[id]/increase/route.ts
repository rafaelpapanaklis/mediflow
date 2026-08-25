// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/leases/[id]/increase → el aumento SUGERIDO + el tope
// POST /api/realty/leases/[id]/increase → aplicarlo
//
// 🔴 EL TOPE DE LA CDMX ES UNA REJA, NO UN TEXTO DE AYUDA.
// Si el inmueble está en la Ciudad de México y el porcentaje pasa la
// inflación del año anterior, el POST responde 409 con code "OVER_CAP" y
// NO guarda nada. Solo se guarda si vuelve con overCapAcknowledged: true,
// y entonces la confirmación queda REGISTRADA en las notas del contrato
// (con fecha, usuario, tope y motivo). Ver src/lib/realty/inpc.ts.
//
// Si el INPC todavía no está capturado en realty_calc_params (lo llena otra
// terminal), el GET devuelve inpcPct: null y missing: "INPC_SIN_CAPTURAR".
// La pantalla pide el porcentaje a mano y lo dice — no truena ni inventa.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  applyIncrease,
  previewIncrease,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  readJson,
} from "@/lib/realty/leases";
import { buildIncreaseNotice, formatPct } from "@/lib/realty/inpc";
import { formatCents, formatMoney, monthLabel, parseMonthKey } from "@/lib/realty/rent-charges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    // `desde` cuenta los cargos con EL MISMO criterio que usa el POST, para
    // que "se van a actualizar N cobros" no se equivoque por uno.
    const preview = await previewIncrease(
      ctx,
      params.id,
      undefined,
      req.nextUrl.searchParams.get("desde") ?? undefined,
    );
    return NextResponse.json({ preview });
  } catch (err) {
    return realtyApiError(err, "leases:increase-preview");
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    const body = await readJson(req);
    const before = await previewIncrease(ctx, params.id);

    const result = await applyIncrease(ctx, params.id, {
      pct: Number(body.pct),
      effectiveFromMonth: String(body.effectiveFromMonth ?? ""),
      overCapAcknowledged: body.overCapAcknowledged === true,
      overCapReason: typeof body.overCapReason === "string" ? body.overCapReason : "",
    });

    // El aviso que el dueño le manda al inquilino, ya redactado. Sale de
    // aquí (y no de la pantalla) para que diga exactamente lo que se aplicó.
    const fromMonth = String(body.effectiveFromMonth ?? "");
    const parsed = parseMonthKey(fromMonth);
    const notice = buildIncreaseNotice({
      tenantName: before.tenantName,
      propertyTitle: before.propertyTitle,
      landlordName: ctx.account.name,
      currentRentLabel: formatCents(before.currentRentCents, before.currency),
      newRentLabel: formatMoney(result.newRent, before.currency),
      pct: Number(body.pct),
      effectiveFromLabel: parsed
        ? `1 de ${monthLabel(fromMonth).toLowerCase()}`
        : "la fecha pactada",
      cdmx: before.cdmx,
      capPct: result.capPct,
      inpcYear: before.inpcYear,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      capLabel: formatPct(result.capPct),
      notice,
    });
  } catch (err) {
    return realtyApiError(err, "leases:increase-apply");
  }
}
