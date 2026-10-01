// API de Conversiones de Meta — el CABLEADO del servidor (WS1-T4).
//
// Tres sitios la llaman, los tres best-effort (nunca lanzan, nunca cambian la
// respuesta de quien los llama):
//   · /api/auth/register y /register-oauth → CompleteRegistration, en segundo
//     plano (la respuesta del alta no espera a Meta).
//   · webhook de Stripe (checkout.session.completed / async_payment_succeeded)
//     → Purchase de la PRIMERA contratación, tarjeta y SPEI/OXXO de Stripe. Es
//     el que cuenta los pagos que nunca pasan por la página de éxito.
//   · /api/admin/spei-transferencias/[id]/confirmar → Purchase del SPEI directo.
//
// La base se lee con `import()` perezoso dentro de los puertos por defecto: así
// las pruebas inyectan puertos falsos y nunca cargan Prisma ni tocan la red.
//
// Sin `import "server-only"` a propósito (rompe las suites de tsx); este
// archivo usa node:crypto y nadie del navegador lo importa.

import { fbcDeCookies, fbpDeCookies } from "@/lib/ads/meta-click";
import { SITE_URL } from "@/lib/seo";
import { centavosAPesos, centavosSinImpuesto, PLATFORM_SUBSCRIPTION_KIND } from "@/app/dashboard/suspended/success/conversion-pago";
import {
  construirEventoCapi,
  enviarEventosCapi,
  eventIdRegistro,
  eventIdSpeiDirecto,
  type DatosEventoMeta,
  type ResultadoCapi,
  type SenalesNavegador,
} from "./meta-capi";

// ── Señales del navegador ───────────────────────────────────────────────────

type ConCabeceras = { headers: { get(nombre: string): string | null } };
type LeerCookie = (nombre: string) => string | null | undefined;

/** IP, user agent, fbp y fbc de una petición del navegador (alta, checkout). */
export function senalesDePeticion(req: ConCabeceras, leerCookie: LeerCookie): SenalesNavegador {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0]!.trim() : "") || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
  let fbp: string | null = null;
  let fbc: string | null = null;
  try { fbp = fbpDeCookies(leerCookie); } catch { /* cookie rara: sin fbp */ }
  try { fbc = fbcDeCookies(leerCookie); } catch { /* cookie rara: sin fbc */ }
  return { ip, userAgent: req.headers.get("user-agent"), fbp, fbc };
}

/**
 * Claves de metadata de la sesión de Checkout con las señales del navegador
 * que inició el pago. El webhook no tiene navegador: las lee de aquí para que
 * el Purchase del servidor case con la persona (Stripe limita cada valor a 500
 * caracteres). Solo van las que existen.
 */
export const META_METADATA = { ip: "meta_ip", ua: "meta_ua", fbp: "meta_fbp", fbc: "meta_fbc" } as const;

export function metadataMetaDePeticion(req: ConCabeceras, leerCookie: LeerCookie): Record<string, string> {
  try {
    const s = senalesDePeticion(req, leerCookie);
    const out: Record<string, string> = {};
    if (s.ip) out[META_METADATA.ip] = s.ip.slice(0, 64);
    if (s.userAgent) out[META_METADATA.ua] = s.userAgent.slice(0, 500);
    if (s.fbp) out[META_METADATA.fbp] = s.fbp.slice(0, 500);
    if (s.fbc) out[META_METADATA.fbc] = s.fbc.slice(0, 500);
    return out;
  } catch {
    return {};
  }
}

// ── Puertos (base, red, entorno) ────────────────────────────────────────────

export interface ContactoClinica {
  email: string | null;
  phone: string | null;
}

