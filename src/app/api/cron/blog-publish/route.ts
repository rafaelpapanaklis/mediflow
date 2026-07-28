import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/seo";
import { pingIndexNow } from "@/lib/blog/indexnow";
import { revalidateBlog } from "@/lib/blog/revalidate";

export const dynamic = "force-dynamic";

/**
 * Cron — publicación en goteo (drip) del blog.
 *
 * Toma los artículos `scheduled` cuya fecha ya llegó y los pasa a `published`
 * con publishedAt = ahora. Corre una vez al día a las 13:00 UTC (vercel.json),
 * la misma hora a la que el importador programa los huecos.
 *
 * Después de publicar: revalida /blog, la categoría y cada slug, y notifica a
 * IndexNow (Bing/Yandex). Para Google basta el sitemap con lastmod, que también
 * se revalida.
 *
 * Idempotente: si no hay nada vencido, no escribe ni notifica. El `updateMany`
 * lleva el mismo filtro que la lectura, así que dos ejecuciones simultáneas no
 * pueden publicar dos veces el mismo artículo.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/blog-publish] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const due = await prisma.blogPost.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, slug: true, category: true },
    take: 200,
  });

  if (due.length === 0) {
    return NextResponse.json({ published: 0, slugs: [] });
  }

  const ids = due.map((p) => p.id);
  const result = await prisma.blogPost.updateMany({
    where: { id: { in: ids }, status: "scheduled" },
    data: { status: "published", publishedAt: now },
  });

  const slugs = due.map((p) => p.slug);
  const categories = due.map((p) => p.category);

  revalidateBlog({ slugs, categories });

  // Falla en silencio: un buscador caído no debe tumbar el cron.
  const indexNow = await pingIndexNow([
    `${SITE_URL}/blog`,
    ...slugs.map((s) => `${SITE_URL}/blog/${s}`),
  ]);

  console.info(`[cron/blog-publish] ${result.count} artículos publicados: ${slugs.join(", ")}`);

  return NextResponse.json({
    published: result.count,
    slugs,
    indexNow: { ok: indexNow.ok, submitted: indexNow.submitted },
  });
}
