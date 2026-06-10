// GET /api/paciente/me — Implementa A1. CONTRATO FIJO (otra terminal lo consume):
//   200 → PacienteMe { id, name, email, phone } (exactamente esos campos)
//   401 → { error } si no hay sesión válida.
import { NextResponse } from "next/server";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();
    return NextResponse.json(ctx.account);
  } catch (err) {
    console.error("[paciente/me] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
