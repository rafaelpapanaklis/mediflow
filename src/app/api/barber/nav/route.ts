import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { resolveBarberNav } from "@/lib/barber/nav";

export const dynamic = "force-dynamic";

/**
 * GET /api/barber/nav — el menú lateral de la sesión, tal como lo arma el
 * layout (resolveBarberNav, el mismo cálculo). Lo pide BarberSidebar en cada
 * navegación interna: Next conserva el layout entre páginas, y sin esto una
 * entrada que el dueño acaba de quitar seguía en el menú hasta recargar (m4,
 * auditoría de permisos 16-nov). Sin permiso propio: cada quien recibe solo
 * SU menú, recortado por sus permisos, su plan y su pago.
 */
export async function GET() {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (ctx.mustChangePassword) return NextResponse.json({ error: "Cambia tu contraseña" }, { status: 403 });
  try {
    const items = await resolveBarberNav(ctx);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[barber-nav]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
