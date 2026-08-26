// ═══════════════════════════════════════════════════════════════════════
// GET    /api/realty/screening/[requestId]        → el expediente
// PATCH  /api/realty/screening/[requestId]        → avanzarla
// DELETE /api/realty/screening/[requestId]        → cancelarla
//
// El PATCH lleva `action`, y el ORDEN de las acciones ES el flujo legal:
//
//   consent  → EL INVESTIGADO AUTORIZA. Se guarda el texto que aceptó, su
//              nombre tal cual lo escribió, la fecha, la IP y el navegador.
//   submit   → se manda al proveedor. 🔴 Sin `consentAt` esto revienta con
//              422 antes de tocar a nadie, y la base lo repite con un CHECK.
//   result   → alguien de DaleControl sube el resultado (proveedor MANUAL).
//
// 🔴 POR QUÉ EL CONSENTIMIENTO SE CAPTURA AQUÍ Y NO EN UNA LIGA PÚBLICA:
// una liga pública a la que llega cualquiera con el id sería más cómoda y
// mucho peor — el que abre el correo puede no ser el investigado. Aquí lo
// autoriza estando presente (o en el teléfono del asesor), y se guarda la
// IP del acto. `namesLookAlike` rechaza una firma que no se parezca a su
// nombre: una autorización firmada "aaa" es no tener autorización.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_SCREENING_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  RealtyScreeningError,
  cancelScreeningRequest,
  deliverScreeningResult,
  getScreeningConsentView,
  getScreeningRequest,
  recordScreeningConsent,
  screeningErrorStatus,
  submitScreeningRequest,
} from "@/lib/realty/screening";
import type {
  RealtyScreeningRecommendation,
  RealtyScreeningRiskLevel,
} from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECOMMENDATIONS = ["APROBADO", "APROBADO_CON_AVAL", "RECHAZADO", "SIN_DICTAMEN"];
const RISK_LEVELS = ["BAJO", "MEDIO", "ALTO", "SIN_DATO"];

/**
 * IP del cliente. Detrás de Vercel la real es la PRIMERA de x-forwarded-for;
 * las siguientes son los saltos. Tomar la última guardaría la del proxy.
 */
function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip");
}

export async function GET(req: NextRequest, { params }: { params: { requestId: string } }) {
  const gate = await openRealtyGrowthGate({
    permission: "leases.manage",
    feature: REALTY_SCREENING_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  // `?view=consent` devuelve la vista MÍNIMA para la pantalla donde firma
  // el investigado: quién investiga, qué se consulta y el texto que acepta.
  // Nunca el resultado, nunca el CURP, nunca las referencias.
  if (req.nextUrl.searchParams.get("view") === "consent") {
    const view = await getScreeningConsentView(ctx.accountId, params.requestId, ctx.account.name);
    if (!view) return NextResponse.json({ error: "No existe." }, { status: 404 });
    return NextResponse.json({ consent: view, accountName: ctx.account.name });
  }

  const request = await getScreeningRequest(ctx.accountId, params.requestId);
  if (!request) return NextResponse.json({ error: "No existe." }, { status: 404 });
  return NextResponse.json({ request });
}

export async function PATCH(req: NextRequest, { params }: { params: { requestId: string } }) {
  const gate = await openRealtyGrowthGate({
    permission: "leases.manage",
    feature: REALTY_SCREENING_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");

  try {
    if (action === "consent") {
      const ok = await recordScreeningConsent({
        accountId: ctx.accountId,
        requestId: params.requestId,
        consentName: String(body?.consentName ?? ""),
        accountName: ctx.account.name,
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent"),
      });
      if (!ok) {
        return NextResponse.json({ error: "No se pudo registrar la autorización." }, { status: 409 });
      }
      return NextResponse.json({ ok: true, status: "SOLICITADA" });
    }

    if (action === "submit") {
      const result = await submitScreeningRequest({
        accountId: ctx.accountId,
        accountName: ctx.account.name,
        accountEmail: ctx.account.email ?? null,
        requestId: params.requestId,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error ?? "El proveedor no la aceptó." }, { status: 502 });
      }
      return NextResponse.json({ ok: true, status: result.status });
    }

    if (action === "result") {
      const recommendation = RECOMMENDATIONS.includes(String(body?.recommendation))
        ? (String(body?.recommendation) as RealtyScreeningRecommendation)
        : null;
      const riskLevel = RISK_LEVELS.includes(String(body?.riskLevel))
        ? (String(body?.riskLevel) as RealtyScreeningRiskLevel)
        : null;
      const resultUrl = typeof body?.resultUrl === "string" ? body.resultUrl.trim() : "";

      // La liga del resultado se guarda solo si es https. Un http:// aquí
      // es un expediente con datos de buró viajando en claro.
      if (resultUrl && !/^https:\/\//i.test(resultUrl)) {
        return NextResponse.json(
          { error: "La liga del resultado tiene que ser https.", field: "resultUrl" },
          { status: 400 },
        );
      }

      const ok = await deliverScreeningResult({
        accountId: ctx.accountId,
        requestId: params.requestId,
        resultUrl: resultUrl || null,
        resultSummary:
          typeof body?.resultSummary === "string" ? body.resultSummary.slice(0, 4000) : null,
        riskLevel,
        recommendation,
      });
      if (!ok) return NextResponse.json({ error: "No se pudo guardar." }, { status: 409 });
      return NextResponse.json({ ok: true, status: "LISTA" });
    }

    return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  } catch (err) {
    if (err instanceof RealtyScreeningError) {
      return NextResponse.json({ error: err.message }, { status: screeningErrorStatus(err.code) });
    }
    console.error("[api/realty/screening/:id] PATCH:", err);
    return NextResponse.json({ error: "No se pudo procesar." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { requestId: string } }) {
  const gate = await openRealtyGrowthGate({
    permission: "leases.manage",
    feature: REALTY_SCREENING_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const ok = await cancelScreeningRequest(gate.ctx.accountId, params.requestId);
  if (!ok) {
    // Una LISTA no se cancela: el resultado ya se entregó y se pagó.
    return NextResponse.json(
      { error: "No se puede cancelar: no existe o ya tiene resultado." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
