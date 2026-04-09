import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const packages = await prisma.servicePackage.findMany({
    where: { clinicId: ctx.clinicId },
    include: { _count: { select: { redemptions: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(packages);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await req.json();
  const { name, totalSessions, price, description, validDays, bodyZone, isActive } = body;

  if (!name?.trim() || !totalSessions || price === undefined) {
    return NextResponse.json({ error: "name, totalSessions, and price are required" }, { status: 400 });
  }

  const pkg = await prisma.servicePackage.create({
    data: {
      clinicId: ctx.clinicId,
      name: name.trim(),
      totalSessions: Number(totalSessions),
      price: Number(price),
      description: description ?? null,
      validDays: validDays ? Number(validDays) : 365,
      bodyZone: bodyZone ?? null,
      isActive: isActive ?? true,
    },
  });

  return NextResponse.json(pkg, { status: 201 });
}
