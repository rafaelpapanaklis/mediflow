import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistentRateLimit } from "@/lib/failban";
import { sendEmail } from "@/lib/email";
import {
  avisoLeadWhatsapp,
  normalizarNombre,
  normalizarNumeroWhatsapp,
} from "@/lib/landing/whatsapp-widget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/whatsapp-lead — formulario «Te escribimos nosotros» del botón
 * de WhatsApp de la portada y el blog. Público, sin sesión.
 *
 * No guarda nada en la base (sin tabla nueva): avisa al equipo por correo, al
 * mismo buzón que los demás avisos de plataforma (ADMIN_NOTIFY_EMAIL, o
 * hola@dalecontrol.com), con el origen «whatsapp-widget».
 *
 * Antispam: honeypot (`empresa_web`, un campo que una persona no ve; si viene
 * con texto se responde 200 sin avisar a nadie) y límite por IP.
 */

const Cuerpo = z.object({
  nombre: z.string().max(200),
  numero: z.string().max(40),
  empresa_web: z.string().max(200).optional(),
  pagina: z.string().max(200).optional(),
});

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  const rl = await persistentRateLimit(req, { limit: 5, windowSec: 600, scope: "whatsapp-lead:ip" });
  if (rl) return rl;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const parsed = Cuerpo.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });

  // Honeypot: a un robot se le contesta "ok" para que no pruebe otra cosa.
  if (parsed.data.empresa_web?.trim()) return NextResponse.json({ ok: true });

  const nombre = normalizarNombre(parsed.data.nombre);
  if ("error" in nombre) return NextResponse.json({ error: nombre.error, campo: "nombre" }, { status: 400 });
  const numero = normalizarNumeroWhatsapp(parsed.data.numero);
  if ("error" in numero) return NextResponse.json({ error: numero.error, campo: "numero" }, { status: 400 });

  // Un mismo número no llena el buzón: 2 avisos por día.
  const tope = await persistentRateLimit(req, {
    id: numero.e164, limit: 2, windowSec: 86400, scope: "whatsapp-lead:numero",
  });
  if (tope) return tope;

  const pagina = parsed.data.pagina?.startsWith("/") ? parsed.data.pagina.replace(/[\u0000-\u001f]/g, "") : undefined;
  const { asunto, lineas } = avisoLeadWhatsapp({ nombre: nombre.nombre, ...numero, pagina });
  const res = await sendEmail({
    to: process.env.ADMIN_NOTIFY_EMAIL?.trim() || "hola@dalecontrol.com",
    subject: asunto,
    html: lineas.map((l) => `<p>${esc(l)}</p>`).join(""),
    text: lineas.join("\n"),
  });
  if (!res.delivered) {
    console.error("[whatsapp-lead] el aviso al equipo no salió");
    return NextResponse.json(
      { error: "No pudimos enviar tu solicitud. Toca «Iniciar conversación» para escribirnos directo." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
