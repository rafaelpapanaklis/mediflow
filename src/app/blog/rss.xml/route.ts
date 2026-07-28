import { SITE_URL, SITE_NAME } from "@/lib/seo";
import { listRecentPublished } from "@/lib/blog/queries";
import { blogCategoryLabel } from "@/lib/blog/categories";
import { BLOG_RSS_LIMIT } from "@/lib/blog/types";

// ─────────────────────────────────────────────────────────────────────────────
// /blog/rss.xml — últimos 50 artículos PUBLICADOS.
//
// Segmento estático bajo /blog, así que gana sobre /blog/[slug] (y "rss.xml"
// está además en BLOG_RESERVED_SLUGS para que nadie pueda crear un artículo
// que intente ocupar esta URL).
//
// Sólo published: listRecentPublished filtra en el where — los borradores y los
// programados no se filtran aquí.
// ─────────────────────────────────────────────────────────────────────────────

export const revalidate = 3600;

/** Escapa los 5 caracteres que rompen un documento XML. */
function xmlEscape(value: string): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(value: string | null): string {
  const d = value ? new Date(value) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toUTCString();
}

export async function GET() {
  const posts = await listRecentPublished(BLOG_RSS_LIMIT);
  const now = new Date().toUTCString();

  const items = posts
    .map((p) => {
      const url = `${SITE_URL}/blog/${p.slug}`;
      return [
        "    <item>",
        `      <title>${xmlEscape(p.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
        `      <description>${xmlEscape(p.excerpt)}</description>`,
        `      <category>${xmlEscape(blogCategoryLabel(p.category))}</category>`,
        `      <pubDate>${rfc822(p.publishedAt)}</pubDate>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>Blog ${xmlEscape(SITE_NAME)}</title>`,
    `    <link>${SITE_URL}/blog</link>`,
    "    <description>Guías prácticas de gestión, marketing, finanzas y tecnología para clínicas en México.</description>",
    "    <language>es-MX</language>",
    `    <lastBuildDate>${posts.length > 0 ? rfc822(posts[0].publishedAt) : now}</lastBuildDate>`,
    `    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
