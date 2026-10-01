import { NextResponse } from "next/server";
import { getTwoFactorActor } from "@/lib/auth/two-factor";
import { setAvisoPospuestoCookie } from "@/lib/auth/two-factor-cookie";

// POST /api/auth/2fa/posponer — «Recordármelo después» del aviso a los dueños
// durante la gracia (ws1-t8 · M2). Solo pone una cookie de 24 h que calla el
// aviso en este navegador. No afloja nada: en gracia no se bloquea, y con la
// gracia vencida el layout ya no mira esta cookie (va directo al enrolamiento).
export async function POST() {
  const actor = await getTwoFactorActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  setAvisoPospuestoCookie(res);
  return res;
}
