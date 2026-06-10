// "Mi equipo": actualizar (PATCH) o eliminar (DELETE) un vendedor. Ownership
// estricto: el vendedor [id] debe pertenecer a ctx.affiliateId, si no → 404.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { currentParentLevelPct } from "@/lib/affiliates/team";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ── PATCH: cambia el % del vendedor y/o lo activa/desactiva ───────────────
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 401 });
  }

  const seller = await prisma.affiliateSeller.findUnique({ where: { id: params.id } });
  if (!seller || seller.affiliateId !== ctx.affiliateId) {
    return NextResponse.json({ error: "Vendedor no encontrado." }, { status: 404 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const data: { commissionPct?: number; isActive?: boolean } = {};

  if (body?.commissionPct !== undefined) {
    const pct = typeof body.commissionPct === "number" ? body.commissionPct : NaN;
    const cap = await currentParentLevelPct(ctx.affiliateId, ctx.affiliate.commissionPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > cap) {
      return NextResponse.json(
        { error: `El porcentaje debe estar entre 0 y ${cap}% (tu nivel vigente).` },
        { status: 400 }
      );
    }
    data.commissionPct = pct;
  }

  if (typeof body?.isActive === "boolean") {
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No hay cambios que aplicar." }, { status: 400 });
  }

  const updated = await prisma.affiliateSeller.update({
    where: { id: seller.id },
    data,
  });

  return NextResponse.json({
    seller: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      commissionPct: updated.commissionPct,
      isActive: updated.isActive,
      hasLogin: !!updated.supabaseId,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

// ── DELETE: elimina un vendedor SIN historial; con historial → 409 ────────
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 401 });
  }

  const seller = await prisma.affiliateSeller.findUnique({ where: { id: params.id } });
  if (!seller || seller.affiliateId !== ctx.affiliateId) {
    return NextResponse.json({ error: "Vendedor no encontrado." }, { status: 404 });
  }

  // Si el vendedor ya tiene historial (comisiones o clínicas atribuidas), NO
  // se borra: rompería los reportes. Se desactiva en su lugar.
  const [commissions, attributions] = await Promise.all([
    prisma.affiliateSellerCommission.count({ where: { sellerId: seller.id } }),
    prisma.affiliateSellerAttribution.count({ where: { sellerId: seller.id } }),
  ]);
  if (commissions > 0 || attributions > 0) {
    return NextResponse.json(
      { error: "El vendedor tiene historial; desactívalo en lugar de eliminarlo." },
      { status: 409 }
    );
  }

  await prisma.affiliateSeller.delete({ where: { id: seller.id } });

  // Borrar también su usuario de Supabase (best-effort) si tenía login.
  if (seller.supabaseId) {
    try {
      await getAdminClient().auth.admin.deleteUser(seller.supabaseId);
    } catch {
      /* ignore — cleanup best-effort */
    }
  }

  return NextResponse.json({ ok: true });
}
