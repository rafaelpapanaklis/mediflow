import "server-only";

/* ═══════════════════════════════════════════════════════════════════════
   EL CARGADOR DE LA WEB PÚBLICA.

   🔴 `select` EXPLÍCITO, JAMÁS `include`.

   Todo lo que devuelva este archivo viaja DENTRO del HTML de una página
   pública, cacheada por ISR y legible con "ver código fuente" sin
   contraseña. Con un `include` a secas, la fila de RealtyAccount llegaría
   entera al navegador: whatsappToken, wabaId, phoneNumberId,
   stripeCustomerId, stripeSubscriptionId y el estado de la suscripción. Es
   exactamente la fuga que ya pasó una vez en la mini-web del dental.

   Por eso el camino es SIEMPRE el mismo: `select` con las columnas
   enumeradas a mano → mapeador puro de @/lib/realty/landing
   (aCuentaPublica / aInmueblePublico / aAgentePublico / aSucursalPublica) →
   DTO. Un campo nuevo se agrega en el mapeador Y en el select, nunca al
   revés. La prueba de src/lib/realty/templates/__tests__ le mete a esos
   mapeadores una fila con todo lo sensible dentro y falla si algo sale.

   Y el accountId sale SIEMPRE del SLUG de la URL resuelto contra la base:
   ninguna función de aquí lo acepta como parámetro.
   ═══════════════════════════════════════════════════════════════════════ */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRealtyPlan } from "@/lib/realty/plans";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import {
  aAgentePublico,
  aCuentaPublica,
  aInmueblePublico,
  aSucursalPublica,
  manifiestoRealtyWeb,
  normalizarConfigRealtyWeb,
  plantillaEfectiva,
  type RealtyWebAgenteDTO,
  type RealtyWebConfig,
  type RealtyWebCuentaDTO,
  type RealtyWebData,
  type RealtyWebInmuebleDTO,
  type RealtyWebSucursalDTO,
} from "@/lib/realty/landing";
import {
  isRealtySubscriptionActive,
  REALTY_ACTIVE_SUBSCRIPTION_STATUSES,
} from "@/lib/realty/plan-shared";

/** Cuántos inmuebles se traen para la portada. Los bloques recortan más. */
const TOPE_PORTADA = 24;
/** Cuántos caben en una página del buscador. */
export const TOPE_LISTADO = 36;

/**
 * Columnas públicas de la cuenta. NI UNA MÁS.
 *
 * 🔴 SIN `email`. En este vertical el correo de la cuenta es EL MISMO con el
 * que se entra al panel: /api/realty/auth/register escribe el mismo valor en
 * RealtyAccount.email y en RealtyUser.email, y ese segundo es la credencial
 * (@@unique([accountId, email]) sobre realty_users). Publicarlo regala media
 * llave de cada cuenta, a escala, porque el sitemap lista todas las que
 * pagan. Es exactamente la regla que ya se le aplica al asesor (SELECT_AGENTE)
 * y que faltaba aplicarle al dueño.
 *
 * El correo que SÍ se publica es `config.correo`: el que la cuenta escribe a
 * mano en el editor de su web, sabiendo que se publica.
 */
const SELECT_CUENTA = {
  id: true,
  slug: true,
  name: true,
  mode: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  logoUrl: true,
  locale: true,
  isActive: true,
  licenseNumber: true,
  licenseState: true,
  licenseExpiresAt: true,
  // Se lee para decidir `noindex` y para el sitemap. NO sale al DTO
  // público: aCuentaPublica no lo copia.
  subscriptionStatus: true,
  plan: true,
} as const;

/** Columnas públicas del inmueble. Sin internalNotes ni commissionPct. */
const SELECT_INMUEBLE = {
  id: true,
  title: true,
  description: true,
  kind: true,
  operation: true,
  status: true,
  price: true,
  currency: true,
  rentPrice: true,
  maintenanceFee: true,
  landM2: true,
  builtM2: true,
  bedrooms: true,
  bathrooms: true,
  halfBathrooms: true,
  parking: true,
  ageYears: true,
  amenities: true,
  address: true,
  colonia: true,
  city: true,
  state: true,
  lat: true,
  lng: true,
  showExactAddress: true,
  publicUrlSlug: true,
  shortTermFolio: true,
  createdAt: true,
  photos: {
    select: { url: true, width: true, height: true, isCover: true },
    orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
    take: 20,
  },
  tours: {
    select: { kind: true, provider: true, externalUrl: true, fileUrl: true },
    orderBy: { sortOrder: "asc" },
    take: 4,
  },
  // `satisfies` y no `as const`: con `as const` los `orderBy` anidados se
  // vuelven arrays READONLY y Prisma los rechaza; sin nada, "desc" se
  // ensancha a `string` y también los rechaza. `satisfies` conserva los
  // literales Y comprueba el objeto contra el select de verdad, así que un
  // campo mal escrito falla al compilar en vez de en producción.
} satisfies Prisma.RealtyPropertySelect;