export interface PuertosMeta {
  enviar: (eventos: ReturnType<typeof construirEventoCapi>[]) => Promise<ResultadoCapi>;
  /** Correo y teléfono de la clínica (filtro por id = la clínica del evento). */
  contactoClinica: (clinicId: string) => Promise<ContactoClinica | null>;
  /** fbc / fbp guardados en el alta (clinic_ads_clicks, de WS1-T10). null si no hay o la tabla/columna no existe. */
  clickMetaGuardado: (clinicId: string) => Promise<{ fbc: string | null; fbp: string | null } | null>;
  ahora: () => number;
}

const puertosReales: PuertosMeta = {
  enviar: (eventos) =>
    enviarEventosCapi(
      eventos,
      { token: process.env.META_CAPI_TOKEN, testEventCode: process.env.META_CAPI_TEST_EVENT_CODE },
      (url, init) => fetch(url, init),
    ),
  contactoClinica: async (clinicId) => {
    if (!clinicId) return null; // regla (c): sin clínica no se consulta
    const { prisma } = await import("@/lib/prisma");
    return prisma.clinic.findUnique({ where: { id: clinicId }, select: { email: true, phone: true } });
  },
  clickMetaGuardado: async (clinicId) => {
    if (!clinicId) return null;
    try {
      const { prisma } = await import("@/lib/prisma");
      // SQL crudo: las columnas fbc/fbp las crea sql/ws1-t10-meta-origen.sql y
      // el código va antes que el SQL. Sin tabla (42P01) o sin columna (42703) → null.
      const filas = await prisma.$queryRaw<{ fbc: string | null; fbp: string | null }[]>`
        SELECT "fbc", "fbp" FROM "clinic_ads_clicks" WHERE "clinicId" = ${clinicId} LIMIT 1`;
      return filas[0] ?? null;
    } catch {
      return null;
    }
  },
  ahora: () => Date.now(),
};

async function enviarUno(datos: DatosEventoMeta, puertos: PuertosMeta): Promise<ResultadoCapi> {
  try {
    return await puertos.enviar([construirEventoCapi(datos)]);
  } catch {
    return "error";
  }
}

// ── CompleteRegistration ────────────────────────────────────────────────────

/**
 * CompleteRegistration del servidor para la clínica recién creada. Mismo
 * event_id que manda el píxel desde /signup (lo devuelve el alta en
 * `metaEventId`). Nunca lanza.
 */
export async function enviarRegistroMeta(
  input: { clinicId: string; email: string | null; phone: string | null; senales: SenalesNavegador; url?: string | null },
  puertos: PuertosMeta = puertosReales,
): Promise<ResultadoCapi> {
  if (!input.clinicId) return "sin-datos";
  return enviarUno(
    {
      eventName: "CompleteRegistration",
      eventId: eventIdRegistro(input.clinicId),
      eventTime: Math.floor(puertos.ahora() / 1000),
      eventSourceUrl: input.url || `${SITE_URL}/signup`,
      email: input.email,
      phone: input.phone,
      ...input.senales,
    },
    puertos,
  );
}

/** Mantiene viva la función de Vercel hasta que termine `tarea` (igual que google-sync.ts). */
function mantenerVivo(tarea: Promise<unknown>): void {
  try {
    const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.();
    ctx?.waitUntil?.(tarea);
  } catch { /* fuera de Vercel el proceso sigue vivo solo */ }
}

/**
 * Lo que llaman las dos rutas de alta. No alarga la respuesta: el envío sigue
 * en segundo plano. Devuelve el event_id para que el navegador lo use en el
 * píxel (deduplicación).
 */
export function enviarRegistroMetaEnSegundoPlano(input: {
  clinicId: string;
  email: string | null;
  phone: string | null;
  req: ConCabeceras;
  leerCookie: LeerCookie;
}): string {
  const eventId = eventIdRegistro(input.clinicId);
  try {
    const referer = input.req.headers.get("referer");
    const url = referer && referer.startsWith("http") ? referer.split("?")[0] : null;
    mantenerVivo(
      enviarRegistroMeta({
        clinicId: input.clinicId,
        email: input.email,
        phone: input.phone,
        senales: senalesDePeticion(input.req, input.leerCookie),
        url,
      }),
    );
  } catch {
    // medir nunca rompe un alta
  }
  return eventId;
}

