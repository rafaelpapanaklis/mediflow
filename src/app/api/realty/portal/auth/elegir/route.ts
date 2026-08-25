import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_PORTAL_COOKIE,
  getPortalSession,
  packPortalSession,
  parsePortalIdentityKey,
  portalCookieOptions,
  portalCsrfBlocked,
  portalUnauthorized,
  resolvePortalIdentities,
} from "@/lib/realty/portal-auth";

/**
 * POST /api/realty/portal/auth/elegir — fijar con cuál cara se entra.
 *
 * Sirve para el paso de "¿inquilino o propietario?" después del código, y
 * también para cambiar de cuenta más tarde sin volver a pedir un código.
 *
 * 🔴 LA LLAVE VIENE DEL NAVEGADOR Y NO SE CREE. Se vuelven a resolver las
 * identidades del teléfono VERIFICADO en la cookie y se comprueba que la
 * llave esté entre ellas. Mandar "PROPIETARIO:<cuenta ajena>" no abre
 * nada: no está en la lista, así que sale 403.
 *
 * Y aunque alguien lograra fijar una cara que no le toca, cada consulta
 * vuelve a derivar el cerco desde el teléfono (getPortalScope) y se
 * quedaría vacío.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const csrf = portalCsrfBlocked(req);
    if (csrf) return csrf;

    const session = getPortalSession();
    if (!session) return portalUnauthorized();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parsePortalIdentityKey(body?.key);
    if (!parsed) return NextResponse.json({ error: "Opción no válida." }, { status: 400 });

    const identities = await resolvePortalIdentities(session.phone);
    const elegida = identities.find(
      (i) => i.role === parsed.role && i.accountId === parsed.accountId,
    );
    if (!elegida) return NextResponse.json({ error: "Opción no válida." }, { status: 403 });

    // 🔴 El 4º argumento es el `issuedAt` ORIGINAL. Sin él, cada cambio de
    // cara reiniciaría el techo absoluto de 90 días y la sesión sería
    // renovable para siempre — que es justo lo que ese techo evita.
    const packed = packPortalSession(
      session.phone,
      { role: elegida.role, accountId: elegida.accountId },
      new Date(),
      session.issuedAt,
    );
    if (!packed) {
      console.error("[realty/portal/elegir] sin secreto de cookie: no se puede abrir sesión");
      return NextResponse.json(
        { error: "No pudimos abrir tu sesión. Intenta más tarde." },
        { status: 503 },
      );
    }

    const res = NextResponse.json({
      ok: true,
      next: elegida.role === "INQUILINO" ? "/i/portal/inquilino" : "/i/portal/propietario",
    });
    res.cookies.set(REALTY_PORTAL_COOKIE, packed.value, portalCookieOptions(packed.expiresAt));
    return res;
  } catch (err) {
    console.error("[realty/portal/elegir] error:", err);
    return NextResponse.json({ error: "No pudimos continuar. Intenta de nuevo." }, { status: 500 });
  }
}
