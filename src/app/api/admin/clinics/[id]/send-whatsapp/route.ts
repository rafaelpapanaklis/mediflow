import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.MEDIFLOW_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.MEDIFLOW_WHATSAPP_PHONE_ID;
  if (!token || !phoneNumberId) {
    return NextResponse.json(
      {
        error: "WhatsApp de DaleControl no está configurado",
        instructions:
          "Agrega MEDIFLOW_WHATSAPP_TOKEN y MEDIFLOW_WHATSAPP_PHONE_ID en Vercel → Environment Variables. Usa un número de WhatsApp Business dedicado para estos envíos administrativos (no el de tu clínica).",
      },
      { status: 503 },
    );
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const message = String(body?.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Mensaje requerido" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, phone: true, users: { select: { phone: true } } },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const destination = String(body?.to ?? clinic.phone ?? clinic.users[0]?.phone ?? "").trim();
  if (!destination) return NextResponse.json({ error: "La clínica no tiene teléfono configurado" }, { status: 400 });

  const normalized = destination.replace(/[^\d+]/g, "");

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized.replace(/^\+/, ""),
        type: "text",
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `WhatsApp API: ${err.slice(0, 300)}` }, { status: 502 });
    }
    const data = await res.json();
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "clinic-whatsapp", entityId: params.id,
      action: "send", clinicId: params.id, after: { to: normalized, message: message.slice(0, 200) },
    });
    return NextResponse.json({ success: true, to: normalized, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error al enviar" }, { status: 500 });
  }
}
