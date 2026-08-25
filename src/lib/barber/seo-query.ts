import "server-only";
import { prisma } from "@/lib/prisma";
import { BARBER_ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/barber/plan-shared";
import {
  barberiasIndexables,
  type BarberLandingSeoRow,
  type BarberShopSeoRow,
  type BarberWebSitemapEntry,
} from "@/lib/barber/seo";

/* ═══════════════════════════════════════════════════════════════════════
   LA LECTURA QUE ALIMENTA EL SITEMAP CON LAS MINI-WEBS.

   Vive separada de `seo.ts` (que es puro) porque importa prisma: así la
   landing y las comparativas pueden usar las constantes y el JSON-LD sin
   arrastrar el cliente de base de datos a un bundle de navegador.

   🛡️ `select` EXPLÍCITO. La fila `barber_shops` tiene `whatsappToken`,
   `stripeCustomerId`, `email` y `phoneNumberId`. Aquí solo se piden tres
   columnas y ninguna sale del servidor: lo único que se publica es la
   URL. Enumerar es a prueba de futuro — una columna secreta nueva no se
   filtra sola.

   🛡️ NUNCA se lee la columna `config` (jsonb). Tiene la galería, las
   reseñas y toda la copia del editor: traerla para miles de barberías
   serían megabytes por cada petición del sitemap. Lo único que hace
   falta de ella es un booleano, y ese se resuelve DENTRO de Postgres con
   un filtro por ruta de json.
   ═══════════════════════════════════════════════════════════════════════ */

/** Techo duro, igual que el que ya usa el dental en el sitemap. */
export const BARBER_SITEMAP_CAP = 5000;

/**
 * Lectura de `barber_landing_configs`, que puede no existir todavía.
 *
 * `sql/barber_complemento.sql` (donde nace la tabla) no está aplicado en
 * todos los entornos. `src/app/b/[slug]/_shared/shop-data.ts` ya vive con
 * eso y sirve la página igual; aquí se hace lo MISMO para no desviarse de
 * lo que el visitante realmente recibe.
 */
type LecturaConfigs =
  | { estado: "ok"; ocultas: Set<string>; fechas: BarberLandingSeoRow[] }
  /** La tabla no existe → nadie ha podido apagar nada: todas las páginas viven. */
  | { estado: "sinTabla" }
  /** Cualquier otro fallo → NO se publica ninguna mini-web (ver abajo). */
  | { estado: "error" };

async function leerConfigs(): Promise<LecturaConfigs> {
  try {
    const [ocultas, fechas] = await Promise.all([
      // Solo los ids de las apagadas. El filtro corre en Postgres, así que
      // no viaja ni un byte de jsonb. `equals: true` es estricto, igual
      // que `normalizarConfigBarberWeb` (`o.oculta === true`): un "true"
      // de texto o un 1 NO apagan la página, ni aquí ni allá.
      prisma.barberLandingConfig.findMany({
        where: { config: { path: ["oculta"], equals: true } },
        select: { barbershopId: true },
      }),
      prisma.barberLandingConfig.findMany({
        select: { barbershopId: true, publishedAt: true, updatedAt: true },
        take: BARBER_SITEMAP_CAP,
      }),
    ]);

    return {
      estado: "ok",
      ocultas: new Set(ocultas.map((o) => o.barbershopId)),
      fechas,
    };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // P2021 = la tabla no existe. P2010 = la lectura cruda falló por lo mismo.
    if (code === "P2021" || code === "P2010") return { estado: "sinTabla" };
    return { estado: "error" };
  }
}

/**
 * Las mini-webs de barbería que van al sitemap.
 *
 * ── QUIÉN ENTRA ───────────────────────────────────────────────────
 *   1. `isActive = true`      — es el interruptor maestro: en false,
 *      `cargarBarberWeb` devuelve null y la página responde 404.
 *   2. Suscripción viva       — ver el bloque de abajo.
 *   3. La página NO apagada   — `config.oculta` la sirve con `noindex`,
 *      y un sitemap jamás debe listar una URL noindex.
 *
 * ── POR QUÉ SE EXIGE SUSCRIPCIÓN VIVA (no estaba en el encargo) ───
 * `/barber/registro` es un formulario público y `Barbershop.isActive`
 * nace en `true` con `subscriptionStatus = "pending_payment"`. Sin este
 * filtro, cualquiera que rellene el registro y no pague nunca obtiene una
 * página indexada en el dominio principal, y el sitemap se la estaría
 * ENTREGANDO a Google en bandeja. Un padrón de registros basura
 * publicados desde dalecontrol.com es un problema de dominio, no de una
 * barbería.
 *
 * Se usa el punto ÚNICO del repo, `BARBER_ACTIVE_SUBSCRIPTION_STATUSES`
 * (active | trialing | paid) — el mismo criterio con el que el panel
 * decide si la barbería tiene la cuenta al corriente. Es también el
 * criterio del dental, que en `visibilityWhere()` exige que el negocio no
 * esté cancelada para entrar al directorio y al sitemap.
 *
 * Consecuencia que hay que saber: una barbería en `past_due` sale del
 * sitemap hasta que pague. NO se des-indexa —su página sigue viva y
 * sigue siendo `index,follow`—, solo se deja de re-anunciar. Si se
 * prefiere que el cobro no toque el SEO, se borra la línea
 * `subscriptionStatus` del `where` y vuelve el criterio literal del
 * encargo (`isActive` + no apagada).
 *
 * ── SI ALGO FALLA ─────────────────────────────────────────────────
 * Devuelve `[]`. Nunca lanza: el sitemap es COMPARTIDO con el dental y
 * un fallo del vertical barber no puede tumbar el sitemap del producto
 * que está vivo en producción.
 *
 * Y falla CERRADO: si la lectura de configuraciones revienta por un
 * motivo que no sea "la tabla no existe", no se publica ninguna mini-web.
 * Publicarlas sin poder comprobar cuáles están apagadas sería filtrar al
 * buscador justo las páginas que su dueña pidió esconder.
 */
export async function getBarberWebSitemapEntries(): Promise<BarberWebSitemapEntry[]> {
  try {
    const shops: BarberShopSeoRow[] = await prisma.barbershop.findMany({
      where: {
        isActive: true,
        subscriptionStatus: { in: Array.from(BARBER_ACTIVE_SUBSCRIPTION_STATUSES) },
      },
      select: { id: true, slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
      take: BARBER_SITEMAP_CAP,
    });

    if (shops.length === 0) return [];

    const configs = await leerConfigs();
    if (configs.estado === "error") return [];
    if (configs.estado === "sinTabla") return barberiasIndexables(shops, new Set());

    return barberiasIndexables(shops, configs.ocultas, configs.fechas);
  } catch {
    return [];
  }
}
