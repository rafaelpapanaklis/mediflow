import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { publishToMeta } from "@/lib/marketing/meta";
import type { Channel } from "@/lib/marketing/types";

export const dynamic = "force-dynamic";

/**
 * Publica AHORA un post ya creado. Reusa publishToMeta y refleja el resultado en
 * el MarketingPost (status / externalIds / publishedAt / errorMsg). Scoped por
 * clinicId de la sesión. Solo admin: empujar a las redes públicas de la clínica
 * es sensible, igual que conectar/desconectar cuentas.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const clinicId = ctx!.clinicId;

  const post = await prisma.marketingPost.findFirst({
    where: { id: params.id, clinicId },
    select: { id: true, caption: true, mediaUrls: true, channel: true, status: true },
  });
  if (!post) return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  if (post.status === "PUBLISHED") {
    return NextResponse.json({ error: "El post ya está publicado" }, { status: 409 });
  }

  await prisma.marketingPost.update({
    where: { id: post.id },
    data: { status: "PUBLISHING", errorMsg: null },
  });

  try {
    const result = await publishToMeta(clinicId, {
      caption: post.caption,
      mediaUrls: post.mediaUrls,
      channel: post.channel as Channel,
    });
    const updated = await prisma.marketingPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        externalIds: result as object,
        errorMsg: null,
      },
      select: { id: true, status: true, publishedAt: true, externalIds: true },
    });
    return NextResponse.json({ ok: true, post: updated });
  } catch (err: any) {
    const msg = String(err?.message ?? "Error al publicar").slice(0, 500);
    await prisma.marketingPost.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMsg: msg },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
