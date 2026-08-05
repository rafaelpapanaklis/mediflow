import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, hashIp, summarizeUserAgent } from "@/lib/affiliates/stats";
import { createAffiliateClick, shouldCountAffiliateClick } from "@/lib/affiliates/click-guard";
import {
  VISITOR_COOKIE,
  newVisitorId,
  parseVisitorId,
  setVisitorCookie,
} from "@/lib/affiliates/visitor-cookie";

export const dynamic = "force-dynamic";

/**
 * POST /api/afiliados/track — registra un click de afiliado (público).
 * Body: { ref: string; path?: string; campaign?: string | null }
 *
 * Siempre responde 204 sin body — también con ref desconocido, bot filtrado o
 * error de DB — para no dar oráculo de enumeración ni romper la página que
 * trackea. Privacidad: la IP solo se guarda hasheada con salt (hashIp); nunca
 * cruda ni en logs.
 *
 * No cuenta bots ni recargas del mismo navegador dentro de la ventana de
 * dedupe (click-guard.ts).
 *
 * Esta ruta es además la que SIEMBRA dc_vid en /socio/<slug>: una página
 * (server component) no puede mandar Set-Cookie, un route handler sí. Por eso
 * el 204 se arma al principio y todas las salidas devuelven ESE mismo
 * response — si alguna se fuera por su cuenta, ese visitante se quedaría sin
 * identificador y volvería a contar en cada recarga.
 */
export async function POST(req: NextRequest) {
  // 120/min (antes 30): la IP es compartida en México —CGNAT móvil, WiFi de
  // la clínica—, así que un link compartido en un grupo grande de WhatsApp
  // llena la cuota con gente legítima.
  const limited = rateLimit(req, 120, 60_000);
  if (limited) return limited;

  const res = new NextResponse(null, { status: 204 });
  const incomingVid = parseVisitorId(req.cookies.get(VISITOR_COOKIE)?.value);
  const vid = incomingVid ?? newVisitorId();
  if (!incomingVid) setVisitorCookie(res, vid);

  try {
    // Body tolerante: sendBeacon manda un Blob JSON (a veces sin content-type
    // estándar). Si req.json() falla, intentamos texto + JSON.parse.
    let raw: unknown = null;
    try {
      raw = await req.json();
    } catch {
      try {
        const text = await req.text();
        raw = text ? JSON.parse(text) : null;
      } catch {
        raw = null;
      }
    }

    const body = (raw ?? {}) as { ref?: unknown; path?: unknown; campaign?: unknown };
    const ref = typeof body.ref === "string" ? body.ref.trim().slice(0, 64) : "";
    if (!ref) return res;

    const campaign =
      typeof body.campaign === "string" && body.campaign ? body.campaign.slice(0, 64) : null;
    const path = typeof body.path === "string" && body.path ? body.path.slice(0, 120) : null;

    // ¿Cuenta? Bot o recarga del mismo navegador → 204 sin escribir nada. Va
    // ANTES de resolver el afiliado: un bot sale sin gastar ni esa consulta
    // (isBotUserAgent corta en seco, la de dedupe solo corre para humanos).
    // `incomingVid`: decide la cookie que TRAÍA, no la que se acaba de sembrar.
    const ipHash = hashIp(clientIp(req.headers));
    const counts = await shouldCountAffiliateClick({
      userAgent: req.headers.get("user-agent"),
      ref,
      ipHash,
      vid: incomingVid,
    });
    if (!counts) return res;

    // Afiliado APPROVED por referralCode o slug; ref desconocido → 204 igual.
    const affiliate = await prisma.affiliate.findFirst({
      where: { status: "APPROVED", OR: [{ referralCode: ref }, { slug: ref }] },
      select: { id: true },
    });

    if (affiliate) {
      // Con el vid EFECTIVO: es la fila contra la que deduplicarán tanto las
      // recargas como el conteo server-side de /socio/<slug>.
      await createAffiliateClick({
        affiliateId: affiliate.id,
        ref,
        campaign,
        landingPage: path,
        ipHash,
        userAgent: summarizeUserAgent(req.headers.get("user-agent")),
        vid,
      });
    }
  } catch {
    // Tragar cualquier error: el tracking jamás rompe ni filtra detalles.
  }
  return res;
}
