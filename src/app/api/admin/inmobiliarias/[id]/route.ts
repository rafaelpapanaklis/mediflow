import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession, isAdminAuthed } from "@/lib/admin-auth";
import {
  RealtyAdminError,
  changeRealtyAccountPlan,
  getRealtyAccountDetailForAdmin,
  grantRealtyAccountDays,
  setRealtyAccountSuspension,
} from "@/lib/realty/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ficha y acciones de soporte de UNA cuenta de inmuebles.
 *
 * 🔴 La identidad del admin (id + correo) sale de la SESIÓN EN BD, nunca del
 * body: es lo que hace auditable la acción. Un `actorEmail` que llegue en el
 * JSON se ignora.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const detail = await getRealtyAccountDetailForAdmin(params.id);
    if (!detail) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    console.error("GET /api/admin/inmobiliarias/[id] error:", err);
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
        const result = await setRealtyAccountSuspension(params.id, {
          suspend: true,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      case "reactivate": {
        const result = await setRealtyAccountSuspension(params.id, {
          suspend: false,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      case "plan": {
        const result = await changeRealtyAccountPlan(params.id, {
          plan: payload.plan,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      case "grant-days": {
        const result = await grantRealtyAccountDays(params.id, {
          days: payload.days,
          note: payload.note,
          actor,
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof RealtyAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/admin/inmobiliarias/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