/**
 * Columnas públicas del asesor.
 *
 * Sin `email` a propósito: en este vertical el correo del equipo ES el
 * usuario del login (@@unique([accountId, email])). Publicarlo regala la
 * mitad de un intento de entrada. El contacto público es el WhatsApp que
 * el propio asesor pone en `socials`.
 */
const SELECT_AGENTE = {
  displayName: true,
  photoUrl: true,
  bio: true,
  zones: true,
  specialties: true,
  credentials: true,
  socials: true,
  publicSlug: true,
} as const;

/** Sin lat/lng: no se pintan, y una oficina no tiene showExactAddress. */
const SELECT_OFICINA = {
  name: true,
  address: true,
  phone: true,
  isMain: true,
} as const;

/** ¿La tabla del vertical todavía no existe en Supabase? */
function tablaSinCrear(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2010";
}

function normalizarSlug(slug: string): string {
  return (slug ?? "").trim().toLowerCase().slice(0, 120);
}

export interface CargaRealtyWeb {
  data: RealtyWebData;
  /** La cuenta apagó su web a propósito, o la suscripción no está al día. */
  indexable: boolean;
  publicada: boolean;
  /** El plan permite página propia por asesor. */
  agentPages: boolean;
  locale: string;
  /**
   * La versión del bloqueo optimista y el Json CRUDO, de la MISMA lectura
   * que `publicada` y la plantilla.
   *
   * 🔴 Están aquí y no en una segunda consulta del editor a propósito. Con
   * dos lecturas separadas se podía armar una foto imposible —`version`
   * nueva con `published` y `template` viejos— y el guardado siguiente
   * entraba por el camino directo (la versión coincide) escribiendo los
   * valores viejos: una web que alguien acababa de APAGAR volvía a estar en
   * línea, sin 409 y sin que nadie lo pidiera.
   */
  version: number;
  configCruda: unknown;
}

/** Cuenta + configuración, sin la cartera. La usan metadata y el sitemap. */
async function leerCuentaYConfig(slug: string) {
  const s = normalizarSlug(slug);
  if (!s) return null;

  const cuenta = await prisma.realtyAccount.findUnique({
    where: { slug: s },
    select: SELECT_CUENTA,
  });
  if (!cuenta || !cuenta.isActive) return null;

  const landing = await prisma.realtyLandingConfig.findUnique({
    where: { accountId: cuenta.id },
    select: { template: true, data: true, published: true, version: true },
  });

  const config = normalizarConfigRealtyWeb(landing?.data);
  const template = plantillaEfectiva(landing?.template, cuenta.mode);
  // La COLUMNA `published` es la única fuente de verdad de si la web se ve.
  // `config.publicada` es el interruptor que mueve el editor, y el PATCH
  // escribe las dos en el mismo guardado (ver /api/realty/landing): tener
  // dos fuentes que se leen a la vez es como se acaba con una web apagada
  // que se sigue sirviendo, o al revés.
  //
  // Sin fila todavía = VISIBLE con la plantilla del modo. Es la promesa del
  // plan más barato ("tienes web con la plantilla por defecto"), y por eso
  // la ausencia de fila no puede significar apagada.
  const publicada = landing ? landing.published : true;

  return {
    cuenta,
    config,
    template,
    publicada,
    version: landing?.version ?? 0,
    configCruda: landing?.data ?? null,
  };
}

/** Lo mínimo para generateMetadata: sin cartera, sin equipo, sin oficinas. */
export async function cargarSeoRealty(slug: string): Promise<{
  cuenta: RealtyWebCuentaDTO;
  config: RealtyWebConfig;
  template: string;
  indexable: boolean;
} | null> {
  try {
    const base = await leerCuentaYConfig(slug);
    if (!base) return null;
    return {
      cuenta: aCuentaPublica(base.cuenta),
      config: base.config,
      template: base.template,
      indexable: base.publicada && isRealtySubscriptionActive(base.cuenta),
    };
  } catch (e) {
    if (tablaSinCrear(e)) return null;
    console.error("[realty-web] cargarSeoRealty falló:", e);
    return null;
  }
}

