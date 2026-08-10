import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { rateLimitKey } from "@/lib/rate-limit";
import {
  createAffiliateAccount,
  normalizePayoutMethod,
  sendAffiliateSignupEmails,
} from "@/lib/affiliates/signup";
import { resolveInviterId } from "@/lib/affiliates/invites";

/**
 * POST /api/afiliados/auth/link — VINCULACIÓN.
 *
 * Da de alta como afiliado a alguien que YA tiene cuenta en DaleControl (el
 * dueño de una clínica, típicamente). Afiliados y clínicas comparten el mismo
 * Supabase Auth, así que su correo ya existe y el registro normal no puede
 * crearlo. Ser cliente y ser afiliado son roles independientes: esta ruta crea
 * el `Affiliate` (PENDING) + el `AffiliateUser` apuntando a su supabaseId YA
 * existente.
 *
 * SEGURIDAD — las dos reglas que sostienen todo:
 *
 *  1. El `supabaseId` sale SIEMPRE de la sesión verificada en el servidor
 *     (`supabase.auth.getUser()`, que valida el token contra el servidor de
 *     Auth), JAMÁS del body. Si viniera del body, cualquiera podría vincularse
 *     al usuario de otro mandando su id.
 *  2. Esta ruta NO crea usuarios, NO cambia contraseñas y NO modifica la cuenta
 *     de Supabase de nadie. Sólo escribe filas nuevas en `affiliates` y
 *     `affiliate_users`. La contraseña de clínica queda exactamente igual.
 *
 * Por lo mismo NO hay rollback de Supabase Auth aquí: no hay nada que revertir,
 * porque esta ruta nunca creó al usuario.
 */

const UNSAFE_ORIGIN_ERROR = NextResponse.json(
  { error: "Origen no permitido." },
  { status: 403 }
);

/**
 * Esta ruta muta estado y autentica por cookie, así que un POST cross-site
 * podría dar de alta un afiliado a nombre de quien tenga sesión abierta. La
 * cookie de Supabase es SameSite=lax (no viaja en POST cross-site), pero un
 * check de origen explícito es barato y no depende de esa configuración.
 * Mismo criterio que el guard CSRF de /api/admin en src/middleware.ts.
 */
function originMismatch(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return true;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const sourceHost = (() => {
    try {
      return origin ? new URL(origin).host : referer ? new URL(referer).host : null;
    } catch {
      return null;
    }
  })();
  if (!sourceHost) return true;
  return sourceHost !== host;
}

export async function POST(req: Request) {
  if (originMismatch(req)) return UNSAFE_ORIGIN_ERROR;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimitKey(`afiliados-link:${ip}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un minuto e intenta de nuevo." },
      { status: 429 }
    );
  }

  // 1) SESIÓN VERIFICADA EN EL SERVIDOR. Única fuente del supabaseId y del correo.
  let user: { id: string; email?: string } | null = null;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  } catch {
    user = null;
  }

  if (!user?.id || !user.email) {
    return NextResponse.json(
      { error: "Inicia sesión con tu cuenta de DaleControl para activar tu cuenta de afiliado." },
      { status: 401 }
    );
  }

  const supabaseId = user.id;
  const email = user.email.trim().toLowerCase();

  // 2) ¿Esta sesión ya es afiliado? → no dupliques: a su panel.
  const existingLink = await prisma.affiliateUser.findUnique({ where: { supabaseId } });
  if (existingLink) {
    return NextResponse.json({ ok: true, alreadyLinked: true, home: "/afiliados/inicio" });
  }

  // 3) Ya hay un Affiliate con ese correo pero NO vinculado a ESTA sesión.
  //    No se adopta: sería un camino de apropiación de una cuenta ajena (p. ej.
  //    si el correo de aquel afiliado cambió en Auth y otra persona lo reusó).
  const existingAffiliate = await prisma.affiliate.findUnique({ where: { email } });
  if (existingAffiliate) {
    return NextResponse.json(
      {
        error:
          "Este correo ya tiene una cuenta de afiliado. Inicia sesión en el portal de afiliados o contacta a soporte.",
        loginUrl: "/afiliados/login",
      },
      { status: 409 }
    );
  }

  // 4) Datos del alta. Vienen del formulario de registro cuando la persona ya
  //    los había escrito; si no llegaron, la pantalla de vinculación los pide.
  //    El correo NO se lee del body: es el de la sesión verificada.
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const payoutMethod = normalizePayoutMethod(body?.payoutMethod);
  const payoutDetails =
    typeof body?.payoutDetails === "string" ? body.payoutDetails.trim().slice(0, 300) : "";

  if (!name) {
    return NextResponse.json(
      { error: "Tu nombre o el de tu empresa es requerido." },
      { status: 400 }
    );
  }

  // 5) ¿Llegó invitado por otro afiliado (`?inv=<referralCode>` propagado desde
  //    /afiliados/registro)? Igual que en el registro normal, esto NUNCA rompe
  //    el alta: código inválido, invitador no APPROVED o auto-invitación
  //    devuelven null y la cuenta se crea igual, sin vínculo. Se resuelve aquí
  //    y no antes porque el `inv` viaja en el body, que se parsea en el paso 4.
  const invitedByAffiliateId = await resolveInviterId({ code: body?.inv, email });

  // 6) Alta con el MISMO helper que el registro normal: mismo slug, mismo
  //    referralCode y mismo status PENDING.
  let affiliateId = "";
  try {
    affiliateId = await createAffiliateAccount({
      name,
      email,
      supabaseId,
      payoutMethod,
      payoutDetails,
      invitedByAffiliateId,
    });
  } catch {
    // Sin rollback de Supabase Auth a propósito: el usuario ya existía y esta
    // ruta no lo creó. Borrarlo dejaría a la persona sin su cuenta de clínica.
    return NextResponse.json(
      { error: "No se pudo activar tu cuenta de afiliado. Intenta de nuevo." },
      { status: 500 }
    );
  }

  // 7) Mismos avisos por correo que el alta normal.
  sendAffiliateSignupEmails({ affiliateId, name, email, payoutMethod });

  return NextResponse.json({ ok: true, status: "PENDING" }, { status: 201 });
}
