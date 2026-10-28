import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { buscarMedicamentos, hayMedicamentosPropios } from "@/lib/clinical/medicamentos-propios.server";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalogs/cums?q=&group=&limit=
 *
 * Catálogo de medicamentos: el GLOBAL (CUMS, sin clinicId) + los PROPIOS de la
 * clínica de la sesión (ws1-t10: «Agregar medicamento que no está»). Los de
 * otra clínica no salen nunca. `puedeAgregar` dice si el alta de propios está
 * disponible (= si Rafael ya pegó sql/cums-medicamentos-propios.sql); sin
 * ella el buscador funciona como siempre y el botón no aparece.
 *
 * Antes este endpoint cacheaba 24 h con unstable_cache por (q, group, limit).
 * Ya no: con medicamentos propios el resultado depende de la clínica y de lo
 * que acaba de dar de alta, y la consulta va por índice (descripción) sobre
 * unas 350 filas globales + las propias: no hace falta caché.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const group = (sp.get("group") ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);

  const [items, puedeAgregar] = await Promise.all([
    buscarMedicamentos({ q, group, limit, clinicId: ctx.clinicId }),
    hayMedicamentosPropios(),
  ]);

  return NextResponse.json({ items, count: items.length, puedeAgregar });
}
