// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/leases/[id]/estado-cuenta → estado de cuenta del contrato
//     ?formato=csv  → descarga para Excel (con BOM, para los acentos)
//     ?propiedad=1  → el estado de cuenta del INMUEBLE (todos sus contratos)
//
// Cargos y pagos en orden, con saldo corriente. Es lo que se le manda al
// inquilino cuando pregunta "¿cuánto debo?".
//
// 🔴 Esto es un ESTADO DE CUENTA, no una factura: este vertical no timbra
// nada y ninguna columna dice CFDI.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  getLeaseStatement,
  getPropertyStatement,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  statementToCsv,
} from "@/lib/realty/leases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "payments.manage");
  } catch {
    return realtyForbidden("payments.manage");
  }

  try {
    const sp = req.nextUrl.searchParams;
    // Con ?propiedad=1 el [id] de la ruta es el del INMUEBLE, no el del
    // contrato: así el dueño ve la historia completa de la casa aunque haya
    // pasado por tres inquilinos.
    const moneda = sp.get("moneda");
    const currency = moneda === "USD" || moneda === "MXN" ? moneda : undefined;
    const statement =
      sp.get("propiedad") === "1"
        ? await getPropertyStatement(ctx, params.id, currency)
        : await getLeaseStatement(ctx, params.id);

    if (sp.get("formato") === "csv") {
      const slug = statement.title
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40)
        .toLowerCase();
      const fileName = `estado-de-cuenta-${slug || "inmueble"}-${statement.generatedAt.slice(0, 10)}.csv`;
      return new NextResponse(statementToCsv(statement), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return NextResponse.json({ statement });
  } catch (err) {
    return realtyApiError(err, "leases:statement");
  }
}
