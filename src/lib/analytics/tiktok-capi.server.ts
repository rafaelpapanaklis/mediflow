// Events API de TikTok — el CABLEADO del servidor (ws1-t5, tanda ws7). Espejo de
// meta-capi.server.ts: mismos cinco sitios, mismos event_id, best-effort (nunca
// lanza ni cambia la respuesta de quien llama).
//
//   · /api/auth/register y /register-oauth → CompleteRegistration (segundo plano)
//   · webhook de Stripe → CompletePayment de la PRIMERA contratación
//   · /api/admin/spei-transferencias/[id]/confirmar → CompletePayment del SPEI directo
//
// Reutiliza de Meta: la regla «¿primera contratación?» (esCompraMeta), el valor
// sin IVA, los puertos de base y la IP/UA que el checkout ya estampa en la
// metadata. Lo propio de TikTok viaja en `tt_ttclid` y `tt_ttp`.

import { SITE_URL } from "@/lib/seo";
import { centavosAPesos, centavosSinImpuesto } from "@/app/dashboard/suspended/success/conversion-pago";
import { ttclidDeCookies, ttpDeCookies } from "@/lib/ads/tiktok-click";
import { eventIdRegistro, eventIdSpeiDirecto } from "./meta-capi";
import {
  esCompraMeta,
  mantenerVivo,
  META_METADATA,
  puertosReales as puertosMeta,
  puertosSpeiReales as puertosSpeiMeta,
  senalesDePeticion,
  type CompraSpeiPendiente,
  type PuertosSpei,
  type SesionCompraMeta,
} from "./meta-capi.server";
import {
  construirEventoTiktok,
  enviarEventosTiktok,
  type DatosEventoTiktok,
  type EventoTiktok,
  type ResultadoTiktok,
  type SenalesTiktok,
} from "./tiktok-capi";

type ConCabeceras = { headers: { get(nombre: string): string | null } };
type LeerCookie = (nombre: string) => string | null | undefined;

export const TIKTOK_METADATA = { ttclid: "tt_ttclid", ttp: "tt_ttp" } as const;

/** IP, user agent, ttclid y ttp de una petición del navegador. */
export function senalesTiktokDePeticion(req: ConCabeceras, leerCookie: LeerCookie): SenalesTiktok {
  const base = senalesDePeticion(req, leerCookie);
  return {
    ip: base.ip,
    userAgent: base.userAgent,
    ttclid: ttclidDeCookies(leerCookie),
    ttp: ttpDeCookies(leerCookie),
  };
}

/** ttclid y ttp para la metadata de la sesión de Checkout (el webhook no tiene navegador). Solo las que existen. */
export function metadataTiktokDePeticion(leerCookie: LeerCookie): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    const c = ttclidDeCookies(leerCookie);
    const p = ttpDeCookies(leerCookie);
    if (c) out[TIKTOK_METADATA.ttclid] = c;
    if (p) out[TIKTOK_METADATA.ttp] = p;
    return out;
  } catch {
    return {};
  }
}

export interface PuertosTiktok {
  enviar: (eventos: EventoTiktok[]) => Promise<ResultadoTiktok>;
  contactoClinica: (clinicId: string) => Promise<{ email: string | null; phone: string | null } | null>;
  ahora: () => number;
}

export const puertosTiktokReales: PuertosTiktok = {
  enviar: (eventos) =>
    enviarEventosTiktok(
      eventos,
      { token: process.env.TIKTOK_EVENTS_API_TOKEN, testEventCode: process.env.TIKTOK_TEST_EVENT_CODE },
      (url, init) => fetch(url, init),
    ),
  contactoClinica: (clinicId) => puertosMeta.contactoClinica(clinicId),
  ahora: () => Date.now(),
};

async function enviarUno(datos: DatosEventoTiktok, puertos: PuertosTiktok): Promise<ResultadoTiktok> {
  try {
    return await puertos.enviar([construirEventoTiktok(datos)]);
  } catch {
    return "error";
  }
}

