import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  BarberAdminError,
  getBarberVerticalMetrics,
  listBarbershopsForAdmin,
} from "@/lib/barber/admin";

// ═══════════════════════════════════════════════════════════════════════
// /api/admin/barberias — roster del vertical BARBER (panel de plataforma).
//   GET ?plan=&status=&scope=&q=&metrics=1
//     → { barbershops } (+ { metrics } si metrics=1)
//
// El guard es el MISMO que usa el resto de /admin (isAdminAuthed, sesión en
// BD con revocación): aquí no se inventa otra autorización. Sin cookie
// válida → 401 y ni una fila sale del server.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const filters = {
      plan: sp.get("plan"),
      status: sp.get("status"),
      scope: sp.get("scope"),
      q: sp.get("q"),
    };

    if (sp.get("metrics") === "1") {
      const [barbershops, metrics] = await Promise.all([
        listBarbershopsForAdmin(filters),
        getBarberVerticalMetrics(),
      ]);
      return NextResponse.json({ barbershops, metrics });
    }

    const barbershops = await listBarbershopsForAdmin(filters);
    return NextResponse.json({ barbershops });
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/barberias error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
