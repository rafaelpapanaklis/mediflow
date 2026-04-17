import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

// Envía emails usando Resend (https://resend.com) si RESEND_API_KEY está configurada.
// Fallback: responde 503 con instrucciones. No usamos SMTP directo para mantener el
// bundle ligero en entornos serverless.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.MEDIFLOW_EMAIL_FROM || "MediFlow <soporte@mediflow.app>";

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Email de MediFlow no está configurado",
        instructions:
          "1) Crea cuenta gratis en https://resend.com (3,000 emails/mes gratis). 2) Verifica el dominio mediflow.app. 3) Agrega RESEND_API_KEY y MEDIFLOW_EMAIL_FROM (ej: 'MediFlow <soporte@mediflow.app>') en Vercel → Environment Variables.",
      },
      { status: 503 },
    );
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const subject = String(body?.subject ?? "").trim();
  const text    = String(body?.body ?? "").trim();
  if (!subject) return NextResponse.json({ error: "Asunto requerido" }, { status: 400 });
  if (!text)    return NextResponse.json({ error: "Cuerpo requerido" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, users: { select: { email: true }, take: 1 } },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const to = String(body?.to ?? clinic.email ?? clinic.users[0]?.email ?? "").trim();
  if (!to) return NextResponse.json({ error: "La clínica no tiene email configurado" }, { status: 400 });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Resend: ${err.slice(0, 300)}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, to, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error al enviar" }, { status: 500 });
  }
}
