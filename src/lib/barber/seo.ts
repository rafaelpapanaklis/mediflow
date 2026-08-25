/* ═══════════════════════════════════════════════════════════════════════
   SEO DEL VERTICAL BARBER — núcleo PURO.

   Sin prisma y sin "server-only": esto se importa desde el sitemap (que
   es servidor), desde las páginas de `/barberias` (servidor) y desde
   cualquier componente de cliente que necesite una ruta o un bloque de
   datos estructurados. La lectura de la base vive en su archivo aparte,
   `src/lib/barber/seo-query.ts`, precisamente para que este NO arrastre
   prisma a un bundle de navegador.

   Es el espejo de `src/lib/seo.ts` del dental, y usa su `SITE_URL` en
   vez de declarar otro: el dominio es UNO. Importarlo no lo modifica.

   ── EL TIPO DE NEGOCIO ES `HealthAndBeautyBusiness` ───────────────
   Una barbería NO es un negocio médico. El JSON-LD de cada mini-web
   vive en `src/app/b/[slug]/_shared/seo.ts` y ya usa ese tipo; aquí
   solo se declara la regla para que nadie la contradiga desde otra
   superficie: en todo el vertical, jamás `MedicalBusiness`,
   `MedicalClinic`, `Dentist`, `Physician` ni `MedicalSpecialty`.

   La landing y las comparativas NO son un negocio: son el PRODUCTO de
   software que se le vende a la barbería. Su tipo es
   `SoftwareApplication`, igual que el dental.
   ═══════════════════════════════════════════════════════════════════════ */

import { SITE_URL } from "@/lib/seo";
import { COMPETIDOR_SLUGS } from "@/lib/barber/comparativas";

/* ── 1. Las rutas públicas del vertical ─────────────────────────────── */

/** La landing del producto. La construye la terminal de landing. */
export const BARBER_LANDING_PATH = "/barberias";

/** La base de las comparativas. La construye la terminal de comparativas. */
export const BARBER_COMPARAR_PATH = "/barberias/comparar";

/** La mini-web de una barbería. Punto ÚNICO: `rutaWebBarberia` en landing.ts. */
export function rutaSitemapBarberia(slug: string): string {
  return `/b/${slug}`;
}

/**
 * Los slugs de comparativa que se publican en el sitemap.
 *
 * NO es una lista a mano: es exactamente `COMPETIDOR_SLUGS`, la misma
 * fuente de la que `/barberias/comparar/[competidor]` saca su
 * `generateStaticParams`. Así no puede existir una comparativa que se
 * genere y no se anuncie, ni una URL anunciada que dé 404: la página y
 * el sitemap leen el MISMO array.
 *
 * Publicar una comparativa nueva es añadir su competidor en
 * `src/lib/barber/comparativas.ts` y nada más. En particular **no hay
 * que volver a tocar `src/app/sitemap.ts`**, que es un archivo
 * COMPARTIDO con el dental y está vivo en producción.
 */
export const BARBER_COMPARATIVA_SLUGS: readonly string[] = COMPETIDOR_SLUGS;

export type BarberChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface BarberSitemapPath {
  /** Ruta absoluta dentro del sitio, empezando por "/". */
  path: string;
  changeFrequency: BarberChangeFrequency;
  priority: number;
}

/**
 * Las rutas ESTÁTICAS del vertical que sí se indexan.
 *
 * Prioridades alineadas con el criterio que ya usa el dental en
 * `src/app/sitemap.ts`: una landing de producto vale 0.9 (como
 * `/software-agenda-dental`), y el contenido editorial de apoyo
 * —comparativas— vale 0.7 (como `/casos-de-uso/*`).
 *
 * Lo que NO está aquí está explicado en `BARBER_RUTAS_NO_INDEXADAS`.
 */
