import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, hashIp, summarizeUserAgent } from "@/lib/affiliates/stats";
import { shouldCountAffiliateClick } from "@/lib/affiliates/click-guard";

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
 * No cuenta bots ni recargas dentro de la ventana de dedupe (click-guard.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(req, 30, 60_000);
    if (limited) return limited;

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
    if (!ref) return new NextResponse(null, { status: 204 });

    const campaign =
      typeof body.campaign === "string" && body.campaign ? body.campaign.slice(0, 64) : null;
    const path = typeof body.path === "string" && body.path ? body.path.slice(0, 120) : null;

    // ¿Cuenta? Bot o recarga dentro de la ventana → 204 sin escribir nada. Va
    // ANTES de resolver el afiliado: un bot sale sin gastar ni esa consulta
    // (isBotUserAgent corta en seco, la de dedupe solo corre para humanos).
    const ipHash = hashIp(clientIp(req.headers));
    const counts = await shouldCountAffiliateClick({
      userAgent: req.headers.get("user-agent"),
      ref,
      ipHash,
    });
    if (!counts) return new NextResponse(null, { status: 204 });

    // Afiliado APPROVED por referralCode o slug; ref desconocido → 204 igual.
    const affiliate = await prisma.affiliate.findFirst({
      where: { status: "APPROVED", OR: [{ referralCode: ref }, { slug: ref }] },
      select: { id: true },
    });

    if (affiliate) {
      await prisma.affiliateClick.create({
        data: {
          affiliateId: affiliate.id,
          ref,
          campaign,
          landingPage: path,
          ipHash,
          userAgent: summarizeUserAgent(req.headers.get("user-agent")),
        },
      });
    }
  } catch {
    // Tragar cualquier error: el tracking jamás rompe ni filtra detalles.
  }
  return new NextResponse(null, { status: 204 });
}
