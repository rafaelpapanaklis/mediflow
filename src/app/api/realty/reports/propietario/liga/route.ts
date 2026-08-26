// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/propietario/liga?propertyId=&from=&to=
//     → { url, expiresAt, expiresInDays }
//
// El plan B —y el que más se va a usar. El asesor la copia y la pega donde
// quiera: por el WhatsApp de su celular, por correo, en el grupo del
// condominio. No todo propietario está en la ventana de 24 h de Meta y no
// todo asesor quiere gastar un mensaje del cupo de la cuenta.
//
// 🔴 SE FIRMA UNA LIGA NUEVA EN CADA CLIC, a propósito. Emitir es barato
// (un HMAC) y no hay nada que revocar: la liga no lleva permisos, lleva
// QUIÉN la emitió, y el alcance se vuelve a derivar de la base cada vez que
// alguien la abre. Guardar la última emitida solo serviría para tener que
// invalidarla algún día.
//
// El reporte se calcula ANTES de firmar. Suena redundante —el PDF lo va a
// volver a calcular— y no lo es: evita entregarle al asesor una liga a un
// inmueble que ya no está en su alcance, que abriría en un 404 justo cuando
// el propietario le da clic.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { resolveRealtyBaseUrl } from "@/lib/realty/billing";
import {
  REPORT_LINK_DAYS,
  getOwnerActivityReport,
  packReportToken,
  reportPublicUrl,
} from "@/lib/realty/reports";
import { gateReport, idFromQuery, isDenied, rangeFromQuery, reportError } from "../../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await gateReport("activity");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const sp = req.nextUrl.searchParams;
    const propertyId = idFromQuery(sp, "propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Falta el inmueble." }, { status: 400 });
    }
    const range = rangeFromQuery(ctx, sp);

    const report = await getOwnerActivityReport(ctx, {
      propertyId,
      from: range.from,
      to: range.to,
    });
    // 404 y no 403: un inmueble de otra cuenta y uno que no existe tienen
    // que contestar EXACTAMENTE lo mismo.
    if (!report) {
      return NextResponse.json({ error: "Ese inmueble ya no existe." }, { status: 404 });
    }

    const packed = packReportToken({
      realtyUserId: ctx.realtyUserId,
      propertyId: report.propertyId,
      from: report.from,
      to: report.to,
    });
    if (!packed) {
      // Producción sin COOKIE_SECRET: falla CERRADO. Más vale un botón que
      // dice "no se pudo" que una liga que el propietario abre en un error.
      return NextResponse.json(
        { error: "No se pudo firmar la liga del reporte. Avísale a soporte." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        url: reportPublicUrl(resolveRealtyBaseUrl(req.url), packed.token),
        expiresAt: packed.expiresAt.toISOString(),
        expiresInDays: REPORT_LINK_DAYS,
      },
      // Una liga firmada no se guarda en ninguna caché intermedia.
      { headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" } },
    );
  } catch (e) {
    return reportError("propietario/liga:GET", e);
  }
}