// ── CompleteRegistration ────────────────────────────────────────────────────

export async function enviarRegistroTiktok(
  input: { clinicId: string; email: string | null; phone: string | null; senales: SenalesTiktok; url?: string | null },
  puertos: PuertosTiktok = puertosTiktokReales,
): Promise<ResultadoTiktok> {
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

/** Lo que llaman las dos rutas de alta, junto al de Meta. No alarga la respuesta. */
export function enviarRegistroTiktokEnSegundoPlano(input: {
  clinicId: string;
  email: string | null;
  phone: string | null;
  req: ConCabeceras;
  leerCookie: LeerCookie;
}): void {
  try {
    const referer = input.req.headers.get("referer");
    const url = referer && referer.startsWith("http") ? referer.split("?")[0] : null;
    mantenerVivo(
      enviarRegistroTiktok({
        clinicId: input.clinicId,
        email: input.email,
        phone: input.phone,
        senales: senalesTiktokDePeticion(input.req, input.leerCookie),
        url,
      }),
    );
  } catch {
    // medir nunca rompe un alta
  }
}

// ── CompletePayment ─────────────────────────────────────────────────────────

/** CompletePayment desde el webhook de Stripe (misma regla de «primera contratación» que Meta). Nunca lanza. */
export async function enviarCompraTiktokDeSesion(
  sesion: SesionCompraMeta,
  puertos: PuertosTiktok = puertosTiktokReales,
): Promise<ResultadoTiktok | "no-aplica"> {
  try {
    if (!esCompraMeta(sesion)) return "no-aplica";
    const meta = sesion.metadata ?? {};
    const contacto = await puertos.contactoClinica(meta.clinicId).catch(() => null);
    return await enviarUno(
      {
        eventName: "CompletePayment",
        eventId: sesion.id,
        eventTime: Math.floor(puertos.ahora() / 1000),
        eventSourceUrl: `${SITE_URL}/dashboard/suspended/success`,
        email: contacto?.email || sesion.customer_details?.email || null,
        phone: contacto?.phone || sesion.customer_details?.phone || null,
        ip: meta[META_METADATA.ip] || null,
        userAgent: meta[META_METADATA.ua] || null,
        ttclid: meta[TIKTOK_METADATA.ttclid] || null,
        ttp: meta[TIKTOK_METADATA.ttp] || null,
        value: centavosAPesos(centavosSinImpuesto(sesion)),
        currency: (sesion.currency ?? "mxn").toUpperCase(),
      },
      puertos,
    );
  } catch {
    return "error";
  }
}

/** CompletePayment del SPEI directo, DESPUÉS de confirmar. Solo la primera contratación. Nunca lanza. */
export async function enviarCompraTiktokSpei(
  previa: CompraSpeiPendiente | null,
  puertos: PuertosTiktok = puertosTiktokReales,
  puertosSpei: Pick<PuertosSpei, "senalesDeSolicitud"> = puertosSpeiMeta,
): Promise<ResultadoTiktok | "no-aplica"> {
  try {
    if (!previa || !previa.primeraContratacion || !previa.clinicId) return "no-aplica";
    const [contacto, senales] = await Promise.all([
      puertos.contactoClinica(previa.clinicId).catch(() => null),
      puertosSpei.senalesDeSolicitud(previa.clinicId, previa.solicitudId).catch(() => null),
    ]);
    return await enviarUno(
      {
        eventName: "CompletePayment",
        eventId: eventIdSpeiDirecto(previa.solicitudId),
        eventTime: Math.floor(puertos.ahora() / 1000),
        eventSourceUrl: `${SITE_URL}/dashboard/suspended`,
        email: contacto?.email ?? null,
        phone: contacto?.phone ?? null,
        ip: senales?.ip ?? null,
        userAgent: senales?.userAgent ?? null,
        value: centavosAPesos(previa.subtotalCents),
        currency: "MXN",
      },
      puertos,
    );
  } catch {
    return "error";
  }
}