/** La carga completa de la portada y del armazón de las páginas interiores. */
export async function cargarWebRealty(slug: string): Promise<CargaRealtyWeb | null> {
  try {
    const base = await leerCuentaYConfig(slug);
    if (!base) return null;
    const { cuenta, config, template } = base;

    const plan = await getRealtyPlan(cuenta.plan);
    const agentPages = realtyPlanHasFeature(plan, "agentPages");

    const [inmuebles, total, perfiles, oficinas] = await Promise.all([
      prisma.realtyProperty.findMany({
        where: { accountId: cuenta.id, isPublished: true },
        select: SELECT_INMUEBLE,
        orderBy: { createdAt: "desc" },
        take: TOPE_PORTADA,
      }),
      prisma.realtyProperty.count({ where: { accountId: cuenta.id, isPublished: true } }),
      // El AND de los DOS interruptores: el de la cuenta
      // (publicProfileEnabled, lo mueve quien administra el equipo) y el de
      // la ficha (active, lo mueve el propio asesor). Apagar cualquiera lo
      // saca de la web.
      prisma.realtyAgentProfile.findMany({
        where: {
          accountId: cuenta.id,
          active: true,
          realtyUser: { active: true, publicProfileEnabled: true },
        },
        select: SELECT_AGENTE,
        orderBy: { createdAt: "asc" },
        take: 40,
      }),
      prisma.realtyOffice.findMany({
        where: { accountId: cuenta.id, isActive: true },
        select: SELECT_OFICINA,
        orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
        take: 20,
      }),
    ]);

    const data: RealtyWebData = {
      cuenta: aCuentaPublica(cuenta),
      config,
      manifest: manifiestoRealtyWeb(template, cuenta.mode),
      inmuebles: inmuebles.map((i) => aInmueblePublico(i as Record<string, unknown>)),
      agentes: perfiles.map((p) => {
        const dto = aAgentePublico(p as Record<string, unknown>);
        // Sin la feature del plan no hay subdirectorio que enlazar: la
        // ficha se pinta, pero sin liga a una página que devolvería 404.
        return agentPages ? dto : { ...dto, ref: null };
      }),
      sucursales: oficinas.map((o) => aSucursalPublica(o as Record<string, unknown>)),
      totalInmuebles: total,
    };

    return {
      data,
      publicada: base.publicada,
      indexable: base.publicada && isRealtySubscriptionActive(cuenta),
      agentPages,
      locale: cuenta.locale,
      // De la MISMA lectura que `publicada` y la plantilla: ver CargaRealtyWeb.
      version: base.version,
      configCruda: base.configCruda,
    };
  } catch (e) {
    if (tablaSinCrear(e)) return null;
    console.error("[realty-web] cargarWebRealty falló:", e);
    return null;
  }
}

/* ── El buscador ──────────────────────────────────────────────────── */

export interface FiltrosBusqueda {
  op: string;
  tipo: string;
  zona: string;
  rec: string;
}

/**
 * El listado filtrado. El filtro va en SQL y no en memoria: una cuenta con
 * cuatrocientos inmuebles no puede traerse la cartera completa en cada
 * visita solo para descartar el 95%.
 */
