import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


const ALLOWED_TYPES  = ["percentage", "fixed"] as const;
const ALLOWED_TARGETS = ["all", "BASIC", "PRO", "CLINIC"] as const;

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
  });

  // Cupones de afiliado: enriquece con el nombre del socio dueño. La tabla
  // puede no existir aún (sql/afiliados-ventas.sql sin correr) → sin enriquecer.
  const affiliateByCoupon = new Map<string, string>();
  try {
    const acs = await prisma.affiliateCoupon.findMany({
      where: { couponId: { in: coupons.map((c) => c.id) } },
      include: { affiliate: { select: { name: true, slug: true } } },
    });
    for (const ac of acs) {
      if (ac.affiliate?.name) affiliateByCoupon.set(ac.couponId, ac.affiliate.name);
    }
  } catch {
    // Tabla sin crear: los cupones se devuelven sin affiliateName.
  }

  return NextResponse.json(
    coupons.map((c) => {
      const affiliateName = affiliateByCoupon.get(c.id);
      // affiliateName?: string — undefined si el cupón no es de afiliado.
      return affiliateName ? { ...c, affiliateName } : c;
    })
  );
}

export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const code = String(body?.code ?? "").trim().toUpperCase();
  if (!code)                                 return NextResponse.json({ error: "Código requerido" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(body?.type))   return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  const value = Number(body?.value);
  if (!Number.isFinite(value) || value <= 0) return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
  if (body?.type === "percentage" && value > 100)
    return NextResponse.json({ error: "El porcentaje no puede ser mayor a 100" }, { status: 400 });

  const appliesTo = ALLOWED_TARGETS.includes(body?.appliesTo) ? body.appliesTo : "all";
  const maxUses   = body?.maxUses != null ? Math.max(1, Math.floor(Number(body.maxUses))) : null;
  const validUntil = body?.validUntil ? new Date(body.validUntil) : null;
  const validFrom  = body?.validFrom  ? new Date(body.validFrom)  : new Date();

  try {
    const created = await prisma.coupon.create({
      data: {
        code,
        type: body.type,
        value,
        appliesTo,
        maxUses,
        validFrom,
        validUntil,
        active: body?.active !== false,
      },
    });
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "coupon", entityId: created.id,
      action: "create",
      after: { code, type: body.type, value, appliesTo, maxUses, active: created.active },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Ya existe un cupón con ese código" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
