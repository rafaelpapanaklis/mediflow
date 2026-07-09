import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { encryptField } from "@/lib/crypto/envelope";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const clinicId = ctx!.clinicId;

  const { phoneNumberId, accessToken, wabaId } = await req.json();

  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: "Se requiere Phone Number ID y Access Token" }, { status: 400 });
  }

  // Verify the token works by calling the WhatsApp API
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: `Token inválido: ${err.error?.message ?? "Error desconocido"}` }, { status: 400 });
    }
    const data = await res.json();

    // Coexistence: si la clínica aportó su WhatsApp Business Account ID (WABA),
    // suscribimos la app de DaleControl a ese WABA. Es REQUISITO para que los
    // mensajes entrantes de ese número lleguen a nuestro webhook. Best-effort:
    // un fallo aquí no debe tirar la conexión (se reintenta al reconectar).
    let subscribed = false;
    if (wabaId) {
      try {
        const subRes = await fetch(
          `https://graph.facebook.com/v19.0/${encodeURIComponent(String(wabaId))}/subscribed_apps`,
          { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        subscribed = subRes.ok;
      } catch {
        /* best-effort: no perdemos las credenciales por esto */
      }
    }

    // Token cifrado en reposo (envelope AES-256-GCM); se descifra solo al
    // usarlo en sendWhatsAppMessage. Tokens viejos en claro siguen funcionando
    // y se re-cifran la próxima vez que la clínica reconecte.
    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        waPhoneNumberId: phoneNumberId,
        waAccessToken: encryptField(accessToken),
        waConnected: true,
        waBusinessAccountId: wabaId ? String(wabaId) : null,
        waConnMethod: wabaId ? "coexistence" : "manual",
      },
    });

    return NextResponse.json({
      success: true,
      displayName: data.display_phone_number ?? data.verified_name,
      subscribed,
    });
  } catch {
    return NextResponse.json({ error: "Error al verificar credenciales" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  await prisma.clinic.update({
    where: { id: ctx!.clinicId },
    data: {
      waPhoneNumberId: null,
      waAccessToken: null,
      waConnected: false,
      waBusinessAccountId: null,
      waConnMethod: null,
    },
  });
  return NextResponse.json({ success: true });
}
