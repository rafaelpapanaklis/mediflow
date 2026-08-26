// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/screening → historial de investigaciones
// POST /api/realty/screening → capturar una nueva
//
// Nace SIEMPRE en PENDIENTE_CONSENTIMIENTO. No hay parámetro para saltarse
// ese paso, ni aquí ni en la capa de abajo: quien la captura es alguien del
// equipo, quien la autoriza es el investigado, y son dos actos distintos.
//
// La feature que abre esto es `rentals` y NO una llave nueva: la
// investigación cuelga del contrato de renta y está en los tres planes a
// propósito — es ingreso que NO depende de la suscripción.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_SCREENING_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  RealtyScreeningError,
  createScreeningRequest,
  listScreeningRequests,
  normalizeApplicant,
  screeningErrorStatus,
} from "@/lib/realty/screening";
import type { RealtyScreeningTier } from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "leases.manage",
    feature: REALTY_SCREENING_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const contactId = req.nextUrl.searchParams.get("contactId");
  const leaseId = req.nextUrl.searchParams.get("leaseId");

  const requests = await listScreeningRequests(gate.ctx.accountId, {
    contactId,
    leaseId,
    limit: 60,
  });
  return NextResponse.json({ requests });
}

export async function POST(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "leases.manage",
    feature: REALTY_SCREENING_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const contactId = typeof body.contactId === "string" ? body.contactId : "";
  if (!contactId) return NextResponse.json({ error: "Falta el contacto." }, { status: 400 });

  try {
    const id = await createScreeningRequest(gate.ctx, {
      contactId,
      tier: (body.tier === "COMPLETA" ? "COMPLETA" : "BASICA") as RealtyScreeningTier,
      leaseId: typeof body.leaseId === "string" ? body.leaseId : null,
      propertyId: typeof body.propertyId === "string" ? body.propertyId : null,
      leasePartyId: typeof body.leasePartyId === "string" ? body.leasePartyId : null,
      // Normaliza aquí también: la capa de abajo lo vuelve a hacer, pero
      // así el 400 por "falta CURP o RFC" sale con el mismo criterio con el
      // que se va a guardar.
      applicant: normalizeApplicant(body.applicant),
    });
    return NextResponse.json({ ok: true, requestId: id }, { status: 201 });
  } catch (err) {
    if (err instanceof RealtyScreeningError) {
      return NextResponse.json({ error: err.message }, { status: screeningErrorStatus(err.code) });
    }
    console.error("[api/realty/screening] POST:", err);
    return NextResponse.json({ error: "No se pudo capturar la solicitud." }, { status: 500 });
  }
}