// ── Purchase ────────────────────────────────────────────────────────────────

/** Lo mínimo de una Stripe.Checkout.Session que hace falta (asignable desde el SDK). */
export interface SesionCompraMeta {
  id: string;
  payment_status: string;
  amount_total: number | null;
  total_details?: { amount_tax?: number | null } | null;
  currency: string | null;
  metadata: Record<string, string> | null;
  customer_details?: { email?: string | null; phone?: string | null } | null;
}

/**
 * ¿Esta sesión pagada es un Purchase para Meta? Mismas reglas que la conversión
 * «Pago completado» de Google (conversion-pago.ts): suscripción de la
 * plataforma, cobro acreditado y PRIMERA contratación. Renovaciones, cambios de
 * plan, módulos o recargas no cuentan.
 */
export function esCompraMeta(sesion: SesionCompraMeta): boolean {
  const meta = sesion.metadata ?? {};
  return (
    !!meta.clinicId &&
    meta.kind === PLATFORM_SUBSCRIPTION_KIND &&
    meta.firstContract === "1" &&
    sesion.payment_status === "paid" &&
    /^cs_(test|live)_/.test(sesion.id)
  );
}

/**
 * Purchase del servidor desde el webhook de Stripe. event_id = id de la sesión
 * (cs_…), el mismo que usa el píxel en /dashboard/suspended/success. Valor =
 * lo cobrado SIN IVA con el cupón descontado (amount_total − amount_tax). Las
 * señales del navegador salen de la metadata que estampó el checkout; si no
 * vienen, del fbc/fbp que guardó el alta. Nunca lanza.
 */
export async function enviarCompraMetaDeSesion(
  sesion: SesionCompraMeta,
  puertos: PuertosMeta = puertosReales,
): Promise<ResultadoCapi | "no-aplica"> {
  try {
    if (!esCompraMeta(sesion)) return "no-aplica";
    const meta = sesion.metadata ?? {};
    const clinicId = meta.clinicId;
    const [contacto, guardado] = await Promise.all([
      puertos.contactoClinica(clinicId).catch(() => null),
      meta[META_METADATA.fbc] && meta[META_METADATA.fbp] ? Promise.resolve(null) : puertos.clickMetaGuardado(clinicId).catch(() => null),
    ]);
    return await enviarUno(
      {
        eventName: "Purchase",
        eventId: sesion.id,
        eventTime: Math.floor(puertos.ahora() / 1000),
        eventSourceUrl: `${SITE_URL}/dashboard/suspended/success`,
        email: contacto?.email || sesion.customer_details?.email || null,
        phone: contacto?.phone || sesion.customer_details?.phone || null,
        ip: meta[META_METADATA.ip] || null,
        userAgent: meta[META_METADATA.ua] || null,
        fbp: meta[META_METADATA.fbp] || guardado?.fbp || null,
        fbc: meta[META_METADATA.fbc] || guardado?.fbc || null,
        value: centavosAPesos(centavosSinImpuesto(sesion)),
        currency: (sesion.currency ?? "mxn").toUpperCase(),
      },
      puertos,
    );
  } catch {
    return "error";
  }
}

// ── SPEI directo (/admin confirma la transferencia) ─────────────────────────

export interface CompraSpeiPendiente {
  solicitudId: string;
  clinicId: string;
  /** Centavos SIN IVA (el SPEI directo no lleva cupón). */
  subtotalCents: number;
  primeraContratacion: boolean;
}

