import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { toBlogPostDTO } from "@/lib/blog/types";
import { resolvePublishedAt, validateBlogPost } from "@/lib/blog/validate";
import { revalidateBlog } from "@/lib/blog/revalidate";

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/blog/[id] — leer, editar y eliminar UN artículo.
//
// El PATCH acepta cambios parciales (la fila "Publicar ahora" manda sólo
// { status }), pero NO valida sólo el parche: fusiona body sobre la fila
// actual y valida el objeto completo. Así ningún camino puede dejar en BD un
// artículo con meta description fuera de rango o categoría inexistente.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const row = await prisma.blogPost.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });
  return NextResponse.json(toBlogPostDTO(row));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const current = await prisma.blogPost.findUnique({ where: { id: params.id } });
  if (!current) {
    return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });
  }

  const currentDto = toBlogPostDTO(current);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body ?? {}, k);

  // Fusión campo a campo: lo que no venga en el body conserva su valor actual.
  const merged = {
    slug: has("slug") ? body.slug : currentDto.slug,
    title: has("title") ? body.title : currentDto.title,
    metaTitle: has("metaTitle") ? body.metaTitle : currentDto.metaTitle,
    metaDescription: has("metaDescription") ? body.metaDescription : currentDto.metaDescription,
    excerpt: has("excerpt") ? body.excerpt : currentDto.excerpt,
    contentMd: has("contentMd") ? body.contentMd : currentDto.contentMd,
    category: has("category") ? body.category : currentDto.category,
    cluster: has("cluster") ? body.cluster : currentDto.cluster,
    tags: has("tags") ? body.tags : currentDto.tags,
    faq: has("faq") ? body.faq : currentDto.faq,
    relatedSlugs: has("relatedSlugs") ? body.relatedSlugs : currentDto.relatedSlugs,
    status: has("status") ? body.status : currentDto.status,
    scheduledAt: has("scheduledAt") ? body.scheduledAt : currentDto.scheduledAt,
    author: has("author") ? body.author : currentDto.author,
  };

  // "Publicar ahora" sobre un programado: deja de tener sentido su fecha futura.
  if (merged.status === "published" && !has("scheduledAt")) {
    merged.scheduledAt = null;
  }

  const parsed = validateBlogPost(merged);
  if (parsed.kind === "error") {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const data = parsed.data;

  if (data.slug !== current.slug) {
    const dupe = await prisma.blogPost.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (dupe && dupe.id !== current.id) {
      return NextResponse.json(
        { error: `Ya existe un artículo con el slug "${data.slug}".` },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.blogPost.update({
    where: { id: current.id },
    data: {
      ...data,
      faq: data.faq.length > 0 ? (data.faq as any) : null,
      publishedAt: resolvePublishedAt(data.status, current.publishedAt, new Date()),
    },
  });

  // El slug o la categoría pueden haber cambiado: se invalidan ambos lados.
  revalidateBlog({
    slugs: [current.slug, updated.slug],
    categories: [current.category, updated.category],
  });
  return NextResponse.json(toBlogPostDTO(updated));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const current = await prisma.blogPost.findUnique({
    where: { id: params.id },
    select: { id: true, slug: true, category: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });
  }

  await prisma.blogPost.delete({ where: { id: current.id } });

  revalidateBlog({ slugs: [current.slug], categories: [current.category] });
  return NextResponse.json({ ok: true });
}
