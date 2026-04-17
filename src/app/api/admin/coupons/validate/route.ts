import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const code = String(body?.code ?? "").trim().toUpperCase();
  const amount = Number(body?.amount);
  const plan   = body?.plan ? String(body.plan) : null;

  if (!code) return NextResponse.json({ error: "Código requerido" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon)          return NextResponse.json({ error: "Cupón no existe" },       { status: 404 });
  if (!coupon.active)   return NextResponse.json({ error: "Cupón desactivado" },     { status: 400 });

  const now = new Date();
  if (coupon.validFrom > now) return NextResponse.json({ error: "Cupón aún no vigente" }, { status: 400 });
  if (coupon.validUntil && coupon.validUntil < now) {
    return NextResponse.json({ error: "Cupón expirado" }, { status: 400 });
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return NextResponse.json({ error: "Cupón agotado" }, { status: 400 });
  }
  if (coupon.appliesTo !== "all" && plan && coupon.appliesTo !== plan) {
    return NextResponse.json({ error: `Cupón solo aplica al plan ${coupon.appliesTo}` }, { status: 400 });
  }

  const discount = coupon.type === "percentage"
    ? Math.min(amount, amount * (coupon.value / 100))
    : Math.min(amount, coupon.value);
  const finalAmount = Math.max(0, amount - discount);

  return NextResponse.json({
    valid: true,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    discount: Number(discount.toFixed(2)),
    finalAmount: Number(finalAmount.toFixed(2)),
    couponId: coupon.id,
  });
}
