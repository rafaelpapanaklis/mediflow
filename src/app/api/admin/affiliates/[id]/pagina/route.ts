/**
 * POST /api/admin/affiliates/[id]/pagina — resuelve la moderación.
 *   body: { action: "approve" | "reject" | "unpublish", reason?: string }
 *
 * Las transiciones viven en @/lib/affiliates/page-moderation; aquí solo se
 * autentica, se despacha y se manda el correo.
 *
 * EL CORREO VA DESPUÉS Y NUNCA REVIERTE. La decisión ya está escrita en la
 * base cuando se intenta enviar: si el correo falla, se registra y la
 * respuesta sigue siendo un éxito. Al revés —tirar la respuesta porque Resend
 * no contestó— dejaría al admin dándole otra vez a "Aprobar" sobre una página
 * que ya está aprobada.
 */
import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  approvePage,
  rejectPage,
  unpublishPage,
  type ModerationResult,
} from "@/lib/affiliates/page-moderation";
import { sendAffiliatePageApprovedEmail, sendAffiliatePageRejectedEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";

  let result: ModerationResult;
  try {
    if (action === "approve") result = await approvePage(params.id);
    else if (action === "reject") result = await rejectPage(params.id, reason);
    else if (action === "unpublish") result = await unpublishPage(params.id, reason);
    else return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (e) {
    console.error("[admin/affiliates/pagina] moderación:", e);
    return NextResponse.json({ error: "No se pudo aplicar la decisión." }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, state: result.state },
      { status: result.status ?? 400 },
    );
  }

  // Aviso al socio. Fuera del camino crítico: ya se decidió.
  if (result.notify) {
    try {
      if (action === "approve") {
        await sendAffiliatePageApprovedEmail({
          email: result.notify.email,
          name: result.notify.name,
          pageUrl: `${SITE_URL}/socio/${result.notify.slug}`,
        });
      } else {
        await sendAffiliatePageRejectedEmail({
          email: result.notify.email,
          name: result.notify.name,
          reason,
          panelUrl: `${SITE_URL}/afiliados/mi-pagina`,
          wasPublished: action === "unpublish",
        });
      }
    } catch (e) {
      console.error("[admin/affiliates/pagina] aviso por correo:", e);
    }
  }

  return NextResponse.json({ ok: true, state: result.state });
}
