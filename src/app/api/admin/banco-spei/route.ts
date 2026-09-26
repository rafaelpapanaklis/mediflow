import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { guardarCuentaSpei, leerCuentaSpeiParaEditar } from "@/lib/billing/spei-directo";
import { validarCuentaBancaria } from "@/lib/billing/spei-directo-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enmascara la CLABE para la bitácora: quién la cambió importa, el número completo no. */
function mascara(clabe: string | undefined | null): string | null {
  return clabe ? `${"*".repeat(Math.max(0, clabe.length - 4))}${clabe.slice(-4)}` : null;
}

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ cuenta: await leerCuentaSpeiParaEditar() });
}

/** PUT { banco, beneficiario, clabe } — la cuenta a la que transfieren las clínicas. */
export async function PUT(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validarCuentaBancaria(body);
  if (v.ok === false) return NextResponse.json({ error: v.error }, { status: 400 });

  try {
    const antes = await leerCuentaSpeiParaEditar();
    await guardarCuentaSpei(v.cuenta, admin.user.id);
    logAdminGlobalEvent({
      req,
      admin: admin.user,
      entity: "platform-bank-account",
      entityId: "spei",
      action: antes ? "update" : "create",
      before: antes ? { banco: antes.banco ?? null, beneficiario: antes.beneficiario ?? null, clabe: mascara(antes.clabe) } : null,
      after: { banco: v.cuenta.banco, beneficiario: v.cuenta.beneficiario, clabe: mascara(v.cuenta.clabe) },
    });
    return NextResponse.json({ success: true, cuenta: v.cuenta });
  } catch (err) {
    console.error("[admin/banco-spei] PUT:", err);
    return NextResponse.json(
      { error: "No se pudo guardar. Si es la primera vez, falta pegar sql/spei-transferencia-directa.sql en Supabase." },
      { status: 500 },
    );
  }
}
