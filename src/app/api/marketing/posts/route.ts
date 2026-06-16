// CRUD de MarketingPost — colección (WS-MKT-T3).
// GET  /api/marketing/posts  → lista (clinic-scoped; ?status= y rango ?from=&to=)
// POST /api/marketing/posts  → crea borrador / programado / publicar ahora

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { CreateSchema, assertChannelConnected, errorResponse } from "./_shared";

export const dynamic = "force-dynamic";

const ALL_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"];

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "500", 10) || 500, 1), 1000);

  const status = statusParam && ALL_STATUSES.includes(statusParam) ? statusParam : undefined;
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  const validFrom = from && !isNaN(from.getTime()) ? from : null;
  const validTo = to && !isNaN(to.getTime()) ? to : null;

  // Aislamiento multi-tenant: SIEMPRE por clinicId del contexto.
  const where: any = { clinicId: ctx.clinicId };
  if (status) where.status = status;
  if (validFrom || validTo) {
    const range: any = {};
    if (validFrom) range.gte = validFrom;
    if (validTo) range.lte = validTo;
    // Un post cae en el rango por su fecha programada o por su fecha de publicación.
    where.OR = [{ scheduledFor: range }, { publishedAt: range }];
  }

  try {
    const posts = await prisma.marketingPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ posts });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  let status: string = d.status;
  let scheduledFor: Date | null = d.scheduledFor ? new Date(d.scheduledFor) : null;
  if (status === "DRAFT") scheduledFor = null; // un borrador no lleva fecha

  try {
    // Publicar ahora: exige conexión del canal y deja el post listo (scheduledFor=ahora)
    // para que el worker de publicación (WS-MKT-T5) lo procese en su próxima pasada.
    if (d.publishNow) {
      const connErr = await assertChannelConnected(ctx.clinicId, d.channel);
      if (connErr) return connErr;
      status = "SCHEDULED";
      scheduledFor = new Date();
    }

    const post = await prisma.marketingPost.create({
      data: {
        clinicId: ctx.clinicId,
        channel: d.channel,
        caption: d.caption,
        mediaUrls: d.mediaUrls ?? [],
        status,
        scheduledFor,
        aiGenerated: d.aiGenerated ?? false,
        createdById: ctx.userId,
      },
    });
    return NextResponse.json({ post }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
