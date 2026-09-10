import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduAiQuotaChanges } from "@/lib/edu/ia-cupo-historial";

export const dynamic = "force-dynamic";

/**
 * GET — EL HISTORIAL DEL CUPO DE IA.
 *
 * El propio `EduAiQuota` lo dejó escrito en el esquema: sus dos columnas
 * de autoría «guardan el ÚLTIMO cambio, no la historia: si algún día hace
 * falta la historia del cupo, es una tabla aparte y no una columna más».
 *
 * Encender el excedente y subir el tope duro cuestan dinero real de la
 * escuela, y «quién lo subió y cuándo» no se contesta con dos columnas que
 * se pisan en cada guardado.
 *
 * 🔴 PERMISO `ia.view`: la misma pantalla que ya enseña el cupo. Ninguna
 * key nueva.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("ia.view");
  if ("response" in g) return g.response;
  try {
    const take = Number.parseInt(new URL(request.url).searchParams.get("take") ?? "50", 10);
    return NextResponse.json({ rows: await listEduAiQuotaChanges(g.ctx, take) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/ia/cupo-historial");
  }
}
