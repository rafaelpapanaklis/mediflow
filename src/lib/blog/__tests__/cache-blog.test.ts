/**
 * ws1-t12 · El blog público no abre conexiones a la base en cada visita.
 *
 * Run: npm run test:conexiones-base
 *
 * Incidente del 1-oct-2026: un robot recorriendo /blog/<slug> cada ~2 s abría
 * una conexión por visita (la ruta era dinámica: sin generateStaticParams, Next
 * 14 la renderizaba en cada petición). Lo que se fija aquí, con las consultas
 * REALES de @/lib/blog/queries y una caché de datos de mentira que se porta
 * como la de Next (llave = nombre + argumentos, invalidación por etiqueta):
 *   · repetir la misma lectura no vuelve a la base;
 *   · revalidateBlog() invalida la etiqueta y la siguiente lectura sí va;
 *   · un slug sin forma de slug ni llega a la base;
 *   · un fallo de la base en el artículo se LANZA y no se cachea (un 404
 *     guardado por un hipo desindexaría el artículo);
 *   · /blog/[slug] es ISR: generateStaticParams vacío y revalidate ≤ 5 min.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Caché de datos de mentira, con la semántica de unstable_cache ──────────
const cache = new Map<string, { valor: string; tags: string[] }>();
const etiquetasInvalidadas: string[] = [];
const rutasInvalidadas: string[] = [];

mock.module("next/cache", {
  namedExports: {
    unstable_cache:
      (fn: (...a: unknown[]) => Promise<unknown>, partes: string[], opts: { tags?: string[]; revalidate?: number }) =>
      async (...args: unknown[]) => {
        assert.ok(opts.tags?.includes("blog-publico"), "toda lectura pública del blog lleva la etiqueta");
        assert.ok(typeof opts.revalidate === "number" && opts.revalidate <= 300, "vida en caché de 5 min como mucho");
        const llave = JSON.stringify([partes, args]);
        const hay = cache.get(llave);
        if (hay) return JSON.parse(hay.valor);
        const valor = await fn(...args); // si lanza, no se guarda (como Next)
        cache.set(llave, { valor: JSON.stringify(valor), tags: opts.tags ?? [] });
        return JSON.parse(JSON.stringify(valor));
      },
    revalidateTag: (tag: string) => {
      etiquetasInvalidadas.push(tag);
      cache.forEach((v, k) => { if (v.tags.includes(tag)) cache.delete(k); });
    },
    revalidatePath: (p: string) => { rutasInvalidadas.push(p); },
  },
});

// ── Prisma de mentira que cuenta viajes ────────────────────────────────────
let viajes = 0;
let baseCaida = false;
const articulo = {
  id: "p1", slug: "agenda-dental", title: "Agenda", metaTitle: "", metaDescription: "", excerpt: "",
  contentMd: "# hola", category: "gestion", cluster: null, tags: [], faq: null, relatedSlugs: [],
  status: "published", scheduledAt: null, publishedAt: new Date("2026-09-01T00:00:00Z"), author: "Equipo",
  readingMinutes: 3, views: 0, createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-09-02T00:00:00Z"),
};
const viaje = async <T>(r: T): Promise<T> => {
  viajes++;
  if (baseCaida) throw Object.assign(new Error("FATAL: (EMAXCONN) max client connections reached, limit: 200"), { code: "P1001" });
  return r;
};
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      blogPost: {
        findFirst: ({ where }: any) => viaje(where.slug === articulo.slug ? articulo : null),
        findMany: ({ select }: any) =>
          viaje(select?.contentMd === undefined && select?.slug && !select?.title
            ? [{ slug: articulo.slug, updatedAt: articulo.updatedAt, publishedAt: articulo.publishedAt }]
            : [articulo]),
        count: () => viaje(1),
        groupBy: () => viaje([{ category: "gestion", _count: { _all: 1 } }]),
      },
    },
  },
});

const q = () => import("@/lib/blog/queries");
const rv = () => import("@/lib/blog/revalidate");

beforeEach(() => {
  cache.clear();
  viajes = 0;
  baseCaida = false;
  etiquetasInvalidadas.length = 0;
  rutasInvalidadas.length = 0;
});

test("el artículo se lee de la base UNA vez; las visitas siguientes salen de la caché", async () => {
  const { getPublishedPostBySlug } = await q();
  for (let i = 0; i < 20; i++) {
    const p = await getPublishedPostBySlug("agenda-dental");
    assert.equal(p?.slug, "agenda-dental");
  }
  assert.equal(viajes, 1);
});

test("un artículo que no existe también se cachea (un robot inventando slugs no repite viaje)", async () => {
  const { getPublishedPostBySlug } = await q();
  assert.equal(await getPublishedPostBySlug("no-existe"), null);
  assert.equal(await getPublishedPostBySlug("no-existe"), null);
  assert.equal(viajes, 1);
});

test("un slug sin forma de slug ni llega a la base", async () => {
  const { getPublishedPostBySlug } = await q();
  for (const malo of ["", "../etc/passwd", "Mayúsculas", "a".repeat(500), "rss.xml", "wp-login.php"]) {
    assert.equal(await getPublishedPostBySlug(malo), null);
  }
  assert.equal(viajes, 0);
});

test("base caída: el artículo LANZA (no un 404 cacheado) y al volver la base se lee bien", async () => {
  const { getPublishedPostBySlug } = await q();
  baseCaida = true;
  await assert.rejects(() => getPublishedPostBySlug("agenda-dental"), /EMAXCONN/);
  baseCaida = false;
  const p = await getPublishedPostBySlug("agenda-dental");
  assert.equal(p?.slug, "agenda-dental", "el fallo no quedó guardado");
});

test("índice, conteo, RSS, sitemap y relacionados: una lectura cada uno, después caché", async () => {
  const m = await q();
  for (let i = 0; i < 3; i++) {
    await m.listPublishedPosts({ page: 1 });
    await m.countPublishedByCategory();
    await m.listRecentPublished();
    await m.listPublishedForSitemap();
    await m.getRelatedPosts({ id: "p2", slug: "otro", cluster: "agenda", relatedSlugs: ["agenda-dental"] }, 3);
  }
  assert.equal(viajes, 1 + 2 + 1 + 1 + 2, "conteo + lista (count + findMany) + RSS + sitemap + relacionados (relatedSlugs + cluster)");
});

test("?page=N fuera de rango (robot contando páginas) no consulta la base", async () => {
  const { listPublishedPosts } = await q();
  await listPublishedPosts({ page: 1 });
  const antes = viajes;
  for (let n = 2; n < 200; n++) {
    const r = await listPublishedPosts({ page: n });
    assert.equal(r.posts.length, 0);
    assert.equal(r.total, 1);
  }
  assert.equal(viajes, antes);
});

test("el sitemap conserva fechas de verdad aunque la caché guarde JSON", async () => {
  const { listPublishedForSitemap } = await q();
  await listPublishedForSitemap();
  const [e] = await listPublishedForSitemap();
  assert.ok(e.lastModified instanceof Date);
  assert.equal(e.lastModified.toISOString(), "2026-09-02T00:00:00.000Z");
});

test("base caída en el índice: vacío (como antes) y SIN cachear el vacío", async () => {
  const { listPublishedPosts } = await q();
  baseCaida = true;
  assert.equal((await listPublishedPosts({ page: 1 })).total, 0);
  baseCaida = false;
  assert.equal((await listPublishedPosts({ page: 1 })).total, 1);
});

test("revalidateBlog invalida la etiqueta: publicar o editar se ve en la siguiente visita", async () => {
  const { getPublishedPostBySlug } = await q();
  const { revalidateBlog, BLOG_CACHE_TAG } = await rv();
  await getPublishedPostBySlug("agenda-dental");
  await getPublishedPostBySlug("agenda-dental");
  assert.equal(viajes, 1);
  revalidateBlog({ slugs: ["agenda-dental"], categories: ["gestion"] });
  assert.deepEqual(etiquetasInvalidadas, [BLOG_CACHE_TAG]);
  assert.ok(rutasInvalidadas.includes("/blog/agenda-dental") && rutasInvalidadas.includes("/sitemap.xml"));
  await getPublishedPostBySlug("agenda-dental");
  assert.equal(viajes, 2);
});

test("/blog/[slug] es ISR: generateStaticParams vacío y revalidate de 5 min como mucho", () => {
  const src = readFileSync(join(process.cwd(), "src/app/blog/[slug]/page.tsx"), "utf8");
  assert.match(src, /export function generateStaticParams\(\)[^{]*\{\s*return \[\];\s*\}/);
  const r = /export const revalidate = (\d+);/.exec(src);
  assert.ok(r && Number(r[1]) <= 300, "revalidate ≤ 300");
  assert.doesNotMatch(src, /export const dynamic\s*=/, "nada que la vuelva dinámica");
  assert.doesNotMatch(src, /from "next\/headers"/, "leer cookies/headers la volvería dinámica");
});
