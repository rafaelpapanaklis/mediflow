// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/reports/propietario/enviar
//   body: { propertyId, from?, to? }
//   → { ok, channel, reason, error, url, expiresAt }
//
// EL UN CLIC. La queja literal de los usuarios de Tokko Broker es que
// generar un reporte de actividad al propietario es imposible en un clic;
// esto es ese clic: arma el reporte, firma la liga y la manda por WhatsApp.
//
// ── TRES DECISIONES QUE VALE LA PENA ENTENDER ──────────────────────────
//
// 1. VA LA LIGA, NO UN PDF ADJUNTO. El PDF se arma de la base en el momento
//    en que se abre. Un adjunto es una foto congelada: si el asesor manda
//    el reporte el lunes y el martes se registra una visita, el propietario
//    sigue viendo el lunes y llama a preguntar por qué.
//
// 2. SI LA VENTANA DE 24 h ESTÁ CERRADA, NO SE FINGE EL ENVÍO. No hay
//    plantilla aprobada para este reporte (las seis del vertical son de
//    prospecto, visita y cobranza) y Meta no deja escribir primero sin una.
//    Se contesta `reason: "window"` y la pantalla ofrece copiar la liga. Un
//    botón que dice "enviado" y no envía enseña a la gente a desconfiar del
//    panel entero.
//
// 3. LA LIGA VUELVE AUNQUE EL ENVÍO FALLE. Es el plan B, y el asesor la
//    necesita más justo cuando WhatsApp no pudo.
//
// 🔴 PERMISO: `activity` abre el reporte, pero MANDAR pide además
// `whatsapp.send`. Son cosas distintas: ver cómo va un inmueble no es lo
// mismo que gastar un mensaje del cupo de la cuenta escribiéndole a un
// cliente en nombre de la inmobiliaria.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { hasRealtyPermission } from "@/lib/realty-auth";
import { resolveRealtyBaseUrl } from "@/lib/realty/billing";
import { sendOwnerReport } from "@/lib/realty/reports";
import { gateReport, isDenied, reportError } from "../../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Un id de los que genera Prisma. Nada crudo llega a la consulta. */
function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function safeYmd(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function POST(req: NextRequest) {
  const gate = await gateReport("activity");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  if (
    !hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      "whatsapp.send",
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        reason: "plan",
        error: "No tienes permiso para mandar WhatsApp. Copia la liga y mándasela tú.",
      },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      propertyId?: unknown;
      from?: unknown;
      to?: unknown;
    };
    if (!safeId(body.propertyId)) {
      return NextResponse.json({ ok: false, error: "Falta el inmueble." }, { status: 400 });
    }

    const result = await sendOwnerReport(ctx, {
      propertyId: body.propertyId,
      // Fechas fuera de forma → null, y `getOwnerActivityReport` cae a su
      // periodo por omisión. No es un 400: el periodo lo pone la pantalla y
      // un reporte del periodo por omisión es mejor que un error.
      from: safeYmd(body.from),
      to: safeYmd(body.to),
      // El cron exige la variable de entorno; aquí sí hay petición de la
      // que sacar el origin, así que la liga sale bien incluso en preview.
      baseUrl: resolveRealtyBaseUrl(req.url),
      // Sin claimKey: el asesor SÍ puede reenviar el reporte a propósito.
      // La idempotencia es del barrido automático, no de un botón.
      claimKey: null,
      // Desde la pantalla no se cae al correo: el asesor tiene el botón de
      // copiar la liga enfrente y decide él por dónde mandarla.
      allowEmail: false,
    });

    // "El inmueble no existe" sí es 404. Lo demás —ventana cerrada, sin
    // teléfono, sin plan, sin cupo— es una RESPUESTA, no un error de la
    // petición: la pantalla la lee y explica qué pasó.
    if (result.reason === "not_found") {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return reportError("propietario/enviar:POST", e);
  }
}