export async function buscarInmueblesWeb(
  slug: string,
  filtros: FiltrosBusqueda,
): Promise<{ inmuebles: RealtyWebInmuebleDTO[]; total: number } | null> {
  const s = normalizarSlug(slug);
  if (!s) return null;
  try {
    const cuenta = await prisma.realtyAccount.findUnique({
      where: { slug: s },
      select: { id: true, isActive: true },
    });
    if (!cuenta || !cuenta.isActive) return null;

    const where: Record<string, unknown> = { accountId: cuenta.id, isPublished: true };
    // AMBAS entra tanto en "venta" como en "renta": un inmueble que se
    // vende o se renta tiene que salir en las dos búsquedas o el visitante
    // jura que no hay nada.
    if (filtros.op === "VENTA") where.operation = { in: ["VENTA", "AMBAS"] };
    else if (filtros.op === "RENTA") where.operation = { in: ["RENTA", "AMBAS"] };
    else if (filtros.op === "AMBAS") where.operation = "AMBAS";
    if (filtros.tipo) where.kind = filtros.tipo;
    if (filtros.zona) {
      where.OR = [
        { colonia: { equals: filtros.zona, mode: "insensitive" } },
        { city: { equals: filtros.zona, mode: "insensitive" } },
      ];
    }
    if (filtros.rec) where.bedrooms = { gte: Number(filtros.rec) };

    const [filas, total] = await Promise.all([
      prisma.realtyProperty.findMany({
        where: where as never,
        select: SELECT_INMUEBLE,
        orderBy: { createdAt: "desc" },
        take: TOPE_LISTADO,
      }),
      prisma.realtyProperty.count({ where: where as never }),
    ]);

    return {
      inmuebles: filas.map((f) => aInmueblePublico(f as Record<string, unknown>)),
      total,
    };
  } catch (e) {
    if (tablaSinCrear(e)) return null;
    console.error("[realty-web] buscarInmueblesWeb falló:", e);
    return null;
  }
}

/* ── La ficha ─────────────────────────────────────────────────────── */

export interface CargaFicha {
  inmueble: RealtyWebInmuebleDTO;
  /** El asesor asignado, si tiene ficha pública encendida. */
  asesor: RealtyWebAgenteDTO | null;
  /** Otros inmuebles de la misma cuenta, para no dejar salida única. */
  similares: RealtyWebInmuebleDTO[];
}

/**
 * Un inmueble por su slug público O por su id.
 *
 * Los dos a propósito: un letrero impreso con el id sigue funcionando
 * después de que alguien le ponga slug al anuncio, y el QR del letrero es
 * el canal número uno en México.
 */
