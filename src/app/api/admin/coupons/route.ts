import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

const ALLOWED_TYPES  = ["percentage", "fixed"] as const;
const ALLOWED_TARGETS = ["all", "BASIC", "PRO", "CLINIC"] as const;

export async function GET() {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(coupons);
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Ya existe un cupón con ese código" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
