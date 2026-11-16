import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { receiptPathOf } from "@/lib/barber/caja-movimientos";
import { BARBER_FILES_BUCKET } from "@/lib/barber/types";

export const dynamic = "force-dynamic";

/** Vida de la liga firmada del comprobante (bucket PRIVADO), como las fotos de clientes. */
const RECEIPT_SIGNED_TTL = 300;

// GET /api/barber/cash-movements/[id]/receipt → redirige a una liga firmada
// (5 min) de la foto del comprobante. cash.view; solo movimientos de la sede
// en sesión (otro → 404).
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const path = await receiptPathOf(ctx, params.id);
    if (!path) return NextResponse.json({ error: "Ese movimiento no tiene comprobante." }, { status: 404 });
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.storage.from(BARBER_FILES_BUCKET).createSignedUrl(path, RECEIPT_SIGNED_TTL);
    if (error || !data?.signedUrl) return NextResponse.json({ error: "No se pudo abrir el comprobante." }, { status: 502 });
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
