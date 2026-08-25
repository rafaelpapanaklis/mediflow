import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { BarberAdminError, addBarberAdminReply } from "@/lib/barber/admin";

// ═══════════════════════════════════════════════════════════════════════
// /api/admin/barberias/soporte/[id]/messages — responder como DaleControl.
//   POST { body, attachments? } → 201 { message }
//
// El mensaje se guarda con authorType = "ADMIN" (BarberSupportMessage), que
// es la MISMA etiqueta que lee el lado de la barbería para pintarlo como
// respuesta de soporte. No se inventa un modelo paralelo.
//
// `attachments` son los metadatos que devolvió
// POST .../[id]/attachments; el service los re-valida contra el
// barbershopId del ticket cargado en el server.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    const message = await addBarberAdminReply(params.id, {
      body: payload.body,
      attachments: payload.attachments,
      actor: { id: session.user.id, email: session.user.email },
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/admin/barberias/soporte/[id]/messages error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
