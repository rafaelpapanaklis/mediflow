import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  BlogImportError,
  parseImportFile,
  planImport,
  type BlogImportRejection,
} from "@/lib/blog/import";
import { BLOG_IMPORT_LIMITS } from "@/lib/blog/types";
import { revalidateBlog } from "@/lib/blog/revalidate";

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/blog/import — importador JSON por lotes.
//
// Entrada: multipart/form-data con `file` (.json) y `perDay` (opcional).
// El File se lee con .text() — NUNCA se pasa un ArrayBuffer entre capas.
// Todo el handler va envuelto en try/catch: un multipart mal formado revienta
// en req.formData(), no en una excepción sin manejar.
//
// Los artículos entran como `scheduled` con scheduledAt auto-espaciado a N/día
// a las 13:00 UTC, arrancando después del último programado que ya exista. El
// cron /api/cron/blog-publish los va publicando.
//
// Un item inválido NO aborta el lote: se inserta lo bueno y se devuelve el
// detalle de lo rechazado con el motivo por slug.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
/** Un lote de 200 artículos con markdown largo tarda más que el default. */
export const maxDuration = 60;

export interface BlogImportResponse {
  inserted: { slug: string; title: string; scheduledAt: string }[];
  rejected: BlogImportRejection[];
  perDay: number;
  totalInFile: number;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdminAuthed())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
    }

    const file = formData.get("file") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Falta el archivo .json" }, { status: 400 });
    }
    if (file.size > BLOG_IMPORT_LIMITS.maxBytes) {
      return NextResponse.json(
        { error: `El archivo pesa más de ${BLOG_IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
    }

    const perDayRaw = Number.parseInt(String(formData.get("perDay") ?? ""), 10);
    const perDay = Number.isFinite(perDayRaw) ? perDayRaw : BLOG_IMPORT_LIMITS.defaultPerDay;

    const text = await file.text();
    const items = parseImportFile(text);

    // Sólo se consultan los slugs que vienen en el archivo — no toda la tabla.
    const fileSlugs: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const s = items[i] && typeof items[i].slug === "string" ? (items[i].slug as string).trim() : "";
      if (s && fileSlugs.indexOf(s) === -1) fileSlugs.push(s);
    }

    const [existing, lastScheduled] = await Promise.all([
      fileSlugs.length > 0
        ? prisma.blogPost.findMany({ where: { slug: { in: fileSlugs } }, select: { slug: true } })
        : Promise.resolve([] as { slug: string }[]),
      prisma.blogPost.findFirst({
        where: { scheduledAt: { not: null } },
        orderBy: { scheduledAt: "desc" },
        select: { scheduledAt: true },
      }),
    ]);

    const taken: Record<string, true> = {};
    for (let i = 0; i < existing.length; i++) taken[existing[i].slug] = true;

    const plan = planImport(items, taken, lastScheduled?.scheduledAt ?? null, perDay, new Date());

    // Inserción de una en una a propósito: createMany aborta el lote entero si
    // una fila viola el unique, y el contrato de este importador es justo el
    // contrario — lo bueno entra y lo malo se reporta. Una carrera con otra
    // importación simultánea cae aquí como rechazo, no como 500.
    const inserted: BlogImportResponse["inserted"] = [];
    const rejected: BlogImportRejection[] = plan.rejected.slice();

    for (let i = 0; i < plan.rows.length; i++) {
      const row = plan.rows[i];
      try {
        const created = await prisma.blogPost.create({
          data: {
            slug: row.slug,
            title: row.title,
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
            excerpt: row.excerpt,
            contentMd: row.contentMd,
            category: row.category,
            cluster: row.cluster,
            tags: row.tags,
            faq: row.faq.length > 0 ? (row.faq as any) : undefined,
            relatedSlugs: row.relatedSlugs,
            status: "scheduled",
            scheduledAt: row.scheduledAt,
            readingMinutes: row.readingMinutes,
          },
          select: { slug: true, title: true, scheduledAt: true },
        });
        inserted.push({
          slug: created.slug,
          title: created.title,
          scheduledAt: created.scheduledAt ? created.scheduledAt.toISOString() : "",
        });
      } catch (e: any) {
        const isUnique = e?.code === "P2002";
        rejected.push({
          slug: row.slug,
          reason: isUnique
            ? "Ya existe un artículo con este slug en la base de datos."
            : "No se pudo guardar en la base de datos.",
        });
        if (!isUnique) console.error(`[admin/blog/import] fallo al insertar ${row.slug}:`, e);
      }
    }

    if (inserted.length > 0) {
      // Nada queda publicado todavía (todo entra como `scheduled`), pero el
      // admin y el sitemap sí cambian de contenido.
      revalidateBlog({ categories: plan.categories });
    }

    const body: BlogImportResponse = {
      inserted,
      rejected,
      perDay: plan.perDay,
      totalInFile: items.length,
    };
    return NextResponse.json(body);
  } catch (err: any) {
    if (err instanceof BlogImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/blog/import] error:", err);
    return NextResponse.json({ error: "Error interno al importar" }, { status: 500 });
  }
}
