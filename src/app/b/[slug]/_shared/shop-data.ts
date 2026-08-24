import "server-only";
import { prisma } from "@/lib/prisma";
import {
  BARBER_WEB_TEMPLATE_DEFAULT,
  normalizarConfigBarberWeb,
  type BarberWebConfig,
} from "@/lib/barber/landing";
import { manifiestoBarberWeb } from "@/components/barber/templates/manifest";
import type { BarberWebData } from "@/components/barber/templates/types";

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE SE LEE DE LA BASE PARA PINTAR /b/[slug].

   🛡️ `select` EXPLÍCITO, jamás `include` ni `findUnique` a secas.

   Esto se sirve SIN sesión, se cachea por ISR y se lee entero con "ver
   código fuente". La fila `barber_shops` tiene `whatsappToken`,
   `stripeCustomerId`, `stripeSubscriptionId`, `email`, `plan`,
   `subscriptionStatus`, `wabaId` y `phoneNumberId`: ninguno de esos
   sale de aquí, y no salen porque NO SE PIDEN. Enumerar es a prueba de
   futuro — una columna secreta nueva no se filtra sola.

   La lista es exactamente `BarberWebShop`
   (components/barber/templates/types.ts) más `isActive`, que se usa aquí
   y no viaja. Un campo nuevo se agrega en los DOS sitios.

   El tenant sale del SLUG DE LA URL. No hay sesión que consultar y no
   hay barbershopId en ningún parámetro: una barbería no puede pedir los
   datos de otra porque no hay dónde pedirlo.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BarberWebCarga {
  data: BarberWebData;
  /** null = nunca ha publicado (o el editor todavía no ha guardado nada). */
  publishedAt: Date | null;
  /** true = la barbería apagó su web a propósito. */
  oculta: boolean;
  /** Marca de bloqueo optimista. 0 = todavía no hay fila. Solo la usa el editor. */
  version: number;
  /**
   * true = la tabla barber_landing_configs NO existe todavía en la base.
   * La página pública no se entera (sale con todo por defecto); el editor
   * SÍ, y lo dice, porque sin la tabla no puede guardar nada.
   */
  sinTabla: boolean;
}

/**
 * Los datos de la página de una barbería, o null si el slug no existe o
 * la barbería está dada de baja.
 *
 * Una barbería SIN fila en `barber_landing_configs` tiene página igual:
 * plantilla clásica y todo por defecto, con su nombre, dirección,
 * teléfono, servicios y barberos reales. Es la página del plan Básico,
 * que no tiene editor — y por eso no puede depender de que exista una
 * fila que solo escribe el editor.
 */
export async function cargarBarberWeb(slug: string): Promise<BarberWebCarga | null> {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s || s.length > 120) return null;

  const shop = await prisma.barbershop.findUnique({
    where: { slug: s },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      logoUrl: true,
      isActive: true,
    },
  });

  if (!shop || !shop.isActive) return null;

  const [servicios, barberos, landing] = await Promise.all([
    prisma.barberService.findMany({
      where: { barbershopId: shop.id, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        durationMin: true,
        price: true,
        category: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 120,
    }),
    prisma.barber.findMany({
      where: { barbershopId: shop.id, isActive: true },
      select: { id: true, name: true, nickname: true, photoUrl: true, bio: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 40,
    }),
    leerConfig(shop.id),
  ]);

  const config = normalizarConfigBarberWeb(landing?.config);

  return {
    publishedAt: landing?.publishedAt ?? null,
    oculta: config.oculta,
    version: landing?.version ?? 0,
    sinTabla: landing === SIN_TABLA,
    data: {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        phone: shop.phone,
        address: shop.address,
        city: shop.city,
        state: shop.state,
        logoUrl: shop.logoUrl,
      },
      config,
      manifest: manifiestoBarberWeb(landing?.template ?? BARBER_WEB_TEMPLATE_DEFAULT),
      servicios: servicios.map((sv) => ({
        id: sv.id,
        nombre: sv.name,
        descripcion: sv.description,
        duracionMin: sv.durationMin,
        // Decimal de Prisma → number. Sin esto viaja como objeto y el
        // formateador de precio devuelve "NaN".
        precio: Number(sv.price),
        categoria: sv.category,
      })),
      barberos: barberos.map((b) => ({
        id: b.id,
        nombre: b.name,
        apodo: b.nickname,
        fotoUrl: b.photoUrl,
        bio: b.bio,
      })),
      editando: false,
    },
  };
}

/**
 * La fila de configuración, o null.
 *
 * El try/catch NO es por pereza: `barber_landing_configs` nace en
 * sql/barber_complemento.sql, que todavía no está aplicado en Supabase.
 * Sin él, una consulta a una tabla que no existe tumbaría con un 500 la
 * página pública de TODAS las barberías. Con él, cada una sigue teniendo
 * su página con la plantilla por defecto hasta que el SQL entre.
 */
type FilaConfig = { template: string; config: unknown; version: number; publishedAt: Date | null };

/** Centinela: la consulta falló porque la tabla no existe (no porque no haya fila). */
const SIN_TABLA: FilaConfig = { template: "", config: null, version: 0, publishedAt: null };

async function leerConfig(barbershopId: string): Promise<FilaConfig | null> {
  try {
    return await prisma.barberLandingConfig.findUnique({
      where: { barbershopId },
      select: { template: true, config: true, version: true, publishedAt: true },
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2021" || code === "P2010") return SIN_TABLA;
    throw e;
  }
}

/** Solo lo necesario para `generateMetadata`, sin traerse servicios ni barberos. */
export async function cargarSeoBarberWeb(slug: string): Promise<{
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  config: BarberWebConfig;
} | null> {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s || s.length > 120) return null;

  const shop = await prisma.barbershop.findUnique({
    where: { slug: s },
    select: {
      id: true,
      name: true,
      slug: true,
      address: true,
      city: true,
      state: true,
      logoUrl: true,
      isActive: true,
    },
  });
  if (!shop || !shop.isActive) return null;

  const landing = await leerConfig(shop.id);
  return {
    name: shop.name,
    slug: shop.slug,
    address: shop.address,
    city: shop.city,
    state: shop.state,
    logoUrl: shop.logoUrl,
    config: normalizarConfigBarberWeb(landing?.config),
  };
}
