import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { logError } from "@/lib/safe-log";
import { csvDelReporte, resolverPeriodo } from "@/lib/sedes/reporte-consolidado-core";
import { accesoAlReporteDeSedes, hoyISOEn, reporteConsolidadoDeSedes } from "@/lib/sedes/reporte-consolidado.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/sedes/reporte?periodo=este-mes|mes-pasado|30-dias|este-anio|personalizado
 *                       [&desde=AAAA-MM-DD&hasta=AAAA-MM-DD][&formato=csv]
 *
 * Reporte consolidado de TODAS las sedes del dueño (ws1-t10, auditoría
 * BEVADENT · M6). Solo SUPER_ADMIN con plan que contempla sedes. Las sedes
 * salen de la sesión (supabaseId); ningún id de sede viaja en la petición.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const acceso = await accesoAlReporteDeSedes({ role: ctx.role, clinicId: ctx.clinicId });
  if (!acceso.ok) {
    return NextResponse.json(
      acceso.motivo === "rol"
        ? { error: "Solo el dueño de la cuenta puede ver el reporte de sedes.", code: "SEDES_ROL" }
        : { error: "Tu plan no incluye sedes. Cambia al plan Clínica para comparar sucursales.", code: "SEDES_PLAN" },
      { status: 403 },
    );
  }

  const q = req.nextUrl.searchParams;
  const hoy = hoyISOEn(acceso.timezone ?? "America/Mexico_City");
  const rango = resolverPeriodo(q.get("periodo"), hoy, q.get("desde"), q.get("hasta"));

  try {
    const reporte = await reporteConsolidadoDeSedes({
      supabaseId: ctx.user.supabaseId,
      clinicIdActiva: ctx.clinicId,
      rango,
    });
    if (q.get("formato") === "csv") {
      return new NextResponse(csvDelReporte(reporte), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="sedes-${rango.desdeISO}-a-${rango.hastaISO}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(reporte, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logError("[api/sedes/reporte GET]", err);
    return NextResponse.json({ error: "No se pudo armar el reporte de sedes" }, { status: 500 });
  }
}
