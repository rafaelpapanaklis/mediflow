import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { parsePageParams } from "@/lib/pagination";
import { isBlogCategory } from "@/lib/blog/categories";
import { isBlogStatus, toBlogPostDTO } from "@/lib/blog/types";
import { resolvePublishedAt, validateBlogPost } from "@/lib/blog/validate";
import { revalidateBlog } from "@/lib/blog/revalidate";

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/blog — listado y creación de artículos (guard AdminUser).
//
// BlogPost es GLOBAL (sin clinicId): el admin de plataforma ve y edita todo.
// Aquí SÍ se devuelven borradores y programados — es el panel; el filtro por
// `published` sólo aplica a las rutas públicas (src/lib/blog/queries.ts).
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

/** GET /api/admin/blog[?status=&category=&q=&page=&take=] */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const statusParam = sp.get("status");
  const categoryParam = sp.get("category");
  const q = (sp.get("q") ?? "").trim().slice(0, 120);

  const where: any = {};
  if (isBlogStatus(statusParam)) where.status = statusParam;
  if (categoryParam && isBlogCategory(categoryParam)) where.category = categoryParam;
  if (q) where.title = { contains: q, mode: "insensitive" };

  const { take, skip, page } = parsePageParams(sp);

  const [total, rows] = await Promise.all([
    prisma.blogPost.count({ where }),
    prisma.blogPost.findMany({
      where,
      // Lo accionable primero: lo recién tocado arriba.
      orderBy: { updatedAt: "desc" },
      take,
      skip,
    }),
  ]);

  return NextResponse.json({
    posts: rows.map(toBlogPostDTO),
    total,
    page,
    take,
    totalPages: Math.max(1, Math.ceil(total / take)),
  });
}

/** POST /api/admin/blog — crea un artículo. */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = validateBlogPost(body);
  if (parsed.kind === "error") {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const data = parsed.data;

  const dupe = await prisma.blogPost.findUnique({
    where: { slug: data.slug },
    select: { id: true },
  });
  if (dupe) {
    return NextResponse.json(
      { error: `Ya existe un artículo con el slug "${data.slug}".` },
      { status: 409 },
    );
  }

  const created = await prisma.blogPost.create({
    data: {
      ...data,
      faq: data.faq.length > 0 ? (data.faq as any) : undefined,
      publishedAt: resolvePublishedAt(data.status, null, new Date()),
    },
  });

  revalidateBlog({ slugs: [created.slug], categories: [created.category] });
  return NextResponse.json(toBlogPostDTO(created), { status: 201 });
}
