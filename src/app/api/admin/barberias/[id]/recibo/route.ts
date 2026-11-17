import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { esCobroDeBarberia } from "@/lib/barber/admin-pagos";
import { getBarberStripe } from "@/lib/barber/billing";

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/barberias/[id]/recibo?factura=in_… — abre el recibo de
// Stripe de un cobro de la suscripción de esa barbería (ws6-t1).
//
// Solo admins de DaleControl (isAdminAuthed, el mismo guard que la ficha).
// La factura TIENE que ser un cobro registrado de esa barbería o de su
// matriz (barber_subscription_payments): con otro in_… responde 404 sin
// preguntarle nada a Stripe. La URL del recibo no se guarda en la base: se
// pide a Stripe en el momento (solo lectura) y se redirige a ella.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const factura = req.nextUrl.searchParams.get("factura") ?? "";
  try {
    if (!(await esCobroDeBarberia(params.id, factura))) {
      return NextResponse.json({ error: "Ese cobro no es de esta barbería" }, { status: 404 });
    }
    const stripe = getBarberStripe();
    if (!stripe) return NextResponse.json({ error: "Stripe de barber no está configurado" }, { status: 503 });
    const inv = await stripe.invoices.retrieve(factura);
    const url = inv.hosted_invoice_url ?? inv.invoice_pdf ?? null;
    if (!url) return NextResponse.json({ error: "Stripe no tiene recibo para ese cobro" }, { status: 404 });
    return NextResponse.redirect(url, 302);
  } catch (err) {
    console.error("GET /api/admin/barberias/[id]/recibo error:", err);
    return NextResponse.json({ error: "No se pudo abrir el recibo" }, { status: 502 });
  }
}
