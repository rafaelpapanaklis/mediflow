import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduCampusesAsignables } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/equipo/sedes — las sedes que se pueden marcar al dar
 * de alta a alguien, o al editarlo (H-112).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ NO SE REUSA GET /api/instituto/sedes. Ése exige `sedes.view`,
 * que es el permiso de ADMINISTRAR la geografía de la escuela, y quien da
 * de alta cuentas tiene `equipo.manage` — que se presta por override a un
 * coordinador académico sin darle la pantalla de sedes. Con el otro
 * endpoint, ese coordinador abriría el diálogo de alta y vería el selector
 * vacío: cero sedes, sin explicación, y crearía cuarenta cuentas con acceso
 * al instituto entero sin enterarse.
 *
 * Quien puede CREAR una cuenta puede decidir a qué sede entra —es la misma
 * decisión, tomada en el mismo momento— así que el permiso correcto para
 * leer esta lista es `equipo.manage`. Y NO es una key nueva: el catálogo de
 * permisos no crece con esta ola.
 *
 * 🔴 QUÉ DEVUELVE, Y NADA MÁS: id, nombre, clave y zona horaria de las
 * sedes ACTIVAS. Ni conteos, ni direcciones, ni quién entra a cada una —
 * eso es la pantalla de sedes y tiene su propio permiso.
 *
 * ⚠️ Un instituto SIN sedes devuelve una lista vacía y eso está bien: casi
 * todas las escuelas tienen una sola sede y no usan esta ola. La pantalla
 * esconde el selector entero en ese caso, igual que el shell esconde el
 * cambiador de sede cuando solo hay una.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function GET() {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    return NextResponse.json({ rows: await listEduCampusesAsignables(g.ctx) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/equipo/sedes");
  }
}
