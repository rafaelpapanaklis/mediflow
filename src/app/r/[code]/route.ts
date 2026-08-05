import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, hashIp, summarizeUserAgent } from "@/lib/affiliates/stats";
import { createAffiliateClick, shouldCountAffiliateClick } from "@/lib/affiliates/click-guard";
import {
  AFFILIATE_COOKIE,
  parseAttribution,
  setAttributionCookie,
} from "@/lib/affiliates/attribution-cookie";
import {
  VISITOR_COOKIE,
  newVisitorId,
  parseVisitorId,
  setVisitorCookie,
} from "@/lib/affiliates/visitor-cookie";

// force-dynamic: cada visita tiene que leer y escribir cookies. Si Next
// cacheara esta ruta, dos visitantes distintos compartirían el mismo
// Set-Cookie y la atribución se cruzaría entre afiliados.
export const dynamic = "force-dynamic";
// nodejs: hashIp() usa node:crypto (createHash), que no existe en Edge.
export const runtime = "nodejs";

/**
 * GET /r/<code> — URL corta de afiliado.
 *
 * Resuelve el código, SIEMBRA la cookie de atribución de primer toque y manda
 * al visitante a la home limpia (sin ?ref= ni ?c= colgando de la URL: el
 * visitante ya no tiene que conservar el querystring hasta el registro, la
 * cookie lo hace por él durante 90 días).
 *
 * `/r` NO está en el matcher del middleware, así que corre en Node sin pasar
 * por updateSession.
 *
 * NUNCA devuelve 404 ni error: un link roto, caducado o de un afiliado
 * suspendido —compartido en WhatsApp o impreso en un QR— tiene que llevar al
 * sitio, no a un muro. Sin atribución, pero al sitio.
 *
 * Los BOTS tampoco se bloquean: reciben su redirección y su cookie igual que
 * cualquiera, solo que no suman clic (ver click-guard.ts).
 */

// Defensivo: el code viaja en la URL, así que se valida ANTES de tocar la BD.
// Cubre los dos formatos: publicCode ([a-z0-9]{8}) y referralCode ([A-Z0-9]{8}).
const CODE_RE = /^[A-Za-z0-9]{4,24}$/;

