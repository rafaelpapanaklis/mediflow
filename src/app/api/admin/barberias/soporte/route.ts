import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  BarberAdminError,
  getBarberSupportMetrics,
  listAdminBarberTickets,
} from "@/lib/barber/admin";

// ═══════════════════════════════════════════════════════════════════════
// /api/admin/barberias/soporte — bandeja de tickets de TODAS las barberías.
//   GET ?status=&priority=&category=&barbershopId=&q=&metrics=1
//     → { tickets } (+ { metrics } si metrics=1)
//   status acepta el pseudo-valor "OPEN" = todos los que no están cerrados.
//
// Ruta HERMANA estática de /api/admin/barberias/[id]: en el App Router un
// segmento estático gana al dinámico, así que "soporte" nunca se cuela como
// id de barbería.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const filters = {
      status: sp.get("status"),
      priority: sp.get("priority"),
      category: sp.get("category"),
      barbershopId: sp.get("barbershopId"),
      q: sp.get("q"),
    };

    if (sp.get("metrics") === "1") {
      const [tickets, metrics] = await Promise.all([
        listAdminBarberTickets(filters),
        getBarberSupportMetrics(),
      ]);
      return NextResponse.json({ tickets, metrics });
    }

    const tickets = await listAdminBarberTickets(filters);
    return NextResponse.json({ tickets });
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/barberias/soporte error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
