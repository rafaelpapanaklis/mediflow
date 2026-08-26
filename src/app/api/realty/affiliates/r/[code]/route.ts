// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/affiliates/r/[code] → la liga que el socio comparte
//
// Registra el clic, deja la cookie de atribución y manda al registro. Es
// PÚBLICA a propósito: quien la abre todavía no tiene cuenta.
//
// 🔴 SIEMPRE REDIRIGE, incluso con un código inventado. Una liga rota que
// enseña un error es un prospecto perdido; una que lleva al registro sin
// cookie es, como mucho, una comisión que nadie cobra. El único caso en el
// que la cookie NO se pone es justamente ese: código desconocido.
//
// La cookie:
//   · httpOnly — nadie la lee desde el navegador;
//   · sameSite lax — sobrevive al clic desde WhatsApp o Instagram, que es
//     por donde va a llegar de verdad;
//   · dura lo que diga `cookieDays` de la config del admin, no un número
//     escrito aquí;
//   · NO se pisa si ya hay una: gana el PRIMER socio que trajo a la
//     persona, no el último. Robarse una atribución con un segundo clic es
//     el fraude clásico de los programas de referidos.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import {
  getRealtyAffiliateConfig,
  recordRealtyAffiliateClick,
} from "@/lib/realty/affiliates";
import {
  REALTY_AFF_COOKIE,
  REALTY_VID_COOKIE,
  isRealtyAffiliateCode,
} from "@/components/realty/growth/growth-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DESTINO = "/inmobiliaria/registro";

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip");
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = String(params.code ?? "").trim().toUpperCase();
  const destino = new URL(DESTINO, req.nextUrl.origin);
  const res = NextResponse.redirect(destino, 302);

  if (!isRealtyAffiliateCode(code)) return res;

  const config = await getRealtyAffiliateConfig();
  if (!config.enabled) return res;

  // El id anónimo del visitante. Se reusa el que ya tenga para que un F5 no
  // cuente como visita nueva.
  const existingVid = req.cookies.get(REALTY_VID_COOKIE)?.value;
  const vid = existingVid && existingVid.length <= 64 ? existingVid : randomUUID();

  const click = await recordRealtyAffiliateClick({
    code,
    vid,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  // Código que no existe (o socio suspendido): ni cookie ni rastro.
  if (!click.known) return res;

  const maxAge = Math.max(1, config.cookieDays) * 24 * 60 * 60;
  const secure = req.nextUrl.protocol === "https:";

  res.cookies.set(REALTY_VID_COOKIE, vid, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });

  // 🔴 GANA EL PRIMERO. Si ya trae padrino, no se toca.
  if (!req.cookies.get(REALTY_AFF_COOKIE)?.value) {
    res.cookies.set(REALTY_AFF_COOKIE, code, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge,
    });
  }

  return res;
}