/** Home limpia. NextResponse.redirect es 307 por defecto; aquí queremos 302. */
function redirectHome(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/", req.url), 302);
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const code = (params?.code ?? "").trim();
    if (!CODE_RE.test(code)) return redirectHome(req);

    // Rate limit por IP+path: solo frena las ESCRITURAS (clic + contador). El
    // visitante siempre se redirige y siempre recibe su cookie — jamás un 429
    // en la cara de alguien que acaba de tocar un link.
    //
    // 120/min y no 30: en México la IP es compartida (CGNAT móvil, WiFi de la
    // clínica). Cuando un afiliado tira su link a un grupo grande de WhatsApp,
    // decenas de personas entran desde la misma IP en el mismo minuto y con 30
    // se tiraban clics legítimos.
    const limited = rateLimit(req, 120, 60_000) !== null;

    // Afiliado resuelto + campaña del link que lo trajo (null = link base).
    let affiliateId: string | null = null;
    let ref: string | null = null;
    let campaign: string | null = null;
    // Link cuyo contador propio habría que subir. Se resuelve aquí pero se
    // incrementa hasta ABAJO, junto con la fila de clic: las dos escrituras
    // comparten UNA sola decisión de "¿esto cuenta?" y no se pueden desfasar.
    let linkIdToCount: string | null = null;

    // a) publicCode de un AffiliateLink (alfabeto [a-z0-9] → normalizamos a
    //    minúsculas por si alguien lo dictó o lo escribió en mayúsculas).
    //    El .catch protege el caso "la columna publicCode aún no existe en la
    //    BD": el código cae al camino (b) en vez de tumbar la redirección.
    const link = await prisma.affiliateLink
      .findUnique({
        where: { publicCode: code.toLowerCase() },
        select: {
          id: true,
          campaign: true,
          affiliate: { select: { id: true, referralCode: true, status: true } },
        },
      })
      .catch(() => null);

    if (link) {
      // El code ES de un link. Si su dueño no está APPROVED (pendiente,
      // suspendido, rechazado) NO se reintenta como referralCode: se trata
      // igual que un code desconocido → home limpia, sin cookie ni clic.
      if (!link.affiliate || link.affiliate.status !== "APPROVED") {
        return redirectHome(req);
      }
      affiliateId = link.affiliate.id;
      ref = link.affiliate.referralCode;
      campaign = link.campaign ?? null;

      // Contador propio del link (el panel del afiliado lo muestra por
      // campaña). Se sube abajo, si la visita resulta contable.
      linkIdToCount = link.id;
    }

    // b) referralCode del propio afiliado (link base, sin campaña). El
    //    alfabeto es de MAYÚSCULAS, así que normalizamos hacia arriba.
    if (!affiliateId) {
      const affiliate = await prisma.affiliate
        .findFirst({
          where: { referralCode: code.toUpperCase(), status: "APPROVED" },
          select: { id: true, referralCode: true },
        })
        .catch(() => null);
      if (affiliate) {
        affiliateId = affiliate.id;
        ref = affiliate.referralCode;
        campaign = null; // link base: no hay campaña que atribuir
      }
    }

    // c) No resolvió nada (o el afiliado no está aprobado) → home limpia, sin
    //    cookie y sin registrar clic.
    if (!affiliateId || !ref) return redirectHome(req);

    const res = redirectHome(req);

    // PRIMER TOQUE: si ya hay una cookie VIGENTE no se toca — ni por otro
    // afiliado, ni por otra campaña, ni aunque sea el mismo afiliado. El
    // primero que trajo al visitante se queda la atribución sus 90 días, y no
    // se renueva con visitas posteriores. Solo sembramos cuando parseAttribution
    // devuelve null (no había cookie, estaba corrupta o ya expiró).
    const current = parseAttribution(req.cookies.get(AFFILIATE_COOKIE)?.value);
    if (!current) {
      setAttributionCookie(res, { ref, campaign, firstTouchAt: Date.now() });
    }

    // Identificador de NAVEGADOR para el conteo (dc_vid). Independiente de la
    // cookie de atribución de arriba: esta no atribuye nada, solo evita contar
    // cinco veces al mismo navegador. Se siembra a todos —bots incluidos, que
    // la ignoran— para que la respuesta sea siempre idéntica.
    const incomingVid = parseVisitorId(req.cookies.get(VISITOR_COOKIE)?.value);
    const vid = incomingVid ?? newVisitorId();
    if (!incomingVid) setVisitorCookie(res, vid);

    // Clic para el embudo del panel. En su propio try/catch: el tracking jamás
    // puede impedir que el visitante llegue al sitio. Privacidad: la IP solo
    // se guarda hasheada con salt, nunca cruda.
    //
    // OJO: `res` ya está armado con su cookie. A partir de aquí NADA puede
    // cambiar la respuesta — un bot de vista previa (WhatsApp, facebookexternalhit)
    // recibe exactamente la misma redirección de siempre, solo que sin sumar.
    const ipHash = hashIp(clientIp(req.headers));
    const counts =
      !limited &&
      // `incomingVid`, NO `vid`: lo que decide es la cookie que el visitante
      // TRAÍA. El id recién sembrado no tiene historial y saltaría el respaldo.
      (await shouldCountAffiliateClick({
        userAgent: req.headers.get("user-agent"),
        ref,
        ipHash,
        vid: incomingVid,
      }));

    if (counts) {
      await Promise.all([
        // Contador por campaña del panel del afiliado.
        linkIdToCount
          ? prisma.affiliateLink
              .update({ where: { id: linkIdToCount }, data: { clicks: { increment: 1 } } })
              .catch(() => null)
          : null,
        // La fila lleva el vid EFECTIVO (el recién sembrado en la primera
        // visita): es contra ella que deduplican las recargas siguientes.
        createAffiliateClick({
          affiliateId,
          ref,
          campaign,
          landingPage: `/r/${code}`.slice(0, 120),
          ipHash,
          userAgent: summarizeUserAgent(req.headers.get("user-agent")),
          vid,
        }),
      ]);
    }

    return res;
  } catch {
    // Cualquier imprevisto (BD caída, params raros) → al sitio igual. Esta
    // ruta nunca le devuelve un error a un visitante.
    return redirectHome(req);
  }
}
