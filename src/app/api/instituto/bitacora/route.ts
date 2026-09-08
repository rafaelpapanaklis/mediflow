import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduAuditLog } from "@/lib/edu/auditoria";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/bitacora — LA BITÁCORA del instituto (NOM-024).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PERMISO: `direccion.panel`, que solo lleva DIRECCION por defecto.
 * Ninguna key nueva ("auditoria.view"): una key nueva no le llega a nadie
 * con `permissionsOverride` guardado y habría exigido backfill en SQL.
 *
 * 🔴 SIN RECORTE POR ALCANCE CLÍNICO, y es deliberado: quien abre esta
 * pantalla ya ve la escuela entera, y una bitácora recortada tendría
 * huecos que se leen como «no pasó». Una bitácora incompleta es peor que
 * ninguna.
 *
 * Filtros por query: `patientId`, `actorUserId`, `entity`, `action`.
 * Paginación por `cursor` + `take` (50 por defecto, 200 de tope).
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("direccion.panel");
  if ("response" in g) return g.response;
  try {
    const url = new URL(request.url);
    const page = await listEduAuditLog(g.ctx, {
      patientId: url.searchParams.get("patientId"),
      actorUserId: url.searchParams.get("actorUserId"),
      entity: url.searchParams.get("entity"),
      action: url.searchParams.get("action"),
      cursor: url.searchParams.get("cursor"),
      take: url.searchParams.get("take"),
    });
    return NextResponse.json(page);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/bitacora");
  }
}
