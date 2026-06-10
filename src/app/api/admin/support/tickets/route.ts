import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { SupportError } from "@/lib/support/types";
import { listAdminTickets, getAdminMetrics } from "@/lib/support/service";

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/support/tickets — bandeja global ADMIN (DaleControl).
//   GET ?status=&category=&priority=&clinicId=&q=&metrics=1
//     → { tickets } (+ { metrics } si metrics=1)
//   (status acepta el pseudo-valor "OPEN" = todos los abiertos)
// El service hace toda la lógica; aquí solo: guard admin, parsear, delegar.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sp = req.nextUrl.searchParams;
    const filters = {
      status: sp.get("status"),
      category: sp.get("category"),
      priority: sp.get("priority"),
      clinicId: sp.get("clinicId"),
      q: sp.get("q"),
    };

    if (sp.get("metrics") === "1") {
      const [tickets, metrics] = await Promise.all([listAdminTickets(filters), getAdminMetrics()]);
      return NextResponse.json({ tickets, metrics });
    }

    const tickets = await listAdminTickets(filters);
    return NextResponse.json({ tickets });
  } catch (err) {
    if (err instanceof SupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/support/tickets error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
