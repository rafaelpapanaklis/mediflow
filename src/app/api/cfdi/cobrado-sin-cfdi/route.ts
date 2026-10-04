// GET /api/cfdi/cobrado-sin-cfdi?mes=YYYY-MM[&formato=csv] (ws1-t8, auditoría CFDI F-09).
//
// Lo cobrado en el mes que NO tiene CFDI propio: la lista para la factura global del contador.
// Reglas en lib/cfdi/cobrado-sin-cfdi.ts. Solo dueño y administrador (como timbrar y como el
// listado de CFDI): es información fiscal de la clínica. Sin nombres de pacientes: la global va a
// «público en general» y basta con el folio de la nota para rastrear cada cobro.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { esMesValido, csvDelReporte } from "@/lib/cfdi/cobrado-sin-cfdi";
import { reporteCobradoSinCfdi, mesActual } from "@/lib/cfdi/cobrado-sin-cfdi.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 20, 60 * 1000);
  if (rl) return rl;
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  let mes = req.nextUrl.searchParams.get("mes");
  if (!mes) {
    const c = await prisma.clinic.findUnique({ where: { id: ctx!.clinicId }, select: { timezone: true } });
    mes = mesActual(c?.timezone);
  }
  if (!esMesValido(mes)) return NextResponse.json({ error: "Mes inválido: usa AAAA-MM." }, { status: 400 });

  const reporte = await reporteCobradoSinCfdi(ctx!.clinicId, mes);

  if (req.nextUrl.searchParams.get("formato") === "csv") {
    return new NextResponse(csvDelReporte(reporte), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cobrado-sin-cfdi-${mes}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return NextResponse.json(reporte);
}
