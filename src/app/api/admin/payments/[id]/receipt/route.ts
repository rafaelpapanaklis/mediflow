import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { renderReciboHtml } from "@/lib/admin/recibo-html";


// Recibo NO fiscal en HTML. El navegador puede exportarlo a PDF con
// Ctrl/Cmd+P → "Guardar como PDF". Evitamos dependencias pesadas
// (@react-pdf/renderer) porque el documento es informativo.
//
// A2 (auditoría 30-sep-2026): se sirve desde el mismo origen que /admin, así
// que el HTML lo arma `renderReciboHtml` escapando CADA valor de la base, y la
// respuesta lleva una CSP que solo deja correr el script con nonce.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payment = await prisma.subscriptionInvoice.findUnique({
    where: { id: params.id },
    include: { clinic: { select: { name: true, email: true, city: true, address: true, taxId: true } } },
  });
  if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });

  const nonce = randomBytes(16).toString("base64");
  const html = renderReciboHtml(payment, nonce);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Defensa en profundidad: aunque algún valor se colara sin escapar, solo
      // corre el script con nonce; no se carga nada externo.
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