export async function cargarFichaRealty(slug: string, ref: string): Promise<CargaFicha | null> {
  const s = normalizarSlug(slug);
  const r = (ref ?? "").trim().slice(0, 140);
  if (!s || !r) return null;
  try {
    const cuenta = await prisma.realtyAccount.findUnique({
      where: { slug: s },
      select: { id: true, isActive: true },
    });
    if (!cuenta || !cuenta.isActive) return null;

    const fila = await prisma.realtyProperty.findFirst({
      where: {
        accountId: cuenta.id,
        isPublished: true,
        OR: [{ publicUrlSlug: r }, { id: r }],
      },
      select: { ...SELECT_INMUEBLE, assignedUserId: true },
    });
    if (!fila) return null;

    const [perfil, similares] = await Promise.all([
      fila.assignedUserId
        ? prisma.realtyAgentProfile.findFirst({
            where: {
              accountId: cuenta.id,
              realtyUserId: fila.assignedUserId,
              active: true,
              realtyUser: { active: true, publicProfileEnabled: true },
            },
            select: SELECT_AGENTE,
          })
        : Promise.resolve(null),
      prisma.realtyProperty.findMany({
        where: { accountId: cuenta.id, isPublished: true, id: { not: fila.id } },
        select: SELECT_INMUEBLE,
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
    ]);

    // assignedUserId se leyó para encontrar al asesor y NO viaja al DTO:
    // aInmueblePublico no lo copia, pero se quita aquí también para que
    // nadie lo pase por descuido a un componente cliente.
    const { assignedUserId: _asignado, ...publico } = fila;

    return {
      inmueble: aInmueblePublico(publico as Record<string, unknown>),
      asesor: perfil ? aAgentePublico(perfil as Record<string, unknown>) : null,
      similares: similares.map((x) => aInmueblePublico(x as Record<string, unknown>)),
    };
  } catch (e) {
    if (tablaSinCrear(e)) return null;
    console.error("[realty-web] cargarFichaRealty falló:", e);
    return null;
  }
}

/* ── La página del asesor ─────────────────────────────────────────── */

export interface CargaAgente {
  agente: RealtyWebAgenteDTO;
  inmuebles: RealtyWebInmuebleDTO[];
  total: number;
}

/**
 * La página propia de un asesor: /i/[slug]/agentes/[agente].
 *
 * 🔴 Existe para NO CANIBALIZAR: doce asesores hablando de las mismas
 * colonias desde la misma página compiten entre sí y Google acaba no
 * rankeando a ninguno. Cada uno con su subdirectorio, su cartera y su
 * WhatsApp.
 *
 * Devuelve null si el plan no tiene `agentPages`: una URL que el plan no
 * incluye no puede quedar viva sirviendo contenido indexable.
 */
export async function cargarAgenteRealty(
  slug: string,
  agenteRef: string,
): Promise<CargaAgente | null> {
  const s = normalizarSlug(slug);
  const r = (agenteRef ?? "").trim().slice(0, 140);
  if (!s || !r) return null;
  try {
    const cuenta = await prisma.realtyAccount.findUnique({
      where: { slug: s },
      select: { id: true, isActive: true, plan: true },
    });
    if (!cuenta || !cuenta.isActive) return null;

    const plan = await getRealtyPlan(cuenta.plan);
    if (!realtyPlanHasFeature(plan, "agentPages")) return null;

    const perfil = await prisma.realtyAgentProfile.findFirst({
      where: {
        accountId: cuenta.id,
        publicSlug: r,
        active: true,
        realtyUser: { active: true, publicProfileEnabled: true },
      },
      select: { ...SELECT_AGENTE, realtyUserId: true },
    });
    if (!perfil) return null;

    const [filas, total] = await Promise.all([
      prisma.realtyProperty.findMany({
        where: { accountId: cuenta.id, isPublished: true, assignedUserId: perfil.realtyUserId },
        select: SELECT_INMUEBLE,
        orderBy: { createdAt: "desc" },
        take: TOPE_LISTADO,
      }),
      prisma.realtyProperty.count({
        where: { accountId: cuenta.id, isPublished: true, assignedUserId: perfil.realtyUserId },
      }),
    ]);

    const { realtyUserId: _interno, ...publico } = perfil;

    return {
      agente: aAgentePublico(publico as Record<string, unknown>),
      inmuebles: filas.map((f) => aInmueblePublico(f as Record<string, unknown>)),
      total,
    };
  } catch (e) {
    if (tablaSinCrear(e)) return null;
    console.error("[realty-web] cargarAgenteRealty falló:", e);
    return null;
  }
}

/* ── El sitemap del vertical ──────────────────────────────────────── */

export interface EntradaSitemapRealty {
  slug: string;
  actualizado: Date;
  inmuebles: Array<{ ref: string; actualizado: Date }>;
  agentes: string[];
}

/**
 * Las cuentas que SÍ deben indexarse: activas, con la suscripción al
 * corriente y con la web encendida. Una cuenta que apagó su página se
 * sirve con noindex y un sitemap jamás debe listarla.
 */
export async function entradasSitemapRealty(): Promise<EntradaSitemapRealty[]> {
  try {
    const cuentas = await prisma.realtyAccount.findMany({
      where: {
        isActive: true,
        // La MISMA constante que decide `indexable`, no un literal copiado.
        // Con dos listas, el día que se añada un estado el sitemap listaría
        // URLs que la propia página sirve con noindex.
        subscriptionStatus: { in: Array.from(REALTY_ACTIVE_SUBSCRIPTION_STATUSES) },
      },
      select: {
        id: true,
        slug: true,
        updatedAt: true,
        plan: true,
        landingConfig: { select: { published: true, updatedAt: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });

    const out: EntradaSitemapRealty[] = [];
    for (const c of cuentas) {
      const publicada = c.landingConfig ? c.landingConfig.published : true;
      if (!publicada) continue;

      const plan = await getRealtyPlan(c.plan);
      const conAgentes = realtyPlanHasFeature(plan, "agentPages");

      const [inmuebles, agentes] = await Promise.all([
        prisma.realtyProperty.findMany({
          where: { accountId: c.id, isPublished: true },
          select: { id: true, publicUrlSlug: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 500,
        }),
        conAgentes
          ? prisma.realtyAgentProfile.findMany({
              where: {
                accountId: c.id,
                active: true,
                publicSlug: { not: null },
                realtyUser: { active: true, publicProfileEnabled: true },
              },
              select: { publicSlug: true },
              take: 60,
            })
          : Promise.resolve([]),
      ]);

      out.push({
        slug: c.slug,
        actualizado: c.landingConfig?.updatedAt ?? c.updatedAt,
        inmuebles: inmuebles.map((i) => ({
          ref: i.publicUrlSlug ?? i.id,
          actualizado: i.updatedAt,
        })),
        agentes: agentes
          .map((a) => a.publicSlug)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      });
    }
    return out;
  } catch {
    // El build de Vercel corre sin garantía de DATABASE_URL: un sitemap
    // vacío es infinitamente mejor que un build caído.
    return [];
  }
}
