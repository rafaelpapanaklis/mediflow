import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


const ALLOWED_TARGETS = ["all", "BASIC", "PRO", "CLINIC"] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const data: any = {};
  if (typeof body?.active === "boolean")                              data.active = body.active;
  if (typeof body?.appliesTo === "string" && ALLOWED_TARGETS.includes(body.appliesTo)) data.appliesTo = body.appliesTo;
  if (body?.value != null) {
    const v = Number(body.value);
    if (Number.isFinite(v) && v > 0) data.value = v;
  }
  if (body?.maxUses !== undefined) {
    data.maxUses = body.maxUses == null ? null : Math.max(1, Math.floor(Number(body.maxUses)));
  }
  if (body?.validUntil !== undefined) {
    data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
  }

  const updated = await prisma.coupon.update({ where: { id: params.id }, data });
  logAdminGlobalEvent({
    req, admin: admin.user, entity: "coupon", entityId: params.id,
    action: "update", after: data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const before = await prisma.coupon.findUnique({
    where: { id: params.id },
    select: { code: true, type: true, value: true },
  });
  await prisma.coupon.delete({ where: { id: params.id } });
  logAdminGlobalEvent({
    req, admin: admin.user, entity: "coupon", entityId: params.id,
    action: "delete", before,
  });
  return NextResponse.json({ success: true });
}
