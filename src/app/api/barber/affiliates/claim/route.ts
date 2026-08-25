import { NextResponse } from "next/server";
import {
  BARBER_AFF_COOKIE_DAYS,
  claimBarberReferralByCode,
  normalizeBarberAffCode,
  rootBarbershopIdOf,
  type BarberClaimReason,
} from "@/lib/barber/affiliates";
import { affiliatesErrorResponse, readJsonBody, requireBarberAffiliates } from "../_lib";

/**
 * POST /api/barber/affiliates/claim — "me recomendó esta barbería".
 *
 * El camino NORMAL de la atribución es la cookie dcb_aff, que se cobra sola
 * al darse de alta (hook en /api/barber/auth/register). Esta ruta es el
 * repesque para quien entró por la liga pero perdió la cookie (cambió de
 * teléfono, navegador en incógnito, se registró desde otra máquina).
 *
 * TODOS los candados corren en el servidor, dentro de
 * claimBarberReferralByCode: no puede referirse a sí misma, ni otra sede de
 * su cadena, ni una cuenta del mismo dueño, ni cerrar un círculo, ni
 * robarle la atribución a quien ya la tiene. Esta ruta no relaja ninguno.
 *
 * VENTANA: solo durante los primeros 90 días de vida de la barbería — el
 * MISMO número que dura la cookie, para no tener dos criterios en la casa.
 * Sin la ventana, una barbería de hace tres años podría regalarle una
 * comisión a un amigo escribiendo su código.
 */
export const dynamic = "force-dynamic";

/** Mensaje para el socio. El motivo técnico viaja aparte, en `reason`. */
const MESSAGES: Record<BarberClaimReason, string> = {
  OK: "Listo: registramos quién te recomendó.",
  NO_COOKIE: "No encontramos el código. Pídeselo de nuevo a quien te recomendó.",
  SCHEMA_MISSING: "El programa de socios todavía no está activado en esta instalación.",
  PROGRAM_DISABLED: "El programa de socios está pausado por ahora.",
  INVALID_CODE: "Ese código no existe. Revísalo con quien te recomendó.",
  INACTIVE_ACCOUNT: "Ese código ya no está activo.",
  SELF_REFERRAL: "No puedes usar tu propio código.",
  SAME_FAMILY: "Ese código es de otra sede de tu misma barbería.",
  SAME_OWNER: "Ese código pertenece a una cuenta del mismo dueño.",
  CYCLE: "Esa barbería ya entró por tu recomendación: no pueden recomendarse entre sí.",
  ALREADY_ATTRIBUTED: "Ya tienes registrado quién te recomendó.",
};

const WINDOW_MS = BARBER_AFF_COOKIE_DAYS * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const auth = await requireBarberAffiliates();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readJsonBody(req);
    const code = normalizeBarberAffCode(body.code);
    if (!code) {
      return NextResponse.json(
        { ok: false, reason: "INVALID_CODE", error: MESSAGES.INVALID_CODE },
        { status: 400 },
      );
    }

    // La barbería referida es SIEMPRE la matriz: abrir una sucursal no es
    // una atribución nueva.
    const referredBarbershopId = rootBarbershopIdOf(auth.ctx);

    const ageMs = Date.now() - new Date(auth.ctx.barbershop.createdAt).getTime();
    if (ageMs > WINDOW_MS) {
      return NextResponse.json(
        {
          ok: false,
          reason: "WINDOW_CLOSED",
          error: `El código solo se puede registrar durante los primeros ${BARBER_AFF_COOKIE_DAYS} días de tu barbería.`,
        },
        { status: 409 },
      );
    }

    const result = await claimBarberReferralByCode({
      referredBarbershopId,
      code,
      // Sin cookie no hay fecha de clic: se sella con la de HOY, que es la
      // única que podemos probar.
      firstTouchAt: new Date(),
    });

    return NextResponse.json(
      { ok: result.ok, reason: result.reason, message: MESSAGES[result.reason] },
      { status: result.ok ? 200 : 409 },
    );
  } catch (err) {
    return affiliatesErrorResponse(err);
  }
}
