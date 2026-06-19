import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { listOrigins } from "@/lib/import/profiles";

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/import/origins  (WS2-T2)
// Catálogo de orígenes para el wizard "Importar mi clínica": id, nombre, si
// tiene perfil de auto-mapeo, instrucciones "cómo exportar" y diccionario de
// mapeo (columna del sistema → campo de DaleControl).
//
// Datos ESTÁTICOS (no tocan DB ni dependen de la clínica), pero el endpoint
// vive en el panel: se exige sesión (no se expone sin autenticar) sin filtrar
// por clinicId. Responde el array tal cual (forma del contrato: Origin[]).
// ═══════════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 60, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  return NextResponse.json(listOrigins());
}