export interface PuertosSpei extends PuertosMeta {
  /** Solicitud + estado de la clínica ANTES de confirmar (para saber si es la primera contratación). */
  leerSolicitud: (solicitudId: string) => Promise<{
    clinicId: string;
    subtotalCents: number;
    status: string;
    clinica: { stripeSubscriptionId: string | null; subscriptionId: string | null; nextBillingDate: Date | null } | null;
  } | null>;
  /** IP / user agent de quien dijo «Ya hice la transferencia» (la bitácora de esa solicitud). */
  senalesDeSolicitud: (clinicId: string, solicitudId: string) => Promise<{ ip: string | null; userAgent: string | null } | null>;
}

const puertosSpeiReales: PuertosSpei = {
  ...puertosReales,
  leerSolicitud: async (solicitudId) => {
    const { prisma } = await import("@/lib/prisma");
    const sol = await prisma.speiTransferRequest.findUnique({
      where: { id: solicitudId },
      select: { clinicId: true, subtotalCents: true, status: true },
    });
    if (!sol?.clinicId) return null;
    const clinica = await prisma.clinic.findUnique({
      where: { id: sol.clinicId },
      select: { stripeSubscriptionId: true, subscriptionId: true, nextBillingDate: true },
    });
    return { ...sol, clinica };
  },
  senalesDeSolicitud: async (clinicId, solicitudId) => {
    if (!clinicId) return null;
    const { prisma } = await import("@/lib/prisma");
    const fila = await prisma.auditLog.findFirst({
      where: { clinicId, entityType: "admin-billing", entityId: solicitudId, action: "create" },
      select: { ipAddress: true, userAgent: true },
      orderBy: { createdAt: "desc" },
    });
    return fila ? { ip: fila.ipAddress, userAgent: fila.userAgent } : null;
  },
};

/**
 * Se llama ANTES de confirmar: después la clínica ya tiene periodo y no se
 * distinguiría de una renovación (mismo criterio que isFirstContract del
 * checkout). null si no hay solicitud pendiente. Nunca lanza.
 */
export async function prepararCompraMetaSpei(
  solicitudId: string,
  puertos: PuertosSpei = puertosSpeiReales,
): Promise<CompraSpeiPendiente | null> {
  try {
    const sol = await puertos.leerSolicitud(solicitudId);
    if (!sol || sol.status !== "pending" || !sol.clinica) return null;
    const c = sol.clinica;
    return {
      solicitudId,
      clinicId: sol.clinicId,
      subtotalCents: sol.subtotalCents,
      primeraContratacion: !c.stripeSubscriptionId && !c.subscriptionId && !c.nextBillingDate,
    };
  } catch {
    return null;
  }
}

/** Purchase del SPEI directo, DESPUÉS de que la confirmación salió bien. Solo la primera contratación. Nunca lanza. */
export async function enviarCompraMetaSpei(
  previa: CompraSpeiPendiente | null,
  puertos: PuertosSpei = puertosSpeiReales,
): Promise<ResultadoCapi | "no-aplica"> {
  try {
    if (!previa || !previa.primeraContratacion || !previa.clinicId) return "no-aplica";
    const [contacto, guardado, senales] = await Promise.all([
      puertos.contactoClinica(previa.clinicId).catch(() => null),
      puertos.clickMetaGuardado(previa.clinicId).catch(() => null),
      puertos.senalesDeSolicitud(previa.clinicId, previa.solicitudId).catch(() => null),
    ]);
    return await enviarUno(
      {
        eventName: "Purchase",
        eventId: eventIdSpeiDirecto(previa.solicitudId),
        eventTime: Math.floor(puertos.ahora() / 1000),
        eventSourceUrl: `${SITE_URL}/dashboard/suspended`,
        email: contacto?.email ?? null,
        phone: contacto?.phone ?? null,
        ip: senales?.ip ?? null,
        userAgent: senales?.userAgent ?? null,
        fbp: guardado?.fbp ?? null,
        fbc: guardado?.fbc ?? null,
        value: centavosAPesos(previa.subtotalCents),
        currency: "MXN",
      },
      puertos,
    );
  } catch {
    return "error";
  }
}
