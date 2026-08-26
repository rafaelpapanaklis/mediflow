// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/propietario/pdf
//
// DOS PUERTAS, y solo dos:
//   1. ?propertyId=…&from=…&to=…  con SESIÓN del panel → el asesor.
//   2. ?t=<token firmado>          SIN sesión          → el propietario.
//
// 🔴 LA SEGUNDA ES LA ÚNICA RUTA DE TODO EL VERTICAL QUE CONTESTA SIN
// SESIÓN, y por eso conviene entender exactamente qué la protege:
//
//   · El token va firmado con HMAC-SHA256 y se compara en tiempo constante.
//     Sin el secreto no se puede fabricar uno, y en producción sin secreto
//     no se firma NI se acepta nada (falla cerrado).
//   · No lleva permisos: lleva QUIÉN lo emitió. El alcance se vuelve a
//     derivar de la base en cada petición con el MISMO
//     `getOwnerActivityReport` de la pantalla. Si al asesor lo dan de baja
//     o el inmueble sale de su alcance, la liga deja de abrir sola.
//   · Caduca a los 30 días.
//   · No hay enumeración posible: el propertyId va DENTRO de la firma, así
//     que cambiarle una letra a la URL invalida el token entero.
//
// Y lleva `X-Robots-Tag: noindex`: una liga que alguien pegue en una
// publicación no puede acabar en Google.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { OwnerReportPdf } from "@/components/realty/reports/report-pdf";
import {
  contextFromReportToken,
  getOwnerActivityReport,
  getReportAccess,
  readReportToken,
} from "@/lib/realty/reports";
import { brandFor, gateReport, idFromQuery, isDenied, pdfResponse, rangeFromQuery, reportError } from "../../_guard";

// @react-pdf/renderer NO corre en edge: necesita Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** La misma respuesta para "no existe", "caducó" y "no es tuyo". */
function gone(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Esta liga ya no funciona. Pídele a tu asesor que te mande el reporte otra vez.",
    },
    { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } },
  );
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("t");

  try {
    // ── Puerta 2: la liga del propietario ──
    if (raw) {
      const token = readReportToken(raw);
      if (!token) return gone();

      const ctx = await contextFromReportToken(token);
      if (!ctx) return gone();
      // El bloque se comprueba IGUAL que con sesión: si al asesor le
      // quitaron `leads.view`, su liga deja de abrir. La firma no es un
      // permiso, solo dice quién la emitió.
      if (!getReportAccess(ctx).activity) return gone();

      const report = await getOwnerActivityReport(ctx, {
        propertyId: token.propertyId,
        from: token.from,
        to: token.to,
      });
      if (!report) return gone();

      const buffer = await renderToBuffer(
        <OwnerReportPdf report={report} brand={await brandFor(ctx)} />,
      );
      const res = pdfResponse(buffer, `reporte-${report.propertyTitle}-${report.to}`);
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
      return res;
    }

    // ── Puerta 1: el asesor, con su sesión ──
    const gate = await gateReport("activity");
    if (isDenied(gate)) return gate.response;
    const { ctx } = gate;

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
    if (!report) {
      return NextResponse.json({ error: "Ese inmueble ya no existe." }, { status: 404 });
    }

    const buffer = await renderToBuffer(
      <OwnerReportPdf report={report} brand={await brandFor(ctx)} />,
    );
    return pdfResponse(buffer, `reporte-${report.propertyTitle}-${report.to}`);
  } catch (e) {
    return reportError("propietario/pdf:GET", e);
  }
}
