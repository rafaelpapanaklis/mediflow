// Cupón propio del afiliado (integrado al sistema EXISTENTE de admin/coupons
// vía tabla puente affiliate_coupons — NO duplica el sistema de cupones).
// GET  → { coupon: AffiliateCouponInfo | null }
// POST { code } → solicita su cupón: crea Coupon INACTIVO (active=false,
//   percentage 10 como placeholder) + AffiliateCoupon. El admin lo revisa,
//   configura el beneficio real y lo activa desde /admin/coupons.
// Máximo 1 cupón por afiliado. Identidad SIEMPRE de getAffiliateContext().
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";

export type AffiliateCouponInfo = {
  code: string;
  active: boolean; // false = "en revisión" (admin aún no lo aprueba/activa)
  type: string; // percentage | fixed
  value: number;
  usedCount: number;
  conversions: number; // AffiliateConversion source="coupon" del afiliado
};

const CODE_RE = /^[A-Z0-9]{4,12}$/;

export async function GET() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ac = await prisma.affiliateCoupon.findFirst({
      where: { affiliateId: ctx.affiliateId },
    });
    if (!ac) return NextResponse.json({ coupon: null });

    const c = await prisma.coupon.findUnique({ where: { id: ac.couponId } });
    if (!c) return NextResponse.json({ coupon: null });

    // Registros atribuidos por cupón (tabla nueva → defensivo, cae a 0)
    let conversions = 0;
    try {
      conversions = await prisma.affiliateConversion.count({
        where: { affiliateId: ctx.affiliateId, source: "coupon" },
      });
    } catch {}

    const coupon: AffiliateCouponInfo = {
      code: c.code,
      active: c.active,
      type: c.type,
      value: c.value,
      usedCount: c.usedCount,
      conversions,
    };
    return NextResponse.json({ coupon });
  } catch {
    // Tabla affiliate_coupons inexistente (SQL sin correr)
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const code = String(body?.code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return NextResponse.json(
      { error: "El código debe tener de 4 a 12 letras o números" },
      { status: 400 },
    );
  }

  try {
    // Máximo 1 cupón por afiliado
    const existing = await prisma.affiliateCoupon.findFirst({
      where: { affiliateId: ctx.affiliateId },
    });
    if (existing) {
      return NextResponse.json({ error: "Ya tienes un cupón" }, { status: 409 });
    }

    // El código vive en la tabla GLOBAL coupons (code @unique)
    const taken = await prisma.coupon.findUnique({ where: { code } });
    if (taken) {
      return NextResponse.json(
        { error: "Ese código ya existe, elige otro" },
        { status: 409 },
      );
    }

    // Coupon INACTIVO (placeholder 10%) + puente affiliate_coupons, atómico.
    // El admin configura el beneficio real y lo activa en /admin/coupons.
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.coupon.create({
        data: { code, type: "percentage", value: 10, active: false },
      });
      await tx.affiliateCoupon.create({
        data: { affiliateId: ctx.affiliateId, couponId: c.id },
      });
      return c;
    });

    const coupon: AffiliateCouponInfo = {
      code: created.code,
      active: created.active,
      type: created.type,
      value: created.value,
      usedCount: created.usedCount,
      conversions: 0,
    };
    return NextResponse.json({ coupon }, { status: 201 });
  } catch (err: any) {
    // Carrera contra otro create (code o couponId únicos)
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "Ese código ya existe, elige otro" },
        { status: 409 },
      );
    }
    // P2021/tabla inexistente (SQL sin correr) u otro fallo de infra
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
