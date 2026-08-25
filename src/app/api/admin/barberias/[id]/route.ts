import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, isAdminAuthed } from "@/lib/admin-auth";
import {
  BarberAdminError,
  changeBarbershopPlan,
  getBarbershopDetailForAdmin,
  setBarbershopSuspension,
} from "@/lib/barber/admin";

// ═══════════════════════════════════════════════════════════════════════
// /api/admin/barberias/[id] — ficha de una barbería.
//   GET   → detalle completo (equipo, plan, WhatsApp, actividad, bitácora)
//   PATCH → acción MANUAL, siempre con nota obligatoria:
//             { action: "suspend"    , note }
//             { action: "reactivate" , note }
//             { action: "plan"       , plan, note }
//
// La nota no es decorativa: sin ella el service lanza 400 y no se escribe
// nada. La identidad del admin (id + correo) sale de la sesión en BD, nunca
// del body — es lo que hace auditable la acción.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const detail = await getBarbershopDetailForAdmin(params.id);
    if (!detail) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/barberias/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const actor = { id: session.user.id, email: session.user.email };

  try {
    switch (payload.action) {
      case "suspend": {
        const result = await setBarbershopSuspension(params.id, {
          suspend: true,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      case "reactivate": {
        const result = await setBarbershopSuspension(params.id, {
          suspend: false,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      case "plan": {
        const result = await changeBarbershopPlan(params.id, {
          plan: payload.plan,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/admin/barberias/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
