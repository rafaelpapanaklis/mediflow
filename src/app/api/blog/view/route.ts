import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidBlogSlug } from "@/lib/blog/types";

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/blog/view — suma una vista a un artículo (PÚBLICO, sin auth).
//
// Por qué un endpoint y no un contador en el render: /blog/[slug] es ISR
// (`revalidate = 3600`), así que su server component sólo corre cuando la
// página se regenera — contar ahí daría una vista por hora, no por lector.
//
// SIEMPRE responde 204 sin body — slug inválido, inexistente, bot o error de
// BD — para no dar oráculo de existencia ni romper la página que trackea.
// NO llama revalidateBlog: incrementar vistas no debe invalidar el ISR.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

// Googlebot va a rastrear el blog entero estos días; sin este filtro el
// contador mediría crawlers, no personas. UA vacío = cliente no-navegador.
const BOT_UA = /bot|crawl|spider|slurp|preview|lighthouse|headless|python|curl|wget/i;

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  try {
    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || BOT_UA.test(ua)) return NO_CONTENT();

    const body = await req.json().catch(() => null);
    const slug = (body as any)?.slug;
    if (!isValidBlogSlug(slug)) return NO_CONTENT();

    // updateMany y no update: el incremento es atómico en la BD (nada de
    // leer-sumar-escribir) y un slug inexistente no lanza P2025, sólo afecta
    // 0 filas. Sólo cuentan los publicados.
    await prisma.blogPost.updateMany({
      where: { slug, status: "published" },
      data: { views: { increment: 1 } },
    });
  } catch {
    // Tragar cualquier error: el tracking jamás rompe ni filtra detalles.
  }
  return NO_CONTENT();
}