export function barberStaticSitemapPaths(): BarberSitemapPath[] {
  return [
    { path: BARBER_LANDING_PATH, changeFrequency: "monthly", priority: 0.9 },
    // El índice de comparativas vale más que cada comparativa suelta: es
    // el que captura "alternativas a X" en genérico y reparte hacia las
    // tres, igual que /casos-de-uso vale más que un caso concreto.
    { path: BARBER_COMPARAR_PATH, changeFrequency: "monthly", priority: 0.8 },
    ...BARBER_COMPARATIVA_SLUGS.map((slug) => ({
      path: `${BARBER_COMPARAR_PATH}/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}

/**
 * Las rutas públicas del vertical que NO se indexan, y por qué.
 *
 * No es documentación decorativa: es el contrato que evita que la
 * próxima ola meta una de estas en el sitemap "porque es pública".
 * Público ≠ indexable.
 *
 * Cada una de estas rutas ya declara `robots: { index: false }` en su
 * propio `generateMetadata` — que es lo que de verdad las saca de
 * Google. Bloquearlas en `robots.txt` sería PEOR: un `Disallow` impide
 * rastrear la página y, por tanto, impide LEER el `noindex`, así que una
 * URL ya indexada se quedaría dentro para siempre.
 */
export const BARBER_RUTAS_NO_INDEXADAS: { patron: string; porque: string }[] = [
  {
    patron: "/b/[slug]/mi-cuenta",
    porque:
      "Portal del cliente. Tiene el historial de visitas y los datos personales de una persona; " +
      "nunca debe existir en un buscador.",
  },
  {
    patron: "/b/[slug]/reservar",
    porque:
      "Embudo de reserva. Es contenido calcado de /b/[slug] (mismos servicios, mismos barberos) " +
      "y se sirve force-dynamic: indexarlo canibalizaría a la mini-web y gastaría rastreo en " +
      "una lectura de la base por visita del robot. El dental aplica el mismo criterio a su " +
      "/reservar (está en el Disallow de robots.txt).",
  },
  {
    patron: "/barber/fila/[slug]",
    porque:
      "Pantalla de la fila virtual: efímera por definición (cambia cada pocos minutos y no " +
      "significa nada fuera del local). Indexarla es publicar un dato caduco.",
  },
  {
    patron: "/barber/**",
    porque:
      "El panel de la barbería. Todo pide sesión y redirige a /login; /barber/registro además " +
      "declara noindex. Es el equivalente de /dashboard en el dental.",
  },
];

/* ── 2. Qué mini-webs entran al sitemap ─────────────────────────────── */

/** Lo mínimo que hay que leer de `barber_shops` para el sitemap. */
export interface BarberShopSeoRow {
  id: string;
  slug: string;
  updatedAt: Date;
}

/** Lo mínimo que hay que leer de `barber_landing_configs`. SIN el `config`. */
export interface BarberLandingSeoRow {
  barbershopId: string;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface BarberWebSitemapEntry {
  path: string;
  lastModified: Date;
}

/**
 * Las mini-webs que se publican en el sitemap.
 *
 * ── LA REGLA, Y POR QUÉ ES EXACTAMENTE ESTA ───────────────────────
 * El sitemap tiene que decir LA MISMA COSA que la página: listar una
 * URL que responde 404 o que se sirve con `noindex` es un error de
 * rastreo que Search Console reporta.
 *
 *   · `isActive = false`  → `cargarBarberWeb` devuelve null → 404.
 *   · `config.oculta`     → la página se sirve con robots noindex.
 *   · cualquier otro caso → página completa e indexable.
 *
 * Aquí se resuelve la tercera condición (la apagada). Las otras dos
 * —`isActive` y la suscripción viva— las filtra el `where` de
 * `getBarberWebSitemapEntries` en `seo-query.ts`, que explica por qué.
 *
 * ── POR QUÉ NO SE EXIGE `publishedAt` ─────────────────────────────
 * Porque en este producto `publishedAt` NO es la llave de la puerta.
 * Una barbería del plan Básico no tiene editor y por tanto no tiene
 * fila en `barber_landing_configs`: su `publishedAt` es null para
 * siempre y aun así su página está VIVA (plantilla clásica con su
 * nombre, dirección, servicios y barberos reales — es justo lo que se
 * le vende). Exigir `publishedAt != null` habría borrado del sitemap a
 * todo el plan Básico, que es el grueso del padrón.
 * `publishedAt` sirve para otra cosa: es la mejor fecha de
 * `lastModified` cuando existe.
 *
 * La función es PURA a propósito: la regla de "una barbería que apagó
 * su página no aparece" se prueba sin base de datos
 * (`__tests__/seo.test.ts`).
 *
 * @param shops     barberías con isActive = true.
 * @param ocultas   ids de barbería cuya config dice `oculta: true`.
 * @param configs   filas de config (solo fechas) para el lastModified.
 */
export function barberiasIndexables(
  shops: BarberShopSeoRow[],
  ocultas: ReadonlySet<string>,
  configs: BarberLandingSeoRow[] = [],
): BarberWebSitemapEntry[] {
  const esFecha = (d: unknown): d is Date =>
    d instanceof Date && !Number.isNaN(d.getTime());

  const fechas = new Map<string, Date>();
  for (const c of configs) {
    // `publishedAt` gana sobre `updatedAt`: es la fecha en la que el
    // visitante vio el cambio, no la del último autoguardado. Una fecha
    // corrupta no arrastra a la otra — se prueba la siguiente.
    const f = esFecha(c.publishedAt) ? c.publishedAt : esFecha(c.updatedAt) ? c.updatedAt : null;
    if (f) fechas.set(c.barbershopId, f);
  }

  const out: BarberWebSitemapEntry[] = [];
  const vistos = new Set<string>();

  for (const shop of shops) {
    const slug = (shop.slug ?? "").trim();
    if (!slug) continue;
    // Apagada a propósito desde el editor → la página va con noindex.
    if (ocultas.has(shop.id)) continue;
    // `slug` es @unique en el schema; el guardia es por si una lectura
    // futura une dos tablas y duplica filas.
    if (vistos.has(slug)) continue;
    vistos.add(slug);

    out.push({
      path: rutaSitemapBarberia(slug),
      lastModified: fechas.get(shop.id) ?? shop.updatedAt,
    });
  }

  return out;
}

/* ── 3. Datos estructurados de las comparativas ─────────────────────── */

export interface BarberBreadcrumbItem {
  name: string;
  /** Ruta dentro del sitio o URL absoluta. */
  path: string;
}

export interface BarberComparativaLdOptions {
  /** Nombre del producto ("DaleControl Barber"). */
  producto: string;
  descripcion: string;
  /** Ruta de ESTA página ("/barberias/comparar/booksy"). */
  path: string;
  /** Precios mensuales REALES, ya resueltos con `getBarberPlans()`. */
  precios: number[];
  /** Migas, de la más general a esta página. */
  migas: BarberBreadcrumbItem[];
}

function urlAbsoluta(p: string): string {
  return p.startsWith("http") ? p : `${SITE_URL}${p}`;
}

/**
 * El `@graph` de una página de comparativa: el producto + las migas.
 *
 * ── AQUÍ NO SE SERIALIZA, Y ES A PROPÓSITO ────────────────────────
 * El serializador seguro ya existe y está EN USO: `serializeBarberJsonLd`
 * (`src/lib/barber/marketing.ts`), el que la landing usa desde el primer
 * día. Tener dos serían dos sitios donde arreglar el mismo agujero el
 * día que se escape un "menor que". Aquí solo se construye el objeto; la
 * página lo pasa por el de marketing.
 *
 * ── EL TIPO ES `SoftwareApplication`, NO EL DEL NEGOCIO ───────────
 * Una comparativa habla de NUESTRO software frente al de otro. El
 * negocio —`HealthAndBeautyBusiness`— es la barbería, y ese tipo vive en
 * la mini-web. Aquí sería falso, y encima nos metería en la categoría de
 * salud y belleza a competir por otras búsquedas.
 *
 * ── POR QUÉ LAS MIGAS ─────────────────────────────────────────────
 * Una comparativa cuelga del índice, que cuelga de la landing. Sin
 * `BreadcrumbList`, Google la trata como una página suelta y no entiende
 * que las cuatro son una sección.
 */
export function barberComparativaLd(opts: BarberComparativaLdOptions): object {
  const url = urlAbsoluta(opts.path);
  const validos = opts.precios.filter((n) => Number.isFinite(n) && n > 0);

  const software: Record<string, unknown> = {
    "@type": "SoftwareApplication",
    "@id": `${url}#software`,
    name: opts.producto,
    url,
    description: opts.descripcion,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "es-MX",
  };

  // Sin precios NO se inventa la oferta. Un AggregateOffer con 0 es peor
  // que no declarar nada: Google lo lee como "gratis".
  if (validos.length > 0) {
    software.offers = {
      "@type": "AggregateOffer",
      priceCurrency: "MXN",
      lowPrice: Math.min(...validos).toFixed(2),
      highPrice: Math.max(...validos).toFixed(2),
      offerCount: validos.length,
      availability: "https://schema.org/InStock",
    };
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      software,
      {
        "@type": "BreadcrumbList",
        itemListElement: opts.migas.map((m, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: m.name,
          item: urlAbsoluta(m.path),
        })),
      },
    ],
  };
}
